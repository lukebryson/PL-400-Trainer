/**
 * The drill loop — the thing the user actually does every day, so it is built
 * to be run from the keyboard and never to lose an answer.
 *
 * Three stages behind one route: pick the pool, answer the cards, read the
 * damage. The filter lives in the URL (`filter.ts`), so a drill is bookmarkable
 * and the dashboard's next action is a plain link.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  - **The attempt is recorded on advance, not on submit.** Confidence is chosen
 *    after the answer is revealed, and confidence changes the Leitner move — a
 *    guessed-correct cannot promote past box 2. Recording at submit would post
 *    every attempt as whatever the default happened to be.
 *  - **A bare Space defaults to `unsure`, never `confident`.** The rating is
 *    load-bearing, so the lazy path must be the honest one.
 *
 * Owned by the features agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuestionCard, isMultiSelect } from '../../components/question';
import { caseStudyFor, emptyResponse, isAnswered, responseKindFor } from '../../lib/bank';
import { grade as gradeResponse } from '../../lib/grade';
import { useStorageStatus, useStore } from '../../lib/store';
import { href, type PageProps } from '../../router';
import type {
  Confidence,
  Grade,
  Question,
  Response,
  Session,
  SessionQuestionResult,
} from '../../types';
import { startSession } from '../session';
import { DrillSetup } from './DrillSetup';
import { DrillSummary, type BoxMove } from './DrillSummary';
import { describeFilter, modeFor, parseFilter } from './filter';
import {
  applyChoice,
  confidenceFromKey,
  isTypingTarget,
  optionIndexFromKey,
  verdictFromKey,
} from './keys';
import './drill.css';

interface CardState {
  response: Response;
  /** Null until submitted. Its presence is what "revealed" means. */
  grade: Grade | null;
  confidence: Confidence;
  /** Self-graded cards reveal before they can be marked; the loop drives it. */
  selfRevealed: boolean;
  elapsedMs: number;
}

interface Run {
  session: Session;
  questions: Question[];
  cards: CardState[];
  index: number;
  results: SessionQuestionResult[];
  finished: boolean;
}

const CONFIDENCES: { value: Confidence; label: string; hint: string }[] = [
  { value: 'guessed', label: 'Guessed', hint: 'Cannot carry a card past box 2' },
  { value: 'unsure', label: 'Unsure', hint: 'Promotes, but shows up as shaky' },
  { value: 'confident', label: 'Confident', hint: 'Promotes normally' },
];

const newCard = (q: Question): CardState => ({
  response: emptyResponse(q),
  grade: null,
  // The default, and deliberately not `confident`: a Space-bar drill must not
  // quietly claim mastery of everything it happened to get right.
  confidence: 'unsure',
  selfRevealed: false,
  elapsedMs: 0,
});

