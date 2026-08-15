# Build prompt — PL-400 interactive revision app

> Paste everything below the line into a fresh session (Claude Code or Cowork
> recommended — this is a multi-phase file-processing plus app-build task).
> Attach **both** `PL-400-Exam-Questions.pdf` and `PL-400-Exam-Questions.docx`
> in the same message. They are not duplicates — see the source files section.

---

## ROLE

You are a senior full-stack engineer and a Microsoft Power Platform certification
coach. You are building a study tool, not a demo. Correctness of the question
bank matters more than visual polish, and the tool must make me faster at
passing an exam, not just look good.

## OBJECTIVE

Build a modern, interactive revision app that lets me drill 440 real-format
PL-400 questions in a flashcard-style loop, track what I keep getting wrong, and
close those gaps against current Microsoft Learn content.

Target: pass **PL-400: Microsoft Power Platform Developer** on **Thursday 17
September 2026**. Pass mark is 700/1000, scaled.

## MY PROFILE — calibrate to this, do not assume a low-code-only user

- Cloud Technical Engineer at a UK MSP. SharePoint and Power Platform delivery.
- Passed PL-200 (796) and AB-410.
- Comfortable with TypeScript, React, npm, VS Code. No primers on tooling.
- Read JavaScript and JSON confidently.
- Genuine gaps: unassisted C# plug-in authoring, and building a PCF component
  end to end from a blank folder.
- UK English, direct and concise, no emojis.

## THE SOURCE FILES — verified facts, do not spend time rediscovering these

Both files in references\docs contain the same 440-question ExamHeist bank, but neither is complete
on its own. **They are complementary, and the build depends on merging them.**

| Property | PDF | DOCX |
| --- | --- | --- |
| Size | ~48.7 MB, 548 pages, A5 | ~26.5 MB |
| Text extraction | `pdftotext -layout` | `pandoc -t markdown --extract-media` |
| Question IDs recoverable from text | **393** | **237** |
| Images | 3,863 raster fragments, incl. masks and slivers | 1,693 whole authored files (1,195 png, 498 jpeg) |
| Question marker format | `Question: N` at line start | H3 heading: `### Question: N [Exam Heist](…)` |

**The critical number: PDF ∪ DOCX = 436 of 440 questions.**

- 199 question IDs appear in the PDF text only
- 43 appear in the DOCX text only
- 194 appear in both — use these to cross-validate the parser
- Only 4 appear in neither: **12, 259, 403, 408**. These exist solely as page
  images and must be recovered by rasterising and reading visually.

Parsing either file alone caps you at 89% or 54% coverage. Parsing both and
reconciling gets you to 99%.

**Recommended source strategy:**

- **Text spine → PDF.** Higher coverage and a flatter structure.
- **Gap fill → DOCX.** For the 43 IDs the PDF text misses, plus any PDF question
  whose parse confidence is low.
- **Images → DOCX media**, not the PDF. The DOCX holds whole images as authored;
  the PDF holds fragmented raster objects. Filter out the 532 DOCX media files
  under 5 KB — they are icons, bullets and decorative slivers, not content.
- **Last resort → rasterise the PDF page** (`pdftoppm -jpeg -r 150 -f N -l N`)
  and read it visually.

**Per-question structure in the PDF text layer:**

```
Question: N                                    Exam Heist
[optional type marker: HOTSPOT - | DRAG DROP -]
[stem, sometimes preceded by shared case-study background]
   A. option
   B. option
   ...
  Answer: D
  Explanation:
  ...
  Reference:
  https://...
```

Type and answer counts from the PDF text: 111 HOTSPOT, 96 DRAG DROP, ~230
standard multiple choice (mixed single-answer A–D and multi-select such as `AD`,
`BCD`, `ADE`), ~430 explanation blocks, ~208 reference links.

**Four complications you must handle explicitly — do not paper over them:**

1. **Visual answer areas.** For HOTSPOT and DRAG DROP questions (~47% of the
   bank) the options live in an image, not in the text. Text extraction alone
   yields an empty option list. Recover these from the DOCX media, cross-checked
   against the `Box 1: … Box 2: …` structure in the explanation block, which
   states the correct selections in order.
