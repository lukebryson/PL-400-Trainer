# PL-400 Trainer

Local revision app for **PL-400: Microsoft Power Platform Developer**. Drills a
440-question bank with spaced repetition, blueprint-weighted readiness scoring and
an exam simulator. Target sitting: **Thursday 17 September 2026**, pass mark 700/1000.

Full build brief: `prompt.md`. Read it before changing pipeline behaviour or scope.

This file is the single source of truth for repo conventions. `CLAUDE.md` imports it,
so Claude Code and Codex get identical instructions — edit this file, never fork it.

## Commands

```bash
python pipeline/01_extract_pdf.py     # -> pipeline/out/raw_pdf.json
python pipeline/02_extract_docx.py    # -> pipeline/out/raw_docx.json + public/images/
python pipeline/03_merge.py           # -> src/data/questions.json
python pipeline/04_classify.py        # adds skillArea/subtopic in place
python pipeline/validate.py           # the Phase 1 checkpoint report
npm run dev                           # Vite dev server
npm run build                         # typecheck + production build
npm test                              # vitest
npm test -- questions.test.ts         # single test file
```

Pipeline stages are **independently re-runnable and deterministic** — the same inputs
must produce byte-identical output. Each stage reads the previous stage's JSON from
`pipeline/out/`, never re-does its work. `01` caches `pdftotext` output to
`pipeline/out/pdf.txt`; delete it to force re-extraction.

## Source documents

`references/docs/*.{pdf,docx}` are gitignored (75 MB) and must be present locally to
run the pipeline. The committed artefacts are `src/data/questions.json` and
`public/images/` — the app never parses the source documents at runtime.

## Hard-won parsing facts

These were measured against the actual files. Several contradict `prompt.md`, which
was written from an earlier `pandoc`-based extraction. **Trust this section over the
brief**, and re-measure before contradicting it.

- **Both sources yield all 440 question IDs.** The brief's 393 / 237 / 436 figures are
  extraction artefacts. There are no unrecoverable "orphan" questions; IDs 12, 259,
  403 and 408 are present in both sources.
- **PDF marker regex must allow leading whitespace**: `(?m)^\s*Question:\s*(\d+)`.
  Anchoring at `^Question:` silently loses 47 questions.
- **PDF option regex must not require a space after the dot**: options are written
  `A.Add the code…`. Using `^\s*([A-F])\.\s+` silently drops 66 questions and looks
  like clean output. Use `^\s*([A-F])\.\s*\S`.
- **The answer-key regex must not let `\s*` cross a newline.** 127 questions have a
  bare `Answer:` line with the real answer inside the image. `Answer:\s*([A-F]…)`
  then matches the `E` of the following `Explanation:` and fabricates **192 phantom
  answer keys**. Require the key token to end its line. See `RE_ANSWER`.
- Real key counts: **220 of 246 MCQs**. Hotspot and dragdrop have **zero** text keys
  by design. 26 MCQs are keyless in the PDF and are merge candidates from the DOCX.
- q182 states `Answer: H` with only options A–F. Surface it, don't discard it.
- **Parse the DOCX as raw XML**, via stdlib `zipfile` + `ElementTree` over
  `word/document.xml`. Do not use `pandoc` — flattening destroys the run ordering that
  resolves image ownership, and it is not installed.
- **The "off-by-one" in prompt.md is wrong — do not implement it.** It claims images
  preceding the `Question: N` run belong to question N-1. Following that inverts 933
  of 4,348 image references. Verified visually: the paragraph bearing `Question: 7`
  opens with the Email / Document storage answer area, and q7's box answers are
  "Server-side synchronization" / "Server-side integration" — the options in that
  image. **Every image in a marker paragraph belongs to the question the marker
  names.** Images in body paragraphs belong to the question in scope.
- **Discard DOCX media under 5 KB** (552 of 1,693) — icons, bullets, slivers.
- **Size alone is not enough: 628 of 634 extracted PNGs are blank white layout
  frames** at 8–11 KB, comfortably above the 5 KB floor. They render as empty boxes
  on a card. Filter on bytes-per-pixel from the PNG IHDR: blanks sit at 0.006–0.009,
  the 6 real PNGs at 0.17–0.35. Real answer areas are almost always JPEG.
