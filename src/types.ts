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
 * Blueprint as of 19 March 2026, verified against the published study guide.
 * Drives simulator sampling and dashboard weighting, so `weight` must sum to 1.
 * `extend-platform` deliberately dominates.
 *
 * The bands are Microsoft's and are not negotiable. Their midpoints sum to
 * **95%**, not 100% — five areas at 12.5 plus one at 32.5 — so 5pp of residual
 * has to go somewhere, and that is the only real decision in this table.
 *
 * It is resolved by scaling every midpoint by the same factor, `1 / 0.95`:
 *
 *   light areas   0.125 / 0.95 = 5/38  = 13.16%, inside 10–15
 *   extend-platform 0.325 / 0.95 = 13/38 = 34.21%, inside 30–35
 *   5 × 5/38 + 13/38 = 38/38 = 1 exactly
 *
 * Every area therefore lands inside its own published band, and the relative
 * weighting is untouched: `extend-platform` stays exactly 2.6× each other area.
 * Dumping the whole residual on one area does not have that property — it was
 * previously all on `integrations`, which put it at 17.5% against a band of
 * 10–15% and made the simulator's setup table contradict its own row.
 *
 * `blueprint.test.ts` pins all three properties. Do not round these to tidier
 * numbers; the untidiness is the point.
 */
export const SKILL_AREAS: Record<
  SkillAreaKey,
  { label: string; band: [number, number]; weight: number }
> = {
  'technical-design': { label: 'Create a technical design', band: [10, 15], weight: 5 / 38 },
  'build-solutions': { label: 'Build Power Platform solutions', band: [10, 15], weight: 5 / 38 },
  'apps-improvements': { label: 'Implement Power Apps improvements', band: [10, 15], weight: 5 / 38 },
  'extend-ux': { label: 'Extend the user experience', band: [10, 15], weight: 5 / 38 },
  'extend-platform': { label: 'Extend the platform', band: [30, 35], weight: 13 / 38 },
  integrations: { label: 'Develop integrations', band: [10, 15], weight: 5 / 38 },
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
  /**
   * Milliseconds on the card. Kept per attempt, not only per session, because
   * pacing is a real exam risk: roughly 100 minutes for 40–60 questions leaves
   * under two minutes each, and the questions that run long are the ones worth
   * knowing about before September.
   */
  elapsedMs: number;
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

// ── UI contract ─────────────────────────────────────────────────────────────
// Owned by the orchestrator. Renderers, store and features all code against
// these; none of them may change them. Raise a change rather than editing.

/**
 * What the user has entered for a card, before grading. One variant per way a
 * question can be answered — `kind` is derived from the question by
 * `responseKindFor`, never guessed at the call site.
 */
export type Response =
  | { kind: 'choice'; keys: string[] }
  | { kind: 'boxes'; values: string[] }
  | { kind: 'self'; verdict: SelfVerdict | null };

export type SelfVerdict = 'correct' | 'wrong';

export type ResponseKind = Response['kind'];

/** Outcome of grading one response. `perBox` is populated for `boxes` only. */
export interface Grade {
  correct: boolean;
  perBox: boolean[] | null;
  /** True when the verdict came from the user, not from comparing to the bank. */
  selfGraded: boolean;
  /** Set when the card cannot be graded at all (q266). */
  ungradeable: boolean;
}

/** Where a card is in the answer/reveal cycle. */
export type CardPhase = 'answering' | 'revealed';

/**
 * The single prop contract every question renderer honours. `src/components/
 * question/QuestionCard.tsx` dispatches on `responseKindFor(question)` from
 * `lib/bank.ts` — on how the card can be answered, not on `question.type`,
 * because a `mcq-single` whose options live in the image answers like a
 * self-graded card and must render like one.
 */
export interface QuestionRendererProps {
  question: Question;
  caseStudy: CaseStudy | null;
  phase: CardPhase;
  response: Response;
  grade: Grade | null;
  /** Ignored once `phase` is 'revealed'. */
  onChange: (response: Response) => void;
  /** User's persisted dispute of the bank's key, if any. */
  correction: string | null;
  /**
   * Raise or clear a dispute. Maps onto `Store.setCorrection`; the renderers
   * never persist anything themselves. Optional so a read-only card (the
   * simulator review, the export preview) can omit it.
   */
  onCorrectionChange?: (correction: string | null) => void;
  /**
   * Case-study disclosure, controlled by the session so a background stays open
   * on first sight and collapses once read. Omit both and the panel manages its
   * own state.
   */
  caseStudyOpen?: boolean;
  onCaseStudyToggle?: (open: boolean) => void;
  /** Hides explanation, answers and grading — used by the exam simulator. */
  suppressFeedback?: boolean;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export type SessionMode = 'drill' | 'weak-area' | 'simulator';

export interface SessionQuestionResult {
  contentHash: string;
  questionId: number;
  correct: boolean;
  confidence: Confidence;
  skillArea: SkillAreaKey;
  /** Milliseconds spent on the card. */
  elapsedMs: number;
}

export interface Session {
  id: string;
  mode: SessionMode;
  startedAt: number;
  finishedAt: number | null;
  results: SessionQuestionResult[];
  /** Simulator only: the scaled 0–1000 score, or null while in progress. */
  scaledScore: number | null;
}

// ── Readiness ───────────────────────────────────────────────────────────────

export type Rag = 'red' | 'amber' | 'green';

export interface AreaReadiness {
  area: SkillAreaKey;
  label: string;
  weight: number;
  /** Questions in the bank for this area. */
  total: number;
  /** Distinct questions attempted at least once. */
  attempted: number;
  /** Correct share of the most recent attempt on each attempted question, 0–1. */
  accuracy: number;
  /** Share of the area's pool seen at least once, 0–1. */
  coverage: number;
  rag: Rag;
}

export interface Readiness {
  areas: AreaReadiness[];
  /** Blueprint-weighted projection onto the exam's 0–1000 scale. */
  projectedScore: number;
  onTrack: boolean;
  daysToExam: number;
  /** The single highest-value thing to do next, already resolved to a link. */
  nextAction: { label: string; detail: string; href: string };
}
