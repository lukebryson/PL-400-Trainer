/**
 * The 87 hotspot/dragdrop questions whose ordered `Box 1: … Box 2: …` answers
 * were recoverable. One graded text input per box.
 *
 * The answers are often full sentences, so each input is backed by a
 * `<datalist>` of that question's own box answers: recall stays open, but the
 * user is not made to retype 90 characters to prove they knew it. Comparison is
 * `answersMatch` from `grade.ts` — the bank's own text carries scanner typos
 * and the user must not be marked wrong for the extraction's mistakes.
 */
import { boxSuggestions } from '../../lib/bank';
import type { CardPhase, Grade, Question } from '../../types';

interface Props {
  question: Question;
  values: string[];
  phase: CardPhase;
  grade: Grade | null;
  onChange: (values: string[]) => void;
  suppressFeedback?: boolean;
}

export function BoxAnswers({ question, values, phase, grade, onChange, suppressFeedback }: Props) {
  const locked = phase === 'revealed';
  const showMarks = locked && !suppressFeedback;
  const suggestions = boxSuggestions(question);
  const listId = `boxlist-q${question.id}`;

  const set = (i: number, v: string) => {
    if (locked) return;
    const next = question.boxAnswers.map((_, j) => values[j] ?? '');
    next[i] = v;
    onChange(next);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">
          Type the answer for each box ({question.boxAnswers.length} in order)
        </span>
        <span className="tiny faint">Close spellings are accepted.</span>
      </div>

      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="boxlist">
        {question.boxAnswers.map((b, i) => {
          const ok = showMarks ? (grade?.perBox?.[i] ?? false) : null;
          const inputId = `q${question.id}-box${b.box}`;
          return (
            <div className="boxrow" key={b.box}>
              <div className="boxhead">
                <label htmlFor={inputId}>Box {b.box}</label>
                {ok === true ? <span className="badge badge-ok">Correct</span> : null}
                {ok === false ? <span className="badge badge-bad">Wrong</span> : null}
              </div>
              <input
                id={inputId}
                type="text"
                list={listId}
                autoComplete="off"
                spellCheck={false}
                className={ok === true ? 'is-correct' : ok === false ? 'is-wrong' : undefined}
                value={values[i] ?? ''}
                readOnly={locked}
                aria-describedby={ok === false ? `${inputId}-expected` : undefined}
                onChange={(e) => set(i, e.target.value)}
              />
              {ok === false ? (
                <span className="expected" id={`${inputId}-expected`}>
                  Expected: {b.answer}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {showMarks && grade?.perBox ? (
        <p className="tiny faint" style={{ margin: 0 }}>
          {grade.perBox.filter(Boolean).length} of {grade.perBox.length} boxes matched. The card
          counts as correct only when every box does.
        </p>
      ) : null}
    </div>
  );
}
