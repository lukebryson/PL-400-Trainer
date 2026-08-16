/**
 * Keyboard bindings. Pure, so they are tested without a DOM — the loop that
 * wires them is tested separately in `DrillPage.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import {
  applyChoice,
  confidenceFromKey,
  isTypingTarget,
  optionIndexFromKey,
  verdictFromKey,
} from './keys';

describe('optionIndexFromKey', () => {
  it('takes numbers by position and letters by label', () => {
    expect(optionIndexFromKey('1', 4)).toBe(0);
    expect(optionIndexFromKey('4', 4)).toBe(3);
    expect(optionIndexFromKey('a', 4)).toBe(0);
    expect(optionIndexFromKey('D', 4)).toBe(3);
  });

  it('is bounded by the options the question actually has', () => {
    expect(optionIndexFromKey('5', 4)).toBeNull();
    expect(optionIndexFromKey('e', 4)).toBeNull();
    expect(optionIndexFromKey('1', 0)).toBeNull();
  });

  it('ignores anything that is not a single character', () => {
    expect(optionIndexFromKey('Enter', 4)).toBeNull();
    expect(optionIndexFromKey(' ', 4)).toBeNull();
    expect(optionIndexFromKey('', 4)).toBeNull();
  });
});

describe('confidenceFromKey', () => {
  it('binds digits and initials to the same three ratings', () => {
    expect(confidenceFromKey('1')).toBe('guessed');
    expect(confidenceFromKey('g')).toBe('guessed');
    expect(confidenceFromKey('2')).toBe('unsure');
    expect(confidenceFromKey('U')).toBe('unsure');
    expect(confidenceFromKey('3')).toBe('confident');
    expect(confidenceFromKey('c')).toBe('confident');
    expect(confidenceFromKey('4')).toBeNull();
  });
});

describe('verdictFromKey', () => {
  it('marks a self-graded card either way', () => {
    expect(verdictFromKey('1')).toBe('correct');
    expect(verdictFromKey('y')).toBe('correct');
    expect(verdictFromKey('2')).toBe('wrong');
    expect(verdictFromKey('N')).toBe('wrong');
    expect(verdictFromKey('x')).toBeNull();
  });
});

describe('applyChoice', () => {
  it('replaces on single-select and toggles on multi', () => {
    expect(applyChoice(['A'], 'C', false)).toEqual(['C']);
    expect(applyChoice(['A'], 'C', true)).toEqual(['A', 'C']);
    expect(applyChoice(['A', 'C'], 'C', true)).toEqual(['A']);
  });

  it('matches case-insensitively, because the bank mixes them', () => {
    expect(applyChoice(['a'], 'A', true)).toEqual([]);
  });
});

describe('isTypingTarget', () => {
  it('protects the box-answer inputs from the option bindings', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('leaves buttons and the document alone', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
