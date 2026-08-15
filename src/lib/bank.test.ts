/**
 * Build-time assertions on the shipped bank. These are acceptance criteria 2
 * and 3 from the brief, not unit tests of behaviour: if the pipeline ever
 * regresses, `npm test` is where it must fail.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bank,
  brokenKeys,
  caseStudies,
  deadEnds,
  drillable,
  emptyResponse,
  gradable,
  questions,
  responseKindFor,
} from './bank';

const PUBLIC = join(process.cwd(), 'public');

describe('bank integrity', () => {
  it('carries all 440 questions and 47 case studies', () => {
    expect(questions).toHaveLength(440);
    expect(caseStudies).toHaveLength(47);
    expect(bank.meta.totalQuestions).toBe(questions.length);
  });

  it('shares a contentHash only between true duplicates', () => {
    // The key is the join that survives a reimport, so anything sharing one
    // shares study history. Three pairs in the dump are the same question twice
    // over; everything else must be distinct. A stem-only hash collided 41
    // questions into 16 groups — see `schema.content_hash`.
    const groups = new Map<string, typeof questions>();
    for (const q of questions) {
      const g = groups.get(q.contentHash) ?? [];
      g.push(q);
      groups.set(q.contentHash, g);
    }
    const collided = [...groups.values()].filter((g) => g.length > 1);
    expect(collided.map((g) => g.map((q) => q.id))).toEqual([
      [402, 410],
      [403, 411],
      [409, 412],
    ]);
    for (const g of collided) {
      const first = g[0]!;
      for (const q of g.slice(1)) {
        expect(q.stem).toBe(first.stem);
        expect(q.options).toEqual(first.options);
        expect(q.correct).toEqual(first.correct);
      }
    }
    expect(groups.size).toBe(437);
    for (const q of questions) expect(q.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  // Criterion 2: no question renders with an empty option list and no fallback.
  it('gives every question something to render', () => {
    const stranded = drillable.filter(
      (q) =>
        q.options.length === 0 &&
        q.boxAnswers.length === 0 &&
        q.images.length === 0 &&
        q.explanation.trim() === '',
    );
    expect(stranded).toEqual([]);
  });

  it('routes every question to a response kind it can satisfy', () => {
    for (const q of questions) {
      const kind = responseKindFor(q);
      const r = emptyResponse(q);
      expect(r.kind).toBe(kind);
      if (kind === 'choice') expect(q.options.length).toBeGreaterThan(0);
      if (kind === 'boxes') expect(q.boxAnswers.length).toBeGreaterThan(0);
    }
  });

  it('has exactly one dead end, q266, and keeps it out of drills', () => {
    expect(deadEnds.map((q) => q.id)).toEqual([266]);
    expect(drillable).toHaveLength(439);
  });

  it('has exactly one broken answer key, q182, and surfaces it', () => {
    expect(brokenKeys.map((q) => q.id)).toEqual([182]);
    // Any growth here means the parser regressed, not that the bank improved.
  });

  it('never points a machine-graded card at a missing option', () => {
    for (const q of gradable) {
      if (q.id === 182) continue; // known, surfaced as a dispute rather than patched
      for (const key of q.correct) {
        expect(
          q.options.some((o) => o.key === key),
          `q${q.id} keys ${key} with options ${q.options.map((o) => o.key).join('')}`,
        ).toBe(true);
      }
    }
  });

  it('binds every case-study child to a background', () => {
    const ids = new Set(caseStudies.map((c) => c.id));
    for (const q of questions) {
      if (q.caseStudyId) expect(ids.has(q.caseStudyId)).toBe(true);
    }
    for (const c of caseStudies) {
      expect(c.background.trim().length).toBeGreaterThan(50);
      expect(c.questionIds.length).toBeGreaterThan(0);
    }
  });

  it('holds the counts the UI is designed around', () => {
    const byType = questions.reduce<Record<string, number>>((acc, q) => {
      acc[q.type] = (acc[q.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({
      'mcq-single': 189,
      'mcq-multi': 57,
      hotspot: 102,
      dragdrop: 92,
    });
    expect(questions.filter((q) => q.selfGraded)).toHaveLength(122);
    expect(questions.filter((q) => q.boxAnswers.length > 0)).toHaveLength(87);
    expect(gradable).toHaveLength(318); // 231 interactive MCQ + 87 box-answer cards
  });
});

// Criterion 3: every image resolves, and none of them is a decorative sliver.
describe('images', () => {
  const referenced = [...new Set(questions.flatMap((q) => q.images))];

  it('references at least one image for the question types that need them', () => {
    const needy = questions.filter((q) => q.type === 'hotspot' || q.type === 'dragdrop');
    const withImages = needy.filter((q) => q.images.length > 0);
    expect(withImages.length / needy.length).toBeGreaterThan(0.9);
  });

  it('resolves every referenced file on disk', () => {
    const missing = referenced.filter((p) => {
      try {
        return !statSync(join(PUBLIC, p)).isFile();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it('ships no decorative or blank image as question content', () => {
    // Blank layout frames sit at 0.006–0.009 bytes per pixel; real answer areas
    // at 0.17 and above. Both the size floor and the density floor must hold.
    const suspect: string[] = [];
    for (const p of referenced) {
      const buf = readFileSync(join(PUBLIC, p));
      if (buf.length < 5000) {
        suspect.push(`${p} is ${buf.length} bytes`);
        continue;
      }
      if (p.endsWith('.png')) {
        // IHDR: width at byte 16, height at 20, big-endian.
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        const bpp = buf.length / (w * h);
        if (bpp < 0.05) suspect.push(`${p} is ${bpp.toFixed(4)} bytes/px — blank frame`);
      }
    }
    expect(suspect).toEqual([]);
  });
});