export function DrillPage({ params }: PageProps) {
  const store = useStore();
  const status = useStorageStatus();
  const filter = useMemo(() => parseFilter(params), [params]);

  const [run, setRun] = useState<Run | null>(null);
  const [moves, setMoves] = useState<BoxMove[]>([]);
  const [openCases, setOpenCases] = useState<ReadonlySet<string>>(new Set());

  const cardStart = useRef<number>(Date.now());
  const seenCases = useRef<Set<string>>(new Set());
  /**
   * The card `advance` has already committed, as `sessionId:index`.
   *
   * The keydown listener is registered from an effect that re-runs on every
   * `run` change, so it closes over the run of the render that registered it.
   * Hold Space down and the browser repeats keydown about every 33ms — faster
   * than React can swap the listener — and the second repeat calls `advance`
   * with the *same* stale `run`: the attempt is posted to the schedule twice,
   * both moves land in the summary, and the second `setRun` overwrites the
   * first so one result is lost. Same for a double-click on Next. This is set
   * synchronously, before any state is touched, so the repeat is a no-op.
   */
  const advanced = useRef<string>('');

  const current = run && !run.finished ? run.questions[run.index] : undefined;
  const card = run && !run.finished ? run.cards[run.index] : undefined;

  // Open a case-study background the first time it is met in a session, then
  // leave it as the user last set it. Reading the same three paragraphs before
  // every child question is how a case study stops being read at all.
  useEffect(() => {
    const id = current?.caseStudyId;
    if (!id || seenCases.current.has(id)) return;
    seenCases.current.add(id);
    setOpenCases((open) => new Set(open).add(id));
  }, [current]);

  const start = useCallback(
    (questions: Question[]) => {
      if (questions.length === 0) return;
      setMoves([]);
      setOpenCases(new Set());
      seenCases.current = new Set();
      cardStart.current = Date.now();
      advanced.current = '';
      setRun({
        session: startSession(modeFor(filter)),
        questions,
        cards: questions.map(newCard),
        index: 0,
        results: [],
        finished: false,
      });
    },
    [filter],
  );

  const patchCard = useCallback((change: Partial<CardState>) => {
    setRun((r) =>
      r === null
        ? r
        : { ...r, cards: r.cards.map((c, i) => (i === r.index ? { ...c, ...change } : c)) },
    );
  }, []);

  /** Grade and reveal. Never persists — the attempt is written on advance. */
  const submit = useCallback(() => {
    if (!run || run.finished) return;
    const q = run.questions[run.index];
    const c = run.cards[run.index];
    if (!q || !c || c.grade !== null || !isAnswered(c.response)) return;
    patchCard({ grade: gradeResponse(q, c.response), elapsedMs: Date.now() - cardStart.current });
  }, [run, patchCard]);

  /**
   * Write the attempt, append the result, move on. The session is saved on every
   * card rather than at the end, so a drill abandoned halfway still counts
   * towards velocity instead of vanishing.
   */
  const advance = useCallback(() => {
    if (!run || run.finished) return;
    const q = run.questions[run.index];
    const c = run.cards[run.index];
    if (!q || !c || c.grade === null) return;

    // Before anything else, and synchronously: see `advanced` above.
    const token = `${run.session.id}:${run.index}`;
    if (advanced.current === token) return;
    advanced.current = token;

    const verdict = c.grade;

    const fromBox = store.progress.get(q.contentHash)?.box ?? 1;
    const result: SessionQuestionResult = {
      contentHash: q.contentHash,
      questionId: q.id,
      correct: verdict.correct,
      confidence: c.confidence,
      skillArea: q.skillArea,
      elapsedMs: c.elapsedMs,
    };

    const results = [...run.results, result];
    const last = run.index >= run.questions.length - 1;
    const session: Session = {
      ...run.session,
      results,
      finishedAt: last ? Date.now() : null,
    };

    setRun({ ...run, session, results, index: last ? run.index : run.index + 1, finished: last });
    cardStart.current = Date.now();

    void store
      .recordAttempt({
        question: q,
        grade: verdict,
        confidence: c.confidence,
        elapsedMs: c.elapsedMs,
      })
      .then((record) =>
        setMoves((m) => [
          ...m,
          { questionId: q.id, from: fromBox, to: record.box, correct: verdict.correct },
        ]),
      );
    void store.saveSession(session);
  }, [run, store]);

  /** Stop here and keep what has been answered. */
  const endEarly = useCallback(() => {
    if (!run || run.finished) return;
    const session: Session = { ...run.session, results: run.results, finishedAt: Date.now() };
    setRun({ ...run, session, finished: true });
    void store.saveSession(session);
  }, [run, store]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!run || run.finished) return;
    const q = run.questions[run.index];
    const c = run.cards[run.index];
    if (!q || !c) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Enter still submits from inside a box-answer input; nothing else does,
      // or typing "Server-side" would select option 5 four times over.
      if (isTypingTarget(event.target) && event.key !== 'Enter') return;

      const kind = responseKindFor(q);

      if (c.grade !== null) {
        const confidence = confidenceFromKey(event.key);
        if (confidence) {
          event.preventDefault();
          patchCard({ confidence });
          return;
        }
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          advance();
        }
        return;
      }

      if (kind === 'choice') {
        const index = optionIndexFromKey(event.key, q.options.length);
        if (index !== null) {
          event.preventDefault();
          const key = q.options[index]!.key;
          const selected = c.response.kind === 'choice' ? c.response.keys : [];
          patchCard({
            response: { kind: 'choice', keys: applyChoice(selected, key, isMultiSelect(q)) },
          });
          return;
        }
      } else if (kind === 'self') {
        if (!c.selfRevealed) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            patchCard({ selfRevealed: true });
          }
          return;
        }
        const verdict = verdictFromKey(event.key);
        if (verdict) {
          event.preventDefault();
          patchCard({ response: { kind: 'self', verdict } });
          return;
        }
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, advance, submit, patchCard]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!store.ready) {
    return (
      <main className="page page-narrow">
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Reading progress…
          </p>
        </div>
      </main>
    );
  }

  if (run === null) {
    return (
      <>
        <StorageWarning show={!status.persistent} error={status.error} />
        <DrillSetup progress={store.progress} filter={filter} onStart={start} />
      </>
    );
  }

  if (run.finished) {
    const missed = run.results
      .filter((r) => !r.correct)
      .map((r) => run.questions.find((q) => q.contentHash === r.contentHash))
      .filter((q): q is Question => q !== undefined);

    return (
      <DrillSummary
        results={run.results}
        moves={moves}
        missed={missed}
        onDrillMissed={start}
        onNewSession={() => setRun(null)}
      />
    );
  }

  const q = current!;
  const c = card!;
  const revealed = c.grade !== null;
  const kind = responseKindFor(q);
  const answered = isAnswered(c.response);
  const correctSoFar = run.results.filter((r) => r.correct).length;

  return (
    <main className="page page-narrow stack">
      <StorageWarning show={!status.persistent} error={status.error} />

      <header className="drill-head">
        <span className="counter num">
          {run.index + 1} / {run.questions.length}
        </span>
        <div
          className="drill-track"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={run.questions.length}
          aria-valuenow={run.index + 1}
          aria-label="Session progress"
        >
          {run.questions.map((question, i) => {
            const result = run.results[i];
            const cls =
              result === undefined
                ? i === run.index
                  ? 'is-current'
                  : ''
                : result.correct
                  ? 'is-correct'
                  : 'is-wrong';
            return <span key={question.id} className={cls} />;
          })}
        </div>
        <span className="tiny faint num">
          {correctSoFar}/{run.results.length || 0} right
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={endEarly}>
          End session
        </button>
      </header>

      <p className="tiny faint" style={{ margin: 0 }}>
        {describeFilter(filter)}
      </p>

      {/*
        The verdict is a colour change and a badge inside the card — nothing a
        screen reader is told about, because submitting moves no focus. The
        region is always in the DOM so the change is announced as an update
        rather than as an insertion, which some readers skip.
      */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {revealed && c.grade
          ? `${
              c.grade.ungradeable
                ? 'Not gradeable'
                : c.grade.correct
                  ? 'Correct'
                  : 'Not correct'
            }. Rate your confidence one to three, then Space for the next card.`
          : ''}
      </div>

      <QuestionCard
        question={q}
        caseStudy={caseStudyFor(q)}
        phase={revealed ? 'revealed' : 'answering'}
        response={c.response}
        grade={c.grade}
        onChange={(response) => patchCard({ response })}
        correction={store.progress.get(q.contentHash)?.correction ?? null}
        onCorrectionChange={(correction) => void store.setCorrection(q.contentHash, correction)}
        caseStudyOpen={q.caseStudyId ? openCases.has(q.caseStudyId) : undefined}
        onCaseStudyToggle={(open) =>
          setOpenCases((cases) => {
            const next = new Set(cases);
            if (!q.caseStudyId) return next;
            if (open) next.add(q.caseStudyId);
            else next.delete(q.caseStudyId);
            return next;
          })
        }
        selfRevealed={c.selfRevealed}
        onSelfReveal={() => patchCard({ selfRevealed: true })}
      />

      <div className="actionbar">
        {!revealed ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!answered}
              onClick={submit}
            >
              Submit
            </button>
            <span className="tiny faint">
              {kind === 'choice' ? (
                <>
                  <kbd>1</kbd>–<kbd>{Math.min(9, q.options.length)}</kbd> or <kbd>A</kbd>–
                  <kbd>{q.options[q.options.length - 1]?.key ?? 'F'}</kbd> select ·{' '}
                </>
              ) : kind === 'self' ? (
                <>
                  <kbd>Enter</kbd> reveal, then <kbd>1</kbd> had it / <kbd>2</kbd> did not ·{' '}
                </>
              ) : (
                <>Type each box · </>
              )}
              <kbd>Enter</kbd> submit
            </span>
          </>
        ) : (
          <>
            <div className="confidence" role="group" aria-label="How confident were you?">
              <span className="label">Confidence</span>
              {CONFIDENCES.map((option, i) => (
                <button
                  key={option.value}
                  type="button"
                  className="btn btn-sm"
                  aria-pressed={c.confidence === option.value}
                  title={option.hint}
                  onClick={() => patchCard({ confidence: option.value })}
                >
                  <kbd>{i + 1}</kbd> {option.label}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary" onClick={advance}>
              {run.index >= run.questions.length - 1 ? 'Finish' : 'Next'}
            </button>
            <span className="tiny faint">
              <kbd>Space</kbd>
            </span>
          </>
        )}
      </div>
    </main>
  );
}

/**
 * A session the user believes is being saved, and is not, is worse than no
 * session — so this is loud and it does not go away.
 */
function StorageWarning({ show, error }: { show: boolean; error: string | null }) {
  if (!show) return null;
  return (
    <div className="notice notice-bad">
      <div>
        <strong>Progress is not being saved.</strong> IndexedDB is unavailable, so this session
        lives in memory for this tab only. {error ?? ''}{' '}
        <a href={href('/export')}>Take a backup</a> before you rely on it.
      </div>
    </div>
  );
}
