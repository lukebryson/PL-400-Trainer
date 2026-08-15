/**
 * Question selection, readiness scoring and exam sampling. Pure functions: the
 * progress map is always an argument, never read from a store, so every
 * number on the dashboard can be reproduced in a test with a literal map.
 *
 * Hrefs are built as plain strings rather than imported from `src/router.ts`,
 * which pulls in React — these need to stay runnable in a bare Node test.
 *
 * Owned by the store agent.
 */
import {
  EXAM_DATE,
  PASS_MARK,
  SKILL_AREAS,
  type AreaReadiness,
  type ProgressRecord,
  type Question,
  type Rag,
  type Readiness,
  type Session,
  type SkillAreaKey,
} from '../types';
import { drillable, questionsByArea } from './bank';
import { DAY_MS, hasBeenAttempted, isDue, lastCorrect } from './leitner';
import type { DrillFilter } from './store-contract';

export type ProgressMap = ReadonlyMap<string, ProgressRecord>;

export const SKILL_AREA_KEYS = Object.keys(SKILL_AREAS) as SkillAreaKey[];

// ── Deterministic randomness ────────────────────────────────────────────────

/**
 * mulberry32. Thirty-two bits of state is ample for shuffling a 440-item bank,
 * and a seeded generator means a session can be resumed in the same order
 * after a reload. No dependency.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const shuffled = <T>(items: readonly T[], rand: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
};

/**
 * The bank holds three true-duplicate pairs (402/410, 403/411, 409/412) which
 * share a `contentHash` and therefore share a progress record. Serving both
 * halves in one session would mean answering the same question twice and
 * writing the second answer over the first.
 */
export const dedupeByHash = (qs: readonly Question[]): Question[] => {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const q of qs) {
    if (seen.has(q.contentHash)) continue;
    seen.add(q.contentHash);
    out.push(q);
  }
  return out;
};

// ── Pools, computed once ────────────────────────────────────────────────────

const AREA_POOL = Object.fromEntries(
  SKILL_AREA_KEYS.map((k) => [k, dedupeByHash(questionsByArea(k))]),
) as Record<SkillAreaKey, Question[]>;

/** Unique drillable questions — 436, not 439: q266 is out, duplicates collapse. */
const DRILLABLE_UNIQUE = dedupeByHash(drillable);

// ── Due and drill selection ─────────────────────────────────────────────────

/**
 * Unseen counts as due — a card you have never met is the most overdue thing
 * there is. `drillable` already excludes q266, the one dead end.
 */
export const dueQuestions = (progress: ProgressMap, now: number = Date.now()): Question[] =>
  DRILLABLE_UNIQUE.filter((q) => isDue(progress.get(q.contentHash), now));

/**
 * `dueOnly` defaults to true, as `DrillFilter` states: the default session
 * serves what the schedule says is due. A weak-area drill that wants the whole
 * pool must pass `dueOnly: false` explicitly.
 */
export const selectDrill = (
  progress: ProgressMap,
  filter: DrillFilter,
  now: number = Date.now(),
): Question[] => {
  const dueOnly = filter.dueOnly ?? true;
  const pool = dedupeByHash(filter.area ? AREA_POOL[filter.area] : DRILLABLE_UNIQUE).filter((q) => {
    if (filter.subtopic && q.subtopic !== filter.subtopic) return false;
    if (filter.type && q.type !== filter.type) return false;
    if (filter.gradedOnly && q.selfGraded) return false;
    const record = progress.get(q.contentHash);
    if (filter.wrongTwice && (record?.timesWrong ?? 0) < 2) return false;
    if (dueOnly && !isDue(record, now)) return false;
    return true;
  });

  const ordered = shuffled(pool, mulberry32(filter.seed ?? 1));
  return filter.limit === undefined ? ordered : ordered.slice(0, Math.max(0, filter.limit));
};

// ── Readiness ───────────────────────────────────────────────────────────────

