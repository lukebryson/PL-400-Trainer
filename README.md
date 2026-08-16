# PL-400 Trainer

A local revision app for **PL-400: Microsoft Power Platform Developer**. It drills a
440-question bank with spaced repetition, projects a blueprint-weighted readiness
score against the exam's 0–1000 scale, and sits timed mock papers.

Target sitting: **Thursday 17 September 2026**, pass mark 700/1000.

Everything runs in the browser against IndexedDB. There is no account, no backend and
no network call at runtime — including to any AI service. That is a design constraint,
not an omission; see [Deliberately not built](#deliberately-not-built).

## Running it

```bash
npm install
npm run dev        # Vite dev server
```

| | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | typecheck then production build |
| `npm run preview` | serve the built output |
| `npm test` | vitest, 164 tests |
| `npm test -- questions.test.ts` | one file |

React and react-dom are the only runtime dependencies. The IndexedDB wrapper, the
hash router and the syntax highlighter are all hand-rolled, each because a library
would have been the app's largest dependency for a few dozen lines of behaviour.

**You do not need the source documents to run the app.** `src/data/questions.json`
and `public/images/` are committed; the pipeline that produced them is only needed
if the bank itself has to be rebuilt.

## The four screens

**Readiness** (`#/`) — the projected score out of 1000, a RAG rating per skill area
ordered by what an hour of revision buys, one next action, velocity against
17 September, and a panel stating plainly what the bank cannot tell you.

**Drill** (`#/drill`) — the daily loop, built to be run from the keyboard: number or
letter keys select, Enter submits, Space advances. The filter lives in the URL, so
`#/drill?area=extend-platform` is a bookmark and the dashboard's next action is a
plain link.

**Simulator** (`#/simulator`) — 40, 50 or 60 questions at two minutes each, sampled
to the blueprint rather than to the bank's own mix, and **silent until you submit**.
It exists to rehearse the two things the drill cannot: pacing, and answering without
knowing whether the last one was right.

**Export** (`#/export`) — the wrong-answer sheet as condensed markdown sized to be
hand-copied onto A5, a JSON backup and restore, and the currency page.

## The question bank

440 questions, extracted from a PDF and a DOCX dump of the same material and
reconciled against each other.

| Type | Count | Options in the text | How it drills |
| --- | --- | --- | --- |
| `mcq-single` | 189 | yes | fully interactive |
| `mcq-multi` | 57 | yes | interactive, all-or-nothing grading |
| `hotspot` | 102 | **no** | image plus graded box inputs, or self-graded |
| `dragdrop` | 92 | **no** | image plus graded box inputs, or self-graded |

Also 47 case studies, and 501 images across 231 questions.

**318 of 440 are actively drillable. 122 are self-graded** — their answer lives
inside an image and no machine-checkable form survived extraction, so you read,
recall, reveal and mark yourself. The UI says so on every one of those cards rather
than implying an interactivity it does not have. This is the bank's weakest point
and it is stated rather than hidden.

Two defects are carried deliberately rather than patched: **q182** states `Answer: H`
against options A–F, and **q266** has no image and no explanation. Both are surfaced
in the app. A third figure worth knowing: **187 questions are flagged as possibly out
of date and none has yet been verified** against live Microsoft Learn.

### Rebuilding the bank

Only needed if the extraction changes. `references/docs/*.{pdf,docx}` are gitignored
(75 MB) and must be present locally.

```bash
python pipeline/01_extract_pdf.py     # -> pipeline/out/raw_pdf.json
python pipeline/02_extract_docx.py    # -> pipeline/out/raw_docx.json + public/images/
python pipeline/03_merge.py           # -> src/data/questions.json
python pipeline/04_classify.py        # adds skillArea/subtopic in place
python pipeline/validate.py           # the checkpoint report
```

Stdlib-only Python, no `pip install`. Each stage is independently re-runnable and
deterministic: the same inputs produce byte-identical output.

## How the scoring works

**Scheduling** is Leitner, with intervals compressed to 0/1/3/7/14 days — the
textbook 30-day box 5 would mean "never seen again" given the runway. A wrong answer
always resets to box 1. A correct answer you flagged as a guess cannot carry a card
past box 2, nor promote it twice running.

**Area score** is `accuracy × (0.6 + 0.4 × coverage)`. The coverage factor is there so
thin sampling cannot read as mastery: five for five in an area of eighty is not a
green light. Green is ≥ 0.75, amber ≥ 0.55.

**Projected score** is `1000 × Σ(weight × areaScore)` across the six skill areas,
weighted by the exam blueprint rather than by what the bank happens to contain — the
dump is 30.2% `extend-platform` by accident, the exam is 32.5% by design, and it is
the exam being predicted. The simulator's score uses the same weights but drops the
coverage factor and renormalises over the areas actually asked, because a single
paper should be marked on what it asked rather than on what you have not yet seen.

**Progress is keyed on a `contentHash`** of each question's content, never on its id
or position in the file. That is what lets a corrected bank be reimported without
orphaning study history, and it is the one decision here that would be expensive to
reverse.

## Deliberately not built

No accounts, no auth, no backend, no server database, no sync, no in-app AI chat and
no gamification. One person revising for one exam on one machine does not need any of
it, and each would have added a failure mode between the user and the questions.

The JSON backup on the export page is the sync story: export on one machine, import
on another, and histories merge on `contentHash` rather than overwriting.

## Where the detail lives

- **`AGENTS.md`** — repo conventions, commands, architecture, and the hard-won
  parsing facts. The single source of truth; `CLAUDE.md` just imports it. It
  contradicts `prompt.md` in several places and is the one to trust.
- **`handoff.md`** — current state, what was reviewed and found, what is open.
- **`prompt.md`** — the original build brief. Historical: several of its stated
  figures are extraction artefacts, corrected in `AGENTS.md`.
