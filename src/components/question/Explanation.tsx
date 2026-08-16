/**
 * The explanation, any code block, and the reference links (228 questions carry
 * them). Rendered only once a card is revealed, and never while the exam
 * simulator is suppressing feedback.
 */
import type { Question } from '../../types';
import { CodeBlock } from './CodeBlock';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function Explanation({ question }: { question: Question }) {
  const hasText = question.explanation.trim() !== '';
  if (!hasText && !question.codeBlock && question.references.length === 0) {
    return (
      <p className="small faint" style={{ margin: 0 }}>
        No explanation survived extraction for this question.
      </p>
    );
  }

  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Explanation">
      {hasText ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Explanation</span>
          <div className="prose">{question.explanation.trim()}</div>
        </div>
      ) : null}

      {question.codeBlock ? <CodeBlock code={question.codeBlock} /> : null}

      {question.references.length > 0 ? (
        <div>
          <span className="label">References</span>
          <ul className="reflist">
            {question.references.map((r) => (
              <li key={r}>
                <a href={r} target="_blank" rel="noreferrer">
                  {hostOf(r)}
                </a>{' '}
                <span className="faint tiny">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