2. **DOCX image anchoring is off by one.** Images are emitted *inside* the H3
   heading paragraph, positioned before the `Question: N` text — but they belong
   to the **preceding** question's answer area, not the question the heading
   names. A naive parser will attach every answer image to the wrong question.
   Validate this against a handful of known questions before trusting it.
3. **Case studies.** Scenario background is shared across several following
   questions. Model this as a parent record with child questions; never render a
   case-study question without its background.
4. **Content vintage.** The bank predates the 19 March 2026 skills update: 38
   uses of "Common Data Service", 236 `docs.microsoft.com` links, zero mentions
   of elastic tables, one of Copilot. Some stated answers are now stale or
   wrong. The app must surface this, not hide it.

## PHASE 1 — EXTRACT AND INDEX, THEN STOP

Do not write a single line of UI code until Phase 1 is complete and I have
reviewed it.

Build a deterministic, re-runnable extraction pipeline (Python) that produces
`questions.json` plus an `/images` directory, and then a validation report.

Structure it as four stages so each can be re-run independently:

1. **Extract PDF text** → `raw_pdf.json`, keyed by question ID.
2. **Extract DOCX text and media** → `raw_docx.json` plus deduplicated image
   files, with sub-5 KB decorative media discarded.
3. **Merge and reconcile** → `questions.json`. PDF wins on text where both
   sources have a question; DOCX fills the 43 PDF-missing IDs. Where the 194
   overlapping questions disagree on the stated answer key, record both and mark
   `parseConfidence: low` rather than picking one silently.
4. **Visual recovery** for the 4 orphans and every question still holding an
   empty option list.

**Emit this schema per question:**

```json
{
  "id": 137,
  "source": "pdf | docx | merged",
  "sourcePages": [184, 185],
  "type": "mcq-single | mcq-multi | hotspot | dragdrop | yesno-series",
  "caseStudyId": null,
  "stem": "...",
  "options": [{ "key": "A", "text": "..." }],
  "correct": ["D"],
  "explanation": "...",
  "references": ["https://..."],
  "images": ["images/q137-stem.png"],
  "skillArea": "extend-the-platform",
  "subtopic": "plug-ins / execution pipeline",
  "currency": "current | suspect | superseded",
  "currencyNote": "References Common Data Service; terminology superseded by Dataverse.",
  "parseConfidence": "high | low",
  "codeBlock": null
}
```

**Tag `skillArea` to the March 2026 blueprint,** using these exact keys and
weights — the exam simulator depends on them:

| Key | Skill area | Weight |
| --- | --- | --- |
| `technical-design` | Create a technical design | 10–15% |
| `build-solutions` | Build Power Platform solutions | 10–15% |
| `apps-improvements` | Implement Power Apps improvements | 10–15% |
| `extend-ux` | Extend the user experience | 10–15% |
| `extend-platform` | Extend the platform | **30–35%** |
| `integrations` | Develop integrations | 10–15% |

Set `currency` heuristically: flag `suspect` on legacy terminology (Common Data
Service, CDS, PowerApps portals, `docs.microsoft.com` links, Xrm.Page, legacy
CLI syntax) and on any topic absent from the current blueprint.

**Then give me a validation report before building anything:**

- Total questions parsed vs 440. Confirm you reached 436 from text and state
  what happened to 12, 259, 403 and 408. List every ID that failed to parse or
  produced an empty option list. Do not silently drop them.
- Source split: how many came from PDF, DOCX, and merged.
- Of the 194 overlapping questions, how many had PDF/DOCX disagreement on the
  answer key. This is your best single indicator of parser quality — if it is
  above about 5%, the parser is wrong, not the sources.
- Breakdown by type and by skill area.
- Count flagged `suspect` or `superseded`.
- Count with `parseConfidence: low`.
- Any question where the stated answer key does not correspond to an existing
  option.
- Image association spot-check: pick 5 HOTSPOT questions, show which images you
  attached, and confirm the off-by-one heading anchor was corrected.

