/**
 * "The bank is wrong" — the affordance that keeps a dump of scraped questions
 * honest. It renders the persisted correction and offers a control to raise or
 * edit one; persistence belongs to the store, so this only calls back.
 *
 * q182 is the natural first case: it states `Answer: H` against options A–F.
 * That class of defect is detected from `brokenKeys` and stated on the card
 * rather than a broken key being shown as if it were an answer.
 */
import { useEffect, useState } from 'react';
import { brokenKeys, isDeadEnd } from '../../lib/bank';
import type { Question } from '../../types';

const BROKEN = new Set(brokenKeys.map((q) => q.id));

interface Props {
  question: Question;
  /** The user's persisted dispute, or null. */
  correction: string | null;
  /** Omit to render read-only — the card still shows an existing correction. */
  onCorrectionChange?: (correction: string | null) => void;
  suppressFeedback?: boolean;
}

/** The keys the bank names that no option provides. */
export const missingKeys = (q: Question): string[] =>
  q.correct.filter((k) => !q.options.some((o) => o.key === k));

export function BrokenKeyNotice({ question }: { question: Question }) {
  if (isDeadEnd(question)) {
    return (
      <div className="notice notice-bad">
        <div>
          <strong>This question did not survive extraction.</strong> No options, no image and no
          explanation reached the bank — only the stem. It is held out of drills and listed for
          manual repair rather than deleted, so the gap stays visible.
        </div>
      </div>
    );
  }

  if (!BROKEN.has(question.id)) return null;

  const missing = missingKeys(question);
  const have = question.options.map((o) => o.key);
  return (
    <div className="notice notice-bad">
      <div>
        <strong>The bank's answer key is broken here.</strong> It names{' '}
        {missing.map((k) => `option ${k}`).join(' and ')}, but this question only has options{' '}
        {have[0]}–{have[have.length - 1]}. No answer is shown because the bank does not have a
        usable one. Work it out, then record what you believe is right below.
      </div>
    </div>
  );
}

export function DisputeBank({
  question,
  correction,
  onCorrectionChange,
  suppressFeedback,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(correction ?? '');

  // A new card must not inherit the previous card's draft.
  useEffect(() => {
    setEditing(false);
    setDraft(correction ?? '');
  }, [question.contentHash, correction]);

  if (suppressFeedback) return null;

  const editable = typeof onCorrectionChange === 'function';
  const fieldId = `dispute-q${question.id}`;

  if (editing && editable) {
    return (
      <div className="dispute">
        <label className="label" htmlFor={fieldId}>
          What the answer should be, and why
        </label>
        <textarea
          id={fieldId}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. the key names H; against these options the answer is B — a scheduled flow cannot see the create event."
        />
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onCorrectionChange(draft.trim() === '' ? null : draft.trim());
              setEditing(false);
            }}
          >
            Save correction
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setDraft(correction ?? '');
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (correction) {
    return (
      <div className="panel dispute">
        <span className="label">Your correction</span>
        <div className="prose small">{correction}</div>
        {editable ? (
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onCorrectionChange(null)}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!editable) return null;

  return (
    <div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
        {BROKEN.has(question.id) ? 'Record the right answer' : 'Dispute the bank'}
      </button>
    </div>
  );
}
