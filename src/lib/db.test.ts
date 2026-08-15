import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgressRecord, Session } from '../types';
import { isDbDump, memoryBacked, openDb, resetDbHandle, type Db, type DbDump } from './db';
import { newRecord } from './leitner';

const record = (contentHash: string, over: Partial<ProgressRecord> = {}): ProgressRecord => ({
  ...newRecord(contentHash),
  ...over,
});

const session = (id: string): Session => ({
  id,
  mode: 'drill',
  startedAt: Date.UTC(2026, 7, 15, 9, 0, 0),
  finishedAt: null,
  results: [],
  scaledScore: null,
});

const wipe = (): Promise<void> =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('pl400');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

describe('openDb', () => {
  let db: Db;

  beforeEach(async () => {
    resetDbHandle();
    await wipe();
    db = await openDb();
  });

  afterEach(() => {
    db.close();
    resetDbHandle();
  });

  it('opens a persistent database with the three stores', async () => {
    expect(db.persistent).toBe(true);
    expect(db.error).toBeNull();
    expect(await db.getAllProgress()).toEqual([]);
    expect(await db.getAllSessions()).toEqual([]);
    expect(await db.getMeta('never-set')).toBeUndefined();
  });

  it('round-trips progress keyed on contentHash', async () => {
    await db.putProgress(record('aaaa1111bbbb2222', { box: 3, timesWrong: 2 }));
    const [stored] = await db.getAllProgress();
    expect(stored?.contentHash).toBe('aaaa1111bbbb2222');
    expect(stored?.box).toBe(3);

    // Same hash, second write: an update, not a duplicate row. This is what
    // makes the three true-duplicate pairs share one record rather than fight.
    await db.putProgress(record('aaaa1111bbbb2222', { box: 4 }));
    const all = await db.getAllProgress();
    expect(all).toHaveLength(1);
    expect(all[0]?.box).toBe(4);
  });

  it('writes many records in one transaction', async () => {
    await db.putManyProgress([record('h1'), record('h2'), record('h3')]);
    expect(await db.getAllProgress()).toHaveLength(3);
  });

  it('round-trips sessions and meta', async () => {
    await db.putSession(session('s1'));
    await db.putMeta('lastBankBuild', '2026-08-15T00:00:00Z');
    expect((await db.getAllSessions()).map((s) => s.id)).toEqual(['s1']);
    expect(await db.getMeta('lastBankBuild')).toBe('2026-08-15T00:00:00Z');
  });

  it('dumps and restores the whole database', async () => {
    await db.putProgress(record('h1', { box: 5, notes: 'plug-in stages' }));
    await db.putSession(session('s1'));
    await db.putMeta('k', 1);

    const dump = await db.dump();
    expect(isDbDump(dump)).toBe(true);
    expect(JSON.parse(JSON.stringify(dump))).toEqual(dump); // survives the wire

    await db.clearAll();
    expect(await db.getAllProgress()).toEqual([]);

    await db.restore(dump);
    expect((await db.getAllProgress())[0]?.notes).toBe('plug-in stages');
    expect(await db.getAllSessions()).toHaveLength(1);
    expect(await db.getMeta('k')).toBe(1);
  });

  it('caches the handle for the page lifetime', async () => {
    expect(await openDb()).toBe(db);
  });
});

describe('memory fallback', () => {
  it('satisfies the same interface and admits it is not persistent', async () => {
    const db = memoryBacked('IndexedDB is not available in this browser');
    expect(db.persistent).toBe(false);
    expect(db.error).toMatch(/not available/);

    await db.putProgress(record('h1', { box: 2 }));
    await db.putSession(session('s1'));
    expect(await db.getAllProgress()).toHaveLength(1);
    const dump = await db.dump();
    await db.clearAll();
    expect(await db.getAllProgress()).toEqual([]);
    await db.restore(dump);
    expect((await db.getAllProgress())[0]?.box).toBe(2);
    expect(await db.getAllSessions()).toHaveLength(1);
  });

  it('does not hand back a reference the caller can mutate', async () => {
    const db = memoryBacked(null);
    const r = record('h1');
    await db.putProgress(r);
    r.box = 5;
    expect((await db.getAllProgress())[0]?.box).toBe(1);
  });
});

describe('openDb without IndexedDB', () => {
  it('downgrades to memory rather than crashing', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error — simulating a hardened or private-mode browser
    delete globalThis.indexedDB;
    resetDbHandle();
    try {
      const db = await openDb();
      expect(db.persistent).toBe(false);
      expect(db.error).toBeTruthy();
      await db.putProgress(record('h1'));
      expect(await db.getAllProgress()).toHaveLength(1);
    } finally {
      globalThis.indexedDB = real;
      resetDbHandle();
    }
  });
});

describe('isDbDump', () => {
  it('rejects anything that is not a version 1 backup', () => {
    expect(isDbDump(null)).toBe(false);
    expect(isDbDump({})).toBe(false);
    expect(isDbDump({ version: 2, progress: [], sessions: [] })).toBe(false);
    expect(isDbDump({ version: 1, progress: [], sessions: [] })).toBe(true);
    const full: DbDump = {
      version: 1,
      exportedAt: '2026-08-15T00:00:00Z',
      progress: [],
      sessions: [],
      meta: [],
    };
    expect(isDbDump(full)).toBe(true);
  });
});
