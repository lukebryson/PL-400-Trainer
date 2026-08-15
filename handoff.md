# Handoff — Phase 2 (build the app)

Phase 1 is done, committed on branch `phase-1-extraction-pipeline` (`d9c17e7`), and
reviewed. `main` has not been fast-forwarded yet.

**Read `AGENTS.md` first.** It holds the conventions, commands and the corrected
parsing facts. It contradicts `prompt.md` in several places and is the one to trust —
each correction was measured against the source files.

Exam: **Thursday 17 September 2026**, pass mark 700/1000.

---

## What exists

```
pipeline/         four deterministic stages + validate.py   (Python, stdlib only)
src/data/questions.json   440 questions, 1.3 MB            (generated, committed)
src/types.ts      the app-facing contract                   (mirror of schema.py)
public/images/    501 images, 27 MB                         (generated, committed)
```

Rebuild the bank end to end (~40s, needs `references/docs/*` present locally):

```bash
python pipeline/01_extract_pdf.py && python pipeline/02_extract_docx.py \
  && python pipeline/03_merge.py && python pipeline/04_classify.py
python pipeline/validate.py     # exits 1 while the 2 known defects stand
```

Output is byte-identical across reruns; a rerun on a clean tree produces no git diff.
If it ever does, something regressed — do not "fix" it by committing the diff.

---

## The data shape that dictates the UI

| | Count | How it must render |
| --- | --- | --- |
| `mcq-single` | 189 | radio, graded |
| `mcq-multi` | 57 | checkbox, **all-or-nothing** — partial is wrong |
| `hotspot` / `dragdrop` with `boxAnswers` | 87 | image + one graded text input per box |
| `selfGraded: true` | **122** | image and/or explanation, user grades own recall |

`selfGraded` is 27.7% of the bank and is not a corner case — design for it early
rather than bolting it on. It covers image-only questions with no parseable boxes
**and** ~15 late case-study MCQs whose options live in the image. The UI must state
plainly that the card is self-graded. Do not fake interactivity.

Other counts worth knowing: 47 case studies covering 68 questions; 187 flagged
`currency: "suspect"`; 123 at `parseConfidence: "low"`; 228 with reference links.

---

## Non-negotiables

1. **Progress keys on `contentHash`, never on `id` or array index.** This is what
   lets a corrected `questions.json` be reimported without wiping study history. It
   is the one decision that is expensive to reverse — build it first.
2. **The app never parses the source documents at runtime.** Static JSON + images.
3. **Blueprint weights drive the simulator, not the bank's own mix.** The bank is
   30.2% `extend-platform`; the simulator must still sample to the blueprint. Every
   area has a deep enough pool — `build-solutions` is thinnest at 35.
4. **Case-study children never render without their parent background** (`caseStudyId`
   → `caseStudies[]`).
5. **No accounts, auth, backend, server DB, sync, in-app AI chat, or gamification.**

---

## Two known defects the UI must handle

- **q182** states `Answer: H` with only options A–F. The bank is wrong. It is the
  natural first case for the "dispute the bank" feature — do not invent an answer.
- **q266** has no options, no image and no explanation. One genuine dead end. Either
  suppress it from drills or show it as needing manual repair; do not crash on it.

`pipeline/validate.py` exits 1 while these stand. That is intended — it should not be
made to pass by loosening the check.

---

## Suggested build order

Contracts are already landed (`src/types.ts`), so waves 3 and 4 can fork immediately.
Ownership is strict: no agent edits another's files, and nobody edits `src/types.ts`
or `pipeline/schema.py` after the fork — those changes go through the orchestrator.

| Wave | Owner | Owns | Depends on |
| --- | --- | --- | --- |
| 3 | store | `src/lib/` — IndexedDB, `contentHash` keying, Leitner, selectors | types |
| 3 | renderers | `src/components/question/` — one per type + self-graded card | types |
| 4 | features | `src/features/{drill,dashboard,simulator}/` | store |
| 4 | export | `src/features/export/`, currency banner, syntax highlighting | store |
| 5 | reviewer | nothing — read-only audit in a **clean context** | all |

Scaffold Vite + React + TS first (`npm create vite@latest . -- --template react-ts`);
nothing exists yet beyond `src/types.ts` and `src/data/`.

---

## Must-have checklist

- [ ] Drill loop, keyboard-driven: number keys select, Enter submits, Space advances
- [ ] All four types rendered natively; multi-select all-or-nothing
- [ ] Leitner spaced repetition; wrong resets to box 1; default session serves what is **due**
- [ ] Readiness dashboard, RAG per skill area, blueprint-weighted, one "highest-value next action"
- [ ] Exam simulator: timed, 40–60 questions, blueprint-sampled, no feedback until the end
- [ ] Weak-area drill: skill area, subtopic, type, "wrong at least twice"
- [ ] Currency banner on the 187 `suspect` questions
- [ ] Wrong-answer export as condensed A5 markdown for hand-writing

Should-have, in priority order: dispute-the-bank with persisted correction; confidence
rating (guessed / unsure / confident); syntax highlighting for C#, JS, XML; Learn deep
links per subtopic; session history and velocity against 17 September; mobile layout.

---

## Remaining acceptance criteria

1. ~~≥436 questions~~ — **met, 440/440.**
2. No question renders with an empty option list and no fallback → assert at build time.
3. Every image resolves, no decorative image as content → assert at build time.
4. Simulator sampling within a few percent of blueprint → sample 1,000 times and assert.
5. Progress survives reload → drill, reload, then reimport a modified bank and confirm
   history still binds.
6. Export genuinely condensed enough to hand-write → if it runs to pages of prose it
   has failed; say so rather than shipping it.

---

## Traps already paid for — do not rediscover

- `prompt.md`'s image off-by-one is **inverted**; images belong to the question the
  marker names. Verified visually against q7.
- Blank 8–11 KB PNG layout frames pass a naive size filter; filtered on bytes-per-pixel.
- `Answer:\s*([A-F])` fabricates 192 phantom keys by capturing the `E` of `Explanation:`.
- Options are written `A.Text` with no space after the dot.
- Do not use pandoc — not installed, and it destroys the run ordering that resolves
  image ownership.

## Still open

- **Currency verification (Phase 3)** has not started. 187 questions are flagged
  heuristically; none verified against live Microsoft Learn. Priority order is in
  `prompt.md`: plug-in pipeline, custom API vs action, Web API vs Organization service,
  PCF lifecycle, elastic/virtual tables, Pipelines, CLI syntax. Mark anything
  unverified as `unverified` rather than guessing.
- **The 122 self-graded questions are the bank's weak point.** If passive review proves
  useless once drilling starts, the fix is manual transcription of those answer images.
  That is a real cost and should be raised before September, not after.
