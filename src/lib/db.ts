/**
 * Persistence. Raw IndexedDB, no wrapper library — three object stores and a
 * handful of promise helpers do not justify a dependency, and `idb` would be
 * the only runtime dependency in the app beyond React.
 *
 * Everything is keyed on `Question.contentHash`, never on `id` or array
 * position. That is the one decision here that is expensive to reverse: it is
 * what lets a corrected `questions.json` be reimported without orphaning study
 * history. Three pairs in the bank (402/410, 403/411, 409/412) are the same
 * question twice over and legitimately share one progress record — that is the
 * keying working, not a collision. See `bank.test.ts`.
 *
 * Owned by the store agent.
 */
import type { ProgressRecord, Session } from '../types';

const DB_NAME = 'pl400';
const DB_VERSION = 1;

export type StoreName = 'progress' | 'sessions' | 'meta';

export interface MetaRecord {
  key: string;
  value: unknown;
}

/** The whole database as plain JSON, for backup across machines. */
export interface DbDump {
  /** Dump format version, independent of the IndexedDB schema version. */
  version: 1;
  exportedAt: string;
  progress: ProgressRecord[];
  sessions: Session[];
  meta: MetaRecord[];
}

export interface Db {
  /**
   * False when IndexedDB was unavailable (private browsing, a hardened
   * profile, or a blocked upgrade) and this is the in-memory stand-in. The UI
   * reads it to warn that progress will not survive a reload; nothing else
   * behaves differently.
   */
  readonly persistent: boolean;
  /** Why persistence is unavailable, for the banner. Null when it is fine. */
  readonly error: string | null;
  getAllProgress(): Promise<ProgressRecord[]>;
  putProgress(record: ProgressRecord): Promise<void>;
  putManyProgress(records: readonly ProgressRecord[]): Promise<void>;
  getAllSessions(): Promise<Session[]>;
  putSession(session: Session): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  putMeta(key: string, value: unknown): Promise<void>;
  clearAll(): Promise<void>;
  dump(): Promise<DbDump>;
  /** Replaces the database wholesale. Merging is the store's job, not this. */
  restore(dump: DbDump): Promise<void>;
  close(): void;
}

// ── IndexedDB plumbing ──────────────────────────────────────────────────────

const promisify = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

const openIdb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      // Safari in private mode throws synchronously rather than erroring.
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'contentHash' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });

const idbBacked = (db: IDBDatabase): Db => {
  const read = <T>(name: StoreName, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    promisify(run(db.transaction(name, 'readonly').objectStore(name)));

  const write = async (
    names: StoreName[],
    run: (stores: Record<StoreName, IDBObjectStore>) => void,
  ): Promise<void> => {
    const tx = db.transaction(names, 'readwrite');
    const stores = {} as Record<StoreName, IDBObjectStore>;
    for (const n of names) stores[n] = tx.objectStore(n);
    run(stores);
    await txDone(tx);
  };

  const all = <T>(name: StoreName): Promise<T[]> =>
    read<T[]>(name, (s) => s.getAll() as IDBRequest<T[]>);

  return {
    persistent: true,
    error: null,
    getAllProgress: () => all<ProgressRecord>('progress'),
    putProgress: (record) => write(['progress'], (s) => void s.progress.put(record)),
    putManyProgress: (records) =>
      write(['progress'], (s) => {
        for (const r of records) s.progress.put(r);
      }),
    getAllSessions: () => all<Session>('sessions'),
    putSession: (session) => write(['sessions'], (s) => void s.sessions.put(session)),
    getMeta: async (key) => {
      const row = await read<MetaRecord | undefined>(
        'meta',
        (s) => s.get(key) as IDBRequest<MetaRecord | undefined>,
      );
      return row?.value;
    },
    putMeta: (key, value) => write(['meta'], (s) => void s.meta.put({ key, value })),
    clearAll: () =>
      write(['progress', 'sessions', 'meta'], (s) => {
        s.progress.clear();
        s.sessions.clear();
        s.meta.clear();
      }),
    dump: async () => {
      const [progress, sessions, meta] = await Promise.all([
        all<ProgressRecord>('progress'),
        all<Session>('sessions'),
        all<MetaRecord>('meta'),
      ]);
      return { version: 1, exportedAt: new Date().toISOString(), progress, sessions, meta };
    },
    restore: (dump) =>
      write(['progress', 'sessions', 'meta'], (s) => {
        s.progress.clear();
        s.sessions.clear();
        s.meta.clear();
        for (const r of dump.progress) s.progress.put(r);
        for (const r of dump.sessions) s.sessions.put(r);
        for (const r of dump.meta) s.meta.put(r);
      }),
    close: () => db.close(),
  };
};

// ── Fallback ────────────────────────────────────────────────────────────────

/**
 * Same interface, no durability. A locked-down browser should still be able to
 * drill for an hour; it just loses the history on reload, and says so.
 */
export const memoryBacked = (error: string | null): Db => {
  const progress = new Map<string, ProgressRecord>();
  const sessions = new Map<string, Session>();
  const meta = new Map<string, unknown>();
  // Structured-clone on the way in and out, so callers cannot mutate stored
  // records by holding on to the object they handed us — matching IndexedDB.
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    persistent: false,
    error,
    getAllProgress: async () => [...progress.values()].map(clone),
    putProgress: async (record) => void progress.set(record.contentHash, clone(record)),
    putManyProgress: async (records) => {
      for (const r of records) progress.set(r.contentHash, clone(r));
    },
    getAllSessions: async () => [...sessions.values()].map(clone),
    putSession: async (session) => void sessions.set(session.id, clone(session)),
    getMeta: async (key) => clone(meta.get(key)),
    putMeta: async (key, value) => void meta.set(key, clone(value)),
    clearAll: async () => {
      progress.clear();
      sessions.clear();
      meta.clear();
    },
    dump: async () => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: [...progress.values()].map(clone),
      sessions: [...sessions.values()].map(clone),
      meta: [...meta.entries()].map(([key, value]) => ({ key, value: clone(value) })),
    }),
    restore: async (dump) => {
      progress.clear();
      sessions.clear();
      meta.clear();
      for (const r of dump.progress) progress.set(r.contentHash, clone(r));
      for (const r of dump.sessions) sessions.set(r.id, clone(r));
      for (const r of dump.meta) meta.set(r.key, clone(r.value));
    },
    close: () => {},
  };
};

// ── Entry point ─────────────────────────────────────────────────────────────

let handle: Promise<Db> | null = null;

/**
 * Opens once per page load. Never rejects: a failure downgrades to the
 * in-memory implementation with `persistent: false` so the app still runs.
 */
export const openDb = (): Promise<Db> => {
  handle ??= openIdb().then(idbBacked, (err: unknown) =>
    memoryBacked(err instanceof Error ? err.message : String(err)),
  );
  return handle;
};

/** Tests only: drops the cached handle so the next `openDb` reopens. */
export const resetDbHandle = (): void => {
  handle = null;
};

/** Narrow a parsed backup file before trusting it. */
export const isDbDump = (value: unknown): value is DbDump => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<DbDump>;
  return (
    v.version === 1 &&
    Array.isArray(v.progress) &&
    Array.isArray(v.sessions) &&
    (v.meta === undefined || Array.isArray(v.meta))
  );
};
