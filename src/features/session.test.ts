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
  it('weights by the blueprint, not by how many of each area were drawn', () => {
    // Everything right except `extend-platform`, which is 32.5% of the exam.
    const spec = Object.fromEntries(
      ALL_AREAS.map((a) => [a, a === 'extend-platform' ? [0, 10] : [10, 0]]),
    ) as Record<SkillAreaKey, [number, number]>;
    expect(scaleScore(results(spec))).toBe(675);

    // The same number of wrong answers in a 12.5% area costs far less.
    const light = Object.fromEntries(
      ALL_AREAS.map((a) => [a, a === 'extend-ux' ? [0, 10] : [10, 0]]),
    ) as Record<SkillAreaKey, [number, number]>;
    expect(scaleScore(results(light))).toBe(875);
  });

  it('does not let an oversampled area buy the score back', () => {
    // Forty easy `extend-platform` questions right, one light area wrong: the
    // score is still 87.5%, because weight comes from the blueprint.
    const spec = Object.fromEntries(
      ALL_AREAS.map((a) => [
        a,
        a === 'extend-platform' ? [40, 0] : a === 'extend-ux' ? [0, 2] : [2, 0],
      ]),
    ) as Record<SkillAreaKey, [number, number]>;
    expect(scaleScore(results(spec))).toBe(875);
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
