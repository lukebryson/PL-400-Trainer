import { describe, expect, it } from 'vitest';
import {
  SKILL_AREAS,
  type Attempt,
  type Confidence,
  type ProgressRecord,
  type Question,
  type Session,
  type SessionQuestionResult,
  type SkillAreaKey,
} from '../types';
import { drillable, gradable, questionsByArea } from './bank';
import { DAY_MS, applyAttempt, newRecord } from './leitner';
import {
  SKILL_AREA_KEYS,
  allocateByBlueprint,
  areaScore,
  dedupeByHash,
  dueQuestions,
  paperShape,
  ragFor,
  readiness,
  sampleExam,
  selectDrill,
  sessionStats,
  weakQuestions,
} from './selectors';

const T0 = Date.UTC(2026, 7, 15, 9, 0, 0);

const answer = (
  map: Map<string, ProgressRecord>,
  q: Question,
  correct: boolean,
  confidence: Confidence = 'confident',
  at = T0,
): void => {
  const attempt: Attempt = { at, correct, confidence, selfGraded: false, elapsedMs: 30_000 };
  const existing = map.get(q.contentHash) ?? newRecord(q.contentHash);
  map.set(q.contentHash, applyAttempt(existing, attempt));
};

const uniqueDrillable = dedupeByHash(drillable);

describe('dueQuestions', () => {
  it('treats every unseen question as due and keeps q266 out', () => {
    const due = dueQuestions(new Map(), T0);
    expect(due).toHaveLength(uniqueDrillable.length);
    expect(due.some((q) => q.id === 266)).toBe(false);
  });

  it('drops a card until its interval has elapsed', () => {
    const q = uniqueDrillable[0]!;
    const progress = new Map<string, ProgressRecord>();
    answer(progress, q, true); // box 2, due in one day
    expect(dueQuestions(progress, T0).some((d) => d.contentHash === q.contentHash)).toBe(false);
    expect(dueQuestions(progress, T0 + DAY_MS).some((d) => d.contentHash === q.contentHash)).toBe(
      true,
    );
  });

  it('brings a wrong card straight back', () => {
    const q = uniqueDrillable[0]!;
    const progress = new Map<string, ProgressRecord>();
    answer(progress, q, false);
    expect(dueQuestions(progress, T0).some((d) => d.contentHash === q.contentHash)).toBe(true);
  });
});

describe('selectDrill', () => {
  it('never serves the same contentHash twice — the bank has three duplicate pairs', () => {
    const picked = selectDrill(new Map(), { dueOnly: false });
    const hashes = new Set(picked.map((q) => q.contentHash));
    expect(hashes.size).toBe(picked.length);
    expect(picked).toHaveLength(uniqueDrillable.length);
    expect(picked.length).toBeLessThan(drillable.length); // 436 of 439
  });

  it('is deterministic for a seed and different across seeds', () => {
    const a = selectDrill(new Map(), { dueOnly: false, seed: 7, limit: 20 });
    const b = selectDrill(new Map(), { dueOnly: false, seed: 7, limit: 20 });
    const c = selectDrill(new Map(), { dueOnly: false, seed: 8, limit: 20 });
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(a.map((q) => q.id)).not.toEqual(c.map((q) => q.id));
  });

  it('ANDs the filters', () => {
    const area: SkillAreaKey = 'extend-platform';
    const picked = selectDrill(new Map(), {
      area,
      type: 'mcq-single',
      gradedOnly: true,
      dueOnly: false,
    });
    expect(picked.length).toBeGreaterThan(0);
    for (const q of picked) {
      expect(q.skillArea).toBe(area);
      expect(q.type).toBe('mcq-single');
      expect(q.selfGraded).toBe(false);
    }
  });

  it('honours wrongTwice', () => {
    const progress = new Map<string, ProgressRecord>();
    const [a, b] = [uniqueDrillable[0]!, uniqueDrillable[1]!];
    answer(progress, a, false, 'guessed', T0);
    answer(progress, a, false, 'guessed', T0 + 1000);
    answer(progress, b, false, 'guessed', T0);
    const picked = selectDrill(progress, { wrongTwice: true, dueOnly: false });
    expect(picked.map((q) => q.contentHash)).toEqual([a.contentHash]);
  });

  it('defaults to due-only, as the contract states', () => {
    const q = uniqueDrillable[0]!;
    const progress = new Map<string, ProgressRecord>();
    answer(progress, q, true);
    const picked = selectDrill(progress, {}, T0);
    expect(picked.some((p) => p.contentHash === q.contentHash)).toBe(false);
    expect(picked).toHaveLength(uniqueDrillable.length - 1);
  });

  it('caps at the limit', () => {
    expect(selectDrill(new Map(), { dueOnly: false, limit: 15 })).toHaveLength(15);
  });
});