/**
 * Thin coverage must not read as mastery: five for five in an area of eighty is
 * not a green light. Accuracy is scaled by a coverage factor running from 0.6
 * (nothing seen) to 1.0 (everything seen), so an untouched area cannot score
 * above 0.6 of its accuracy however well those few attempts went.
 */
export const areaScore = (a: Pick<AreaReadiness, 'accuracy' | 'coverage'>): number =>
  a.accuracy * (0.6 + 0.4 * a.coverage);

/** Green is "would pass comfortably", amber "would pass on a good day". */
export const ragFor = (score: number): Rag =>
  score >= 0.75 ? 'green' : score >= 0.55 ? 'amber' : 'red';

const TARGET_SCORE = 0.75;

export const daysToExam = (now: number = Date.now()): number =>
  Math.max(0, Math.ceil((EXAM_DATE.getTime() - now) / DAY_MS));

export const readiness = (progress: ProgressMap, now: number = Date.now()): Readiness => {
  const areas: AreaReadiness[] = SKILL_AREA_KEYS.map((area) => {
    const meta = SKILL_AREAS[area];
    const pool = AREA_POOL[area];
    let attempted = 0;
    let correct = 0;
    for (const q of pool) {
      const record = progress.get(q.contentHash);
      if (!hasBeenAttempted(record)) continue;
      attempted += 1;
      if (lastCorrect(record) === true) correct += 1;
    }
    const accuracy = attempted === 0 ? 0 : correct / attempted;
    const coverage = pool.length === 0 ? 0 : attempted / pool.length;
    return {
      area,
      label: meta.label,
      weight: meta.weight,
      total: pool.length,
      attempted,
      accuracy,
      coverage,
      rag: ragFor(areaScore({ accuracy, coverage })),
    };
  });

  const projectedScore = Math.round(
    1000 * areas.reduce((sum, a) => sum + a.weight * areaScore(a), 0),
  );

  return {
    areas,
    projectedScore,
    onTrack: projectedScore >= PASS_MARK,
    daysToExam: daysToExam(now),
    nextAction: nextAction(areas),
  };
};

/**
 * One instruction, not a list. The area maximising `weight × shortfall` is the
 * one where an hour buys the most marks — a red area worth 12.5% can be worth
 * less than an amber one worth 32.5%.
 */
const nextAction = (areas: AreaReadiness[]): Readiness['nextAction'] => {
  const totalAttempted = areas.reduce((n, a) => n + a.attempted, 0);
  if (totalAttempted === 0) {
    return {
      label: 'Start your first drill',
      detail: `${DRILLABLE_UNIQUE.length} questions, none attempted. Twenty now gives the dashboard something to measure.`,
      href: '#/drill',
    };
  }

  let best: AreaReadiness | null = null;
  let bestValue = 0;
  for (const a of areas) {
    const value = a.weight * Math.max(0, TARGET_SCORE - areaScore(a));
    if (value > bestValue) {
      bestValue = value;
      best = a;
    }
  }

  if (!best) {
    return {
      label: 'Sit a full simulator',
      detail: 'Every area is at or above target. The remaining risk is pacing, not recall.',
      href: '#/simulator',
    };
  }

  const gap = best.total - best.attempted;
  const detail =
    gap > 0 && best.coverage < 0.5
      ? `${Math.round(best.weight * 100)}% of the exam, ${gap} of ${best.total} still unseen.`
      : `${Math.round(best.weight * 100)}% of the exam, scoring ${Math.round(best.accuracy * 100)}% on ${best.attempted} attempted.`;

  return { label: `Drill ${best.label}`, detail, href: `#/drill?area=${best.area}` };
};

// ── Exam sampling ───────────────────────────────────────────────────────────

/**
 * Largest remainder, so the per-area counts sum to exactly `count` rather than
 * drifting by two or three after rounding. The tie-break on weight then key
 * keeps it deterministic.
 */
