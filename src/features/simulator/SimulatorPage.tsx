/**
 * The exam simulator. Timed, blueprint-sampled, and silent until the end.
 *
 * The point of it is not more practice — the drill is better practice, because
 * it tells you immediately. The point is the two things the drill cannot
 * rehearse: pacing, and answering without knowing whether the last one was
 * right. So no feedback is shown until the paper is submitted, and the clock is
 * always on screen.
 *
 * Sampling comes from `selectors.sampleExam`, which is blueprint-weighted
 * rather than bank-weighted and prefers machine-gradable questions — a
 * simulator you have to mark yourself does not give a score. Verified at 1,000
 * exams landing within 1.5pp of every weight.
 *
 * Owned by the features agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuestionCard, isMultiSelect } from '../../components/question';
import { caseStudyFor, emptyResponse, isAnswered, responseKindFor } from '../../lib/bank';
import { grade as gradeResponse } from '../../lib/grade';
import { sampleExam } from '../../lib/selectors';
import { useStorageStatus, useStore } from '../../lib/store';
import { href, type PageProps } from '../../router';
import {
  PASS_MARK,
  SKILL_AREAS,
  type Question,
  type Response,
  type Session,
  type SessionQuestionResult,
  type SkillAreaKey,
} from '../../types';
import { applyChoice, isTypingTarget, optionIndexFromKey, verdictFromKey } from '../drill/keys';
import { mmss, scaleScore, startSession } from '../session';
import './simulator.css';

/**
 * Two minutes a question. The real paper allows roughly 100 minutes for 40–60,
 * and pacing is the whole reason to sit one of these, so the budget scales with
 * the length rather than being a flat hour.
 */
const MS_PER_QUESTION = 120_000;
const LOW_TIME_MS = 600_000;
const LENGTHS = [40, 50, 60];

/**
 * The most time one card can be charged with.
 *
 * The clock is wall-clock against a deadline, so backgrounding the tab is
 * handled correctly — the paper still auto-submits on return. The stopwatch is
 * not: it would charge the whole background interval, hours if the tab sat
 * overnight, to whichever card happened to be on screen. That figure is written
 * into every attempt and read back by the "longest on the clock" line. Five
 * times the budget for a single question is already a pacing disaster; beyond
 * that the user was not in the room.
 */
const MAX_CARD_MS = MS_PER_QUESTION * 5;

/** Pure: bank `spent` against the card being left. */
const charged = (elapsed: readonly number[], index: number, spent: number): number[] =>
  elapsed.map((ms, i) => (i === index ? ms + spent : ms));

interface Paper {
  session: Session;
  questions: Question[];
  responses: Response[];
  flagged: boolean[];
  elapsed: number[];
  index: number;
  deadline: number;
  /** Null while sitting; set once submitted, and the only way feedback appears. */
  results: SessionQuestionResult[] | null;
}