- After filtering: 501 unique images, covering 97 of 101 hotspot and 89 of 90
  dragdrop questions — the types that actually need them.
- `pandoc` and `pdftoppm` are **not installed**; `pdftotext` 4.00 is. The pipeline is
  stdlib-only Python and needs no `pip install`.

## Question bank shape

| Type | Count | Options in text | Rendering |
| --- | --- | --- | --- |
| `mcq-single` | 189 | yes | fully interactive |
| `mcq-multi` | 57 | yes | fully interactive, all-or-nothing grading |
| `hotspot` | 102 | **no** | image + graded box inputs, or self-grade |
| `dragdrop` | 92 | **no** | image + graded box inputs, or self-grade |

Of the 194 image-only questions, **87 carry ordered `Box 1: … Box 2: …` answers** in
the explanation and get real graded inputs. **122 questions are self-graded** — the
107 image-only ones without box answers, plus ~15 late case-study MCQs whose options
live in the image. The UI must say so plainly rather than implying interactivity it
does not have.

Final position: **318 of 440 actively drillable (72%)**, 122 passive review, 1 dead
end (q266, no image and no explanation). Two known defects are surfaced rather than
patched: q182 states `Answer: H` with only options A–F, and q266 above.

Zero other answer keys reference a non-existent option. If a change makes that
untrue, the parser regressed.

## Architecture

- `pipeline/` — Python extraction. `schema.py` is the shared record contract; every
  stage validates against it on write.
- `src/data/questions.json` — the built bank. Generated, but committed.
- `src/lib/` — persistence and scheduling. IndexedDB progress is keyed by a stable
  `contentHash` of the question stem, **never by array index or file position**, so
  reimporting a corrected bank preserves history. This is load-bearing; changing the
  key strategy orphans the user's real study data.
- `src/components/question/` — one renderer per question type.
- `src/features/` — drill, dashboard, simulator, export.

Blueprint weights drive simulator sampling and dashboard scoring. Keys are fixed:
`technical-design`, `build-solutions`, `apps-improvements`, `extend-ux`,
`extend-platform` (30–35%, the dominant band), `integrations`.

## Parallel agent ownership

Contracts land first, then agents fork. **No agent edits a file another owns**, and no
agent edits `pipeline/schema.py` or `src/types.ts` after the fork — changes to those go
through the orchestrator.

| Wave | Agent | Owns | Depends on |
| --- | --- | --- | --- |
| 0 | orchestrator | `schema.py`, `src/types.ts` | — |
| 1 | pdf-extractor | `pipeline/01_extract_pdf.py` | schema |
| 1 | docx-extractor | `pipeline/02_extract_docx.py` | schema |
| 2 | merger | `pipeline/03_merge.py`, `04_classify.py`, `rules.py` | wave 1 |
| 3 | store | `src/lib/` (IndexedDB, Leitner, selectors) | types |
| 3 | renderers | `src/components/question/` | types |
| 4 | features | `src/features/{dashboard,simulator,drill}/` | store |
| 4 | export | `src/features/export/`, currency banner | store |
| 5 | reviewer | nothing — read-only audit | all |

Waves 1, 3 and 4 run in parallel. Review always runs in a **clean context** — never
review an implementation in the session that wrote it.

## Conventions

- UK English throughout, including UI copy. Direct and concise. No emojis.
- The user is a Power Platform engineer fluent in TypeScript, React and JSON. No
  tooling primers, no explanations of npm or VS Code.
- Never invent an API signature, CLI flag or service limit. Where a question's currency
  is unverified, mark it `unverified` in the data rather than guessing. Verify against
  live Microsoft Learn docs via the `microsoft-learn` MCP server.
- Raise genuine judgement calls (malformed question, disputed answer key) rather than
  deciding silently. Be blunt about what is not working.
- Do not build accounts, auth, a backend, a server database, sync, in-app AI chat, or
  gamification. These are explicit non-goals.
