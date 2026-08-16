/**
 * The entry screen for every drill, filtered or not.
 *
 * It exists mainly to answer one question before the session starts: how many
 * cards is this actually going to serve? A filter that yields four questions
 * should say four, not open a four-card session and let the user discover it at
 * the end. The pool line is recomputed on every control change.
 */
import { useMemo } from 'react';
import { subtopics } from '../../lib/bank';
import { selectDrill, SKILL_AREA_KEYS, weakQuestions, type ProgressMap } from '../../lib/selectors';
import type { DrillFilter } from '../../lib/store-contract';
import { href, navigate } from '../../router';
import { SKILL_AREAS, type Question, type QuestionType, type SkillAreaKey } from '../../types';
import { filterToParams, QUESTION_TYPES, TYPE_LABELS } from './filter';

interface Props {
  progress: ProgressMap;
  filter: DrillFilter;
  onStart: (questions: Question[]) => void;
}

const goto = (filter: DrillFilter) => navigate(href('/drill', filterToParams(filter)));

export function DrillSetup({ progress, filter, onStart }: Props) {
  const { session, matching, due } = useMemo(() => {
    const wide: DrillFilter = { ...filter, dueOnly: false, limit: undefined };
    return {
      session: selectDrill(progress, filter),
      matching: selectDrill(progress, wide).length,
      due: selectDrill(progress, { ...wide, dueOnly: true }).length,
    };
  }, [progress, filter]);

  const availableSubtopics = useMemo(() => subtopics(filter.area), [filter.area]);
  const wrongTwiceTotal = useMemo(() => weakQuestions(progress).length, [progress]);

  const set = (change: Partial<DrillFilter>) => goto({ ...filter, ...change });

  return (
    <main className="page page-narrow stack">
      <header className="stack" style={{ gap: 4 }}>
        <h1>Drill</h1>
        <p className="muted small" style={{ margin: 0 }}>
          The default session serves what the Leitner schedule says is due. Narrow it to work an
          area, a subtopic or the cards you keep getting wrong.
        </p>
      </header>

      <section className="card stack" aria-label="Filters">
        <div className="drill-filters">
          <label className="field">
            <span className="label">Skill area</span>
            <select
              value={filter.area ?? ''}
              onChange={(e) =>
                set({
                  area: (e.target.value || undefined) as SkillAreaKey | undefined,
                  subtopic: undefined,
                })
              }
            >
              <option value="">All areas</option>
              {SKILL_AREA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SKILL_AREAS[k].label} ({Math.round(SKILL_AREAS[k].weight * 100)}%)
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">Subtopic</span>
            <select
              value={filter.subtopic ?? ''}
              onChange={(e) => set({ subtopic: e.target.value || undefined })}
            >
              <option value="">All subtopics</option>
              {availableSubtopics.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">Question type</span>
            <select
              value={filter.type ?? ''}
              onChange={(e) => set({ type: (e.target.value || undefined) as QuestionType | undefined })}
            >
              <option value="">All types</option>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">Cap the session</span>
            <select
              value={filter.limit === undefined ? '' : String(filter.limit)}
              onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">No cap</option>
              {[10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row" style={{ gap: 16 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.wrongTwice === true}
              onChange={(e) => set({ wrongTwice: e.target.checked || undefined })}
            />
            <span>Wrong at least twice ({wrongTwiceTotal})</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.dueOnly !== false}
              onChange={(e) => set({ dueOnly: e.target.checked })}
            />
            <span>Due only</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.gradedOnly === true}
              onChange={(e) => set({ gradedOnly: e.target.checked || undefined })}
            />
            <span>Machine-graded only</span>
          </label>
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => goto({})}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="card stack" aria-label="Session">
        <p className="pool num" data-testid="pool-size">
          {session.length} question{session.length === 1 ? '' : 's'} in this session
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          {matching} match the filter, {due} due now.
          {filter.limit !== undefined && matching > filter.limit
            ? ` Capped at ${filter.limit}.`
            : ''}
        </p>

        {session.length === 0 ? (
          <div className="notice notice-warn">
            <div>
              Nothing to serve. {matching > 0
                ? 'Everything matching is scheduled for later — untick “Due only” to revise the area end to end.'
                : 'No question in the bank matches this filter.'}
            </div>
          </div>
        ) : session.length < 5 ? (
          <div className="notice notice-warn">
            <div>
              A {session.length}-card session. Widen the filter if you meant to sit down for longer.
            </div>
          </div>
        ) : null}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={session.length === 0}
            onClick={() => onStart(session)}
          >
            Start drill
          </button>
          <span className="tiny faint">
            <kbd>1</kbd>–<kbd>6</kbd> select · <kbd>Enter</kbd> submit · <kbd>Space</kbd> next
          </span>
        </div>
      </section>
    </main>
  );
}
