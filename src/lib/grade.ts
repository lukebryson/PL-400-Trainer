/**
 * Grading. Pure, synchronous, no storage. Owned by the orchestrator because
 * both the renderers and the features depend on it agreeing exactly.
 */
import type { Grade, Question, Response } from '../types';
import { isDeadEnd, responseKindFor } from './bank';

/**
 * Comparison for typed box answers. The bank's own text carries scanner typos
 * ("Server-side syncrhonization"), so an exact match would punish the user for
 * the extraction's mistakes. Normalise hard, then allow a small edit distance.
 */
export const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
};

/** Tolerates roughly one slip per eight characters. */
export const answersMatch = (given: string, expected: string): boolean => {
  const g = normalise(given);
  const e = normalise(expected);
  if (!g || !e) return false;
  if (g === e) return true;
  const allowed = Math.floor(Math.max(g.length, e.length) / 8);
  return allowed > 0 && editDistance(g, e) <= allowed;
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].map((s) => s.toUpperCase()).sort();
  const sb = [...b].map((s) => s.toUpperCase()).sort();
  return sa.every((v, i) => v === sb[i]);
};

/**
 * Multi-select is all-or-nothing: two of three right is wrong, exactly as the
 * exam scores it. Box answers are graded per box but the card is only correct
 * when every box is.
 */
export const grade = (q: Question, response: Response): Grade => {
  if (isDeadEnd(q)) {
    return { correct: false, perBox: null, selfGraded: true, ungradeable: true };
  }

  const kind = responseKindFor(q);

  if (kind === 'choice' && response.kind === 'choice') {
    return {
      correct: sameSet(response.keys, q.correct),
      perBox: null,
      selfGraded: false,
      ungradeable: false,
    };
  }

  if (kind === 'boxes' && response.kind === 'boxes') {
    const perBox = q.boxAnswers.map((b, i) => answersMatch(response.values[i] ?? '', b.answer));
    return {
      correct: perBox.length > 0 && perBox.every(Boolean),
      perBox,
      selfGraded: false,
      ungradeable: false,
    };
  }

  return {
    correct: response.kind === 'self' && response.verdict === 'correct',
    perBox: null,
    selfGraded: true,
    ungradeable: false,
  };
};
