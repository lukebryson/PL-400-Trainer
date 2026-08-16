/**
 * End of session. Three things, in order of what the user actually wants:
 * the score, what moved in the schedule, and a way straight back into the
 * questions that were missed.
 */
import { href } from '../../router';
import type { LeitnerBox, Question, SessionQuestionResult } from '../../types';

export interface BoxMove {
  questionId: number;
  from: LeitnerBox;
  to: LeitnerBox;
  /** Carried explicitly: a wrong answer at box 1 resets to box 1, so the
   * numbers alone cannot tell a reset from a card that simply held. */
  correct: boolean;
}

interface Props {
  results: SessionQuestionResult[];
  moves: BoxMove[];
  missed: Question[];
  onDrillMissed: (questions: Question[]) => void;
  onNewSession: () => void;
}

const mmss = (ms: number): string => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
};

export function DrillSummary({ results, moves, missed, onDrillMissed, onNewSession }: Props) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const elapsed = results.reduce((ms, r) => ms + r.elapsedMs, 0);
  const reset = moves.filter((m) => !m.correct).length;
  const promoted = moves.filter((m) => m.correct && m.to > m.from).length;
  const held = moves.length - promoted - reset;
  const guessed = results.filter((r) => r.confidence === 'guessed').length;
  const shaky = results.filter((r) => r.correct && r.confidence !== 'confident').length;

  return (
    <main className="page page-narrow stack">
      <h1>Session complete</h1>

      <section className="card stack" aria-label="Score">
        <div className="summary-figures">
          <div>
            <span className="label">Correct</span>
            <p className="figure num" data-testid="summary-correct">
              {correct} / {total}
            </p>
          </div>
          <div>
            <span className="label">Accuracy</span>
            <p className="figure num">{total === 0 ? '—' : `${Math.round((correct / total) * 100)}%`}</p>
          </div>
          <div>
            <span className="label">Time</span>
            <p className="figure num">{mmss(elapsed)}</p>
          </div>
          <div>
            <span className="label">Median per card</span>
            <p className="figure num">{total === 0 ? '—' : mmss(elapsed / total)}</p>
          </div>
        </div>

        <p className="small muted" style={{ margin: 0 }} data-testid="summary-moves">
          {promoted} moved up a box, {reset} reset to box 1, {held} held.
        </p>
        {shaky > 0 || guessed > 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            {guessed} answered on a guess; {shaky} correct but not confident. Guesses cannot carry a
            card past box 2.
          </p>
        ) : null}
      </section>

      {missed.length > 0 ? (
        <section className="card stack" aria-label="Missed">
          <h2>
            Missed {missed.length} question{missed.length === 1 ? '' : 's'}
          </h2>
          <ul className="missed">
            {missed.map((q) => (
              <li key={q.id}>
                <span className="badge qid">Q{q.id}</span>{' '}
                <span className="small">{q.stem.trim().slice(0, 130)}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => onDrillMissed(missed)}>
              Drill these {missed.length} again
            </button>
            <a className="btn" href={href('/drill', { wrongTwice: 1, dueOnly: 0 })}>
              Everything wrong twice or more
            </a>
          </div>
        </section>
      ) : (
        <section className="card">
          <p style={{ margin: 0 }}>Nothing missed. The schedule has pushed all of these out.</p>
        </section>
      )}

      <div className="row">
        <button type="button" className="btn" onClick={onNewSession}>
          New drill
        </button>
        <a className="btn" href={href('/')}>
          Back to readiness
        </a>
      </div>
    </main>
  );
}
