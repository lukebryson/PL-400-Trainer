/**
 * 122 questions — 27.7% of the bank — cannot be machine-graded. Either the
 * answer lives inside the image and no `Box N:` structure could be parsed, or
 * the options themselves were never in the text.
 *
 * This card says so, up front, and then gets out of the way: read, recall,
 * reveal, and mark yourself honestly. No dead radio buttons, no disabled inputs
 * pretending to be a question.
 */
import { useState } from 'react';
import type { CardPhase, Question, SelfVerdict } from '../../types';
import { Explanation } from './Explanation';

interface Props {
  question: Question;
  verdict: SelfVerdict | null;
  phase: CardPhase;
  onChange: (verdict: SelfVerdict) => void;
  suppressFeedback?: boolean;
}

const reasonFor = (q: Question): string => {
  if (q.options.length > 0) {
    return 'The stated options are incomplete in the text — the answer area is in the image, so this one is graded on your own recall.';
  }
  if (q.type === 'dragdrop') {
    return 'A drag-and-drop ordering whose sequence could not be recovered as text. Work it out against the image, then mark yourself.';
  }
  if (q.type === 'hotspot') {
    return 'A hotspot whose answer area is in the image and carries no parseable box labels. Work it out against the image, then mark yourself.';
  }
  return 'No machine-checkable answer survived extraction, so this one is graded on your own recall.';
};

export function SelfGraded({ question, verdict, phase, onChange, suppressFeedback }: Props) {
  // Keyed on the question id so moving to the next card re-hides the answer
  // without the parent having to remount or reset anything.
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  const showAnswer = !suppressFeedback && (phase === 'revealed' || revealedFor === question.id);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="notice notice-info">
        <div>
          <strong>Self-graded.</strong> {reasonFor(question)}
        </div>
      </div>

      {suppressFeedback ? (
        <p className="small muted" style={{ margin: 0 }}>
          The answer is withheld until the end of the exam. Record now whether you believe you had
          it; it is scored on that.
        </p>
      ) : !showAnswer ? (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setRevealedFor(question.id)}>
            Reveal answer
          </button>
        </div>
      ) : (
        <Explanation question={question} />
      )}

      {(showAnswer || suppressFeedback) && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Mark yourself</span>
          <div className="verdicts" role="group" aria-label="Self-grade this question">
            <button
              type="button"
              className="btn btn-ok"
              aria-pressed={verdict === 'correct'}
              onClick={() => onChange('correct')}
            >
              {suppressFeedback ? 'I think I had it' : 'I had it'}
            </button>
            <button
              type="button"
              className="btn btn-bad"
              aria-pressed={verdict === 'wrong'}
              onClick={() => onChange('wrong')}
            >
              I did not
            </button>
          </div>
          {verdict ? (
            <span className="tiny faint">
              Recorded as {verdict === 'correct' ? 'correct' : 'wrong'}. Change it before moving on
              if that was generous.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