Tell me plainly how much of the bank is usable. If the honest answer is that
150 questions need manual repair, say so — do not pad the numbers.

## PHASE 2 — BUILD THE APP

### Must have

- **Flashcard drill loop.** Question with its options, I select, immediate
  correct/incorrect, then the explanation and reference links. Keyboard-driven:
  number keys to select, Enter to submit, Space to advance.
- **All four question types rendered natively.** Multi-select must require all
  correct options and mark partial answers wrong. Hotspot and drag-drop can fall
  back to a "reveal and self-grade" card showing the image plus ordered box
  answers — but say so in the UI rather than faking interactivity.
- **Spaced repetition.** Leitner boxes or SM-2 lite. A wrong answer resets the
  interval; a correct answer promotes it. The default session should serve what
  is due, not a random shuffle.
- **Readiness dashboard.** Accuracy per skill area with a RAG rating, weighted
  by the real blueprint percentages so `extend-platform` dominates. Show a
  single "highest-value next action".
- **Exam simulator.** Timed, 40–60 questions, sampled to match blueprint
  weights, no feedback until the end, then a full review.
- **Weak-area drill.** Filter by skill area, subtopic, question type, or
  "everything I have got wrong at least twice".
- **Currency banner.** Any question flagged `suspect` or `superseded` renders
  with a visible warning and a note on what has changed.
- **Wrong-answer export.** Export missed questions and my notes as markdown,
  condensed to A5 revision-note format — headings, tight bullets, definitions —
  for handwriting into a physical A5 notebook.

### Should have

- Per-question "flag as wrong answer" so I can dispute the bank, with my
  correction stored and shown on future encounters.
- Confidence rating on answer (guessed / unsure / confident) so the dashboard
  can separate lucky guesses from real knowledge.
- Syntax highlighting for C#, JavaScript and XML in stems and explanations.
- Deep links to the relevant current Microsoft Learn module per subtopic.
- Session history and a streak/velocity view against the 17 September date.
- Mobile-usable layout — I will drill on a phone.

### Non-goals

Do not build accounts, auth, a backend, a server database, or any sync. Do not
build an AI chat feature into the app. Do not gamify with badges or points.

## TECH CONSTRAINTS

- Local Vite + React + TypeScript project I can run with `npm run dev`.
- Persist progress in IndexedDB, keyed so that reimporting a corrected
  `questions.json` does not wipe my history.
- Question bank ships as a static JSON file plus extracted images — the app must
  never parse the PDF at runtime.
- If any part is delivered as a chat artifact instead, `localStorage` and
  `sessionStorage` are unavailable — use React state only and say so.
- Design should be clean and modern, but spend your effort on the question bank.

## CURRENCY VERIFICATION

Where a flagged question's answer could plausibly have changed since the March
2026 update, verify against current Microsoft Learn documentation using the
Microsoft Learn MCP connector or web search rather than answering from memory.
Priority order for verification: plug-in registration and pipeline stages,
custom API vs custom action, Web API vs Organization service, PCF manifest and
lifecycle, elastic and virtual tables, Power Platform Pipelines, CLI syntax.

Never invent an API signature, CLI flag, or service limit. If unverified, mark
it unverified in the data rather than guessing.

## ACCEPTANCE CRITERIA

1. At least 436 of the 440 questions are in `questions.json`; any shortfall is
   named ID by ID with the reason. Falling back to a single source is a fail.
2. No question renders with an empty option list and no fallback.
3. Every referenced image resolves, and no decorative sub-5 KB image is
   presented as question content.
4. Exam simulator sampling matches blueprint weights within a few percent.
5. Progress survives a page reload.
6. Wrong-answer markdown export is genuinely condensed enough to hand-write.

## HOW TO WORK

Work in phases and stop at the Phase 1 checkpoint for my review. Show me real,
runnable code rather than describing it. When you hit a genuine judgement call —
how to handle a malformed question, whether a stated answer is still correct —
raise it rather than deciding silently. Be blunt about what is not working.