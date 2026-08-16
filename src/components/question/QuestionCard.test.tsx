/**
 * Renderer tests. Every fixture is pulled out of the real bank by id — the
 * shapes that broke the pipeline are exactly the shapes the UI has to survive,
 * and an invented fixture would not carry the scanner typos, the missing option
 * keys or the empty explanation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { caseStudyFor, emptyResponse, questionById } from '../../lib/bank';
import { grade as gradeOf } from '../../lib/grade';
import type { CardPhase, Question, Response } from '../../types';
import { QuestionCard } from './QuestionCard';
import { CodeBlock, detectLanguage } from './CodeBlock';

const q = (id: number): Question => {
  const found = questionById(id);
  if (!found) throw new Error(`q${id} is not in the bank`);
  return found;
};

/** Renders a real question with a real grade, exactly as the drill loop would. */
function renderCard(
  question: Question,
  opts: {
    response?: Response;
    phase?: CardPhase;
    onChange?: (r: Response) => void;
    suppressFeedback?: boolean;
    correction?: string | null;
    onCorrectionChange?: (c: string | null) => void;
  } = {},
) {
  const phase = opts.phase ?? 'answering';
  const response = opts.response ?? emptyResponse(question);
  return render(
    <QuestionCard
      question={question}
      caseStudy={caseStudyFor(question)}
      phase={phase}
      response={response}
      grade={phase === 'revealed' ? gradeOf(question, response) : null}
      onChange={opts.onChange ?? (() => {})}
      correction={opts.correction ?? null}
      suppressFeedback={opts.suppressFeedback}
      onCorrectionChange={opts.onCorrectionChange}
    />,
  );
}