export function SimulatorPage(_props: PageProps) {
  const store = useStore();
  const status = useStorageStatus();

  const [paper, setPaper] = useState<Paper | null>(null);
  const [length, setLength] = useState(50);
  const [wrongOnly, setWrongOnly] = useState(true);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [tick, setTick] = useState(0);

  const viewStart = useRef(Date.now());
  /**
   * The session id already submitted. The auto-submit effect cannot fire twice
   * on its own — effects run once per commit and `sitting` is false by the next
   * one — but `submit` posts 40–60 attempts to the schedule, and a Confirm click
   * racing the deadline, or a double-click on Confirm, would post all of them
   * twice. Set synchronously, for the same reason as the drill's `advanced`.
   */
  const submitted = useRef<string>('');

  const sitting = paper !== null && paper.results === null;
  const remaining = paper === null ? 0 : paper.deadline - Date.now();

  const begin = useCallback(() => {
    // Sampled once, here. Sampling inside the render would reshuffle the paper
    // under the user mid-question.
    const questions = sampleExam(store.progress, length);
    if (questions.length === 0) return;
    const now = Date.now();
    viewStart.current = now;
    setConfirmSubmit(false);
    setPaper({
      session: startSession('simulator', now),
      questions,
      responses: questions.map(emptyResponse),
      flagged: questions.map(() => false),
      elapsed: questions.map(() => 0),
      index: 0,
      deadline: now + questions.length * MS_PER_QUESTION,
      results: null,
    });
  }, [store, length]);

  /**
   * Read the stopwatch and restart it. This mutates a ref, so it must never be
   * called from inside a `setPaper` updater: StrictMode invokes updaters twice,
   * the second call would measure a zero-length interval, and its return value
   * is the one React keeps — every card navigated away from would be recorded
   * as taking no time at all.
   */
  const takeSpent = useCallback((): number => {
    const now = Date.now();
    const spent = now - viewStart.current;
    viewStart.current = now;
    return Math.min(Math.max(0, spent), MAX_CARD_MS);
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const p = paper;
      if (p === null || p.results !== null) return;
      const bounded = Math.max(0, Math.min(p.questions.length - 1, index));
      if (bounded === p.index) return;
      setPaper({ ...p, elapsed: charged(p.elapsed, p.index, takeSpent()), index: bounded });
    },
    [paper, takeSpent],
  );

  const respond = useCallback((response: Response) => {
    setPaper((p) =>
      p === null || p.results !== null
        ? p
        : { ...p, responses: p.responses.map((r, i) => (i === p.index ? response : r)) },
    );
  }, []);

  /**
   * Grade the whole paper at once, write every attempt to the schedule, and
   * save the session with its scaled score. Attempts are recorded as `unsure`:
   * an exam collects no confidence signal, and claiming `confident` on the
   * user's behalf would let a lucky paper promote cards to a fortnight's delay.
   */
  const submit = useCallback(() => {
    const p = paper;
    if (p === null || p.results !== null) return;
    if (submitted.current === p.session.id) return;
    submitted.current = p.session.id;
    const elapsed = charged(p.elapsed, p.index, takeSpent());

    const grades = p.questions.map((q, i) => gradeResponse(q, p.responses[i]!));
    const results: SessionQuestionResult[] = p.questions.map((q, i) => ({
      contentHash: q.contentHash,
      questionId: q.id,
      correct: grades[i]!.correct,
      confidence: 'unsure' as const,
      skillArea: q.skillArea,
      elapsedMs: elapsed[i] ?? 0,
    }));

    const session: Session = {
      ...p.session,
      results,
      finishedAt: Date.now(),
      scaledScore: scaleScore(results),
    };

    setPaper({ ...p, elapsed, session, results, index: 0 });
    setConfirmSubmit(false);

    // Outside the state updater: an updater can be invoked more than once, and
    // a double-invoked `recordAttempt` would post every answer to the schedule
    // twice.
    p.questions.forEach((q, i) => {
      void store.recordAttempt({
        question: q,
        grade: grades[i]!,
        confidence: 'unsure',
        elapsedMs: elapsed[i] ?? 0,
      });
    });
    void store.saveSession(session);
  }, [paper, takeSpent, store]);

  // The clock. One interval for the whole paper; it also drives auto-submit,
  // because a timed paper that runs over is not a timed paper.
  useEffect(() => {
    if (!sitting) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sitting]);

  useEffect(() => {
    if (sitting && remaining <= 0) submit();
  }, [sitting, remaining, submit, tick]);

  // Keyboard: the same option bindings as the drill, plus paging. No Enter-to-
  // submit — submitting a whole paper is not something to do by reflex.
  useEffect(() => {
    if (!sitting || paper === null) return;
    const q = paper.questions[paper.index];
    if (!q) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goTo(paper.index + 1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(paper.index - 1);
        return;
      }
      if (event.key === 'f') {
        event.preventDefault();
        setPaper((p) =>
          p === null ? p : { ...p, flagged: p.flagged.map((v, i) => (i === p.index ? !v : v)) },
        );
        return;
      }

      const kind = responseKindFor(q);
      if (kind === 'choice') {
        const index = optionIndexFromKey(event.key, q.options.length);
        if (index === null) return;
        event.preventDefault();
        const key = q.options[index]!.key;
        const response = paper.responses[paper.index]!;
        const selected = response.kind === 'choice' ? response.keys : [];
        respond({ kind: 'choice', keys: applyChoice(selected, key, isMultiSelect(q)) });
      } else if (kind === 'self') {
        const verdict = verdictFromKey(event.key);
        if (!verdict) return;
        event.preventDefault();
        respond({ kind: 'self', verdict });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sitting, paper, goTo, respond]);

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

  if (paper === null) {
    return <Setup length={length} onLength={setLength} onStart={begin} persistent={status.persistent} />;
  }

  if (paper.results !== null) {
    return (
      <Review
        paper={paper}
        wrongOnly={wrongOnly}
        onWrongOnly={setWrongOnly}
        onAgain={() => setPaper(null)}
      />
    );
  }

  const q = paper.questions[paper.index]!;
  const answeredCount = paper.responses.filter(isAnswered).length;
  const low = remaining <= LOW_TIME_MS;

  return (
    <main className="page stack">
      <section className="card sim-bar" aria-label="Exam status">
        <span
          className={`timer ${remaining <= 0 ? 'is-out' : low ? 'is-low' : ''}`}
          role="timer"
          aria-live="off"
        >
          {mmss(Math.max(0, remaining))}
        </span>
        <span className="tiny faint">
          left · {answeredCount} of {paper.questions.length} answered
        </span>
        <span style={{ flex: 1 }} />
        <span className="badge badge-accent">No feedback until you submit</span>
        {confirmSubmit ? (
          <>
            <span className="small">
              {answeredCount < paper.questions.length
                ? `${paper.questions.length - answeredCount} unanswered will be marked wrong.`
                : 'Submit and mark the paper?'}
            </span>
            <button type="button" className="btn btn-primary" onClick={submit}>
              Confirm
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmSubmit(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirmSubmit(true)}>
            Submit paper
          </button>
        )}
      </section>

      <JumpGrid paper={paper} onGo={goTo} />

      <QuestionCard
        question={q}
        caseStudy={caseStudyFor(q)}
        phase="answering"
        response={paper.responses[paper.index]!}
        grade={null}
        onChange={respond}
        correction={store.progress.get(q.contentHash)?.correction ?? null}
        suppressFeedback
      />

      <div className="actionbar">
        <button
          type="button"
          className="btn"
          disabled={paper.index === 0}
          onClick={() => goTo(paper.index - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={paper.index >= paper.questions.length - 1}
          onClick={() => goTo(paper.index + 1)}
        >
          Next
        </button>
        <button
          type="button"
          className={paper.flagged[paper.index] ? 'btn btn-ok' : 'btn'}
          aria-pressed={paper.flagged[paper.index]}
          onClick={() =>
            setPaper((p) =>
              p === null ? p : { ...p, flagged: p.flagged.map((v, i) => (i === p.index ? !v : v)) },
            )
          }
        >
          {paper.flagged[paper.index] ? 'Flagged' : 'Flag for review'}
        </button>
        <span style={{ flex: 1 }} />
        <span className="tiny faint">
          <kbd>1</kbd>–<kbd>6</kbd> select · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>F</kbd> flag
        </span>
      </div>
    </main>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function Setup({
  length,
  onLength,
  onStart,
  persistent,
}: {
  length: number;
  onLength: (n: number) => void;
  onStart: () => void;
  persistent: boolean;
}) {
  return (
    <main className="page page-narrow stack">
      <header className="stack" style={{ gap: 4 }}>
        <h1>Exam simulator</h1>
        <p className="muted small" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          Sampled to the March 2026 blueprint rather than to the bank&rsquo;s own mix, timed at two
          minutes a question, and silent until you submit. It is here to rehearse pacing and
          answering blind — the drill is better practice for recall.
        </p>
      </header>

      {!persistent ? (
        <div className="notice notice-bad">
          <div>
            <strong>Progress is not being saved.</strong> The result will not survive a reload.
          </div>
        </div>
      ) : null}

      <section className="card stack">
        <label className="field" style={{ maxWidth: 240 }}>
          <span className="label">Paper length</span>
          <select value={String(length)} onChange={(e) => onLength(Number(e.target.value))}>
            {LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n} questions · {(n * MS_PER_QUESTION) / 60_000} minutes
              </option>
            ))}
          </select>
        </label>

        <table className="grid">
          <thead>
            <tr>
              <th>Skill area</th>
              <th style={{ textAlign: 'right' }}>Blueprint</th>
              <th style={{ textAlign: 'right' }}>Questions in this paper</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SKILL_AREAS) as SkillAreaKey[]).map((k) => (
              <tr key={k}>
                <td>{SKILL_AREAS[k].label}</td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {SKILL_AREAS[k].band[0]}–{SKILL_AREAS[k].band[1]}%
                </td>
                <td className="num" style={{ textAlign: 'right' }}>
                  ~{Math.round(SKILL_AREAS[k].weight * length)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={onStart}>
            Start the clock
          </button>
          <span className="tiny faint">
            Unanswered questions are marked wrong, exactly as the real paper does.
          </span>
        </div>
      </section>
    </main>
  );
}

// ── Jump grid ───────────────────────────────────────────────────────────────

function JumpGrid({ paper, onGo }: { paper: Paper; onGo: (i: number) => void }) {
  return (
    <section className="card stack" style={{ gap: 10 }} aria-label="Jump to question">
      <div className="sim-grid">
        {paper.questions.map((q, i) => {
          const result = paper.results?.[i];
          const classes = ['sim-cell'];
          if (result) classes.push(result.correct ? 'is-correct' : 'is-wrong');
          else if (isAnswered(paper.responses[i]!)) classes.push('is-answered');
          if (paper.flagged[i]) classes.push('is-flagged');
          if (i === paper.index) classes.push('is-current');
          return (
            <button
              key={q.id}
              type="button"
              className={classes.join(' ')}
              aria-current={i === paper.index ? 'true' : undefined}
              onClick={() => onGo(i)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="sim-legend tiny faint">
        <span>filled = answered</span>
        <span>amber outline = flagged</span>
        <span>blue outline = where you are</span>
      </div>
    </section>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

function Review({
  paper,
  wrongOnly,
  onWrongOnly,
  onAgain,
}: {
  paper: Paper;
  wrongOnly: boolean;
  onWrongOnly: (v: boolean) => void;
  onAgain: () => void;
}) {
  const results = paper.results ?? [];
  const score = paper.session.scaledScore ?? 0;
  const passed = score >= PASS_MARK;
  const correct = results.filter((r) => r.correct).length;
  const totalMs = paper.elapsed.reduce((a, b) => a + b, 0);
  const slowest = useMemo(
    () =>
      paper.questions
        .map((q, i) => ({ q, ms: paper.elapsed[i] ?? 0, correct: results[i]?.correct === true }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3),
    [paper, results],
  );

  const byArea = useMemo(() => {
    const tally = new Map<SkillAreaKey, { seen: number; correct: number }>();
    for (const r of results) {
      const t = tally.get(r.skillArea) ?? { seen: 0, correct: 0 };
      t.seen += 1;
      if (r.correct) t.correct += 1;
      tally.set(r.skillArea, t);
    }
    return [...tally.entries()].sort(
      (a, b) => SKILL_AREAS[b[0]].weight - SKILL_AREAS[a[0]].weight,
    );
  }, [results]);

  const shown = paper.questions
    .map((q, i) => ({ q, i, correct: results[i]?.correct === true }))
    .filter((row) => !wrongOnly || !row.correct);

  return (
    <main className="page stack">
      <section className="card stack" aria-label="Result">
        <div className="score-hero">
          <p className={`figure figure-lg ${passed ? 'is-ok' : 'is-bad'}`} data-testid="scaled">
            {score}
          </p>
          <div className="stack" style={{ gap: 2 }}>
            <h1>{passed ? 'Pass' : 'Below the pass mark'}</h1>
            <span className="small muted">
              {correct} of {results.length} correct · {mmss(totalMs)} on the clock · {PASS_MARK}{' '}
              needed
            </span>
          </div>
        </div>
        <p className="tiny faint" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          Scaled by blueprint weight, not by how many of each area the sample happened to draw, and
          renormalised over the areas actually asked. It is <em>not</em> the dashboard projection:
          that one penalises thin coverage across the whole bank and counts an area you have never
          touched as zero, both of which would be meaningless on a single paper. This measures the
          questions in front of you, so expect it to read higher, and noisier, than the projection.
        </p>

        <table className="grid">
          <thead>
            <tr>
              <th>Skill area</th>
              <th style={{ textAlign: 'right' }}>Weight</th>
              <th style={{ textAlign: 'right' }}>Asked</th>
              <th style={{ textAlign: 'right' }}>Correct</th>
            </tr>
          </thead>
          <tbody>
            {byArea.map(([area, t]) => (
              <tr key={area}>
                <td>{SKILL_AREAS[area].label}</td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {Math.round(SKILL_AREAS[area].weight * 100)}%
                </td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {t.seen}
                </td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {t.correct} <span className="faint tiny">({Math.round((t.correct / t.seen) * 100)}%)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {slowest.length > 0 && slowest[0]!.ms > 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            Longest on the clock:{' '}
            {slowest
              .map((s) => `q${s.q.id} ${mmss(s.ms)}${s.correct ? '' : ' (wrong)'}`)
              .join(' · ')}
            . Two minutes a question is the budget; anything over four is a pacing risk.
          </p>
        ) : null}

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={onAgain}>
            Sit another
          </button>
          <a className="btn" href={href('/drill', { wrongTwice: 1, dueOnly: 0 })}>
            Drill what you keep missing
          </a>
          <a className="btn" href={href('/export')}>
            Export the wrong answers
          </a>
          <span style={{ flex: 1 }} />
          <label className="check">
            <input
              type="checkbox"
              checked={wrongOnly}
              onChange={(e) => onWrongOnly(e.target.checked)}
            />
            <span>Show only what I got wrong</span>
          </label>
        </div>
      </section>

      {shown.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>Nothing wrong in this paper.</p>
        </div>
      ) : (
        shown.map(({ q, i }) => (
          <QuestionCard
            key={q.id}
            question={q}
            caseStudy={caseStudyFor(q)}
            phase="revealed"
            response={paper.responses[i]!}
            grade={gradeResponse(q, paper.responses[i]!)}
            onChange={() => undefined}
            correction={null}
          />
        ))
      )}
    </main>
  );
}