describe('readiness', () => {
  it('reads zero and points at a first drill when nothing is attempted', () => {
    const r = readiness(new Map(), T0);
    expect(r.projectedScore).toBe(0);
    expect(r.onTrack).toBe(false);
    expect(r.areas.every((a) => a.rag === 'red')).toBe(true);
    expect(r.areas.map((a) => a.area)).toEqual(SKILL_AREA_KEYS);
    expect(r.nextAction.href).toBe('#/drill');
    expect(r.daysToExam).toBe(33); // 15 August to 17 September 2026
  });

  it('counts only the most recent attempt on each question', () => {
    const area: SkillAreaKey = 'integrations';
    const pool = dedupeByHash(questionsByArea(area));
    const q = pool[0]!;
    const progress = new Map<string, ProgressRecord>();
    answer(progress, q, false, 'confident', T0);
    answer(progress, q, true, 'confident', T0 + 1000);
    const a = readiness(progress, T0).areas.find((x) => x.area === area)!;
    expect(a.attempted).toBe(1);
    expect(a.accuracy).toBe(1);
    expect(a.coverage).toBeCloseTo(1 / pool.length, 10);
  });

  it('will not call thin coverage mastery', () => {
    const area: SkillAreaKey = 'build-solutions';
    const pool = dedupeByHash(questionsByArea(area));
    const progress = new Map<string, ProgressRecord>();
    for (const q of pool.slice(0, 5)) answer(progress, q, true);
    const a = readiness(progress, T0).areas.find((x) => x.area === area)!;
    expect(a.accuracy).toBe(1);
    // Perfect accuracy on 5 of ~35 scores well under the green threshold.
    expect(areaScore(a)).toBeLessThan(0.75);
    expect(a.rag).not.toBe('green');
  });

  it('projects 1000 for a perfect, complete bank and honours the pass mark', () => {
    const progress = new Map<string, ProgressRecord>();
    for (const q of uniqueDrillable) answer(progress, q, true);
    const r = readiness(progress, T0);
    expect(r.projectedScore).toBe(1000);
    expect(r.onTrack).toBe(true);
    expect(r.areas.every((a) => a.rag === 'green')).toBe(true);
    expect(r.nextAction.href).toBe('#/simulator');
  });

  it('weights the next action by blueprint value, not by raw weakness', () => {
    const progress = new Map<string, ProgressRecord>();
    // Two weak areas: a 12.5% one at zero, and the 32.5% one at roughly a
    // third right. The lighter area is weaker, but the heavyweight is worth
    // more marks, so it is the one to drill.
    for (const q of uniqueDrillable) {
      const correct = !(q.skillArea === 'technical-design' || q.skillArea === 'extend-platform');
      answer(progress, q, correct);
    }
    for (const q of dedupeByHash(questionsByArea('extend-platform')).slice(0, 40)) {
      answer(progress, q, true, 'confident', T0 + 1000);
    }
    const areas = readiness(progress, T0).areas;
    expect(areaScore(areas.find((a) => a.area === 'technical-design')!)).toBe(0);
    expect(areaScore(areas.find((a) => a.area === 'extend-platform')!)).toBeLessThan(0.46);
    const r = readiness(progress, T0);
    expect(r.nextAction.href).toBe('#/drill?area=extend-platform');
    expect(r.projectedScore).toBeGreaterThan(0);
    expect(r.projectedScore).toBeLessThan(1000);
  });

  it('bands RAG on the area score', () => {
    expect(ragFor(0.75)).toBe('green');
    expect(ragFor(0.7499)).toBe('amber');
    expect(ragFor(0.55)).toBe('amber');
    expect(ragFor(0.5499)).toBe('red');
  });
});

