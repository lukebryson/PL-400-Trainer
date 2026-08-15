/**
 * The 246 questions whose options survived extraction: 189 single-answer and
 * 57 multi-answer.
 *
 * Multi-answer is all-or-nothing, exactly as the exam scores it — two of three
 * right is wrong. That is stated on the card rather than discovered after a
 * wrong mark.
 *
 * The option letter is rendered in `.option-key` and is stable, because the
 * drill loop binds number and letter keys to these rows.
 */
import type { CardPhase, Grade, Question } from '../../types';

interface Props {
  question: Question;
  /** Currently selected option keys. */
  selected: string[];
  phase: CardPhase;
  grade: Grade | null;
  onChange: (keys: string[]) => void;
  suppressFeedback?: boolean;
}

export const isMultiSelect = (q: Question): boolean =>
  q.type === 'mcq-multi' || q.correct.length > 1;

export function McqOptions({ question, selected, phase, grade, onChange, suppressFeedback }: Props) {
  const multi = isMultiSelect(question);
  const locked = phase === 'revealed';
  const showMarks = locked && !suppressFeedback;
  const correct = new Set(question.correct.map((k) => k.toUpperCase()));
  const chosen = new Set(selected.map((k) => k.toUpperCase()));

  const toggle = (key: string) => {
    if (locked) return;
    if (multi) {
      onChange(chosen.has(key.toUpperCase()) ? selected.filter((k) => k !== key) : [...selected, key]);
    } else {
      onChange([key]);
    }
  };

  const classFor = (key: string): string => {
    if (!showMarks) return 'option';
    const k = key.toUpperCase();
    const isCorrect = correct.has(k);
    const isChosen = chosen.has(k);
    if (isChosen && isCorrect) return 'option is-correct';
    if (isChosen && !isCorrect) return 'option is-wrong';
    if (!isChosen && isCorrect) return 'option is-missed';
    return 'option';
  };

  const markFor = (key: string): string | null => {
    if (!showMarks) return null;
    const k = key.toUpperCase();
    if (correct.has(k)) return chosen.has(k) ? 'Correct, and you chose it' : 'Correct, and you missed it';
    return chosen.has(k) ? 'Wrong, and you chose it' : null;
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">
          {multi ? `Select ${question.correct.length || 'all that apply'}` : 'Select one'}
        </span>
        {multi ? (
          <span className="tiny faint">All-or-nothing: a partly correct set scores zero.</span>
        ) : null}
      </div>

      <div
        className="optionlist"
        role={multi ? 'group' : 'radiogroup'}
        aria-label={`Options for question ${question.id}`}
      >
        {question.options.map((o) => (
          <button
            key={o.key}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={chosen.has(o.key.toUpperCase())}
            className={classFor(o.key)}
            disabled={locked}
            onClick={() => toggle(o.key)}
          >
            <span className="option-key" aria-hidden="true">
              {o.key}
            </span>
            <span>
              {o.text}
              {markFor(o.key) ? <span className="visually-hidden"> — {markFor(o.key)}</span> : null}
            </span>
          </button>
        ))}
      </div>

      {showMarks && multi && grade && !grade.correct ? (
        <p className="tiny faint" style={{ margin: 0 }}>
          Multi-select is graded whole. The dashed outline marks an answer you did not select.
        </p>
      ) : null}
    </div>
  );
}