export const allocateByBlueprint = (
  count: number,
  capacity?: Readonly<Record<SkillAreaKey, number>>,
): Record<SkillAreaKey, number> => {
  const alloc = {} as Record<SkillAreaKey, number>;
  const remainders: { area: SkillAreaKey; frac: number }[] = [];
  let assigned = 0;

  for (const area of SKILL_AREA_KEYS) {
    const exact = SKILL_AREAS[area].weight * count;
    const floor = Math.floor(exact);
    alloc[area] = floor;
    assigned += floor;
    remainders.push({ area, frac: exact - floor });
  }

  remainders.sort(
    (a, b) =>
      b.frac - a.frac ||
      SKILL_AREAS[b.area].weight - SKILL_AREAS[a.area].weight ||
      a.area.localeCompare(b.area),
  );
  for (let i = 0; assigned < count && i < remainders.length; i++) {
    alloc[remainders[i]!.area] += 1;
    assigned += 1;
  }

  if (!capacity) return alloc;

  // Redistribute anything an area cannot supply. `build-solutions` is the
  // thinnest pool at 35, so a 60-question exam never gets near the ceiling —
  // but a filtered pool could, and silently short-changing the exam would be
  // worse than borrowing from the next-heaviest area.
  let overflow = 0;
  for (const area of SKILL_AREA_KEYS) {
    const over = alloc[area] - capacity[area];
    if (over > 0) {
      alloc[area] = capacity[area];
      overflow += over;
    }
  }
  const byWeight = [...SKILL_AREA_KEYS].sort(
    (a, b) => SKILL_AREAS[b].weight - SKILL_AREAS[a].weight || a.localeCompare(b),
  );
  while (overflow > 0) {
    const before = overflow;
    for (const area of byWeight) {
      if (overflow === 0) break;
      if (alloc[area] < capacity[area]) {
        alloc[area] += 1;
        overflow -= 1;
      }
    }
    if (overflow === before) break; // every pool is full; the exam is short
  }
  return alloc;
};

/**
 * Blueprint-weighted, not bank-weighted. The bank is 30.2% `extend-platform`
 * by accident of what the dump contains; the exam is 32.5% by design, and the
 * simulator has to reproduce the exam. Machine-gradable questions come first —
 * a simulator you have to mark yourself does not give a score — and an area
 * only draws on its self-graded pool once the gradable one is exhausted.
 */
export const sampleExam = (
  progress: ProgressMap,
  count: number,
  seed: number = Date.now(),
): Question[] => {
  const rand = mulberry32(seed);
  const now = Date.now();
  const capacity = Object.fromEntries(
    SKILL_AREA_KEYS.map((k) => [k, AREA_POOL[k].length]),
  ) as Record<SkillAreaKey, number>;
  const alloc = allocateByBlueprint(Math.max(0, count), capacity);

  const picked: Question[] = [];
  for (const area of SKILL_AREA_KEYS) {
    const want = alloc[area];
    if (want <= 0) continue;
    // Shuffle first, then a stable sort by preference tier: within a tier the
    // order stays random, between tiers it is strict.
    const ranked = shuffled(AREA_POOL[area], rand)
      .map((q) => {
        const record = progress.get(q.contentHash);
        const freshness = !hasBeenAttempted(record) ? 0 : isDue(record, now) ? 1 : 2;
        return { q, rank: (q.selfGraded ? 3 : 0) + freshness };
      })
      .sort((a, b) => a.rank - b.rank);
    for (const { q } of ranked.slice(0, want)) picked.push(q);
  }

  return dedupeByHash(shuffled(picked, rand));
};

// ── Weak areas and history ──────────────────────────────────────────────────

export interface WeakOptions {
  /** "Wrong at least twice" is the brief's default. */
  minWrong?: number;
  area?: SkillAreaKey;
  subtopic?: string;
  /** Also include cards answered correctly but flagged `guessed` or `unsure`. */
  includeShaky?: boolean;
  limit?: number;
}

/**
 * The wrong-answer list, ordered worst first. Used by the weak-area drill and
 * by the export, so the order has to be stable rather than shuffled.
 */
