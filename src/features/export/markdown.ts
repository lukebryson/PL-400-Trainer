/**
 * The wrong-answer export, compressed for hand-writing onto A5.
 *
 * The acceptance criterion is density: "if it runs to pages of prose it has
 * failed". So this is deliberately lossy. Every entry is three or four lines —
 * what was being asked, what the answer is, and the first sentence of the
 * bank's reasoning — and anything cut is marked `[…]` rather than dropped
 * silently. There is no model call at runtime, so nothing here summarises: it
 * only selects and truncates. Inventing a rationale for an exam answer would be
 * worse than truncating one.
 *
 * Pure functions with the progress map as an argument, matching `selectors.ts`,
 * so the density numbers on the page can be reproduced in a test.
 *
 * Owned by the export agent.
 */
import { weakQuestions, type ProgressMap } from '../../lib/selectors';
import { responseKindFor } from '../../lib/bank';
import type { ProgressRecord, Question, SkillAreaKey } from '../../types';

// ── Density model ───────────────────────────────────────────────────────────

/**
 * A5 is 148 mm wide. Allowing 12 mm margins and ordinary adult handwriting at
 * roughly 2.7 mm per character, a written line holds about 48 characters and a
 * side holds about 30 of them. Both are stated in the UI so the estimate can be
 * argued with rather than trusted.
 */
export const CHARS_PER_LINE = 48;
export const LINES_PER_SIDE = 30;

export interface Density {
  chars: number;
  /** Markdown lines, wrapped at `CHARS_PER_LINE`. */
  lines: number;
  /** Fractional A5 sides. The UI rounds up. */
  sides: number;
}

export const density = (markdown: string): Density => {
  let lines = 0;
  for (const line of markdown.split('\n')) {
    lines += line.trim() === '' ? 1 : Math.ceil(line.length / CHARS_PER_LINE);
  }
  return { chars: markdown.length, lines, sides: lines / LINES_PER_SIDE };
};

// ── Truncation ──────────────────────────────────────────────────────────────

export const TRUNCATION_MARK = '[…]';

/**
 * Caps, in characters, derived from the budget rather than chosen by eye.
 *
 * The acceptance criterion is that the sheet can be written out by hand, and
 * `SIDES_BUDGET` on the page calls three A5 sides the limit. Three sides is 90
 * written lines; the default cap is 10 questions; so an entry has about nine
 * lines, or roughly 430 characters, to spend — and it should come in well under
 * that so a 20-question sheet is still only awkward rather than absurd.
 *
 * These were set by measuring the real bank, not by guessing: at the first
 * pass's 110/150/140/56 a 20-question sheet ran to 6.5 sides, which is a
 * booklet, not a revision card.
 */
export const CUE_MAX = 76;
export const ANSWER_MAX = 96;
export const WHY_MAX = 88;
export const BOX_MAX = 30;

