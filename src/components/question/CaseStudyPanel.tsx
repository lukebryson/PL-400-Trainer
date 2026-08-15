/**
 * 47 case studies cover 68 questions. A case-study child must never render
 * without its parent background — the stem alone is unanswerable.
 *
 * Expansion state belongs to the session, not to the card: the first sight of a
 * case study within a session opens it, subsequent questions on the same case
 * study leave it collapsed. That decision is taken by the caller and arrives as
 * `open`; the panel only falls back to its own state when uncontrolled.
 */
import { useState } from 'react';
import type { CaseStudy } from '../../types';

interface Props {
  caseStudy: CaseStudy;
  /** Controlled expansion. Omit to let the panel own it. */
  open?: boolean;
  /** Uncontrolled initial state. */
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  questionCount?: number;
}

export function CaseStudyPanel({
  caseStudy,
  open,
  defaultOpen = true,
  onToggle,
  questionCount,
}: Props) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const isOpen = open ?? localOpen;
  const bodyId = `case-${caseStudy.id}-body`;
  const count = questionCount ?? caseStudy.questionIds.length;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setLocalOpen(next);
    onToggle?.(next);
  };

  return (
    <section className="case-panel" aria-label="Case study background">
      <button
        type="button"
        className="case-toggle"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="chev" aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
        Case study background
        <span className="tiny faint" style={{ fontWeight: 400 }}>
          {count === 1 ? '1 question' : `${count} questions`} depend on this
        </span>
      </button>
      <div id={bodyId} className="case-body" hidden={!isOpen}>
        <div className="prose">{caseStudy.background.trim()}</div>
      </div>
    </section>
  );
}

/**
 * Shown when a question claims a case study the bank cannot resolve. It should
 * never fire — `bank.test.ts` asserts every `caseStudyId` binds — but a child
 * rendered without its background is a wrong question, not a cosmetic problem,
 * so it is stated rather than silently dropped.
 */
export function MissingCaseStudy({ caseStudyId }: { caseStudyId: string }) {
  return (
    <div className="notice notice-bad">
      <div>
        This question belongs to case study <code>{caseStudyId}</code>, whose background is missing
        from the bank. Answer it with that in mind — the stem alone is incomplete.
      </div>
    </div>
  );
}
