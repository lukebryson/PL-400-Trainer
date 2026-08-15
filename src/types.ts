/**
 * App-facing contract for the question bank. Mirrors `pipeline/schema.py` —
 * the two must be changed together.
 *
 * Owned by the orchestrator. Feature agents read this; none of them edit it.
 */

export type QuestionType =
  | 'mcq-single'
  | 'mcq-multi'
  | 'hotspot'
  | 'dragdrop'
  | 'yesno-series';

export type Source = 'pdf' | 'docx' | 'merged';
export type Currency = 'current' | 'suspect' | 'superseded';
export type ParseConfidence = 'high' | 'low';

export type SkillAreaKey =
  | 'technical-design'
  | 'build-solutions'
  | 'apps-improvements'
  | 'extend-ux'
  | 'extend-platform'
  | 'integrations';

/**
 * March 2026 blueprint. Drives simulator sampling and dashboard weighting, so
 * `weight` must sum to 1. `extend-platform` deliberately dominates.
 */
export const SKILL_AREAS: Record<
  SkillAreaKey,
  { label: string; band: [number, number]; weight: number }
> = {
  'technical-design': { label: 'Create a technical design', band: [10, 15], weight: 0.125 },
  'build-solutions': { label: 'Build Power Platform solutions', band: [10, 15], weight: 0.125 },
  'apps-improvements': { label: 'Implement Power Apps improvements', band: [10, 15], weight: 0.125 },
  'extend-ux': { label: 'Extend the user experience', band: [10, 15], weight: 0.125 },
  'extend-platform': { label: 'Extend the platform', band: [30, 35], weight: 0.325 },
  integrations: { label: 'Develop integrations', band: [10, 15], weight: 0.175 },
};

export const EXAM_DATE = new Date('2026-09-17T00:00:00Z');
export const PASS_MARK = 700;

export interface Option {
  key: string;
  text: string;
}

/** An ordered answer slot recovered from `Box 1: … Box 2: …` in the explanation. */
export interface BoxAnswer {
  box: number;
  answer: string;
}

export interface Question {
  id: number;
  /**
   * Stable identity derived from the stem text, not the id or file position.
   * All progress records key on this so a corrected bank can be reimported
   * without orphaning study history. Never key persistence on `id`.
   */
  contentHash: string;
  source: Source;
  sourcePages: number[];
  type: QuestionType;
  caseStudyId: string | null;
  stem: string;
  options: Option[];
  correct: string[];
  /** Populated for the 87 image-only questions whose boxes could be parsed. */
  boxAnswers: BoxAnswer[];
  /**
   * True when the question cannot be machine-graded and the user grades their own
   * recall. The UI must state this explicitly rather than implying interactivity.
   */
  selfGraded: boolean;
  explanation: string;
  references: string[];
  images: string[];
  skillArea: SkillAreaKey;
  subtopic: string;
  currency: Currency;
  currencyNote: string | null;
  parseConfidence: ParseConfidence;
  parseNotes: string[];
  codeBlock: string | null;
  /** Set only where PDF and DOCX disagreed on the stated key. */
  answerDisagreement: { pdf: string[]; docx: string[] } | null;
}

export interface CaseStudy {
  id: string;
  background: string;
  questionIds: number[];
}

export interface QuestionBank {
  questions: Question[];
  caseStudies: CaseStudy[];
  meta: {
    generatedAt: string;
    totalQuestions: number;
    sourceSplit: Record<Source, number>;
  };
}

// ── Progress ────────────────────────────────────────────────────────────────

export type Confidence = 'guessed' | 'unsure' | 'confident';

/** Leitner box. 1 = due every session, 5 = long interval. Wrong always resets to 1. */
export type LeitnerBox = 1 | 2 | 3 | 4 | 5;

export interface Attempt {
  at: number;
  correct: boolean;
  confidence: Confidence;
  /** User's own verdict for self-graded cards. */
  selfGraded: boolean;
}

export interface ProgressRecord {
  /** Matches `Question.contentHash` — the join key that survives a reimport. */
  contentHash: string;
  box: LeitnerBox;
  dueAt: number;
  attempts: Attempt[];
  timesWrong: number;
  /** User's dispute of the bank's stated answer, shown on future encounters. */
  correction: string | null;
  notes: string | null;
}
