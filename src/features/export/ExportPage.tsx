/**
 * Three things that all amount to "get the state of play out of the app":
 * the condensed wrong-answer sheet for hand-writing, the backup that is the
 * only way progress moves between machines, and the honest statement of how
 * much of the bank is unverified.
 *
 * Owned by the export agent.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useStorageStatus, useStore } from '../../lib/store';
import type { PageProps } from '../../router';
import { SKILL_AREAS, type SkillAreaKey } from '../../types';
import { bankCurrency, disputes, share } from './currency';
import {
  buildSheet,
  CHARS_PER_LINE,
  DEFAULT_FILTERS,
  LINES_PER_SIDE,
  type ExportFilters,
} from './markdown';
import './export.css';

const AREA_KEYS = Object.keys(SKILL_AREAS) as SkillAreaKey[];
const LIMITS = [10, 20, 30, 50, 0];
/** Beyond this the sheet has stopped being a revision aid and become a booklet. */
const SIDES_BUDGET = 3;

const isArea = (value: string): value is SkillAreaKey => AREA_KEYS.includes(value as SkillAreaKey);

const copyToClipboard = async (text: string, fallback: HTMLTextAreaElement | null) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission or an insecure context — fall through to the selection.
  }
  if (!fallback) return false;
  fallback.focus();
  fallback.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
};

