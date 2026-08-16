/**
 * Small pieces the drill and the simulator both need. Kept out of `src/lib/`
 * because none of it is persistence or scheduling — it is session bookkeeping.
 */
import type { Session, SessionMode, SessionQuestionResult, SkillAreaKey } from '../types';
import { SKILL_AREAS } from '../types';

/**
 * `crypto.randomUUID` is not present in every test environment, and a session id
 * only has to be unique within one browser's history.
 */
export const newSessionId = (): string => {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') return globalThis.crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const startSession = (mode: SessionMode, at: number = Date.now()): Session => ({
  id: newSessionId(),
  mode,
  startedAt: at,
  finishedAt: null,
  results: [],
  scaledScore: null,
});

export const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * The exam's 0–1000 scale from one sitting's results.
 *
 * Weighted by the blueprint, not by how many questions of each area happened to
 * be drawn — a sample that came up one short on `extend-platform` must not make
 * the score depend on which questions the seed picked. Areas absent from the
 * sitting are dropped and the remaining weights renormalised, so a 40-question
 * exam that misses an area scores what it measured rather than scoring a zero
 * for what it never asked.
 */
export const scaleScore = (results: readonly SessionQuestionResult[]): number => {
  if (results.length === 0) return 0;

  const tally = new Map<SkillAreaKey, { seen: number; correct: number }>();
  for (const r of results) {
    const t = tally.get(r.skillArea) ?? { seen: 0, correct: 0 };
    t.seen += 1;
    if (r.correct) t.correct += 1;
    tally.set(r.skillArea, t);
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const [area, t] of tally) {
    const weight = SKILL_AREAS[area]?.weight ?? 0;
    weighted += weight * (t.correct / t.seen);
    totalWeight += weight;
  }

  return totalWeight === 0 ? 0 : Math.round(1000 * (weighted / totalWeight));
};
