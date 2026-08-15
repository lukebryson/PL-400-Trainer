/**
 * Leitner scheduling. Pure — no storage, no clock of its own; `now` is always
 * passed in so the transitions are testable and a session can be replayed.
 *
 * Owned by the store agent.
 */
import type { Attempt, Confidence, LeitnerBox, ProgressRecord } from '../types';

export const DAY_MS = 86_400_000;

/**
 * Intervals in days. These are deliberately compressed against the textbook
 * 1/3/7/14/30 schedule: the exam is 17 September 2026 and there are only about
 * 33 days of runway, so a 30-day box 5 means "never seen again" — the card
 * would leave the rotation and never come back before the sitting. Box 5 at 14
 * days is the longest interval that still guarantees a second look.
 *
 * Box 1 is 0 days: a card you have just got wrong comes back in the same
 * session, which is the whole point of the first box.
 */
export const BOX_INTERVAL_DAYS: Record<LeitnerBox, number> = {
  1: 0,
  2: 1,
  3: 3,
  4: 7,
  5: 14,
};

export const MAX_BOX: LeitnerBox = 5;

const clampBox = (n: number): LeitnerBox => Math.min(5, Math.max(1, Math.round(n))) as LeitnerBox;

export const newRecord = (contentHash: string): ProgressRecord => ({
  contentHash,
  box: 1,
  // 0, not `now`: an unseen card is due immediately, and a record created
  // ahead of an attempt must not hide the question from the same session.
  dueAt: 0,
  attempts: [],
  timesWrong: 0,
  correction: null,
  notes: null,
});

export const isDue = (record: ProgressRecord | undefined, now: number = Date.now()): boolean =>
  record === undefined || record.dueAt <= now;

export const dueAtFor = (box: LeitnerBox, now: number): number =>
  now + BOX_INTERVAL_DAYS[box] * DAY_MS;

const lastAttempt = (record: ProgressRecord): Attempt | undefined =>
  record.attempts[record.attempts.length - 1];

/**
 * The next box and due date for one graded answer.
 *
 * Wrong always resets to box 1 — no partial credit, no half-step down. A card
 * you cannot answer is a card you have not learnt, whatever it scored before.
 *
 * Confidence modulates promotion but never demotion:
 *  - `guessed` and correct is a coin toss dressed as knowledge. It cannot carry
 *    a card past box 2, and it cannot promote twice running — two lucky guesses
 *    in a row leave the card exactly where it was.
 *  - `unsure` promotes normally; `selectors.weakQuestions` surfaces it instead,
 *    so shaky recall shows up on the dashboard rather than in the schedule.
 */
export const nextState = (
  record: ProgressRecord,
  correct: boolean,
  confidence: Confidence,
  now: number = Date.now(),
): { box: LeitnerBox; dueAt: number } => {
  if (!correct) return { box: 1, dueAt: dueAtFor(1, now) };

  const current = clampBox(record.box);
  let box: LeitnerBox;

  if (confidence === 'guessed') {
    const prev = lastAttempt(record);
    const guessedLastTime = prev?.correct === true && prev.confidence === 'guessed';
    box = guessedLastTime || current >= 2 ? current : 2;
  } else {
    box = clampBox(current + 1);
  }

  return { box, dueAt: dueAtFor(box, now) };
};

/**
 * The whole record after one attempt: schedule move, attempt appended, wrong
 * count maintained. Corrections and notes are the user's own and survive.
 */
export const applyAttempt = (
  record: ProgressRecord,
  attempt: Attempt,
): ProgressRecord => {
  const { box, dueAt } = nextState(record, attempt.correct, attempt.confidence, attempt.at);
  return {
    ...record,
    box,
    dueAt,
    attempts: [...record.attempts, attempt],
    timesWrong: record.timesWrong + (attempt.correct ? 0 : 1),
  };
};

/** Most recent verdict, or undefined if never attempted. */
export const lastCorrect = (record: ProgressRecord | undefined): boolean | undefined =>
  record && record.attempts.length > 0 ? lastAttempt(record)?.correct : undefined;

export const hasBeenAttempted = (record: ProgressRecord | undefined): boolean =>
  record !== undefined && record.attempts.length > 0;