export function ExportPage({ params }: PageProps) {
  const store = useStore();
  const status = useStorageStatus();

  const areaParam = params.get('area');
  const [filters, setFilters] = useState<ExportFilters>({
    ...DEFAULT_FILTERS,
    area: areaParam && isArea(areaParam) ? areaParam : null,
  });

  const set = useCallback(
    <K extends keyof ExportFilters>(key: K, value: ExportFilters[K]) =>
      setFilters((f) => ({ ...f, [key]: value })),
    [],
  );

  const sheet = useMemo(() => buildSheet(store.progress, filters), [store.progress, filters]);
  const userDisputes = useMemo(() => disputes(store.progress), [store.progress]);

  return (
    <main className="page stack">
      <div className="stack" style={{ gap: 4 }}>
        <h1>Export</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Condensed revision notes for hand-writing, the progress backup, and what the bank has not
          had verified.
        </p>
      </div>

      <RevisionSheetCard sheet={sheet} filters={filters} set={set} ready={store.ready} />
      <BackupCard />
      <CurrencyCard disputeCount={userDisputes.length} />
      <DisputesCard disputes={userDisputes} />

      <pre className="print-sheet">{sheet.markdown}</pre>
    </main>
  );

  // ── Wrong-answer sheet ────────────────────────────────────────────────────

  function RevisionSheetCard({
    sheet: s,
    filters: f,
    set: setFilter,
    ready,
  }: {
    sheet: ReturnType<typeof buildSheet>;
    filters: ExportFilters;
    set: typeof set;
    ready: boolean;
  }) {
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const [copied, setCopied] = useState(false);

    const count = s.entries.length;
    const sides = Math.max(0, s.density.sides);
    const over = sides > SIDES_BUDGET;
    const perQuestion = count === 0 ? 0 : Math.round(s.density.chars / count);

    const onCopy = async () => {
      const ok = await copyToClipboard(s.markdown, areaRef.current);
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 2000);
    };

    return (
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Wrong answers, condensed for A5</h2>
          <span className="badge">markdown</span>
        </div>
        <p className="muted small" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          Three lines a question: what was being asked, the answer, and the first sentence of the
          bank&rsquo;s reasoning. Everything cut is marked <code>[…]</code> — nothing here
          paraphrases, because there is no model call at runtime and an invented rationale would be
          worse than a truncated one.
        </p>

        <div className="export-filters">
          <label className="export-field">
            <span className="label">Skill area</span>
            <select
              value={f.area ?? ''}
              onChange={(e) => setFilter('area', e.target.value === '' ? null : (e.target.value as SkillAreaKey))}
            >
              <option value="">All areas</option>
              {AREA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SKILL_AREAS[k].label}
                </option>
              ))}
            </select>
          </label>

          <label className="export-field">
            <span className="label">Threshold</span>
            <select
              value={String(f.minWrong)}
              onChange={(e) => setFilter('minWrong', Number(e.target.value))}
            >
              <option value="1">Wrong at least once</option>
              <option value="2">Wrong at least twice</option>
              <option value="3">Wrong at least three times</option>
            </select>
          </label>

          <label className="export-field">
            <span className="label">Cap</span>
            <select
              value={String(f.limit ?? 0)}
              onChange={(e) => {
                const n = Number(e.target.value);
                setFilter('limit', n === 0 ? null : n);
              }}
            >
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No cap' : `Worst ${n}`}
                </option>
              ))}
            </select>
          </label>

          <label className="export-check">
            <input
              type="checkbox"
              checked={f.includeSelfGraded}
              onChange={(e) => setFilter('includeSelfGraded', e.target.checked)}
            />
            Include self-graded cards
          </label>
        </div>

        <div className="panel density">
          <div>
            <span className="figure">{count}</span>
            <span className="tiny faint">questions</span>
          </div>
          <div>
            <span className="figure">{s.density.chars.toLocaleString('en-GB')}</span>
            <span className="tiny faint">characters</span>
          </div>
          <div>
            <span className="figure">{perQuestion}</span>
            <span className="tiny faint">chars/question</span>
          </div>
          <div>
            <span className="figure">{s.density.lines}</span>
            <span className="tiny faint">written lines</span>
          </div>
          <div>
            <span className={over ? 'figure over' : 'figure'}>{sides.toFixed(1)}</span>
            <span className="tiny faint">A5 sides</span>
          </div>
          <div className="tiny faint" style={{ maxWidth: 260 }}>
            Assumes {CHARS_PER_LINE} characters a line and {LINES_PER_SIDE} lines an A5 side.
            Argue with the assumption, not the arithmetic.
          </div>
        </div>

        {over ? (
          <div className="notice notice-warn">
            <div>
              About {Math.ceil(sides)} A5 sides. That is past the point where this gets written out
              in one sitting — narrow to one skill area, or raise the threshold to wrong at least
              twice.
            </div>
          </div>
        ) : null}

        {s.truncated > 0 ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            {s.truncated} of {count} entries are cut to the first sentence. The full explanation is
            still on the card in the drill.
          </p>
        ) : null}

        {!ready ? <p className="muted small">Reading progress…</p> : null}

        <textarea
          ref={areaRef}
          className="export-md"
          readOnly
          value={s.markdown}
          aria-label="Condensed wrong-answer markdown"
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void onCopy()}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print to A5
          </button>
          <span className="tiny faint">
            No file download: a generated link is inert in some hosting contexts, the clipboard is
            not.
          </span>
        </div>
      </section>
    );
  }

  // ── Backup and restore ────────────────────────────────────────────────────

  function BackupCard() {
    const backupRef = useRef<HTMLTextAreaElement>(null);
    const [backup, setBackup] = useState('');
    const [paste, setPaste] = useState('');
    const [outcome, setOutcome] = useState<{ imported: number; skipped: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [armed, setArmed] = useState(false);

    const generate = async () => {
      setBusy(true);
      try {
        setBackup(await store.exportJson());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
    };

    const restore = async () => {
      setBusy(true);
      setOutcome(null);
      try {
        setOutcome(await store.importJson(paste));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
    };

    return (
      <section className="card stack">
        <h2>Backup and restore</h2>
        <p className="muted small" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
          Progress lives in this browser&rsquo;s IndexedDB. There is no account and no sync — that
          is a design decision, not a gap — so this JSON is the only way study history moves between
          machines or survives clearing site data. Restoring merges on the question&rsquo;s content
          hash, so a backup taken against an older bank still binds to the right questions.
        </p>

        {!status.persistent ? (
          <div className="notice notice-bad">
            <div>
              <strong>Storage is not persisting.</strong> Progress is in memory for this tab only
              and will be gone on reload. {status.error ?? ''} Take a backup now.
            </div>
          </div>
        ) : null}

        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => void generate()}>
            {backup === '' ? 'Generate backup' : 'Regenerate'}
          </button>
          {backup !== '' ? (
            <button
              type="button"
              className="btn"
              onClick={() => void copyToClipboard(backup, backupRef.current)}
            >
              Copy backup
            </button>
          ) : null}
          <span className="tiny faint">
            {store.progress.size} question{store.progress.size === 1 ? '' : 's'} with history ·{' '}
            {store.sessions.length} session{store.sessions.length === 1 ? '' : 's'}
          </span>
        </div>

        {backup !== '' ? (
          <textarea
            ref={backupRef}
            className="export-md"
            style={{ minHeight: 160 }}
            readOnly
            value={backup}
            aria-label="Progress backup JSON"
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : null}

        <hr className="rule" />

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Restore</span>
          <textarea
            className="export-md"
            style={{ minHeight: 120 }}
            value={paste}
            placeholder="Paste a backup JSON here"
            aria-label="Backup JSON to restore"
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || paste.trim() === ''}
              onClick={() => void restore()}
            >
              Restore
            </button>
            {outcome ? (
              <span className="small muted">
                {outcome.imported} imported, {outcome.skipped} skipped as already known.
              </span>
            ) : null}
            {error ? <span className="small" style={{ color: 'var(--bad)' }}>{error}</span> : null}
          </div>
        </div>

        <hr className="rule" />

        <div className="row">
          <button
            type="button"
            className={armed ? 'btn btn-bad' : 'btn btn-ghost'}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              void store.resetAll();
              setArmed(false);
            }}
          >
            {armed ? 'Confirm: erase all progress' : 'Erase all progress'}
          </button>
          {armed ? (
            <button type="button" className="btn btn-ghost" onClick={() => setArmed(false)}>
              Cancel
            </button>
          ) : (
            <span className="tiny faint">Irreversible. Take a backup first.</span>
          )}
        </div>
      </section>
    );
  }
}

