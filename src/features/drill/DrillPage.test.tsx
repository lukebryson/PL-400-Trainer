/**
 * The drill loop end to end, driven the way it is meant to be driven: from the
 * keyboard, against the real bank and the real IndexedDB-backed store.
 *
 * Two contracts are pinned here because both are silent when they break and
 * both corrupt months of scheduling:
 *
 *  - a bare Space records `unsure`, never `confident`;
 *  - the attempt is written on advance, with the confidence chosen after the
 *    reveal — not on submit, with whatever the default was.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { questionById } from '../../lib/bank';
import { openDb, resetDbHandle } from '../../lib/db';
import { StoreProvider, useStore } from '../../lib/store';
import type { ProgressRecord, Question } from '../../types';
import { DrillPage } from './DrillPage';

const wipe = (): Promise<void> =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('pl400');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

/** Reads the live store out of the tree, so assertions see what was persisted. */
let peek: { progress: ReadonlyMap<string, ProgressRecord>; sessions: unknown[] } = {
  progress: new Map(),
  sessions: [],
};

function Probe() {
  const store = useStore();
  peek = { progress: store.progress, sessions: store.sessions };
  return null;
}

/** Machine-graded single-answer questions only, capped and seeded: two cards. */
const drill = (query = 'type=mcq-single&gradedOnly=1&limit=2&seed=3') =>
  render(
    createElement(
      StoreProvider,
      null,
      createElement(DrillPage, { params: new URLSearchParams(query) }) as ReactNode,
      createElement(Probe) as ReactNode,
    ),
  );

/** The question currently on screen, resolved back to its bank record. */
const onScreen = (): Question => {
  const article = screen.getByRole('article');
  const id = Number(/Question (\d+)/.exec(article.getAttribute('aria-label') ?? '')?.[1]);
  const question = questionById(id);
  if (!question) throw new Error(`no question ${id} in the bank`);
  return question;
};

/** Press the number key for a given option letter — 'A' is 1, 'B' is 2. */
const pressOption = async (question: Question, key: string) => {
  const index = question.options.findIndex((o) => o.key.toUpperCase() === key.toUpperCase());
  await userEvent.keyboard(String(index + 1));
};

const start = async () => {
  await waitFor(() => expect(screen.getByTestId('pool-size')).toBeTruthy());
  await userEvent.click(screen.getByRole('button', { name: 'Start drill' }));
  await waitFor(() => expect(screen.getByRole('article')).toBeTruthy());
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

describe('the drill loop', () => {
  it('answers, submits and advances entirely from the keyboard', async () => {
    drill();
    await start();

    const first = onScreen();
    await pressOption(first, first.correct[0]!);
    const chosen = screen.getAllByRole('radio').find((b) => b.getAttribute('aria-checked') === 'true');
    expect(chosen?.textContent).toContain(first.correct[0]);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Correct')).toBeTruthy());

    await userEvent.keyboard(' ');

    await waitFor(() => expect(peek.progress.size).toBe(1));
    const record = peek.progress.get(first.contentHash)!;
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0]!.correct).toBe(true);
    // The contract: a bare Space is `unsure`, so it promotes one box and no more.
    expect(record.attempts[0]!.confidence).toBe('unsure');
    expect(record.box).toBe(2);
  });

  it('writes nothing until the card is advanced past', async () => {
    drill();
    await start();

    const first = onScreen();
    await pressOption(first, first.correct[0]!);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Correct')).toBeTruthy());

    // Revealed, graded, and still unrecorded — confidence has not been chosen.
    expect(peek.progress.size).toBe(0);
  });

  it('honours a confidence chosen after the reveal', async () => {
    drill();
    await start();

    const first = onScreen();
    await pressOption(first, first.correct[0]!);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Correct')).toBeTruthy());

    await userEvent.keyboard('1'); // guessed
    await userEvent.keyboard(' ');

    await waitFor(() => expect(peek.progress.size).toBe(1));
    const record = peek.progress.get(first.contentHash)!;
    expect(record.attempts[0]!.confidence).toBe('guessed');
    // A guessed-correct cannot go past box 2 — `leitner.nextState`.
    expect(record.box).toBe(2);
  });

  it('resets a wrong answer to box 1 and lists it as missed', async () => {
    drill();
    await start();

    const first = onScreen();
    const wrongKey = first.options.find((o) => !first.correct.includes(o.key))!.key;
    await pressOption(first, wrongKey);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Not correct')).toBeTruthy());
    await userEvent.keyboard(' ');

    await waitFor(() => expect(peek.progress.size).toBe(1));
    expect(peek.progress.get(first.contentHash)!.box).toBe(1);
    expect(peek.progress.get(first.contentHash)!.timesWrong).toBe(1);

    // Second and last card, then the summary.
    const second = onScreen();
    await pressOption(second, second.correct[0]!);
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await waitFor(() => expect(screen.getByText('Session complete')).toBeTruthy());
    expect(screen.getByTestId('summary-correct').textContent).toContain('1 / 2');
    expect(screen.getByText(`Q${first.id}`)).toBeTruthy();
  });

  it('saves the session as it goes, so an abandoned drill still counts', async () => {
    drill();
    await start();

    const first = onScreen();
    await pressOption(first, first.correct[0]!);
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await waitFor(() => expect(peek.sessions).toHaveLength(1));
  });

  it('does not serve a card the schedule has pushed out', async () => {
    const view = drill('type=mcq-single&gradedOnly=1&limit=1&seed=3');
    await start();
    const first = onScreen();
    await pressOption(first, first.correct[0]!);
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('3'); // confident — box 2, due in a day
    await userEvent.keyboard(' ');
    await waitFor(() => expect(screen.getByText('Session complete')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'New drill' }));
    await waitFor(() => expect(screen.getByTestId('pool-size')).toBeTruthy());
    view.unmount();

    // Re-entering the same filter must not offer the question just answered.
    drill('type=mcq-single&gradedOnly=1&limit=1&seed=3');
    await start();
    expect(onScreen().id).not.toBe(first.id);
  });
});
