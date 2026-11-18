/**
 * Readiness. One screen that answers "would I pass on Thursday 17 September,
 * and if not, what do I do this evening?"
 *
 * Every number comes out of `lib/selectors.ts` with the progress map passed in,
 * so anything shown here is reproducible in a test with a literal map. Nothing
 * is computed twice with slightly different arithmetic.
 *
 * The projection is blueprint-weighted, not bank-weighted: the bank is 30.2%
 * `extend-platform` by accident of what the dump contains, the exam is 32.5% by
 * design, and it is the exam that has to be predicted.
 *
 * Owned by the features agent.
 */
import { useMemo } from 'react';
import { brokenKeys, deadEnds, questions } from '../../lib/bank';
import {
  areaScore,
  drillableUnique,
  dueQuestions,
  readiness,
  sessionStats,
  weakQuestions,
} from '../../lib/selectors';
import { useStorageStatus, useStore } from '../../lib/store';
import { href, type PageProps } from '../../router';
import { PASS_MARK, type AreaReadiness, type Rag } from '../../types';
import './dashboard.css';

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * What an hour in this area buys. Both operands must come from the *same* area:
 * writing `b.weight * (1 - areaScore(a))` reads plausibly and is not a
 * comparator at all — it ranked the dominant area scoring 0.97 above a light one
 * scoring 0.14, which is the opposite of the advice the table claims to give.
 */
const shortfallValue = (a: AreaReadiness): number => a.weight * (1 - areaScore(a));

/**
 * Five of the six areas now carry the same blueprint weight, so an untouched
 * board is a five-way tie on `shortfallValue` and the row order would otherwise
 * fall out of whatever order `Object.keys` happened to give. Break it on what
 * actually distinguishes the areas to a revising user — how much of the area is
 * still unseen — and then on the label, so the table is fully determined and
 * does not reshuffle between renders.
 */
const byValueThenUnseen = (a: AreaReadiness, b: AreaReadiness): number =>
  shortfallValue(b) - shortfallValue(a) ||
  b.total - b.attempted - (a.total - a.attempted) ||
  a.label.localeCompare(b.label);

const RAG_WORD: Record<Rag, string> = {
  green: 'would pass comfortably',
  amber: 'would pass on a good day',
  red: 'not there yet',
};