export interface Clipped {
  text: string;
  cut: boolean;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Word-boundary truncation. Always marks what it removed. */
export const clip = (raw: string, max: number): Clipped => {
  const text = collapse(raw);
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  const body = space > max * 0.6 ? head.slice(0, space) : head;
  return { text: `${body.replace(/[\s,;:.–-]+$/, '')} ${TRUNCATION_MARK}`, cut: true };
};

// ── Cue: what the question was actually asking ──────────────────────────────

/** Exam scaffolding that carries no information once the card is off screen. */
const BOILERPLATE = [
  /NOTE:.*/gi,
  /To answer,.*/gi,
  /Each correct (selection|answer presents).*/gi,
  /More than one answer choice may achieve the goal.*/gi,
  /Select the best answer\.?/gi,
  /Select and place\.?/gi,
];

const stripBoilerplate = (s: string): string =>
  BOILERPLATE.reduce((acc, re) => acc.replace(re, ' '), s);

/**
 * The ask, in one line, in priority order:
 *   1. the last question sentence, when it is substantive
 *      ("Which authentication mechanism should you use?");
 *   2. the `You need to …` goal, when it is not just filler;
 *   3. the line immediately before that goal — in this bank's phrasing that is
 *      the constraint which makes the question ("Solution checker fails to
 *      export solutions with model-driven app components.").
 * Mechanical, not clever. It never invents wording.
 */
export const cueFor = (q: Question): Clipped => {
  const stem = stripBoilerplate(q.stem);
  const lines = stem.split('\n').map(collapse).filter(Boolean);
  const asks = collapse(stem).match(/[^.?!]+\?/g) ?? [];
  const ask = asks.length > 0 ? collapse(asks[asks.length - 1]!) : null;
  if (ask && ask.length >= 28) return clip(ask, CUE_MAX);

  const needIndex = lines.findIndex((l) => /^you (need|must|are asked) to\b/i.test(l));
  const need = needIndex === -1 ? null : lines[needIndex]!;
  if (need && need.length >= 40) return clip(need, CUE_MAX);

  const before = needIndex > 0 ? lines[needIndex - 1]! : null;
  const fallback = before ?? need ?? ask ?? lines[lines.length - 1] ?? q.subtopic;
  return clip(fallback, CUE_MAX);
};

// ── Answer ──────────────────────────────────────────────────────────────────

export const answerFor = (q: Question): Clipped => {
  switch (responseKindFor(q)) {
    case 'choice': {
      const parts = q.correct.map((key) => {
        const option = q.options.find((o) => o.key === key);
        return option ? `${key}. ${option.text}` : `${key} — no such option in the bank`;
      });
      return clip(parts.join(' · '), ANSWER_MAX);
    }
    case 'boxes': {
      // Every box is kept and capped individually rather than clipping the
      // joined string: dropping box 4 of 5 would leave a sheet that looks
      // complete and is not, which is worse than a terse box 4.
      let cut = false;
      const parts = [...q.boxAnswers]
        .sort((a, b) => a.box - b.box)
        .map((b) => {
          const clipped = clip(b.answer, BOX_MAX);
          cut = cut || clipped.cut;
          return `${b.box}. ${clipped.text}`;
        });
      return { text: parts.join(' · '), cut };
    }
    case 'self':
      return { text: 'in the image — you graded this one yourself', cut: false };
  }
};

// ── Why ─────────────────────────────────────────────────────────────────────

const firstSentence = (s: string): string => {
  const text = collapse(s);
  const match = text.match(/^.*?[.?!](?=\s|$)/);
  return match ? match[0] : text;
};

/**
 * The first sentence of the explanation, with the `Box N:` answer lines removed
 * first — those already appear on the answer line, so repeating them would cost
 * a written line and say nothing new.
 */
export const whyFor = (q: Question): Clipped => {
  const body = q.explanation
    .split('\n')
    .filter((l) => !/^\s*Box \d+\s*:/i.test(l))
    .join('\n');
  const sentence = firstSentence(body);
  if (sentence === '') return { text: '', cut: false };
  const clipped = clip(sentence, WHY_MAX);
  // A one-sentence cut out of a five-paragraph explanation is still a cut.
  const dropped = collapse(body).length > sentence.length + 4;
  return { text: clipped.text, cut: clipped.cut || dropped };
};

// ── Entries ─────────────────────────────────────────────────────────────────

export interface ExportEntry {
  question: Question;
  lines: string[];
  truncated: boolean;
}

export const entryFor = (q: Question, record: ProgressRecord | undefined): ExportEntry => {
  const cue = cueFor(q);
  const answer = answerFor(q);
  const why = whyFor(q);
  const wrong = record?.timesWrong ?? 0;

  // The header is one written line, so it carries the subtopic and nothing
  // else in words. The skill area is recoverable from the subtopic and would
  // cost a second line on every entry; the two flags are single characters.
  const flags = `${q.selfGraded ? '~' : ''}${q.currency !== 'current' ? '?' : ''}`;
  const lines = [
    `**q${q.id}** ${q.subtopic || 'general'} ·${flags ? ` ${flags}` : ''} ×${wrong}`,
    `- Cue: ${cue.text}`,
    `- Ans: ${answer.text}`,
  ];
  lines.push(`- Why: ${why.text === '' ? 'no explanation in the bank' : why.text}`);
  if (record?.correction) lines.push(`- Yours: ${clip(record.correction, WHY_MAX).text}`);

  return { question: q, lines, truncated: cue.cut || answer.cut || why.cut };
};

// ── Selection ───────────────────────────────────────────────────────────────

export interface ExportFilters {
  /** Null is every area. */
  area: SkillAreaKey | null;
  /** 1 is "answered wrongly at all", 2 is the brief's "wrong at least twice". */
  minWrong: number;
  /**
   * Self-graded cards only ever reach this list because the user marked
   * themselves wrong — there is no machine verdict to disagree with.
   */
  includeSelfGraded: boolean;
  /** Null is no cap. */
  limit: number | null;
}

/**
 * Ten, not twenty. Twenty entries is six A5 sides even after the caps above,
 * and a sheet nobody writes out is a feature that does not exist. The cap is
 * the first control on the page and the density readout says what raising it
 * costs.
 */
export const DEFAULT_FILTERS: ExportFilters = {
  area: null,
  minWrong: 1,
  includeSelfGraded: true,
  limit: 10,
};

export const selectForExport = (progress: ProgressMap, filters: ExportFilters): Question[] => {
  const pool = weakQuestions(progress, {
    minWrong: filters.minWrong,
    area: filters.area ?? undefined,
  });
  const kept = filters.includeSelfGraded ? pool : pool.filter((q) => !q.selfGraded);
  return filters.limit === null ? kept : kept.slice(0, Math.max(0, filters.limit));
};

// ── The sheet ───────────────────────────────────────────────────────────────

export interface RevisionSheet {
  markdown: string;
  entries: ExportEntry[];
  density: Density;
  /** Entries with something cut. Stated on the sheet, not hidden. */
  truncated: number;
}

const formatDate = (now: number): string =>
  new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const describe = (filters: ExportFilters, count: number): string => {
  const bits = [
    `${count} question${count === 1 ? '' : 's'}`,
    filters.area ?? 'all areas',
    filters.minWrong >= 2 ? `wrong at least ${filters.minWrong} times` : 'wrong at least once',
  ];
  if (!filters.includeSelfGraded) bits.push('machine-graded only');
  return bits.join(' · ');
};

export const buildSheet = (
  progress: ProgressMap,
  filters: ExportFilters,
  now: number = Date.now(),
): RevisionSheet => {
  const questions = selectForExport(progress, filters);
  const entries = questions.map((q) => entryFor(q, progress.get(q.contentHash)));
  const truncated = entries.filter((e) => e.truncated).length;

  const head = [`# PL-400 — wrong answers, ${formatDate(now)}`, describe(filters, questions.length)];
  if (entries.some((e) => e.question.selfGraded || e.question.currency !== 'current')) {
    head.push('~ self-graded · ? currency unverified · ×n times wrong');
  }
  if (truncated > 0) {
    head.push(
      `${truncated} entr${truncated === 1 ? 'y is' : 'ies are'} cut, marked ${TRUNCATION_MARK}. Full text stays in the app.`,
    );
  }

  const body =
    entries.length === 0
      ? ['Nothing to revise: no question in this filter has been answered wrongly.']
      : entries.map((e) => e.lines.join('\n'));

  const markdown = `${[head.join('\n'), ...body].join('\n\n')}\n`;
  return { markdown, entries, density: density(markdown), truncated };
};
