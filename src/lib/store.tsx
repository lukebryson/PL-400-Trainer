/**
 * The React binding over IndexedDB. Implements `Store` from
 * `store-contract.ts`; the features code against that interface and never
 * touch `db.ts` directly.
 *
 * Writes are optimistic — state moves first, persistence follows. A drill at
 * one card every four seconds must never wait on a transaction, and a failed
 * write degrades to a warning rather than losing the answer on screen.
 *
 * Owned by the store agent.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Attempt, ProgressRecord, Session } from '../types';
import { isDbDump, openDb, type Db, type DbDump } from './db';
import { applyAttempt, newRecord } from './leitner';
import type { Store } from './store-contract';

interface StorageStatus {
  /** False when IndexedDB was unavailable and progress lives in memory only. */
  persistent: boolean;
  error: string | null;
}

const StoreCtx = createContext<Store | null>(null);
const StatusCtx = createContext<StorageStatus>({ persistent: true, error: null });

/** Most recent first — the session list is history, and history reads backwards. */
const byRecency = (a: Session, b: Session): number => b.startedAt - a.startedAt;

/** Field-by-field, not `JSON.stringify` — key order is not a difference. */
const sameRecord = (a: ProgressRecord, b: ProgressRecord): boolean =>
  a.box === b.box &&
  a.dueAt === b.dueAt &&
  a.timesWrong === b.timesWrong &&
  a.correction === b.correction &&
  a.notes === b.notes &&
  a.attempts.length === b.attempts.length &&
  a.attempts.every((x, i) => {
    const y = b.attempts[i];
    return (
      y !== undefined &&
      x.at === y.at &&
      x.correct === y.correct &&
      x.confidence === y.confidence &&
      x.selfGraded === y.selfGraded
    );
  });

/**
 * Merge two histories of the same question. Attempts are unioned on timestamp,
 * so importing a backup taken mid-session on another machine adds what it knows
 * without dropping what this machine knows. The schedule comes from whichever
 * side answered last; the user's own correction and notes are never overwritten
 * with nulls.
 */
