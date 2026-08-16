/**
 * Written as `.ts` rather than `.tsx` — the provider is wrapped with
 * `createElement`, so no JSX is needed and the store agent's file ownership
 * stays exactly as agreed.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Grade, Question, Session } from '../types';
import { drillable } from './bank';
import { openDb, resetDbHandle, type DbDump } from './db';
import { StoreProvider, useStorageStatus, useStore } from './store';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(StoreProvider, null, children);

const wipe = (): Promise<void> =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('pl400');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

const q0 = drillable[0]!;
const q1 = drillable[1]!;

const correct: Grade = { correct: true, perBox: null, selfGraded: false, ungradeable: false };
const wrong: Grade = { correct: false, perBox: null, selfGraded: false, ungradeable: false };

const mounted = async () => {
  const view = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
};

const session = (id: string, q: Question): Session => ({
  id,
  mode: 'drill',
  startedAt: Date.now(),
  finishedAt: Date.now() + 1000,
  results: [
    {
      contentHash: q.contentHash,
      questionId: q.id,
      correct: true,
      confidence: 'confident',
      skillArea: q.skillArea,
      elapsedMs: 12_000,
    },
  ],
  scaledScore: null,
});

beforeEach(async () => {
  resetDbHandle();
  await wipe();
});

afterEach(async () => {
  // Unmount before closing the handle: an in-flight load effect resolving
  // against a closed database is noise, not a finding.
  cleanup();
  (await openDb()).close();
  resetDbHandle();
});

describe('StoreProvider', () => {
  it('starts not ready and flips once IndexedDB has been read', async () => {
    const view = renderHook(() => useStore(), { wrapper });
    expect(view.result.current.ready).toBe(false);
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.progress.size).toBe(0);
    expect(view.result.current.sessions).toEqual([]);
  });

  it('reports storage as persistent when IndexedDB is there', async () => {
    const view = renderHook(() => useStorageStatus(), { wrapper });
    await waitFor(() => expect(view.result.current.persistent).toBe(true));
    expect(view.result.current.error).toBeNull();
  });
});

describe('recordAttempt', () => {
  it('applies the Leitner move and keys the record on contentHash', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 8000,
      });
    });
    const record = view.result.current.progress.get(q0.contentHash);
    expect(record?.box).toBe(2);
    expect(record?.attempts).toHaveLength(1);
    expect(view.result.current.progress.has(String(q0.id))).toBe(false);
  });

  it('resets to box 1 on a wrong answer and counts it', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 1,
      });
      await view.result.current.recordAttempt({
        question: q0,
        grade: wrong,
        confidence: 'unsure',
        elapsedMs: 1,
      });
    });
    const record = view.result.current.progress.get(q0.contentHash);
    expect(record?.box).toBe(1);
    expect(record?.timesWrong).toBe(1);
    expect(record?.attempts).toHaveLength(2);
  });

  // Acceptance criterion 5: progress survives a reload.
  it('survives a remount', async () => {
    const first = await mounted();
    await act(async () => {
      await first.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 1,
      });
      await first.result.current.setNotes(q0.contentHash, 'plug-in execution order');
    });
    first.unmount();

    const second = await mounted();
    await waitFor(() => expect(second.result.current.progress.size).toBe(1));
    const record = second.result.current.progress.get(q0.contentHash);
    expect(record?.box).toBe(2);
    expect(record?.notes).toBe('plug-in execution order');
  });
});

describe('corrections and notes', () => {
  it('stores a dispute against the bank and clears it again', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.setCorrection(q0.contentHash, 'Answer H does not exist; C is right');
    });
    expect(view.result.current.progress.get(q0.contentHash)?.correction).toMatch(/does not exist/);
    await act(async () => {
      await view.result.current.setCorrection(q0.contentHash, null);
    });
    expect(view.result.current.progress.get(q0.contentHash)?.correction).toBeNull();
  });
});

describe('sessions', () => {
  it('saves sessions most recent first and replaces one on the same id', async () => {
    const view = await mounted();
    const s = session('s1', q0);
    await act(async () => {
      await view.result.current.saveSession({ ...s, startedAt: 1000 });
      await view.result.current.saveSession(session('s2', q1));
      await view.result.current.saveSession({ ...s, startedAt: 1000, scaledScore: 820 });
    });
    expect(view.result.current.sessions).toHaveLength(2);
    expect(view.result.current.sessions[0]?.id).toBe('s2');
    expect(view.result.current.sessions.find((x) => x.id === 's1')?.scaledScore).toBe(820);
  });
});

describe('export and import', () => {
  it('round-trips a backup', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 1,
      });
      await view.result.current.saveSession(session('s1', q0));
    });
    const json = await view.result.current.exportJson();
    const parsed = JSON.parse(json) as DbDump;
    expect(parsed.version).toBe(1);
    expect(parsed.progress).toHaveLength(1);
    expect(parsed.sessions).toHaveLength(1);

    await act(async () => {
      await view.result.current.resetAll();
    });
    expect(view.result.current.progress.size).toBe(0);

    let outcome = { imported: 0, skipped: 0 };
    await act(async () => {
      outcome = await view.result.current.importJson(json);
    });
    expect(outcome.imported).toBe(2); // one progress record, one session
    expect(view.result.current.progress.get(q0.contentHash)?.box).toBe(2);
    expect(view.result.current.sessions).toHaveLength(1);
  });

  it('merges on contentHash rather than overwriting local history', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 1,
      });
    });
    const backup: DbDump = {
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: [
        {
          contentHash: q0.contentHash,
          box: 4,
          dueAt: Date.now() + 7 * 86_400_000,
          attempts: [
            { at: Date.now() + 5000, correct: true, confidence: 'confident', selfGraded: false, elapsedMs: 30_000 },
          ],
          timesWrong: 0,
          correction: null,
          notes: 'from the other machine',
        },
      ],
      sessions: [],
      meta: [],
    };

    let outcome = { imported: 0, skipped: 0 };
    await act(async () => {
      outcome = await view.result.current.importJson(JSON.stringify(backup));
    });
    const record = view.result.current.progress.get(q0.contentHash);
    expect(outcome.imported).toBe(1);
    expect(record?.attempts).toHaveLength(2); // both machines' attempts survive
    expect(record?.box).toBe(4); // the later answer owns the schedule
    expect(record?.notes).toBe('from the other machine');
  });

  it('skips a backup it has already seen', async () => {
    const view = await mounted();
    await act(async () => {
      await view.result.current.recordAttempt({
        question: q0,
        grade: correct,
        confidence: 'confident',
        elapsedMs: 1,
      });
      await view.result.current.saveSession(session('s1', q0));
    });
    const json = await view.result.current.exportJson();
    let outcome = { imported: 0, skipped: 0 };
    await act(async () => {
      outcome = await view.result.current.importJson(json);
    });
    expect(outcome).toEqual({ imported: 0, skipped: 2 });
  });

  it('refuses anything that is not a backup', async () => {
    const view = await mounted();
    await expect(view.result.current.importJson('{"nope":true}')).rejects.toThrow(/backup/);
  });

  /**
   * `isDbDump` only checks the envelope. A record that gets past it with no
   * `attempts` array is persisted, and then every later read throws on
   * `record.attempts.length` — permanently, because it is in IndexedDB. A
   * truncated file is enough to do it, so malformed elements are skipped.
   */
  it('skips malformed records rather than persisting a landmine', async () => {
    const view = await mounted();
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: [
        { contentHash: q0.contentHash, box: 3, dueAt: 0, timesWrong: 0 }, // no attempts
        { contentHash: q1.contentHash, box: 99, dueAt: 0, attempts: [], timesWrong: 0, correction: null, notes: null },
        { box: 2, dueAt: 0, attempts: [], timesWrong: 0 }, // no hash
      ],
      sessions: [{ id: 's-bad', startedAt: 1 }], // no results array
      meta: [],
    };

    let outcome = { imported: 0, skipped: 0 };
    await act(async () => {
      outcome = await view.result.current.importJson(JSON.stringify(backup));
    });

    expect(outcome).toEqual({ imported: 0, skipped: 4 });
    expect(view.result.current.progress.size).toBe(0);
    expect(view.result.current.sessions).toEqual([]);
  });
});