const relative = (at: number | null, now: number): string => {
  if (at === null) return 'never';
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

export function DashboardPage(_props: PageProps) {
  const store = useStore();
  const status = useStorageStatus();
  const now = Date.now();

  const view = useMemo(() => {
    const r = readiness(store.progress);
    return {
      r,
      due: dueQuestions(store.progress).length,
      weak: weakQuestions(store.progress).length,
      stats: sessionStats(store.sessions),
    };
  }, [store.progress, store.sessions]);

  const { r, due, weak, stats } = view;

  if (!store.ready) {
    return (
      <main className="page stack">
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Reading progress…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page stack">
      {!status.persistent ? (
        <div className="notice notice-bad">
          <div>
            <strong>Progress is not being saved.</strong> IndexedDB is unavailable, so everything
            below is this tab&rsquo;s memory only. {status.error ?? ''}{' '}
            <a href={href('/export')}>Take a backup</a>.
          </div>
        </div>
      ) : null}

      <section className="card hero" aria-label="Projected score">
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Projected score</span>
          <p className={`figure figure-lg ${r.onTrack ? 'is-ok' : 'is-bad'}`} data-testid="projected">
            {r.projectedScore}
          </p>
          <div className="scale" aria-hidden="true">
            <span
              className={`fill rag-${r.onTrack ? 'green' : r.projectedScore >= 550 ? 'amber' : 'red'}`}
              style={{ width: `${Math.min(100, (r.projectedScore / 1000) * 100)}%` }}
            />
            <span className="mark" style={{ left: `${(PASS_MARK / 1000) * 100}%` }} />
          </div>
          <span className="tiny faint num">
            0 — {PASS_MARK} to pass — 1000 · {r.daysToExam} days left
          </span>
        </div>

        <div className="stack verdict" style={{ gap: 10 }}>
          <h1>
            {r.onTrack
              ? 'On track for 17 September'
              : `${PASS_MARK - r.projectedScore} marks short of a pass`}
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            Projected from a blueprint weighting of your last verdict on every question you have
            attempted, scaled down where an area is thinly covered — five for five in an area of
            eighty is not a green light. It is a projection from your own drilling, not a
            prediction of the real paper.
          </p>

          <div className="panel next-action stack" style={{ gap: 4 }}>
            <span className="label">Do this next</span>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{r.nextAction.label}</strong>
              <a className="btn btn-primary btn-sm" href={r.nextAction.href}>
                Go
              </a>
            </div>
            <span className="small muted">{r.nextAction.detail}</span>
          </div>

          <div className="row">
            <a className="btn" href={href('/drill')}>
              {due} due now
            </a>
            <a className="btn" href={href('/drill', { wrongTwice: 1, dueOnly: 0 })}>
              {weak} wrong twice or more
            </a>
            <a className="btn" href={href('/simulator')}>
              Sit a simulator
            </a>
          </div>
        </div>
      </section>

      <section className="card stack" aria-label="Skill areas">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>By skill area</h2>
          <span className="tiny faint">
            score = accuracy × (0.6 + 0.4 × coverage) · green ≥ 0.75, amber ≥ 0.55
          </span>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>Area</th>
              <th style={{ textAlign: 'right' }}>Weight</th>
              <th style={{ textAlign: 'right' }}>Seen</th>
              <th style={{ textAlign: 'right' }}>Accuracy</th>
              <th style={{ width: '18%' }}>Score</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...r.areas]
              .sort(byValueThenUnseen)
              .map((a) => (
                <AreaRow key={a.area} area={a} />
              ))}
          </tbody>
        </table>
        <p className="tiny faint" style={{ margin: 0 }}>
          Ordered by what an hour buys: weight × shortfall. A red area worth 12.5% can matter less
          than an amber one worth 32.5%.
        </p>
      </section>

      <section className="card stack" aria-label="Velocity">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Velocity</h2>
          <span className="tiny faint">
            {stats.sessions} session{stats.sessions === 1 ? '' : 's'} · last studied{' '}
            {relative(stats.lastStudiedAt, now)}
          </span>
        </div>

        <div className="stat-row">
          <div>
            <span className="label">Seen at least once</span>
            <p className="figure num">
              {stats.distinctSeen}
              <span className="tiny faint"> / {drillableUnique.length}</span>
            </p>
          </div>
          <div>
            <span className="label">Attempts a day</span>
            <p className="figure num">{stats.attemptsPerDay.toFixed(1)}</p>
          </div>
          <div>
            <span className="label">Needed a day</span>
            <p className={`figure num ${stats.onPace ? 'is-ok' : 'is-warn'}`}>
              {stats.requiredPerDay}
            </p>
          </div>
          <div>
            <span className="label">Last 50 answers</span>
            <p className="figure num">
              {stats.totalAttempts === 0 ? '—' : pct(stats.rollingAccuracy)}
            </p>
          </div>
          <div>
            <span className="label">All answers</span>
            <p className="figure num">{stats.totalAttempts === 0 ? '—' : pct(stats.accuracy)}</p>
          </div>
        </div>

        <Spark stats={stats} />

        <p className="small muted" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          {stats.remaining === 0
            ? 'Every drillable question has been seen at least once. What is left is the schedule and the wrong ones.'
            : stats.onPace
              ? `${stats.remaining} questions still unseen. At the current rate they are all met before the exam.`
              : `${stats.remaining} questions still unseen with ${stats.daysToExam} days left. That needs ${stats.requiredPerDay} a day against the ${stats.attemptsPerDay.toFixed(1)} you are averaging.`}
        </p>
      </section>

      <section className="card stack" aria-label="Bank health">
        <h2>What the bank cannot tell you</h2>
        <p className="muted small" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          The projection above is only as good as the bank underneath it. None of these is a bug to
          be fixed before drilling; they are the known limits of a question dump, stated so the
          score is read with them in mind.
        </p>
        <ul className="stack small" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
          <li>
            <strong className="num">{questions.filter((q) => q.selfGraded).length}</strong> of{' '}
            {questions.length} questions are self-graded — their answer lives in an image. The
            accuracy above trusts your own marking on those.
          </li>
          <li>
            <strong className="num">{questions.filter((q) => q.currency !== 'current').length}</strong>{' '}
            are flagged as possibly out of date and none has been verified against live Microsoft
            Learn. <a href={href('/export')}>The full statement is on the export page</a>.
          </li>
          <li>
            <strong className="num">{brokenKeys.length + deadEnds.length}</strong> are defective and
            carried deliberately rather than patched: q
            {[...brokenKeys, ...deadEnds].map((q) => q.id).join(', q')}.
          </li>
        </ul>
      </section>
    </main>
  );
}

function AreaRow({ area: a }: { area: AreaReadiness }) {
  const score = areaScore(a);
  return (
    <tr>
      <td>
        <span className="area-name">
          <span className={`dot rag-${a.rag}`} aria-hidden="true" />
          {a.label}
          <span className="visually-hidden"> — {RAG_WORD[a.rag]}</span>
        </span>
      </td>
      <td className="num" style={{ textAlign: 'right' }}>
        {Math.round(a.weight * 100)}%
      </td>
      <td className="num" style={{ textAlign: 'right' }}>
        {a.attempted}
        <span className="faint tiny"> / {a.total}</span>
      </td>
      <td className="num" style={{ textAlign: 'right' }}>
        {a.attempted === 0 ? '—' : pct(a.accuracy)}
      </td>
      <td>
        <div className={`meter rag-${a.rag}`} title={`${score.toFixed(2)} — ${RAG_WORD[a.rag]}`}>
          <span style={{ width: `${Math.min(100, score * 100)}%` }} />
        </div>
      </td>
      <td style={{ textAlign: 'right' }}>
        <a className="btn btn-sm btn-ghost" href={href('/drill', { area: a.area })}>
          Drill
        </a>
      </td>
    </tr>
  );
}

/** Fourteen days of attempts. Bars, because a chart library is a dependency. */
function Spark({ stats }: { stats: ReturnType<typeof sessionStats> }) {
  const days = stats.byDay.slice(-14);
  if (days.length === 0) {
    return (
      <p className="tiny faint" style={{ margin: 0 }}>
        No sessions yet — the chart fills in as you drill.
      </p>
    );
  }
  const peak = Math.max(...days.map((d) => d.attempts), 1);
  return (
    <div className="spark" aria-hidden="true">
      {days.map((d) => (
        <div key={d.date} title={`${d.date}: ${d.attempts} attempts, ${d.correct} correct`}>
          <span style={{ height: `${Math.round((d.attempts / peak) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
