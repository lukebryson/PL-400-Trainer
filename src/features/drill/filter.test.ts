/**
 * The drill filter is the contract between a link and a session — the
 * dashboard's next action is nothing but a query string — so it is tested
 * against literal query strings rather than through a rendered page.
 */
import { describe, expect, it } from 'vitest';
import { selectDrill } from '../../lib/selectors';
import { describeFilter, filterToParams, modeFor, parseFilter } from './filter';

const parse = (qs: string) => parseFilter(new URLSearchParams(qs));

describe('parseFilter', () => {
  it('reads every field the setup screen can set', () => {
    expect(
      parse('area=extend-platform&subtopic=Plug-ins&type=mcq-multi&wrongTwice=1&gradedOnly=1&limit=20&seed=7'),
    ).toEqual({
      area: 'extend-platform',
      subtopic: 'Plug-ins',
      type: 'mcq-multi',
      wrongTwice: true,
      gradedOnly: true,
      limit: 20,
      seed: 7,
    });
  });

  it('drops an unknown area rather than selecting an empty pool', () => {
    expect(parse('area=extend-plaform')).toEqual({});
    expect(parse('type=essay')).toEqual({});
  });

  it('leaves dueOnly unset unless the URL says so, so the contract default holds', () => {
    expect(parse('area=integrations').dueOnly).toBeUndefined();
    expect(parse('dueOnly=0').dueOnly).toBe(false);
    expect(parse('dueOnly=false').dueOnly).toBe(false);
    expect(parse('dueOnly=1').dueOnly).toBe(true);
  });

  /**
   * The default matters more than it looks: `selectDrill` serves what is due,
   * and a filter that quietly widened to the whole pool would turn a ten-minute
   * revision session into 436 cards.
   */
  it('an unset dueOnly still means due only', () => {
    const due = selectDrill(new Map(), parse('area=integrations')).length;
    const all = selectDrill(new Map(), parse('area=integrations&dueOnly=0')).length;
    expect(due).toBe(all); // nothing attempted, so everything is due
    expect(due).toBeGreaterThan(0);
  });

  it('ignores a negative or non-numeric limit', () => {
    expect(parse('limit=-5').limit).toBeUndefined();
    expect(parse('limit=lots').limit).toBeUndefined();
    expect(parse('limit=12.9').limit).toBe(12);
  });
});

describe('filterToParams', () => {
  it('round-trips through the URL', () => {
    const filter = parse('area=extend-ux&type=hotspot&wrongTwice=1&dueOnly=0&limit=30');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filterToParams(filter))) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    expect(parseFilter(params)).toEqual(filter);
  });

  it('omits a dueOnly it was never given, rather than writing the default down', () => {
    expect(filterToParams(parse('area=extend-ux')).dueOnly).toBeUndefined();
  });
});

describe('modeFor', () => {
  it('calls an unnarrowed session a drill and a narrowed one a weak-area session', () => {
    expect(modeFor({})).toBe('drill');
    expect(modeFor({ limit: 20 })).toBe('drill');
    expect(modeFor({ area: 'integrations' })).toBe('weak-area');
    expect(modeFor({ wrongTwice: true })).toBe('weak-area');
  });
});

describe('describeFilter', () => {
  it('always states the due/whole-pool choice, because it changes the session size', () => {
    expect(describeFilter({})).toBe('due only');
    expect(describeFilter({ dueOnly: false, area: 'integrations' })).toBe(
      'integrations · whole pool',
    );
  });
});