// ── Currency ────────────────────────────────────────────────────────────────

function CurrencyCard({ disputeCount }: { disputeCount: number }) {
  const c = bankCurrency;
  return (
    <section className="card stack">
      <h2>What the bank has not had verified</h2>
      <p className="muted small" style={{ margin: 0, maxWidth: 'var(--measure)' }}>
        {c.verified} of {c.total} questions have been checked against live Microsoft Learn. Phase 3,
        the verification pass, has not started. {c.suspect} are flagged{' '}
        <code>currency: suspect</code> ({share(c.suspect, c.total)}%) and {c.lowConfidence} sit at{' '}
        <code>parseConfidence: low</code> ({share(c.lowConfidence, c.total)}%); together{' '}
        {c.flagged} distinct questions carry at least one flag, or{' '}
        {share(c.flagged, c.total)}% of the bank. Both flags are heuristic — matched on wording and
        on how cleanly the extraction ran. A flag means check it before trusting it, not that the
        answer is wrong.
      </p>

      <table className="grid">
        <thead>
          <tr>
            <th>Skill area</th>
            <th style={{ textAlign: 'right' }}>Questions</th>
            <th style={{ textAlign: 'right' }}>Currency suspect</th>
            <th style={{ textAlign: 'right' }}>Low parse confidence</th>
          </tr>
        </thead>
        <tbody>
          {c.byArea.map((a) => (
            <tr key={a.area}>
              <td>{a.label}</td>
              <td className="num" style={{ textAlign: 'right' }}>
                {a.total}
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {a.suspect} <span className="faint tiny">({share(a.suspect, a.total)}%)</span>
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {a.lowConfidence}{' '}
                <span className="faint tiny">({share(a.lowConfidence, a.total)}%)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="tiny faint" style={{ margin: 0 }}>
        {c.withReferences} questions carry a reference link, so they can be checked by hand.{' '}
        {disputeCount > 0
          ? `You have recorded ${disputeCount} correction${disputeCount === 1 ? '' : 's'} of your own, listed below.`
          : 'You have recorded no corrections of your own yet.'}
      </p>
    </section>
  );
}

// ── Known defects and user disputes ─────────────────────────────────────────

function DisputesCard({ disputes: list }: { disputes: ReturnType<typeof disputes> }) {
  const c = bankCurrency;
  return (
    <section className="card stack">
      <h2>Disputed and defective questions</h2>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Known defects, carried deliberately</span>
        {c.brokenKeys.map((q) => (
          <div key={q.id} className="notice notice-bad">
            <div>
              <strong>q{q.id}</strong> states the key <code>{q.correct.join(', ')}</code> against
              options <code>{q.options.map((o) => o.key).join('–') || 'none'}</code>. The bank is
              wrong; no answer has been invented for it.
            </div>
          </div>
        ))}
        {c.deadEnds.map((q) => (
          <div key={q.id} className="notice notice-bad">
            <div>
              <strong>q{q.id}</strong> has no options, no image and no explanation — nothing to
              reveal. It is kept out of every drill rather than patched.
            </div>
          </div>
        ))}
        {c.disagreements.length > 0 ? (
          <div className="notice">
            <div>
              {c.disagreements.length} question{c.disagreements.length === 1 ? '' : 's'} where the
              PDF and the DOCX state different keys:{' '}
              <span className="num">{c.disagreements.map((q) => `q${q.id}`).join(', ')}</span>. The
              card shows one of them and says so.
            </div>
          </div>
        ) : null}
      </div>

      <hr className="rule" />

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Your corrections</span>
        {list.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            None recorded. Disputing the bank on a card writes here, which makes the disagreements
            reviewable in one place before the exam.
          </p>
        ) : (
          <div className="dispute-list">
            {list.map((d) => (
              <div key={d.question.id} className="panel">
                <div className="row" style={{ gap: 6 }}>
                  <strong>q{d.question.id}</strong>
                  <span className="badge">{d.question.skillArea}</span>
                  <span className="tiny faint">{d.question.subtopic || 'general'}</span>
                  {d.question.correct.length > 0 ? (
                    <span className="tiny faint">bank says {d.question.correct.join(', ')}</span>
                  ) : null}
                </div>
                <p className="small">{d.correction}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