export const weakQuestions = (progress: ProgressMap, opts: WeakOptions = {}): Question[] => {
  const minWrong = opts.minWrong ?? 2;
  const scored: { q: Question; record: ProgressRecord; shaky: boolean }[] = [];

  for (const q of DRILLABLE_UNIQUE) {
    if (opts.area && q.skillArea !== opts.area) continue;
    if (opts.subtopic && q.subtopic !== opts.subtopic) continue;
    const record = progress.get(q.contentHash);
    if (!record || !hasBeenAttempted(record)) continue;
    const last = record.attempts[record.attempts.length - 1]!;
    const shaky = last.correct && last.confidence !== 'confident';
    if (record.timesWrong >= minWrong || (opts.includeShaky === true && shaky)) {
      scored.push({ q, record, shaky });
    }
  }

  scored.sort((a, b) => {
    const lastA = a.record.attempts[a.record.attempts.length - 1]!;
    const lastB = b.record.attempts[b.record.attempts.length - 1]!;
    return (
      b.record.timesWrong - a.record.timesWrong ||
      Number(lastA.correct) - Number(lastB.correct) ||
      lastB.at - lastA.at ||
      a.q.id - b.q.id
    );
  });

  const out = scored.map((s) => s.q);
  return opts.limit === undefined ? out : out.slice(0, Math.max(0, opts.limit));
};

export interface DayStat {
  /** Local `YYYY-MM-DD`. The user studies in one timezone; UTC would split evenings. */
  date: string;
  attempts: number;
  correct: number;
}

export interface SessionStats {
  sessions: number;
  totalAttempts: number;
  totalCorrect: number;
  accuracy: number;
  /** Over the last `ROLLING_WINDOW` attempts — the number that moves. */
  rollingAccuracy: number;
  byDay: DayStat[];
  activeDays: number;
  attemptsPerDay: number;
  distinctSeen: number;
  remaining: number;
  daysToExam: number;
  /** Attempts a day needed to see the rest of the bank once before 17 September. */
  requiredPerDay: number;
  onPace: boolean;
  lastStudiedAt: number | null;
}

export const ROLLING_WINDOW = 50;

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Velocity against 17 September 2026. `SessionQuestionResult` carries no
 * timestamp of its own, so attempts are bucketed by the session's start —
 * accurate to the session, which is the granularity the chart shows anyway.
 */
export const sessionStats = (
  sessions: readonly Session[],
  now: number = Date.now(),
): SessionStats => {
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const days = new Map<string, DayStat>();
  const seen = new Set<string>();
  const verdicts: boolean[] = [];
  let totalCorrect = 0;
  let lastStudiedAt: number | null = null;

  for (const session of ordered) {
    if (session.results.length > 0) lastStudiedAt = session.startedAt;
    const key = dayKey(session.startedAt);
    const day = days.get(key) ?? { date: key, attempts: 0, correct: 0 };
    for (const r of session.results) {
      seen.add(r.contentHash);
      verdicts.push(r.correct);
      day.attempts += 1;
      if (r.correct) {
        day.correct += 1;
        totalCorrect += 1;
      }
    }
    days.set(key, day);
  }

  const totalAttempts = verdicts.length;
  const recent = verdicts.slice(-ROLLING_WINDOW);
  const activeDays = [...days.values()].filter((d) => d.attempts > 0).length;
  const remaining = DRILLABLE_UNIQUE.length - seen.size;
  const left = daysToExam(now);
  const attemptsPerDay = activeDays === 0 ? 0 : totalAttempts / activeDays;
  const requiredPerDay = left === 0 ? remaining : Math.ceil(remaining / left);

  return {
    sessions: ordered.length,
    totalAttempts,
    totalCorrect,
    accuracy: totalAttempts === 0 ? 0 : totalCorrect / totalAttempts,
    rollingAccuracy:
      recent.length === 0 ? 0 : recent.filter(Boolean).length / recent.length,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    activeDays,
    attemptsPerDay,
    distinctSeen: seen.size,
    remaining,
    daysToExam: left,
    requiredPerDay,
    onPace: remaining === 0 || attemptsPerDay >= requiredPerDay,
    lastStudiedAt,
  };
};
