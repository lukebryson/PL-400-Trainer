/**
 * The simulator's two promises: no feedback until submission, and a
 * blueprint-weighted score at the end. Both are testable and both are the kind
 * of thing that quietly stops being true.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, resetDbHandle } from '../../lib/db';
import { StoreProvider, useStore } from '../../lib/store';
import type { ProgressRecord, Session } from '../../types';
import { SimulatorPage } from './SimulatorPage';

const wipe = (): Promise<void> =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('pl400');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

let peek: { progress: ReadonlyMap<string, ProgressRecord>; sessions: Session[] } = {
  progress: new Map(),
  sessions: [],
};

function Probe() {
  const store = useStore();
  peek = { progress: store.progress, sessions: store.sessions };
  return null;
}

const mount = () =>
  render(
    createElement(
      StoreProvider,
      null,
      createElement(SimulatorPage, { params: new URLSearchParams() }) as ReactNode,
      createElement(Probe) as ReactNode,
    ),
  );

/** The shortest paper the setup screen offers, to keep the test quick. */
const startShortPaper = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start the clock' })).toBeTruthy());
  await userEvent.selectOptions(screen.getByRole('combobox'), '40');
  await userEvent.click(screen.getByRole('button', { name: 'Start the clock' }));
  await waitFor(() => expect(screen.getByRole('timer')).toBeTruthy());
};

beforeEach(async () => {
  resetDbHandle();
  await wipe();
  peek = { progress: new Map(), sessions: [] };
});

afterEach(async () => {
  cleanup();
  (await openDb()).close();
  resetDbHandle();
});

describe('SimulatorPage', () => {
  it('states the blueprint before the clock starts', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start the clock' })).toBeTruthy());
    expect(screen.getByText('Extend the platform')).toBeTruthy();
    expect(screen.getByText('30–35%')).toBeTruthy();
  });

  it('serves a blueprint-sampled paper with a jump cell per question', async () => {
    mount();
    await startShortPaper();
    expect(screen.getByRole('article')).toBeTruthy();
    expect(screen.getByLabelText('Exam status').textContent).toContain('0 of 40 answered');
    // One cell per question, plus the paper's own controls.
    const cells = screen.getAllByRole('button').filter((b) => b.className.includes('sim-cell'));
    expect(cells).toHaveLength(40);
  });

  it('shows no feedback while the paper is being sat', async () => {
    mount();
    await startShortPaper();
    expect(screen.getByText('No feedback until you submit')).toBeTruthy();
    expect(screen.queryByText('Correct')).toBeNull();
    expect(screen.queryByText('Not correct')).toBeNull();
    // Answering does not reveal anything either.
    await userEvent.keyboard('1');
    expect(screen.queryByText('Correct')).toBeNull();
    expect(screen.queryByText('Not correct')).toBeNull();
  });

  it('moves between questions with the arrow keys and flags with F', async () => {
    mount();
    await startShortPaper();
    const first = screen.getByRole('article').getAttribute('aria-label');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('article').getAttribute('aria-label')).not.toBe(first),
    );
    await userEvent.keyboard('f');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Flagged' })).toBeTruthy());
  });

  it('asks before submitting, then scores the paper and writes every attempt', async () => {
    mount();
    await startShortPaper();
    await userEvent.keyboard('1');

    await userEvent.click(screen.getByRole('button', { name: 'Submit paper' }));
    expect(screen.getByText(/will be marked wrong/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByTestId('scaled')).toBeTruthy());
    const score = Number(screen.getByTestId('scaled').textContent);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1000);

    // Unanswered counts as wrong, exactly as the real paper marks it.
    await waitFor(() => expect(peek.progress.size).toBe(40));
    await waitFor(() => expect(peek.sessions).toHaveLength(1));
    const session = peek.sessions[0]!;
    expect(session.mode).toBe('simulator');
    expect(session.results).toHaveLength(40);
    expect(session.scaledScore).toBe(score);
    expect(session.finishedAt).not.toBeNull();
    // No confidence signal exists in an exam, so nothing may be recorded as
    // confident — a lucky paper must not push cards out to a fortnight.
    expect(session.results.every((r) => r.confidence === 'unsure')).toBe(true);
  }, 30_000);
});
