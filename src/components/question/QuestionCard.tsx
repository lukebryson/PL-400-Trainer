/**
 * The one entry point for rendering a question. Everything else in this folder
 * is a part it composes.
 *
 * It dispatches on `responseKindFor(question)` rather than on `question.type`:
 * type says what the question looked like in the dump, response kind says what
 * the user can actually do with it here. A hotspot with parsed boxes and a
 * hotspot without are the same `type` and completely different cards.
 *
 * Presentational only — no store, no persistence, no scheduling. State arrives
 * as props and leaves through callbacks.
 */
import { responseKindFor, isDeadEnd } from '../../lib/bank';
import type { QuestionRendererProps, Response, SelfVerdict } from '../../types';
import { SKILL_AREAS } from '../../types';
import { BoxAnswers } from './BoxAnswers';
import { BrokenKeyNotice, DisputeBank } from './DisputeBank';
import { CaseStudyPanel, MissingCaseStudy } from './CaseStudyPanel';
import { CurrencyBanner } from './CurrencyBanner';
import { Explanation } from './Explanation';
import { McqOptions, isMultiSelect } from './McqOptions';
import { QuestionImages } from './QuestionImages';
import { SelfGraded } from './SelfGraded';
import './question.css';

export interface QuestionCardProps extends QuestionRendererProps {
  /**
   * Case-study expansion is session state, not card state: open on first sight
   * of a case study in a session, collapsed thereafter. The drill loop owns it.
   */
  caseStudyOpen?: boolean;
  onCaseStudyToggle?: (open: boolean) => void;
  /** Omit to render the dispute affordance read-only. */
  onCorrectionChange?: (correction: string | null) => void;
}

const TYPE_LABEL: Record<string, string> = {
  'mcq-single': 'Single answer',
  'mcq-multi': 'Multi answer',
  hotspot: 'Hotspot',
  dragdrop: 'Drag and drop',
  'yesno-series': 'Yes/no series',
};

function GradeSummary({
  correct,
  selfGraded,
  ungradeable,
}: {
  correct: boolean;
  selfGraded: boolean;
  ungradeable: boolean;
}) {
  if (ungradeable) return <span className="badge">Not gradeable</span>;
  if (correct) {
    return (
      <span className="badge badge-ok">{selfGraded ? 'Marked correct by you' : 'Correct'}</span>
    );
  }
  return (
    <span className="badge badge-bad">{selfGraded ? 'Marked wrong by you' : 'Not correct'}</span>
  );
}

export function QuestionCard({
  question,
  caseStudy,
  phase,
  response,
  grade,
  onChange,
  correction,
  suppressFeedback,
  caseStudyOpen,
  onCaseStudyToggle,
  onCorrectionChange,
}: QuestionCardProps) {
  const kind = responseKindFor(question);
  const dead = isDeadEnd(question);
  const revealed = phase === 'revealed' && !suppressFeedback;
  const area = SKILL_AREAS[question.skillArea];

  const emit = (r: Response) => {
    if (phase === 'revealed') return; // the contract: ignored once revealed
    onChange(r);
  };

  return (
    <article className="card stack qcard" aria-label={`Question ${question.id}`}>
      <header className="qhead">
        <span className="badge qid">Q{question.id}</span>
        <span className="badge">{TYPE_LABEL[question.type] ?? question.type}</span>
        {question.selfGraded ? <span className="badge badge-accent">Self-graded</span> : null}
        <span style={{ flex: 1 }} />
        <span className="tiny faint">
          {area?.label ?? question.skillArea}
          {question.subtopic ? ` · ${question.subtopic}` : ''}
        </span>
      </header>

      <CurrencyBanner question={question} suppressFeedback={suppressFeedback} />
      <BrokenKeyNotice question={question} />

      {question.caseStudyId ? (
        caseStudy ? (
          <CaseStudyPanel
            caseStudy={caseStudy}
            open={caseStudyOpen}
            onToggle={onCaseStudyToggle}
          />
        ) : (
          <MissingCaseStudy caseStudyId={question.caseStudyId} />
        )
      ) : null}

      <p className="stem">{question.stem.trim()}</p>

      <QuestionImages
        images={question.images}
        questionId={question.id}
        caption={
          kind === 'choice' && question.images.length > 0 ? 'Exhibit' : undefined
        }
      />

      {dead ? null : kind === 'choice' && response.kind === 'choice' ? (
        <McqOptions
          question={question}
          selected={response.keys}
          phase={phase}
          grade={grade}
          suppressFeedback={suppressFeedback}
          onChange={(keys) => emit({ kind: 'choice', keys })}
        />
      ) : kind === 'boxes' && response.kind === 'boxes' ? (
        <BoxAnswers
          question={question}
          values={response.values}
          phase={phase}
          grade={grade}
          suppressFeedback={suppressFeedback}
          onChange={(values) => emit({ kind: 'boxes', values })}
        />
      ) : response.kind === 'self' ? (
        <SelfGraded
          question={question}
          verdict={response.verdict}
          phase={phase}
          suppressFeedback={suppressFeedback}
          onChange={(verdict: SelfVerdict) => emit({ kind: 'self', verdict })}
        />
      ) : null}

      {revealed && grade ? (
        <div className="row">
          <GradeSummary
            correct={grade.correct}
            selfGraded={grade.selfGraded}
            ungradeable={grade.ungradeable}
          />
          {kind === 'choice' && isMultiSelect(question) && !grade.correct ? (
            <span className="tiny faint">
              Multi-select is all-or-nothing — a partly correct set scores zero.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* The self-graded card reveals its own explanation as part of its flow. */}
      {revealed && kind !== 'self' && !dead ? <Explanation question={question} /> : null}

      <DisputeBank
        question={question}
        correction={correction}
        onCorrectionChange={onCorrectionChange}
        suppressFeedback={suppressFeedback}
      />
    </article>
  );
}
