import { describe, expect, it } from 'vitest';
import { SKILL_AREAS, type SessionQuestionResult, type SkillAreaKey } from '../types';
import { mmss, newSessionId, scaleScore, startSession } from './session';

const results = (spec: Partial<Record<SkillAreaKey, [right: number, wrong: number]>>) => {
  const out: SessionQuestionResult[] = [];
  let n = 0;
  for (const [area, [right, wrong]] of Object.entries(spec) as [
    SkillAreaKey,
    [number, number],
  ][]) {
    for (let i = 0; i < right + wrong; i++) {
      n += 1;
      out.push({
        contentHash: `h${n}`,
        questionId: n,
        correct: i < right,
        confidence: 'unsure',
        skillArea: area,
        elapsedMs: 60_000,
      });
    }
  }
  return out;
};

const ALL_AREAS = Object.keys(SKILL_AREAS) as SkillAreaKey[];
const evenly = (right: number, wrong: number) =>
  results(Object.fromEntries(ALL_AREAS.map((a) => [a, [right, wrong]])));

describe('scaleScore', () => {
  it('is 0 for an empty paper and 1000 for a clean sweep', () => {
    expect(scaleScore([])).toBe(0);
    expect(scaleScore(evenly(5, 0))).toBe(1000);
    expect(scaleScore(evenly(0, 5))).toBe(0);
  });

  /**
   * The whole reason this is not `correct / total`: the exam's weighting, not
   * the paper's mix, decides what a mistake costs.
   */
  /**
   * Sit a paper that is perfect except in one area, and the score must be
   * `1000 × (1 − that area's blueprint weight)` — every area was asked, so
   * there is nothing to renormalise. Stated as the model rather than as a
   * literal, because renormalising the blueprint changes every one of these
   * numbers and a test full of magic constants would then have to be edited
   * into agreement with whatever the code now does.
   */
  const allRightExcept = (wrongArea: SkillAreaKey) =>
    scaleScore(
      results(
        Object.fromEntries(
          ALL_AREAS.map((a) => [a, a === wrongArea ? [0, 10] : [10, 0]]),
        ) as Record<SkillAreaKey, [number, number]>,
      ),
    );

  it('weights by the blueprint, not by how many of each area were drawn', () => {
    for (const area of ALL_AREAS) {
      expect(allRightExcept(area)).toBe(Math.round(1000 * (1 - SKILL_AREAS[area].weight)));
    }

    // And the dominant area really does cost more than a light one: 2.6x, the
    // ratio the blueprint sets. Approximate because `scaleScore` rounds to
    // whole marks — the penalties are 342 and 132, which is 2.59, not 2.60.
    const heavy = 1000 - allRightExcept('extend-platform');
    const light = 1000 - allRightExcept('extend-ux');
    expect(heavy / light).toBeCloseTo(2.6, 1);
  });

  it('does not let an oversampled area buy the score back', () => {
    // Forty easy `extend-platform` questions right, one light area wrong. The
    // forty must buy nothing: the penalty is the light area's blueprint weight,
    // exactly as if it had been asked twice.
    const spec = Object.fromEntries(
      ALL_AREAS.map((a) => [
        a,
        a === 'extend-platform' ? [40, 0] : a === 'extend-ux' ? [0, 2] : [2, 0],
      ]),
    ) as Record<SkillAreaKey, [number, number]>;
    expect(scaleScore(results(spec))).toBe(
      Math.round(1000 * (1 - SKILL_AREAS['extend-ux'].weight)),
    );
    // Same figure as the evenly-sampled paper above — that is the whole point.
    expect(scaleScore(results(spec))).toBe(allRightExcept('extend-ux'));
  });

  /**
   * A 40-question paper can miss an area entirely. Scoring the gap as a zero
   * would make the result depend on the seed rather than on the answers.
   */
  it('renormalises over the areas actually asked', () => {
    const half = scaleScore(results({ 'extend-platform': [1, 0], integrations: [0, 1] }));
    const weight = SKILL_AREAS['extend-platform'].weight;
    const total = weight + SKILL_AREAS.integrations.weight;
    expect(half).toBe(Math.round(1000 * (weight / total)));
  });
});

describe('session bookkeeping', () => {
  it('starts a session with no results and no score', () => {
    const s = startSession('simulator', 1000);
    expect(s).toMatchObject({ mode: 'simulator', startedAt: 1000, finishedAt: null, scaledScore: null });
    expect(s.results).toEqual([]);
    expect(s.id).not.toBe(startSession('drill').id);
  });

  it('generates an id even where crypto.randomUUID is missing', () => {
    expect(newSessionId()).toMatch(/\S/);
  });

  it('formats the clock', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-500)).toBe('0:00');
    expect(mmss(65_000)).toBe('1:05');
    expect(mmss(6_000_000)).toBe('100:00');
  });
});
