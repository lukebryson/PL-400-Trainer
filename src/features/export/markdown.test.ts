/**
 * Acceptance criterion 6: the export has to be condensed enough to hand-write.
 * "If it runs to pages of prose it has failed" is not a testable sentence, so
 * it is pinned to the density model the page itself displays — characters,
 * wrapped lines, A5 sides — and the budget is asserted rather than eyeballed.
 *
 * Fixtures come from the real bank. An invented question would not carry the
 * five-box drag-and-drop answer or the five-paragraph explanation that are the
 * two things actually capable of blowing the budget.
 */
import { describe, expect, it } from 'vitest';
import { drillable, questionById, responseKindFor } from '../../lib/bank';
import type { ProgressRecord, Question } from '../../types';
import {
  ANSWER_MAX,
  CHARS_PER_LINE,
  CUE_MAX,
  DEFAULT_FILTERS,
  LINES_PER_SIDE,
  TRUNCATION_MARK,
  WHY_MAX,
  answerFor,
  buildSheet,
  clip,
  cueFor,
  density,
  entryFor,
  selectForExport,
  whyFor,
} from './markdown';

/** The page's own budget: past three A5 sides it has stopped being a card. */
const SIDES_BUDGET = 3;

const wrongRecord = (contentHash: string, timesWrong = 2): ProgressRecord => ({
  contentHash,
  box: 1,
  dueAt: 0,
  attempts: [{ at: 1, correct: false, confidence: 'unsure', selfGraded: false, elapsedMs: 1 }],
  timesWrong,
  correction: null,
  notes: null,
});

/** Everything wrong, so the selection is the filter's doing and not the fixture's. */
const allWrong = (questions: readonly Question[]) =>
  new Map(questions.map((q) => [q.contentHash, wrongRecord(q.contentHash)]));

const q = (id: number): Question => {
  const found = questionById(id);
  if (!found) throw new Error(`q${id} is not in the bank`);
  return found;
};

describe('density', () => {
  it('counts a wrapped line as the lines it will actually take by hand', () => {
    expect(density('').lines).toBe(1);
    expect(density('x'.repeat(CHARS_PER_LINE)).lines).toBe(1);
    expect(density('x'.repeat(CHARS_PER_LINE + 1)).lines).toBe(2);
    expect(density(`${'x'.repeat(CHARS_PER_LINE * 2)}\n\n`).lines).toBe(4);
  });

  it('converts to A5 sides at the stated rate', () => {
    expect(density(`${'x\n'.repeat(LINES_PER_SIDE - 1)}x`).sides).toBeCloseTo(1, 5);
  });
});

