/**
 * Keyboard mapping for the drill loop, kept pure and separate from the page so
 * the bindings can be tested without a DOM.
 *
 * The drill is the thing the user does every day; it has to be operable without
 * the mouse. Number keys and letter keys both select, because the option rows
 * are labelled A–F on screen and 1–6 by position, and reaching for the mouse to
 * resolve that ambiguity is exactly the friction being designed out.
 */
import type { Confidence } from '../../types';

/**
 * True when the event landed on something the user is typing into. The
 * box-answer cards are real text inputs; swallowing their keystrokes to select
 * "option 3" would make them unusable.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (target === null || typeof target !== 'object') return false;
  const el = target as Partial<HTMLElement> & { tagName?: string };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * `1`–`9` by position and `a`–`z` by letter, both bounded by how many options
 * the question actually has. The bound matters: the bank tops out at six
 * options, so `g` and beyond stay free for other bindings.
 */
export const optionIndexFromKey = (key: string, optionCount: number): number | null => {
  if (key.length !== 1 || optionCount <= 0) return null;
  const c = key.toLowerCase();
  let index: number;
  if (c >= '1' && c <= '9') index = c.charCodeAt(0) - '1'.charCodeAt(0);
  else if (c >= 'a' && c <= 'z') index = c.charCodeAt(0) - 'a'.charCodeAt(0);
  else return null;
  return index < optionCount ? index : null;
};

/**
 * Confidence bindings, live only once the card is revealed — at which point the
 * option keys are spent and `1`/`2`/`3` can be reused for the rating without
 * ambiguity. The initials are bound as well for anyone who prefers them.
 */
export const confidenceFromKey = (key: string): Confidence | null => {
  switch (key.toLowerCase()) {
    case '1':
    case 'g':
      return 'guessed';
    case '2':
    case 'u':
      return 'unsure';
    case '3':
    case 'c':
      return 'confident';
    default:
      return null;
  }
};

/** Self-graded cards take a verdict rather than an option. */
export const verdictFromKey = (key: string): 'correct' | 'wrong' | null => {
  switch (key.toLowerCase()) {
    case '1':
    case 'y':
      return 'correct';
    case '2':
    case 'n':
      return 'wrong';
    default:
      return null;
  }
};

/**
 * Single-select replaces, multi-select toggles. Mirrors `McqOptions.toggle` so
 * the keyboard and the mouse cannot drift apart.
 */
export const applyChoice = (selected: string[], key: string, multi: boolean): string[] => {
  if (!multi) return [key];
  const upper = key.toUpperCase();
  return selected.some((k) => k.toUpperCase() === upper)
    ? selected.filter((k) => k.toUpperCase() !== upper)
    : [...selected, key];
};
