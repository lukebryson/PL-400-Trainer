/**
 * The question bank, loaded once from static JSON. Owned by the orchestrator —
 * this and `grade.ts` are the contract the store and the renderers share.
 *
 * The app never parses the source documents at runtime; this is the only door
 * to the data.
 */
import raw from '../data/questions.json';
import type {
  CaseStudy,
  Question,
  QuestionBank,
  Response,
  ResponseKind,
  SkillAreaKey,
} from '../types';

export const bank = raw as unknown as QuestionBank;

export const questions: Question[] = bank.questions;
export const caseStudies: CaseStudy[] = bank.caseStudies;

const byId = new Map<number, Question>(questions.map((q) => [q.id, q]));
const byHash = new Map<string, Question>(questions.map((q) => [q.contentHash, q]));
const caseById = new Map<string, CaseStudy>(caseStudies.map((c) => [c.id, c]));

export const questionById = (id: number): Question | undefined => byId.get(id);
export const questionByHash = (hash: string): Question | undefined => byHash.get(hash);
export const caseStudyFor = (q: Question): CaseStudy | null =>
  q.caseStudyId ? (caseById.get(q.caseStudyId) ?? null) : null;

/**
 * Image paths in the bank are relative (`images/q7-1.jpeg`) so the JSON stays
 * deploy-agnostic. Resolve them against the Vite base at render time.
 */
export const imageUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`;
};

/**
 * A card with nothing to show and nothing to grade. Exactly one question in the
 * bank is in this state (q266) — no options, no image, no explanation. It is
 * surfaced on the dashboard as needing repair and kept out of every drill,
 * rather than being deleted or silently patched.
 */
export const isDeadEnd = (q: Question): boolean =>
  q.options.length === 0 &&
  q.images.length === 0 &&
  q.boxAnswers.length === 0 &&
  q.explanation.trim() === '';

/** Everything that can meaningfully be put in front of the user. */
export const drillable: Question[] = questions.filter((q) => !isDeadEnd(q));

/** The 318 that can be machine-graded — the rest are honest self-assessment. */
export const gradable: Question[] = drillable.filter((q) => !q.selfGraded);

export const deadEnds: Question[] = questions.filter(isDeadEnd);

/**
 * Questions whose stated key names an option that does not exist. The bank is
 * wrong, not the user; these surface a "dispute the bank" prompt. q182 states
 * `Answer: H` against options A–F.
 */
export const brokenKeys: Question[] = questions.filter(
  (q) =>
    q.options.length > 0 &&
    q.correct.length > 0 &&
    q.correct.some((k) => !q.options.some((o) => o.key === k)),
);

export const questionsByArea = (area: SkillAreaKey): Question[] =>
  drillable.filter((q) => q.skillArea === area);

export const subtopics = (area?: SkillAreaKey): string[] => {
  const pool = area ? questionsByArea(area) : drillable;
  return [...new Set(pool.map((q) => q.subtopic))].filter(Boolean).sort();
};

// ── Response shape ──────────────────────────────────────────────────────────

/** How a question is answered. Derived, never guessed at the call site. */
export const responseKindFor = (q: Question): ResponseKind => {
  if (q.selfGraded || isDeadEnd(q)) return 'self';
  if (q.options.length > 0 && q.correct.length > 0) return 'choice';
  if (q.boxAnswers.length > 0) return 'boxes';
  return 'self';
};

export const emptyResponse = (q: Question): Response => {
  switch (responseKindFor(q)) {
    case 'choice':
      return { kind: 'choice', keys: [] };
    case 'boxes':
      return { kind: 'boxes', values: q.boxAnswers.map(() => '') };
    case 'self':
      return { kind: 'self', verdict: null };
  }
};

/** True once the user has entered enough to submit. */
export const isAnswered = (r: Response): boolean => {
  switch (r.kind) {
    case 'choice':
      return r.keys.length > 0;
    case 'boxes':
      return r.values.some((v) => v.trim() !== '');
    case 'self':
      return r.verdict !== null;
  }
};

/**
 * The pooled set of a question's own box answers, offered as a datalist so the
 * user can recall freely but need not retype a 90-character sentence.
 */
export const boxSuggestions = (q: Question): string[] =>
  [...new Set(q.boxAnswers.map((b) => b.answer.trim()))].filter(Boolean);