const mergeRecords = (local: ProgressRecord, incoming: ProgressRecord): ProgressRecord => {
  const attempts = new Map<number, Attempt>();
  for (const a of local.attempts) attempts.set(a.at, a);
  for (const a of incoming.attempts) if (!attempts.has(a.at)) attempts.set(a.at, a);
  const merged = [...attempts.values()].sort((a, b) => a.at - b.at);

  const localLast = local.attempts[local.attempts.length - 1]?.at ?? -1;
  const incomingLast = incoming.attempts[incoming.attempts.length - 1]?.at ?? -1;
  const fresher = incomingLast > localLast ? incoming : local;

  return {
    contentHash: local.contentHash,
    box: fresher.box,
    dueAt: fresher.dueAt,
    attempts: merged,
    timesWrong: merged.filter((a) => !a.correct).length,
    correction: local.correction ?? incoming.correction,
    notes: local.notes ?? incoming.notes,
  };
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, ProgressRecord>>(new Map());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<StorageStatus>({ persistent: true, error: null });

  // Refs mirror state so a mutation can read the current value without being
  // recreated on every change — the drill holds these callbacks across cards.
  const progressRef = useRef<ReadonlyMap<string, ProgressRecord>>(progress);
  const sessionsRef = useRef<Session[]>(sessions);
  const dbRef = useRef<Db | null>(null);

  const commitProgress = useCallback((next: ReadonlyMap<string, ProgressRecord>) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  const commitSessions = useCallback((next: Session[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const database = useCallback(async (): Promise<Db> => {
    dbRef.current ??= await openDb();
    return dbRef.current;
  }, []);

  /** A failed write is reported, never thrown at the drill loop. */
  const persist = useCallback(async (work: (db: Db) => Promise<void>): Promise<void> => {
    try {
      await work(await database());
    } catch (err) {
      setStatus({
        persistent: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [database]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await database();
        const [records, saved] = await Promise.all([db.getAllProgress(), db.getAllSessions()]);
        if (cancelled) return;
        commitProgress(new Map(records.map((r) => [r.contentHash, r])));
        commitSessions([...saved].sort(byRecency));
        setStatus({ persistent: db.persistent, error: db.error });
      } catch (err) {
        // A read that fails (a closed handle, a corrupt store) must not leave
        // the app stuck on "loading" — come up empty and say storage is gone.
        if (cancelled) return;
        setStatus({
          persistent: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [database, commitProgress, commitSessions]);

  const recordAttempt = useCallback<Store['recordAttempt']>(
    async (input) => {
      const { question, grade, confidence, elapsedMs } = input;
      const attempt: Attempt = {
        at: Date.now(),
        correct: grade.correct,
        confidence,
        selfGraded: grade.selfGraded,
        elapsedMs,
      };
      const existing =
        progressRef.current.get(question.contentHash) ?? newRecord(question.contentHash);
      const updated = applyAttempt(existing, attempt);

      commitProgress(new Map(progressRef.current).set(question.contentHash, updated));
      void persist((db) => db.putProgress(updated));
      return updated;
    },
    [commitProgress, persist],
  );

  const patch = useCallback(
    async (contentHash: string, change: Partial<ProgressRecord>): Promise<void> => {
      const existing = progressRef.current.get(contentHash) ?? newRecord(contentHash);
      const updated: ProgressRecord = { ...existing, ...change };
      commitProgress(new Map(progressRef.current).set(contentHash, updated));
      await persist((db) => db.putProgress(updated));
    },
    [commitProgress, persist],
  );

  const setCorrection = useCallback<Store['setCorrection']>(
    (contentHash, correction) => patch(contentHash, { correction }),
    [patch],
  );

  const setNotes = useCallback<Store['setNotes']>(
    (contentHash, notes) => patch(contentHash, { notes }),
    [patch],
  );

  const saveSession = useCallback<Store['saveSession']>(
    async (session) => {
      const next = [...sessionsRef.current.filter((s) => s.id !== session.id), session].sort(
        byRecency,
      );
      commitSessions(next);
      await persist((db) => db.putSession(session));
    },
    [commitSessions, persist],
  );

  const exportJson = useCallback<Store['exportJson']>(async () => {
    const db = await database();
    return JSON.stringify(await db.dump(), null, 2);
  }, [database]);

  const importJson = useCallback<Store['importJson']>(
    async (json) => {
      const parsed: unknown = JSON.parse(json);
      if (!isDbDump(parsed)) {
        throw new Error('Not a PL-400 backup: expected version 1 with progress and sessions.');
      }

      let imported = 0;
      let skipped = 0;

      // Merge on contentHash, never on id or position. A backup taken against
      // an older bank still binds, because the hash is derived from the stem.
      const nextProgress = new Map(progressRef.current);
      for (const incoming of parsed.progress) {
        if (typeof incoming?.contentHash !== 'string') {
          skipped += 1;
          continue;
        }
        const local = nextProgress.get(incoming.contentHash);
        const merged = local ? mergeRecords(local, incoming) : incoming;
        if (local && sameRecord(local, merged)) {
          skipped += 1;
          continue;
        }
        nextProgress.set(incoming.contentHash, merged);
        imported += 1;
      }

      const nextSessions = [...sessionsRef.current];
      const known = new Set(nextSessions.map((s) => s.id));
      for (const s of parsed.sessions) {
        if (typeof s?.id !== 'string' || known.has(s.id)) {
          skipped += 1;
          continue;
        }
        known.add(s.id);
        nextSessions.push(s);
        imported += 1;
      }
      nextSessions.sort(byRecency);

      commitProgress(nextProgress);
      commitSessions(nextSessions);

      const dump: DbDump = {
        version: 1,
        exportedAt: new Date().toISOString(),
        progress: [...nextProgress.values()],
        sessions: nextSessions,
        meta: parsed.meta ?? [],
      };
      await persist((db) => db.restore(dump));

      return { imported, skipped };
    },
    [commitProgress, commitSessions, persist],
  );

  const resetAll = useCallback<Store['resetAll']>(async () => {
    commitProgress(new Map());
    commitSessions([]);
    await persist((db) => db.clearAll());
  }, [commitProgress, commitSessions, persist]);

  const store = useMemo<Store>(
    () => ({
      ready,
      progress,
      sessions,
      persistent: status.persistent,
      storageError: status.error,
      recordAttempt,
      setCorrection,
      setNotes,
      saveSession,
      exportJson,
      importJson,
      resetAll,
    }),
    [
      ready,
      progress,
      sessions,
      status,
      recordAttempt,
      setCorrection,
      setNotes,
      saveSession,
      exportJson,
      importJson,
      resetAll,
    ],
  );

  return (
    <StatusCtx.Provider value={status}>
      <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>
    </StatusCtx.Provider>
  );
}

export const useStore = (): Store => {
  const store = useContext(StoreCtx);
  if (!store) throw new Error('useStore called outside StoreProvider');
  return store;
};

/**
 * Storage health, for the banner. Deliberately outside `Store`: the contract
 * is owned by the orchestrator and this is a UI concern, not a data one.
 */
export const useStorageStatus = (): StorageStatus => useContext(StatusCtx);
