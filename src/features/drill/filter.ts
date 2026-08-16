/**
 * The drill filter lives in the URL, not in component state. That is what makes
 * the dashboard's "next action" a plain link — `#/drill?area=extend-platform`
 * is the whole handoff — and what makes a filtered drill something the user can
 * bookmark.
 *
 * Everything here is pure so the parsing can be tested against literal query
 * strings rather than through a rendered page.
 */
import { SKILL_AREA_KEYS } from '../../lib/selectors';
import type { DrillFilter } from '../../lib/store-contract';
import type { QuestionType, SkillAreaKey } from '../../types';

export const QUESTION_TYPES: QuestionType[] = [
  'mcq-single',
  'mcq-multi',
  'hotspot',
  'dragdrop',
  'yesno-series',
];

export const TYPE_LABELS: Record<QuestionType, string> = {
  'mcq-single': 'Single answer',
  'mcq-multi': 'Multi answer',
  hotspot: 'Hotspot',
  dragdrop: 'Drag and drop',
  'yesno-series': 'Yes/no series',
};

/** `1`, `true` and `yes` are all true; `0`, `false` and `no` are all false. */
const asBool = (raw: string | null): boolean | null => {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return null;
};

/**
 * Unknown values are dropped rather than passed through: a typo in `area` must
 * narrow nothing, not silently select an empty pool.
 *
 * `dueOnly` is only set when the URL says so, because `DrillFilter` already
 * defaults it to true and re-stating the default here would hide that.
 */
export const parseFilter = (params: URLSearchParams): DrillFilter => {
  const filter: DrillFilter = {};

  const area = params.get('area');
  if (area && (SKILL_AREA_KEYS as string[]).includes(area)) filter.area = area as SkillAreaKey;

  const subtopic = params.get('subtopic');
  if (subtopic) filter.subtopic = subtopic;

  const type = params.get('type');
  if (type && (QUESTION_TYPES as string[]).includes(type)) filter.type = type as QuestionType;

  if (asBool(params.get('wrongTwice')) === true) filter.wrongTwice = true;
  if (asBool(params.get('gradedOnly')) === true) filter.gradedOnly = true;

  const dueOnly = asBool(params.get('dueOnly'));
  if (dueOnly !== null) filter.dueOnly = dueOnly;

  const limit = Number(params.get('limit'));
  if (Number.isFinite(limit) && limit > 0) filter.limit = Math.floor(limit);

  const seed = Number(params.get('seed'));
  if (Number.isFinite(seed) && seed > 0) filter.seed = Math.floor(seed);

  return filter;
};

/** The inverse, for the controls on the setup screen. */
export const filterToParams = (filter: DrillFilter): Record<string, string | number | undefined> => ({
  area: filter.area,
  subtopic: filter.subtopic,
  type: filter.type,
  wrongTwice: filter.wrongTwice ? 1 : undefined,
  gradedOnly: filter.gradedOnly ? 1 : undefined,
  dueOnly: filter.dueOnly === undefined ? undefined : filter.dueOnly ? 1 : 0,
  limit: filter.limit,
  seed: filter.seed,
});

/** A drill with any narrowing applied is a weak-area session, not the daily due list. */
export const modeFor = (filter: DrillFilter): 'drill' | 'weak-area' =>
  filter.area || filter.subtopic || filter.type || filter.wrongTwice || filter.gradedOnly
    ? 'weak-area'
    : 'drill';

export const describeFilter = (filter: DrillFilter): string => {
  const parts: string[] = [];
  if (filter.area) parts.push(filter.area);
  if (filter.subtopic) parts.push(filter.subtopic);
  if (filter.type) parts.push(TYPE_LABELS[filter.type]);
  if (filter.wrongTwice) parts.push('wrong at least twice');
  if (filter.gradedOnly) parts.push('machine-graded only');
  parts.push(filter.dueOnly === false ? 'whole pool' : 'due only');
  if (filter.limit) parts.push(`capped at ${filter.limit}`);
  return parts.join(' · ');
};
