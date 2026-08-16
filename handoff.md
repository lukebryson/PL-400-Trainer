# Handoff — Phase 2 (build the app), feature-complete, reviewed

Branch `phase-2-app`, four commits past `main`:

- `0006e17` scaffold + contracts + **the contentHash fix**
- `757727f` wave 3 — store, scheduling, selectors, renderers
- `3d8e0e8` wave 4 — drill loop, dashboard, simulator, export
- `7e0f560` wave 5 — the review, and the five defects it found

**Wave 5 is done.** Jump to [Wave 5, as reviewed](#wave-5-as-reviewed) for what
was found and what was deliberately left. **The branch is ready to merge to
`main`.** The next thing to do is
[sit a real drill session](#after-wave-5) — and there is one open judgement call
on the blueprint weights that needs a decision, not code.

**Read `AGENTS.md` first.** Conventions, commands and the corrected parsing facts.
It contradicts `prompt.md` in several places and is the one to trust.

Exam: **Thursday 17 September 2026**, pass mark 700/1000.

State: `npx tsc -b --force` clean, `npm run build` clean, `npx vitest run`
**164 passing**. `npm run dev` works.

---

## What is done

| | |
| --- | --- |
| Scaffold | Vite + React 19 + TS, hash router (`src/router.ts`), design system (`src/styles.css`) |
| Contracts | `src/types.ts`, `src/lib/{bank,grade,store-contract}.ts` — **orchestrator-owned** |
| Store | `src/lib/{db,leitner,selectors,store}.tsx` — IndexedDB keyed on `contentHash`, in-memory fallback |
| Renderers | `src/components/question/` — 10 components, 21 tests |
| Drill | `src/features/drill/` — setup, keyboard loop, summary |
| Dashboard | `src/features/dashboard/` — projection, RAG per area, velocity, bank health |
| Simulator | `src/features/simulator/` — timed, blueprint-sampled, silent until submit |
| Export | `src/features/export/` — A5 sheet, JSON backup/restore, currency page |

Dependencies are still react + react-dom only. IndexedDB wrapper, router and
syntax highlighter are hand-rolled.

---

## Wave 4, as built

### Drill — `DrillPage.tsx`

Three stages behind one route: `DrillSetup` → the loop → `DrillSummary`. The
filter lives in the URL (`filter.ts`), so a filtered drill is bookmarkable and
the dashboard's next action is a plain link.

Two things are load-bearing and both are pinned by `DrillPage.test.tsx`:

- **The attempt is recorded on advance, not on submit.** Confidence is chosen
  after the reveal and it changes the Leitner move; recording at submit would
  post every attempt as whatever the default was.
- **A bare Space records `unsure`.** Never `confident`. The lazy path has to be
  the honest one or the schedule inflates.

The session is saved after every card, so an abandoned drill still counts
towards velocity instead of vanishing.

### Dashboard — `DashboardPage.tsx`

Projection, RAG per area ordered by `weight × shortfall`, one next action,
velocity against 17 September, and a "what the bank cannot tell you" panel
stating the self-graded count, the unverified currency flags and the two
carried defects. Every number comes out of `lib/selectors.ts`.

### Simulator — `SimulatorPage.tsx`

40/50/60 questions at two minutes each, blueprint-sampled, `suppressFeedback`
throughout, a jump grid so the skipped ones are findable, flagging on `F`,
auto-submit at zero. Attempts are written as `unsure` — an exam collects no
confidence signal, and claiming `confident` would let a lucky paper push cards
out to a fortnight.

`scaleScore` (`src/features/session.ts`) weights by blueprint and renormalises
over the areas actually asked, so a 40-question paper that misses an area
scores what it measured rather than a zero for what it never asked.

### Export — `ExportPage.tsx`

Unchanged in shape from the wave-4 partial, but the density was wrong and is
fixed. See below.

---

## Changes made to earlier waves' files

Two, both deliberate, both additive:

1. **`SelfGraded` and `QuestionCard` gained optional `revealed`/`onReveal`
   (`selfRevealed`/`onSelfReveal`) props.** Without them the reveal is internal
   component state and the 122 self-graded questions — 28% of the bank — cannot
   be operated from the keyboard at all. Defaults are unchanged, so the
   uncontrolled path and all 21 renderer tests are untouched.
2. **`src/styles.css` gained `.field`, `.check`, `.figure`.** Generic form and
   readout primitives the wave-4 markup already assumed; they belong in the
   orchestrator-owned design system rather than duplicated across three feature
   stylesheets.

`src/features/session.ts` is new and shared by the drill and the simulator.
`types.ts`, `bank.ts`, `grade.ts` and `store-contract.ts` are untouched.

---

## The export was failing criterion 6 and now is not

Measured against the real bank, the wave-4 partial produced **6.5 A5 sides for
its default 20 questions** at 326 characters an entry. That is a booklet, not a
revision card, and the criterion says to say so rather than ship it.

Fixed by measurement, not by eye:

- caps cut — cue 110→76, answer 150→96, why 140→88, per-box 56→30;
- the header line compressed to one written line (`**q7** plug-ins · ? ×2`),
  with `~` self-graded and `?` currency-unverified explained in the sheet head;
- default cap 20 → **10**.

Now **2.87 A5 sides for the default sheet**, inside the page's own three-side
budget, at 281 characters an entry. 20 questions is still 5.3 sides and the
page warns. Every box of a box answer is kept and capped individually — dropping
box 4 of 5 would leave a sheet that looks complete and is not.

Asserted in `markdown.test.ts` against the real bank.

---

## Contract decisions already taken (do not relitigate)

- **Leitner intervals compressed to 0/1/3/7/14 days.** Textbook box 5 is 30 days;
  with the runway left that means "never seen again".
- **A guessed-correct answer cannot promote past box 2**, nor promote twice
  running.
- **Wrong always resets to box 1.** Non-negotiable.
- Area score = `accuracy × (0.6 + 0.4 × coverage)`; RAG ≥0.75 green, ≥0.55 amber.
  `projectedScore = 1000 × Σ(weight × areaScore)`, on track at ≥700.
- `DrillFilter.dueOnly` **defaults true**.
- Renderers dispatch on `responseKindFor(q)`, **not** `question.type`.
- Simulator budget is **two minutes a question**, scaling with paper length.

---

## Non-negotiables (unchanged)

1. Progress keys on `contentHash`, never `id` or array index.
2. The app never parses the source documents at runtime.
3. Blueprint weights drive the simulator, not the bank's own mix. **Verified:**
   1,000 exams of 50 land within 1.5pp of every weight.
4. Case-study children never render without their parent background.
5. No accounts, auth, backend, server DB, sync, in-app AI chat, or gamification.

---

## Must-have checklist

- [x] All four types rendered natively; multi-select all-or-nothing
- [x] Leitner spaced repetition; wrong resets to box 1; default session serves what is due
- [x] Currency banner per card, and the app-level currency page
- [x] Drill loop, keyboard-driven: number keys select, Enter submits, Space advances
- [x] Readiness dashboard, RAG per area, blueprint-weighted, one next action
- [x] Exam simulator: timed, 40–60 questions, no feedback until the end
- [x] Weak-area drill: area, subtopic, type, "wrong at least twice"
- [x] Wrong-answer export as condensed A5 markdown

Should-have, done: dispute-the-bank wired to `store.setCorrection` from the
drill; confidence rating; velocity and pace against 17 September; mobile
breakpoints.

Should-have, **not** done: Learn deep links per subtopic; a session history
list (velocity is aggregated on the dashboard, individual sessions are stored
but never listed).

---

## Acceptance criteria

1. ~~≥436 questions~~ **met, 440/440.**
2. ~~No question renders with an empty option list~~ **met**, `bank.test.ts`.
3. ~~Every image resolves, none decorative~~ **met**, `bank.test.ts`.
4. ~~Simulator sampling within a few percent of blueprint~~ **met**, 1.5pp over 1,000 exams.
5. ~~Progress survives reload and a bank reimport~~ **met** — reload in
   `store.test.ts`, reimport in `export/backup.test.ts`, which renumbers and
   reverses the whole bank and checks every record still binds.
6. ~~Export condensed enough to hand-write~~ **met after the rework above**,
   asserted in `markdown.test.ts`.

---

## Traps already paid for — do not rediscover

- `prompt.md`'s image off-by-one is **inverted**; images belong to the question
  the marker names.
- Blank 8–11 KB PNG layout frames pass a naive size filter; filter on
  bytes-per-pixel.
- `Answer:\s*([A-F])` fabricates 192 phantom keys off `Explanation:`.
- Options are written `A.Text`, no space after the dot.
- Do not use pandoc — not installed, and it destroys run ordering.
- Do not derive `contentHash` from the stem alone.
- **Do not do side effects inside a `setState` updater.** StrictMode is on
  (`main.tsx`), so every updater runs twice. This bit the simulator twice over:
  writing 40–60 attempts from inside the submit updater would post every answer
  to the schedule twice, and reading the stopwatch ref from inside `goTo`'s
  updater made the second call measure a zero-length interval whose return value
  React then kept — every card navigated away from would have been recorded as
  taking no time. Both now compute outside the updater and pass the result in.
- **Do not `indexedDB.deleteDatabase` mid-test** while a `StoreProvider` is
  mounted — it blocks on the open handle and the hook times out. Use
  `store.resetAll()`.
- **A window-level key handler registered from an effect closes over the render
  that registered it, and key repeat outruns React.** Any handler that writes to
  the schedule needs a synchronous guard *before* it touches state — a ref, not
  a state flag, because a state flag is exactly what is stale. The drill's
  `advanced` ref and the simulator's `submitted` ref are that guard. Four
  attempts from one held Space is what it looks like when the guard is missing.
- **Reverse-check any test written for a fix**: revert the fix, watch the test
  fail, restore. All three wave-5 tests were checked this way. A test that
  passes against the broken code pins nothing, and there is no way to know
  which kind you have written without reverting.

---

## Wave 5, as reviewed

Reviewed in a clean context against the seven risk areas the wave-4 handoff
named. Five real defects, all fixed on this branch; three of the seven risks
turned out to be nothing, and the reasoning is recorded below so nobody spends
an evening rediscovering it.

Every fix is pinned by a test that was **checked to fail without it** — the
three fixes were reverted, the tests run, and each failed with exactly the
defect it describes. That check is why the ordering bug is stated as fact
rather than as a reading of the code.

### Fixed

1. **The dashboard ordered the skill-area table by a crossed comparator.**
   `b.weight * (1 - areaScore(a)) - a.weight * (1 - areaScore(b))` mixes one
   area's weight with another's shortfall. It is not a comparator at all, and
   the table under the heading "ordered by what an hour buys" put a
   twelve-for-twelve `extend-platform` **first** and five untouched areas below
   it. The single most load-bearing piece of advice on the dashboard was
   inverted. Now `shortfallValue(b) - shortfallValue(a)`, pinned by
   `DashboardPage.test.tsx`.
2. **A held Space recorded four attempts on one card.** The drill's keydown
   listener is registered from an effect that re-runs on `run`, so it closes
   over the run of the render that registered it. Key repeat fires about every
   33ms — faster than React swaps the listener — so each repeat called
   `advance()` with the same stale `run`. Measured: **four attempts written for
   one answer**, which walks a card from box 1 to box 5 on a single correct
   guess, and the second `setRun` overwrote the first so a result was lost too.
   `advance` now takes a synchronous `sessionId:index` token before touching
   any state. Pinned by dispatching four keydowns inside one `act`, which
   reproduces the race exactly.
3. **The simulator could post 40–60 attempts twice.** Same class, lower odds:
   the auto-submit effect alone cannot double-fire, but a Confirm click racing
   the deadline, or a double-click on Confirm, would. Guarded by a `submitted`
   ref on the session id.
4. **A malformed backup bricked the app permanently.** `isDbDump` checks the
   envelope and never looks inside the arrays, and `importJson` checked only
   that `contentHash` was a string. A record with no `attempts` array was
   written into IndexedDB and thereafter threw on `record.attempts.length` on
   every load — taking the dashboard, the drill and the export with it, on
   every reload, because it is persisted. A truncated file was enough.
   `isProgressRecord` and `isSession` now validate every element; malformed
   ones count as skipped, which is already a reported outcome.
5. **The simulator's own copy claimed a falsehood.** "It is the same arithmetic
   as the dashboard projection" — it is not. `scaleScore` drops the
   `0.6 + 0.4 × coverage` factor and renormalises over the areas actually
   asked; `readiness` keeps the coverage factor and counts an untouched area as
   zero. Both are right for their job. The copy now says which is which and
   that the sitting score should read higher.

Plus two smaller ones found on the way: the simulator charged an entire
backgrounded interval to whichever card was on screen (`takeSpent` now clamps
at five times the per-question budget), and the drill announced nothing to a
screen reader on reveal, because submitting moves no focus — there is now a
`role="status"` live region carrying the verdict.

### Looked at and deliberately left

- **The simulator's auto-submit cannot fire twice.** Effects run once per
  commit, `sitting` is false by the next one, and StrictMode double-invokes
  effects only on mount — when `paper` is still null. Backgrounding the tab past
  the deadline is handled correctly: the clock is wall-clock against a stored
  deadline, so the paper auto-submits on return. Only the stopwatch needed the
  clamp above.
- **`DrillSummary`'s "N moved up a box" is never one short.** The handoff
  worried the summary renders before the final `recordAttempt` resolves.
  `store.recordAttempt` commits to memory synchronously and only *then* fires
  the IndexedDB write behind `void persist(...)`, so its promise settles on the
  next microtask, before paint. Nothing to close.
- **`endEarly()` discarding a submitted-but-unadvanced card is right.**
  Confidence is chosen after the reveal. Recording that card would post it as
  whatever the default was, which is precisely the failure the "record on
  advance, not on submit" rule exists to prevent. Second opinion: keep it.
- **The dashboard prose and `selectors.ts` still agree** on `green ≥ 0.75`,
  `amber ≥ 0.55` and `accuracy × (0.6 + 0.4 × coverage)`. Checked line by line.
- **Accessibility beyond the live region is unverified.** `aria-pressed`,
  `role="group"` and the labels are all present and correct in the markup, but
  nothing here has been driven by an actual screen reader or checked at 200%
  zoom. Static reading is not a substitute; treat this as unaudited.

### One judgement call, open — needs a decision, not code

**`integrations` carries `weight: 0.175` against its own displayed band of
10–15%.** The four light areas sit at 0.125 and `extend-platform` at 0.325, so
the residual needed to reach 1.0 was dumped entirely on `integrations`. The
simulator's setup table prints "Develop integrations · 10–15% · ~9 questions"
for a 50-question paper — 9 of 50 is 17.5%, outside the band printed on the
same row.

Not fixed, because every route out changes something real:

- move the residual onto `extend-platform` (0.325 → 0.375) and it leaves *its*
  band of 30–35%;
- spread it across all six and every area drifts off its midpoint;
- widen the printed band and the table stops being the blueprint.

Changing any weight changes simulator sampling, `scaleScore` and every
projected score already recorded. That is the user's call. Until it is made,
the setup table shows a row that contradicts itself.

### After wave 5

In the order they earn their keep before 17 September:

0. **Decide the `integrations` weight**, above. One line of `types.ts`, but it
   moves every score.
1. **Sit a real drill session and a real simulator paper.** Everything above is
   tested; none of it has been *used*. An hour of actual revision will find more
   than another pass of review will, particularly on whether the 122
   self-graded cards are worth anything in practice. Wave 5 found four
   defects that only a reader would catch and one — the held Space — that only
   a *user* would have caught; that ratio is the argument for drilling next
   rather than reviewing again.
2. **Phase 3, currency verification.** 187 questions flagged, none checked.
   Priority order in `prompt.md`, verify against live Microsoft Learn via the
   `microsoft-learn` MCP server, and mark anything unresolved `unverified`
   rather than guessing.
3. **The remaining should-haves**, if the drilling shows they are missed: Learn
   deep links per subtopic, and a session history list.
4. **`codeBlock`**, only if the unhighlighted inline code proves genuinely hard
   to read while revising. It is a real piece of work and it is not on the
   critical path to a pass.

## Still open

- **`codeBlock` is null for all 440 — a real gap.** `03_merge.py` hardcodes it
  to `None`, yet 67 questions carry code in stem or explanation. It renders
  inline with indentation intact (`pre-wrap`) but unhighlighted.
  `CodeBlock.tsx` is built and tested, waiting for a producer.
- **`answerDisagreement` is null for all 440 — not a bug.**
- **Currency verification (Phase 3) has not started.** 187 flagged
  heuristically, none verified against live Microsoft Learn. Priority order in
  `prompt.md`. Mark anything unverified as `unverified` rather than guessing.
- **The 122 self-graded questions are still the bank's weak point.** They are
  now keyboard-operable and honestly labelled, but the drill still cannot tell
  you whether you were right. If passive review proves useless once drilling
  starts, the fix is manual transcription of those answer images. A real cost,
  to be raised before September, not after.
- **The bank chunk is 1.1 MB** (226 KB gzipped) and Vite warns. It is already
  split into its own chunk; nothing further has been done because a local app
  loading 226 KB once is not a problem worth a dynamic import.
