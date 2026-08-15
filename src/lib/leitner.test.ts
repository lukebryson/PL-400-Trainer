import { describe, expect, it } from 'vitest';
import type { Attempt, Confidence, LeitnerBox, ProgressRecord } from '../types';
import {
  BOX_INTERVAL_DAYS,
  DAY_MS,
  applyAttempt,
  hasBeenAttempted,
  isDue,
  lastCorrect,
  newRecord,
  nextState,
} from './leitner';

const T0 = Date.UTC(2026, 7, 15, 9, 0, 0);

const attempt = (correct: boolean, confidence: Confidence, at = T0): Attempt => ({
  at,
  correct,
  confidence,
  selfGraded: false,
  elapsedMs: 30_000,
});

const at = (box: LeitnerBox, attempts: Attempt[] = []): ProgressRecord => ({
  ...newRecord('hash'),
  box,
  attempts,
  timesWrong: attempts.filter((a) => !a.correct).length,
});

describe('newRecord', () => {
  it('starts in box 1 and is due immediately', () => {
    const r = newRecord('abc');
    expect(r.box).toBe(1);
    expect(r.dueAt).toBe(0);
    expect(isDue(r, T0)).toBe(true);
    expect(hasBeenAttempted(r)).toBe(false);
  });

  it('treats an unseen question as due', () => {
    expect(isDue(undefined, T0)).toBe(true);
  });
});

describe('nextState — promotion', () => {
  it('promotes one box at a time on a confident correct answer', () => {
    const boxes: LeitnerBox[] = [1, 2, 3, 4, 5];
    const expected: LeitnerBox[] = [2, 3, 4, 5, 5];
    boxes.forEach((box, i) => {
      expect(nextState(at(box), true, 'confident', T0).box).toBe(expected[i]);
    });
  });

  it('promotes an unsure correct answer normally', () => {
    expect(nextState(at(3), true, 'unsure', T0).box).toBe(4);
  });

  it('schedules by the compressed interval table', () => {
    const { box, dueAt } = nextState(at(2), true, 'confident', T0);
    expect(box).toBe(3);
    expect(dueAt).toBe(T0 + BOX_INTERVAL_DAYS[3] * DAY_MS);
    expect(BOX_INTERVAL_DAYS).toEqual({ 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 });
  });
});

describe('nextState — wrong', () => {
  it('resets to box 1 from every box, whatever the confidence', () => {
    for (const box of [1, 2, 3, 4, 5] as LeitnerBox[]) {
      for (const c of ['guessed', 'unsure', 'confident'] as Confidence[]) {
        expect(nextState(at(box), false, c, T0).box).toBe(1);
      }
    }
  });

  it('brings a wrong card back in the same session', () => {
    expect(nextState(at(5), false, 'confident', T0).dueAt).toBe(T0);
  });
});

describe('nextState — guessed', () => {
  it('promotes box 1 to box 2 but no further', () => {
    expect(nextState(at(1), true, 'guessed', T0).box).toBe(2);
    expect(nextState(at(2), true, 'guessed', T0).box).toBe(2);
    expect(nextState(at(3), true, 'guessed', T0).box).toBe(3);
    expect(nextState(at(4), true, 'guessed', T0).box).toBe(4);
  });

  it('never promotes on two guessed correct answers running', () => {
    const first = at(1, [attempt(true, 'guessed')]);
    expect(nextState(first, true, 'guessed', T0).box).toBe(1);
  });

  it('promotes again once a guess follows a real answer', () => {
    const after = at(1, [attempt(true, 'confident'), attempt(false, 'guessed')]);
    expect(nextState(after, true, 'guessed', T0).box).toBe(2);
  });
});

describe('applyAttempt', () => {
  it('appends the attempt, moves the box and counts the wrong ones', () => {
    let r = newRecord('abc');
    r = applyAttempt(r, attempt(true, 'confident', T0));
    expect(r.box).toBe(2);
    expect(r.dueAt).toBe(T0 + DAY_MS);
    expect(r.attempts).toHaveLength(1);
    expect(r.timesWrong).toBe(0);
    expect(lastCorrect(r)).toBe(true);

    r = applyAttempt(r, attempt(false, 'unsure', T0 + DAY_MS));
    expect(r.box).toBe(1);
    expect(r.timesWrong).toBe(1);
    expect(lastCorrect(r)).toBe(false);
    expect(isDue(r, T0 + DAY_MS)).toBe(true);
  });

  it('keeps the user’s correction and notes across the move', () => {
    const r = applyAttempt(
      { ...newRecord('abc'), correction: 'The key should be C', notes: 'plug-in stages' },
      attempt(true, 'confident'),
    );
    expect(r.correction).toBe('The key should be C');
    expect(r.notes).toBe('plug-in stages');
  });

  it('does not mutate the record it is given', () => {
    const before = newRecord('abc');
    const snapshot = JSON.stringify(before);
    applyAttempt(before, attempt(false, 'guessed'));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('isDue', () => {
  it('holds a box 5 card for fourteen days and no longer', () => {
    const r = applyAttempt(at(4), attempt(true, 'confident'));
    expect(r.box).toBe(5);
    expect(isDue(r, T0 + 13 * DAY_MS)).toBe(false);
    expect(isDue(r, T0 + 14 * DAY_MS)).toBe(true);
  });
});