describe('sampleExam', () => {
  // Acceptance criterion 4: sampling follows the blueprint, not the bank's mix.
  it('lands within 3 points of every blueprint weight over 1,000 exams', () => {
    const counts = new Map<SkillAreaKey, number>(SKILL_AREA_KEYS.map((k) => [k, 0]));
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const exam = sampleExam(new Map(), 50, i);
      expect(exam).toHaveLength(50);
      for (const q of exam) {
        counts.set(q.skillArea, counts.get(q.skillArea)! + 1);
        total += 1;
      }
    }
    expect(total).toBe(50_000);
    for (const area of SKILL_AREA_KEYS) {
      const share = counts.get(area)! / total;
      expect(
        Math.abs(share - SKILL_AREAS[area].weight),
        `${area} sampled at ${(share * 100).toFixed(2)}% against a ${(SKILL_AREAS[area].weight * 100).toFixed(1)}% weight`,
      ).toBeLessThan(0.03);
    }
  });

  it('does not simply mirror the bank’s own mix', () => {
    // The bank is ~30% extend-platform; the blueprint says 32.5%.
    const bankShare =
      uniqueDrillable.filter((q) => q.skillArea === 'extend-platform').length /
      uniqueDrillable.length;
    const exam = sampleExam(new Map(), 60, 42);
    const examShare = exam.filter((q) => q.skillArea === 'extend-platform').length / exam.length;
    expect(Math.abs(examShare - SKILL_AREAS['extend-platform'].weight)).toBeLessThan(
      Math.abs(bankShare - SKILL_AREAS['extend-platform'].weight) + 0.02,
    );
  });

  it('sums to exactly the requested count for every plausible exam length', () => {
    for (let n = 40; n <= 60; n++) {
      const alloc = allocateByBlueprint(n);
      const sum = SKILL_AREA_KEYS.reduce((s, k) => s + alloc[k], 0);
      expect(sum).toBe(n);
      expect(sampleExam(new Map(), n, n)).toHaveLength(n);
    }
  });

  /**
   * The simulator's setup table renders `paperShape` under a column headed
   * "Questions in this paper", so the column has to total the paper. It used to
   * round the weights itself — a different function from largest-remainder
   * allocation, and one that disagrees: with five areas sharing a weight,
   * `Math.round(weight × 40)` gives six counts summing to 39.
   */
  it('shapes a paper that totals the paper length and matches what is drawn', () => {
    for (const n of [40, 50, 60]) {
      const shape = paperShape(n);
      expect(SKILL_AREA_KEYS.reduce((s, k) => s + shape[k], 0)).toBe(n);

      // And it is the allocation `sampleExam` actually draws, not a parallel one.
      const drawn = sampleExam(new Map(), n, 7);
      for (const area of SKILL_AREA_KEYS) {
        expect(drawn.filter((q) => q.skillArea === area)).toHaveLength(shape[area]);
      }

      // Every row stays inside the band printed beside it — the defect that
      // started this: integrations read 9 of 50 against a band of 10–15%.
      for (const area of SKILL_AREA_KEYS) {
        const pct = (shape[area]! / n) * 100;
        const [lo, hi] = SKILL_AREAS[area].band;
        expect(pct).toBeGreaterThanOrEqual(lo);
        expect(pct).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('never over-draws an area — build-solutions is the thinnest pool', () => {
    for (const area of SKILL_AREA_KEYS) {
      const pool = dedupeByHash(questionsByArea(area)).length;
      for (let n = 40; n <= 60; n++) {
        expect(allocateByBlueprint(n)[area]).toBeLessThanOrEqual(pool);
      }
    }
    expect(dedupeByHash(questionsByArea('build-solutions')).length).toBeGreaterThanOrEqual(35);
  });

  it('redistributes rather than short-changing the exam when a pool is capped', () => {
    const capacity = Object.fromEntries(SKILL_AREA_KEYS.map((k) => [k, 100])) as Record<
      SkillAreaKey,
      number
    >;
    capacity['build-solutions'] = 1;
    const alloc = allocateByBlueprint(60, capacity);
    expect(alloc['build-solutions']).toBe(1);
    expect(SKILL_AREA_KEYS.reduce((s, k) => s + alloc[k], 0)).toBe(60);
  });

  it('prefers machine-gradable questions', () => {
    const exam = sampleExam(new Map(), 50, 3);
    const selfGraded = exam.filter((q) => q.selfGraded).length;
    expect(selfGraded).toBe(0);
    expect(exam.every((q) => gradable.some((g) => g.contentHash === q.contentHash))).toBe(true);
  });

  it('deduplicates and is reproducible from its seed', () => {
    const a = sampleExam(new Map(), 60, 11);
    const b = sampleExam(new Map(), 60, 11);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(new Set(a.map((q) => q.contentHash)).size).toBe(a.length);
  });
});

describe('weakQuestions', () => {
  it('defaults to wrong at least twice, worst first', () => {
    const progress = new Map<string, ProgressRecord>();
    const [a, b, c] = [uniqueDrillable[0]!, uniqueDrillable[1]!, uniqueDrillable[2]!];
    for (let i = 0; i < 3; i++) answer(progress, a, false, 'guessed', T0 + i);
    for (let i = 0; i < 2; i++) answer(progress, b, false, 'guessed', T0 + i);
    answer(progress, c, false, 'guessed', T0);
    const weak = weakQuestions(progress);
    expect(weak.map((q) => q.contentHash)).toEqual([a.contentHash, b.contentHash]);
  });

  it('can include shaky correct answers', () => {
    const progress = new Map<string, ProgressRecord>();
    const q = uniqueDrillable[0]!;
    answer(progress, q, true, 'guessed');
    expect(weakQuestions(progress)).toEqual([]);
    expect(weakQuestions(progress, { includeShaky: true }).map((x) => x.id)).toEqual([q.id]);
  });

  it('filters by area and caps at the limit', () => {
    const progress = new Map<string, ProgressRecord>();
    for (const q of uniqueDrillable) {
      answer(progress, q, false, 'guessed', T0);
      answer(progress, q, false, 'guessed', T0 + 1);
    }
    const weak = weakQuestions(progress, { area: 'extend-ux', limit: 5 });
    expect(weak).toHaveLength(5);
    expect(weak.every((q) => q.skillArea === 'extend-ux')).toBe(true);
  });
});

describe('sessionStats', () => {
  const result = (q: Question, correct: boolean): SessionQuestionResult => ({
    contentHash: q.contentHash,
    questionId: q.id,
    correct,
    confidence: 'confident',
    skillArea: q.skillArea,
    elapsedMs: 20_000,
  });

  const session = (id: string, startedAt: number, results: SessionQuestionResult[]): Session => ({
    id,
    mode: 'drill',
    startedAt,
    finishedAt: startedAt + 600_000,
    results,
    scaledScore: null,
  });

  it('reports nothing gracefully', () => {
    const s = sessionStats([], T0);
    expect(s.totalAttempts).toBe(0);
    expect(s.accuracy).toBe(0);
    expect(s.byDay).toEqual([]);
    expect(s.remaining).toBe(uniqueDrillable.length);
    expect(s.onPace).toBe(false);
    expect(s.lastStudiedAt).toBeNull();
  });

  it('buckets by day, tracks accuracy and measures velocity against the exam', () => {
    const qs = uniqueDrillable.slice(0, 30);
    const dayOne = session(
      's1',
      T0 - DAY_MS,
      qs.slice(0, 10).map((q, i) => result(q, i < 6)),
    );
    const dayTwo = session(
      's2',
      T0,
      qs.slice(10, 30).map((q, i) => result(q, i < 18)),
    );
    const s = sessionStats([dayTwo, dayOne], T0);
    expect(s.sessions).toBe(2);
    expect(s.totalAttempts).toBe(30);
    expect(s.totalCorrect).toBe(24);
    expect(s.accuracy).toBeCloseTo(0.8, 10);
    expect(s.byDay).toHaveLength(2);
    expect(s.byDay[0]!.date < s.byDay[1]!.date).toBe(true);
    expect(s.activeDays).toBe(2);
    expect(s.attemptsPerDay).toBe(15);
    expect(s.distinctSeen).toBe(30);
    expect(s.remaining).toBe(uniqueDrillable.length - 30);
    expect(s.daysToExam).toBe(33);
    expect(s.requiredPerDay).toBe(Math.ceil((uniqueDrillable.length - 30) / 33));
    expect(s.onPace).toBe(s.attemptsPerDay >= s.requiredPerDay);
    expect(s.lastStudiedAt).toBe(T0);
  });

  it('rolls accuracy over the recent window only', () => {
    const qs = uniqueDrillable.slice(0, 60);
    const old = session(
      's1',
      T0 - DAY_MS,
      qs.slice(0, 10).map((q) => result(q, false)),
    );
    const recent = session(
      's2',
      T0,
      qs.slice(10, 60).map((q) => result(q, true)),
    );
    const s = sessionStats([old, recent], T0);
    expect(s.accuracy).toBeCloseTo(50 / 60, 10);
    expect(s.rollingAccuracy).toBe(1);
  });
});