describe('multi-select', () => {
  const question = q(4); // correct: C and D

  it('is all-or-nothing: two of three right shows as wrong', () => {
    expect(question.type).toBe('mcq-multi');
    expect(question.correct).toEqual(['C', 'D']);

    renderCard(question, {
      phase: 'revealed',
      response: { kind: 'choice', keys: ['C'] },
    });

    expect(screen.getByText('Not correct')).toBeInTheDocument();
    expect(screen.getAllByText(/all-or-nothing/i).length).toBeGreaterThan(0);
  });

  it('marks chosen-correct, chosen-wrong and correct-but-missed distinctly', () => {
    renderCard(question, {
      phase: 'revealed',
      response: { kind: 'choice', keys: ['A', 'C'] },
    });

    const boxes = screen.getAllByRole('checkbox');
    const classFor = (key: string) =>
      boxes.find((b) => b.textContent?.startsWith(key))?.className ?? '';

    expect(classFor('A')).toContain('is-wrong'); // chosen, not in the key
    expect(classFor('C')).toContain('is-correct'); // chosen, in the key
    expect(classFor('D')).toContain('is-missed'); // in the key, not chosen
    expect(classFor('B')).toBe('option'); // neither
  });

  it('uses checkbox semantics and toggles rather than replaces', async () => {
    const onChange = vi.fn();
    renderCard(question, { response: { kind: 'choice', keys: ['C'] }, onChange });

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(question.options.length);
    expect(boxes.find((b) => b.textContent?.startsWith('C'))).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(boxes.find((b) => b.textContent?.startsWith('D'))!);
    expect(onChange).toHaveBeenCalledWith({ kind: 'choice', keys: ['C', 'D'] });
  });

  it('uses radio semantics for single answer', () => {
    renderCard(q(25));
    expect(screen.getAllByRole('radio')).toHaveLength(q(25).options.length);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('box answers', () => {
  const question = q(2); // five ordered boxes, hotspot

  it('marks each box separately and tolerates a typo', () => {
    const expected = question.boxAnswers.map((b) => b.answer);
    const values = [
      // one transposition — the bank's own text is full of scanner slips, and
      // the user must not be marked wrong for the extraction's mistakes
      expected[0]!.replace('candidates', 'canditates'),
      expected[1]!,
      'Something else entirely',
      '',
      '',
    ];

    renderCard(question, { phase: 'revealed', response: { kind: 'boxes', values } });

    expect(screen.getByLabelText('Box 1')).toHaveClass('is-correct');
    expect(screen.getByLabelText('Box 2')).toHaveClass('is-correct');
    expect(screen.getByLabelText('Box 3')).toHaveClass('is-wrong');
    expect(screen.getByLabelText('Box 5')).toHaveClass('is-wrong');

    // The expected answer sits beside the wrong box, not in a separate panel.
    expect(screen.getByText(`Expected: ${expected[2]}`)).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 boxes matched/)).toBeInTheDocument();
    expect(screen.getByText('Not correct')).toBeInTheDocument();
  });

  it('offers the question’s own answers as datalist suggestions without closing the field', async () => {
    const onChange = vi.fn();
    const { container } = renderCard(question, { onChange });

    const list = container.querySelector('datalist');
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll('option')).toHaveLength(question.boxAnswers.length);

    const input = screen.getByLabelText('Box 1');
    expect(input).toHaveAttribute('list', list!.id);
    // A free-text input, not a select: anything can be typed.
    expect(input.tagName).toBe('INPUT');

    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalledWith({
      kind: 'boxes',
      values: ['x', '', '', '', ''],
    });
  });
});

describe('self-graded cards', () => {
  const question = q(11); // dragdrop, image only, no parseable boxes

  it('says it is self-graded, why, and offers both verdicts', async () => {
    expect(question.selfGraded).toBe(true);
    const onChange = vi.fn();
    renderCard(question, { onChange });

    // Said twice on purpose: a badge in the header and a plain statement above
    // the card, because this is 27.7% of the bank and not a corner case.
    expect(screen.getAllByText(/Self-graded/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/graded on your own recall|mark yourself/i)).toBeInTheDocument();

    // No fake interactivity before the reveal.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'I had it' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));

    expect(screen.getByRole('button', { name: 'I had it' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I did not' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'self', verdict: 'wrong' });
  });

  it('renders its image large enough to be the question', () => {
    renderCard(question);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(question.images.length);
    expect(imgs[0]).toHaveAttribute('loading', 'lazy');
    expect(imgs[0]).toHaveAccessibleName(/question 11/i);
  });

  it('withholds the answer under suppressFeedback but still takes a verdict', () => {
    renderCard(question, { suppressFeedback: true });
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I think I had it' })).toBeInTheDocument();
    expect(screen.queryByText(/^Explanation$/)).not.toBeInTheDocument();
  });
});

describe('case studies', () => {
  const question = q(25);

  it('never renders a child without its parent background', () => {
    const cs = caseStudyFor(question);
    expect(cs).not.toBeNull();

    renderCard(question);
    const panel = screen.getByRole('region', { name: 'Case study background' });
    expect(panel.textContent).toContain(cs!.background.trim().slice(0, 60));
  });

  it('collapses on request without losing the background from the card', async () => {
    renderCard(question);
    const toggle = screen.getByRole('button', { name: /Case study background/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the two known defects', () => {
  it('surfaces q182’s broken key rather than showing an answer it does not have', () => {
    const question = q(182);
    expect(question.correct).toEqual(['H']);
    expect(question.options.some((o) => o.key === 'H')).toBe(false);

    const { container } = renderCard(question, {
      phase: 'revealed',
      response: { kind: 'choice', keys: ['B'] },
    });

    expect(screen.getByText(/answer key is broken/i)).toBeInTheDocument();
    expect(container.textContent).toContain('option H');
    // Nothing is marked correct, because the bank has nothing to mark.
    expect(container.querySelectorAll('.option.is-correct')).toHaveLength(0);
    expect(container.querySelectorAll('.option.is-missed')).toHaveLength(0);
    expect(container.querySelector('.option.is-wrong')).not.toBeNull();
  });

  it('renders q266, the dead end, without crashing or faking a question', () => {
    const question = q(266);
    const { container } = renderCard(question, {
      phase: 'revealed',
      response: { kind: 'self', verdict: null },
    });

    expect(screen.getByText(/did not survive extraction/i)).toBeInTheDocument();
    expect(screen.getByText('Not gradeable')).toBeInTheDocument();
    expect(container.querySelectorAll('.option')).toHaveLength(0);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /I had it/ })).not.toBeInTheDocument();
  });
});

describe('currency and parse flags', () => {
  it('flags a suspect question honestly, as heuristic rather than confirmed', () => {
    renderCard(q(182));
    expect(screen.getByText(/heuristic flag, not verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Low parse confidence/)).toBeInTheDocument();
  });
});

describe('dispute the bank', () => {
  it('renders a persisted correction and lets it be edited', async () => {
    const onCorrectionChange = vi.fn();
    renderCard(q(182), { correction: 'The key is wrong; B is right.', onCorrectionChange });

    expect(screen.getByText('The key is wrong; B is right.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onCorrectionChange).toHaveBeenCalledWith(null);
  });

  it('raises a new correction through the callback only', async () => {
    const onCorrectionChange = vi.fn();
    renderCard(q(182), { onCorrectionChange });

    await userEvent.click(screen.getByRole('button', { name: /Record the right answer/ }));
    await userEvent.type(screen.getByRole('textbox'), 'B');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(onCorrectionChange).toHaveBeenCalledWith('B');
  });

  it('is absent while the simulator suppresses feedback', () => {
    renderCard(q(182), { suppressFeedback: true, onCorrectionChange: vi.fn() });
    expect(screen.queryByRole('button', { name: /Record the right answer/ })).not.toBeInTheDocument();
  });
});

describe('suppressFeedback', () => {
  const question = q(4);

  it('shows no marking, no grade and no explanation even when revealed', () => {
    const { container } = renderCard(question, {
      phase: 'revealed',
      response: { kind: 'choice', keys: ['C'] },
      suppressFeedback: true,
    });

    expect(container.querySelectorAll('.is-correct, .is-wrong, .is-missed')).toHaveLength(0);
    expect(screen.queryByText('Not correct')).not.toBeInTheDocument();
    expect(screen.queryByText('Explanation')).not.toBeInTheDocument();
  });
});

describe('code highlighting', () => {
  it('detects the three languages the bank can carry', () => {
    expect(detectLanguage('<Entity name="account" />')).toBe('xml');
    expect(detectLanguage('public class FollowUpPlugin : IPlugin { }')).toBe('csharp');
    expect(detectLanguage('const x = 1; function go() { return x; }')).toBe('javascript');
  });

  it('tokenises without losing a character', () => {
    const code = 'public void Execute(IServiceProvider sp) {\n  // trace\n  var n = 42;\n}';
    const { container } = render(<CodeBlock code={code} />);
    const pre = container.querySelector('pre.code')!;
    expect(pre.textContent).toBe(code);
    expect(pre.querySelectorAll('.tok-key').length).toBeGreaterThan(0);
    expect(pre.querySelectorAll('.tok-com')).toHaveLength(1);
    expect(pre.querySelectorAll('.tok-num')).toHaveLength(1);
  });

  it('highlights XML tags and attributes', () => {
    const { container } = render(<CodeBlock code={'<step name="Create">\n  <!-- x -->\n</step>'} />);
    const pre = container.querySelector('pre.code')!;
    expect(pre.querySelectorAll('.tok-tag').length).toBeGreaterThan(0);
    expect(pre.querySelectorAll('.tok-attr')).toHaveLength(1);
    expect(pre.querySelectorAll('.tok-str')).toHaveLength(1);
  });
});