describe('clip', () => {
  it('cuts on a word boundary and always marks the cut', () => {
    const out = clip('the quick brown fox jumps over the lazy dog', 20);
    expect(out.cut).toBe(true);
    expect(out.text.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(out.text).not.toMatch(/ {2}/);
  });

  it('leaves anything already short enough alone, and collapses whitespace', () => {
    expect(clip('  two   words \n', 40)).toEqual({ text: 'two words', cut: false });
  });
});

describe('the three lines of an entry', () => {
  it('takes the ask from the question sentence when there is one', () => {
    const cue = cueFor(q(2));
    expect(cue.text.length).toBeLessThanOrEqual(CUE_MAX + TRUNCATION_MARK.length + 1);
    expect(cue.text).toMatch(/\S/);
  });

  it('states the option text, not just the letter', () => {
    const single = drillable.find((x) => responseKindFor(x) === 'choice' && x.correct.length === 1)!;
    const answer = answerFor(single);
    expect(answer.text.startsWith(`${single.correct[0]}.`)).toBe(true);
  });

  it('keeps every box of a box answer rather than dropping the later ones', () => {
    const boxes = drillable.find((x) => responseKindFor(x) === 'boxes' && x.boxAnswers.length >= 4)!;
    const answer = answerFor(boxes);
    for (const b of boxes.boxAnswers) expect(answer.text).toContain(`${b.box}.`);
  });

  it('says plainly that a self-graded card has no written answer', () => {
    const self = drillable.find((x) => x.selfGraded)!;
    expect(answerFor(self).text).toMatch(/image/);
  });

  it('drops the Box lines out of the why, because they are already on the answer line', () => {
    const boxes = drillable.find(
      (x) => x.boxAnswers.length > 0 && /^\s*Box 1\s*:/im.test(x.explanation),
    )!;
    expect(whyFor(boxes).text).not.toMatch(/^Box 1:/);
  });

  it('never invents an explanation where the bank has none', () => {
    const bare = drillable.find((x) => x.explanation.trim() === '');
    if (!bare) return;
    const entry = entryFor(bare, undefined);
    expect(entry.lines.join('\n')).toContain('no explanation in the bank');
  });

  it('holds every entry to four or five short lines', () => {
    for (const question of drillable.slice(0, 120)) {
      const entry = entryFor(question, wrongRecord(question.contentHash));
      expect(entry.lines.length).toBeLessThanOrEqual(5);
      expect(entry.lines[1]!.length).toBeLessThanOrEqual(CUE_MAX + 20);
      expect(entry.lines[3]!.length).toBeLessThanOrEqual(WHY_MAX + 20);
    }
  });
});

describe('selection', () => {
  const progress = allWrong(drillable.slice(0, 60));

  it('honours the wrong-at-least-n threshold', () => {
    const once = new Map(progress);
    const only = drillable[0]!;
    once.set(only.contentHash, wrongRecord(only.contentHash, 1));
    expect(selectForExport(once, { ...DEFAULT_FILTERS, minWrong: 2, limit: null })).not.toContain(
      only,
    );
    expect(selectForExport(once, { ...DEFAULT_FILTERS, minWrong: 1, limit: null })).toContain(only);
  });

  it('can leave the self-graded cards out', () => {
    const kept = selectForExport(progress, {
      ...DEFAULT_FILTERS,
      includeSelfGraded: false,
      limit: null,
    });
    expect(kept.every((x) => !x.selfGraded)).toBe(true);
  });

  it('caps at the requested length', () => {
    expect(selectForExport(progress, { ...DEFAULT_FILTERS, limit: 5 })).toHaveLength(5);
  });
});

// ── Acceptance criterion 6 ──────────────────────────────────────────────────

describe('acceptance criterion 6: condensed enough to hand-write', () => {
  const progress = allWrong(drillable.slice(0, 60));

  it('the default sheet fits inside the three-A5-side budget', () => {
    const sheet = buildSheet(progress, DEFAULT_FILTERS, 0);
    expect(sheet.entries).toHaveLength(10);
    expect(sheet.density.sides).toBeLessThanOrEqual(SIDES_BUDGET);
  });

  it('an entry costs under 300 characters, not a paragraph', () => {
    const sheet = buildSheet(progress, { ...DEFAULT_FILTERS, limit: 30 }, 0);
    const perEntry = sheet.density.chars / sheet.entries.length;
    expect(perEntry).toBeLessThan(300);
  });

  it('no line in the sheet is a wall of prose', () => {
    const sheet = buildSheet(progress, { ...DEFAULT_FILTERS, limit: 40 }, 0);
    const longest = Math.max(...sheet.markdown.split('\n').map((l) => l.length));
    // The box-answer line is the only one allowed to run long, and even it is
    // capped per box rather than being an explanation in disguise.
    expect(longest).toBeLessThan(ANSWER_MAX * 3);
  });

  it('says how much was cut instead of hiding it', () => {
    const sheet = buildSheet(progress, DEFAULT_FILTERS, 0);
    expect(sheet.truncated).toBeGreaterThan(0);
    expect(sheet.markdown).toContain(TRUNCATION_MARK);
    expect(sheet.markdown).toMatch(/cut, marked/);
  });

  it('degrades to a plain sentence when there is nothing wrong yet', () => {
    const sheet = buildSheet(new Map(), DEFAULT_FILTERS, 0);
    expect(sheet.entries).toHaveLength(0);
    expect(sheet.markdown).toMatch(/Nothing to revise/);
    expect(sheet.density.sides).toBeLessThan(0.5);
  });

  it('carries the user’s own correction through to the sheet', () => {
    const only = drillable[0]!;
    const record = { ...wrongRecord(only.contentHash), correction: 'The key is C, not D.' };
    const sheet = buildSheet(new Map([[only.contentHash, record]]), DEFAULT_FILTERS, 0);
    expect(sheet.markdown).toContain('The key is C, not D.');
  });
});
