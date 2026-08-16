/**
 * The app-level currency statement. `CurrencyBanner` says "treat this card with
 * suspicion"; this says how much of the bank is in that state and what has and
 * has not been checked.
 *
 * Every number is computed from the shipped bank, never written down here — a
 * hardcoded "187" would quietly become a lie the first time the bank is rebuilt.
 *
 * Owned by the export agent.
 */
import { brokenKeys, deadEnds, drillable, questions, questionByHash } from '../../lib/bank';
import type { ProgressMap } from '../../lib/selectors';
import { SKILL_AREAS, type Question, type SkillAreaKey } from '../../types';

export interface AreaCurrency {
  area: SkillAreaKey;
  label: string;
  total: number;
  suspect: number;
  lowConfidence: number;
}

export interface BankCurrency {
  total: number;
  drillable: number;
  suspect: number;
  superseded: number;
  lowConfidence: number;
  /** Suspect, superseded or low-confidence — the union, not the sum. */
  flagged: number;
  /** Carrying a Microsoft Learn reference link, so at least checkable by hand. */
  withReferences: number;
  /**
   * Verified against live documentation. Zero, and it stays zero until Phase 3
   * runs. The UI states the number rather than describing the situation.
   */
  verified: number;
  byArea: AreaCurrency[];
  disagreements: Question[];
  brokenKeys: Question[];
  deadEnds: Question[];
}

const isFlagged = (q: Question): boolean =>
  q.currency !== 'current' || q.parseConfidence === 'low';

/** Computed once: the bank is static and this is read on every render. */
export const bankCurrency: BankCurrency = {
  total: questions.length,
  drillable: drillable.length,
  suspect: questions.filter((q) => q.currency === 'suspect').length,
  superseded: questions.filter((q) => q.currency === 'superseded').length,
  lowConfidence: questions.filter((q) => q.parseConfidence === 'low').length,
  flagged: questions.filter(isFlagged).length,
  withReferences: questions.filter((q) => q.references.length > 0).length,
  verified: 0,
  byArea: (Object.keys(SKILL_AREAS) as SkillAreaKey[]).map((area) => {
    const pool = questions.filter((q) => q.skillArea === area);
    return {
      area,
      label: SKILL_AREAS[area].label,
      total: pool.length,
      suspect: pool.filter((q) => q.currency !== 'current').length,
      lowConfidence: pool.filter((q) => q.parseConfidence === 'low').length,
    };
  }),
  disagreements: questions.filter((q) => q.answerDisagreement !== null),
  brokenKeys,
  deadEnds,
};

export const share = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export interface Dispute {
  question: Question;
  correction: string;
  at: number | null;
}

/**
 * The user's own disputes, newest first. Kept alongside the bank's known
 * defects so every disagreement with the bank is reviewable in one place before
 * the exam.
 */
export const disputes = (progress: ProgressMap): Dispute[] => {
  const out: Dispute[] = [];
  for (const record of progress.values()) {
    if (!record.correction) continue;
    const question = questionByHash(record.contentHash);
    if (!question) continue; // a correction against a question this bank dropped
    out.push({
      question,
      correction: record.correction,
      at: record.attempts[record.attempts.length - 1]?.at ?? null,
    });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.question.id - b.question.id);
};
