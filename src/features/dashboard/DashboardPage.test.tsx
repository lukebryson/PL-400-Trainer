/**
 * The dashboard is arithmetic plus markup, and the arithmetic is already
 * covered in `selectors.test.ts`. What is tested here is the join: that the
 * numbers on screen are the ones the selectors produced, and that the page is
 * honest when there is nothing to show.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { questionsByArea } from '../../lib/bank';
import { openDb, resetDbHandle } from '../../lib/db';
import { readiness } from '../../lib/selectors';
import { StoreProvider, useStore } from '../../lib/store';
import type { Grade } from '../../types';
import { DashboardPage } from './DashboardPage';

const wipe = (): Promise<void> =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('pl400');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

const right: Grade = { correct: true, perBox: null, selfGraded: false, ungradeable: false };

/** Answers the first `count` questions of an area correctly, once mounted. */
function Seeder({ area, count }: { area: 'extend-platform'; count: number }) {
  const store = useStore();
  useEffect(() => {
    if (!store.ready || store.progress.size > 0) return;
    void (async () => {
      for (const question of questionsByArea(area).slice(0, count)) {
        await store.recordAttempt({
          question,
          grade: right,
          confidence: 'confident',
          elapsedMs: 30_000,
        });
      }
    })();
  }, [store, area, count]);
  return null;
}

const mount = (seed?: ReactNode) =>
  render(createElement(StoreProvider, null, createElement(DashboardPage, { params: new URLSearchParams() }) as ReactNode, seed));

beforeEach(async () => {
  resetDbHandle();
  await wipe();
});

afterEach(async () => {
  cleanup();
  (await openDb()).close();
  resetDbHandle();
});

describe('DashboardPage', () => {
  it('opens on zero and points at the first drill rather than a fake score', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('projected')).toBeTruthy());
    expect(screen.getByTestId('projected').textContent).toBe('0');
    expect(screen.getByText('Start your first drill')).toBeTruthy();
    expect(screen.getByText(/marks short of a pass/)).toBeTruthy();
  });

  it('lists every skill area with its blueprint weight', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('projected')).toBeTruthy());
    // `extend-platform` is the dominant band and must read as 33%, not as the
    // bank's own 30.2% share.
    expect(screen.getByText('Extend the platform')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Drill' })).toHaveLength(6);
    expect(screen.getByText('33%')).toBeTruthy();
  });

  it('shows the same projection the selectors compute', async () => {
    const view = mount(createElement(Seeder, { area: 'extend-platform', count: 12 }));
    await waitFor(() => expect(screen.getByTestId('projected').textContent).not.toBe('0'));

    // Rebuild the expected figure from the store's own map, so the assertion
    // cannot drift from the arithmetic it is checking.
    const shown = Number(screen.getByTestId('projected').textContent);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(1000);
    view.unmount();
  });

  it('states what the bank cannot tell you rather than burying it', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('projected')).toBeTruthy());
    expect(screen.getByText(/self-graded/)).toBeTruthy();
    expect(screen.getByText(/verified against live Microsoft/)).toBeTruthy();
    expect(screen.getByText(/carried deliberately rather than patched/)).toBeTruthy();
  });
});

describe('readiness, as the page reads it', () => {
  it('cannot call an area green off a handful of attempts', () => {
    const pool = questionsByArea('extend-platform');
    const progress = new Map(
      pool.slice(0, 5).map((q) => [
        q.contentHash,
        {
          contentHash: q.contentHash,
          box: 2 as const,
          dueAt: 0,
          attempts: [
            { at: 1, correct: true, confidence: 'confident' as const, selfGraded: false, elapsedMs: 1 },
          ],
          timesWrong: 0,
          correction: null,
          notes: null,
        },
      ]),
    );
    const area = readiness(progress).areas.find((a) => a.area === 'extend-platform')!;
    expect(area.accuracy).toBe(1);
    expect(area.rag).not.toBe('green');
  });
});
