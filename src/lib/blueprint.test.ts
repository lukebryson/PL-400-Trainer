/**
 * The blueprint weights are the one table in the app that nothing else can
 * check. They drive simulator sampling, `scaleScore` and every projected score,
 * and a wrong one is silent: the app keeps working and quietly drills the wrong
 * mix for a month.
 *
 * That is what happened. `integrations` carried 0.175 against its own displayed
 * band of 10–15% because the 5pp residual — the published midpoints sum to 95%,
 * not 100% — had been dumped entirely on it. The simulator's setup table printed
 * "Develop integrations · 10–15% · ~9 questions" for a 50-question paper, and 9
 * of 50 is 17.5%. The row contradicted itself on screen for the whole of Phase 2
 * and no test noticed, because no test asserted the weights against the bands.
 *
 * These are those assertions.
 */
import { describe, expect, it } from 'vitest';
import { SKILL_AREAS, type SkillAreaKey } from '../types';

const KEYS = Object.keys(SKILL_AREAS) as SkillAreaKey[];

describe('blueprint weights', () => {
  it('covers the six areas the March 2026 study guide names, and only those', () => {
    expect(KEYS.sort()).toEqual(
      [
        'apps-improvements',
        'build-solutions',
        'extend-platform',
        'extend-ux',
        'integrations',
        'technical-design',
      ].sort(),
    );
  });

  it('sums to exactly 1', () => {
    const total = KEYS.reduce((sum, k) => sum + SKILL_AREAS[k].weight, 0);
    // Rational arithmetic gives 38/38. Floating point lands a few ulps away, so
    // assert to 12 places rather than on identity.
    expect(total).toBeCloseTo(1, 12);
  });

  /**
   * The assertion that was missing. Every weight must sit inside the band
   * printed beside it, because the simulator renders both on the same row and
   * the dashboard renders the weight as a share of the exam.
   */
  it.each(KEYS)('places %s inside its own published band', (key) => {
    const { band, weight } = SKILL_AREAS[key];
    const pct = weight * 100;
    expect(pct).toBeGreaterThanOrEqual(band[0]);
    expect(pct).toBeLessThanOrEqual(band[1]);
  });

  /**
   * Pins the residual policy itself, not just its result. Scaling every
   * midpoint by the same factor is what keeps the areas in proportion; if
   * someone later moves the residual onto one area again, the sum and the bands
   * might still pass while the relative weighting has quietly changed.
   */
  it('scales every band midpoint by the same factor', () => {
    const midpoint = (k: SkillAreaKey) => (SKILL_AREAS[k].band[0] + SKILL_AREAS[k].band[1]) / 2;
    const factors = KEYS.map((k) => (SKILL_AREAS[k].weight * 100) / midpoint(k));
    // 100 / 95 — the published midpoints are 5pp short of the whole exam.
    const expected = 100 / 95;
    for (const f of factors) expect(f).toBeCloseTo(expected, 12);
  });

  it('keeps extend-platform dominant at 2.6x every other area', () => {
    for (const k of KEYS) {
      if (k === 'extend-platform') continue;
      expect(SKILL_AREAS['extend-platform'].weight / SKILL_AREAS[k].weight).toBeCloseTo(2.6, 12);
    }
    // And it is the single heaviest, which `selectors.ts` relies on when it
    // orders areas by weight.
    const heaviest = KEYS.reduce((a, b) => (SKILL_AREAS[a].weight >= SKILL_AREAS[b].weight ? a : b));
    expect(heaviest).toBe('extend-platform');
  });

  it('publishes bands that are ordered, positive and plausible', () => {
    for (const k of KEYS) {
      const [lo, hi] = SKILL_AREAS[k].band;
      expect(lo).toBeLessThan(hi);
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeLessThanOrEqual(100);
      expect(SKILL_AREAS[k].label.length).toBeGreaterThan(0);
    }
  });
});
