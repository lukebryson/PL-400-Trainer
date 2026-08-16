/**
 * 187 questions are flagged `currency: "suspect"`, 123 sit at
 * `parseConfidence: "low"`.
 *
 * Both flags are heuristic and unverified — nothing in the bank has yet been
 * checked against live Microsoft Learn. The wording says so. A flag here means
 * "treat this with suspicion", not "this is wrong"; claiming otherwise would
 * teach the user to discount correct answers.
 */
import type { Question } from '../../types';

const CURRENCY_HEADLINE: Record<string, string> = {
  suspect: 'Currency suspect — heuristic flag, not verified',
  superseded: 'Superseded — the product has moved on since this was written',
};

export function CurrencyBanner({
  question,
  suppressFeedback,
}: {
  question: Question;
  suppressFeedback?: boolean;
}) {
  const flagged = question.currency !== 'current';
  const lowConfidence = question.parseConfidence === 'low';
  // The disagreement names both candidate keys, so it is feedback: withheld
  // while the simulator is running.
  const disagreement = suppressFeedback ? null : question.answerDisagreement;

  if (!flagged && !lowConfidence && !disagreement) return null;

  return (
    <div className="stack" style={{ gap: 6 }}>
      {flagged ? (
        <div className="notice notice-warn">
          <div>
            <strong>{CURRENCY_HEADLINE[question.currency] ?? 'Currency flagged'}.</strong>{' '}
            {question.currencyNote ??
              'Flagged automatically on wording alone; no one has checked it against current documentation.'}{' '}
            <span className="faint">Verify before trusting the answer.</span>
          </div>
        </div>
      ) : null}

      {lowConfidence ? (
        <div className="notice small">
          <div>
            <span className="label">Low parse confidence</span>{' '}
            {question.parseNotes.length > 0
              ? question.parseNotes.join(' · ')
              : 'The extraction was not clean for this question.'}
          </div>
        </div>
      ) : null}

      {disagreement ? (
        <div className="notice small">
          <div>
            <span className="label">Sources disagree on the key</span> PDF says{' '}
            <strong>{disagreement.pdf.join(', ') || '—'}</strong>, DOCX says{' '}
            <strong>{disagreement.docx.join(', ') || '—'}</strong>. The card shows one of them; the
            other may be right.
          </div>
        </div>
      ) : null}
    </div>
  );
}
