"""Stage 1 — extract the question bank from the PDF text layer.

The PDF is the text spine: `pdftotext -layout` recovers all 440 questions with a
flatter structure than the DOCX. Images come from stage 2.

    python pipeline/01_extract_pdf.py   ->  pipeline/out/raw_pdf.json

Deterministic and re-runnable. Delete pipeline/out/pdf.txt to force re-extraction.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows consoles default to cp1252; question text contains typographic marks.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import schema  # noqa: E402
from schema import Option, RawQuestion  # noqa: E402

PAGE_BREAK = "\f"
WATERMARK = re.compile(r"[ \t]*Exam\s+Heist[ \t]*")

#: The marker appears bare, as `HOTSPOT -`, and with trailing text. Anchoring on
#: end-of-line loses 4 questions; requiring the trailing hyphen loses 80. Match the
#: word at line start and nothing more.
RE_TYPE_MARKER = re.compile(r"(?m)^[ \t]*(HOTSPOT|DRAG DROP)\b[ \t]*-?[ \t]*")
RE_EXPLANATION = re.compile(r"(?m)^[ \t]*Explanation:[ \t]*$")
RE_REFERENCE = re.compile(r"(?m)^[ \t]*Reference[s]?:[ \t]*$")
RE_ANSWER_LINE = re.compile(r"(?m)^[ \t]*Answer:")

#: Case-study boilerplate. Identical across all ~69 case-study questions and worth
#: nothing to the reader, so it is stripped from the stored background.
RE_CS_BOILERPLATE = re.compile(
    r"This is a case study\..*?(?=\n\s*\n)", re.DOTALL
)
RE_CS_HEADING = re.compile(
    r"(?m)^[ \t]*(Background|Current environment|Requirements|Issues|Overview)[ \t]*-?[ \t]*$"
)


def extract_text() -> str:
    """Run pdftotext once and cache. The cache is the unit of determinism."""
    if schema.PDF_TXT.exists():
        return schema.PDF_TXT.read_text(encoding="utf-8", errors="replace")

    if not schema.PDF_SRC.exists():
        sys.exit(f"Source PDF not found: {schema.PDF_SRC}\nSee AGENTS.md — source docs are gitignored.")

    schema.PDF_TXT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pdftotext", "-layout", str(schema.PDF_SRC), str(schema.PDF_TXT)],
        check=True,
    )
    return schema.PDF_TXT.read_text(encoding="utf-8", errors="replace")


def build_page_map(text: str) -> list[tuple[int, int, int]]:
    """(start_offset, end_offset, page_number) so sourcePages is measured, not guessed."""
    spans: list[tuple[int, int, int]] = []
    cursor = 0
    for page_no, page in enumerate(text.split(PAGE_BREAK), start=1):
        spans.append((cursor, cursor + len(page), page_no))
        cursor += len(page) + 1
    return spans


def pages_for(spans: list[tuple[int, int, int]], start: int, end: int) -> list[int]:
    return [page for lo, hi, page in spans if lo < end and hi >= start]


def clean(text: str) -> str:
    """Strip the watermark and normalise whitespace without destroying structure."""
    text = WATERMARK.sub(" ", text)
    text = text.replace(PAGE_BREAK, "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    # A type marker's trailing hyphen often wraps to a line of its own; left in,
    # it becomes the first character of the stem.
    text = re.sub(r"(?m)^[ \t]*-[ \t]*$\n?", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def join_wrapped_urls(text: str) -> str:
    """`pdftotext -layout` breaks long URLs at the margin; rejoin the continuations.

    A continuation line contains no spaces and follows a line ending in a URL.
    Without this, ~a third of the 245 reference links resolve to 404s.
    """
    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if out and stripped and " " not in stripped and re.search(r"https?://\S+$", out[-1]):
            out[-1] += stripped
        else:
            out.append(stripped)
    return "\n".join(out)


def split_sections(block: str) -> tuple[str, str, str]:
    """Return (before_answer, explanation, references) regions of one question block."""
    answer = RE_ANSWER_LINE.search(block)
    head = block[: answer.start()] if answer else block
    tail = block[answer.start() :] if answer else ""

    explanation, references = "", ""
    expl_match = RE_EXPLANATION.search(tail)
    ref_match = RE_REFERENCE.search(tail)

    if expl_match:
        expl_end = ref_match.start() if ref_match and ref_match.start() > expl_match.end() else len(tail)
        explanation = tail[expl_match.end() : expl_end]
    if ref_match:
        references = tail[ref_match.end() :]
    elif not expl_match:
        references = tail

    return head, explanation, references


def parse_options(head: str) -> tuple[list[Option], int]:
    """Options plus the offset where the first one starts (the stem boundary)."""
    matches = list(schema.RE_OPTION.finditer(head))
    if not matches:
        return [], len(head)

    options: list[Option] = []
    seen: set[str] = set()
    for i, match in enumerate(matches):
        key = match.group(1)
        if key in seen:
            continue  # duplicated option letter — keep the first, flagged upstream
        seen.add(key)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(head)
        body = clean(head[match.start(2) : end])
        options.append(Option(key=key, text=body))

    return options, matches[0].start()


def parse_case_study(stem_region: str) -> tuple[str | None, str]:
    """Split a case-study block into (shared background, the actual question).

    The background is scenario context repeated across several questions; the
    question is the final paragraph. Never render one without the other.
    """
    if not schema.RE_CASE_STUDY.search(stem_region):
        return None, stem_region

    body = RE_CS_BOILERPLATE.sub("", stem_region)
    body = schema.RE_CASE_STUDY_HEADING.sub("", body).strip()

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if len(paragraphs) < 2:
        return (body or None), stem_region.strip()

    # The trailing paragraph is the question itself; everything above is shared.
    question = paragraphs[-1]
    background = "\n\n".join(paragraphs[:-1])
    return (background or None), question


def parse_boxes(explanation: str) -> list[schema.BoxAnswer]:
    """Ordered `Box 1: … Box 2: …` selections stated in the explanation."""
    boxes: list[schema.BoxAnswer] = []
    for match in schema.RE_BOX.finditer(explanation):
        answer = clean(match.group(2)).split("\n")[0].strip(" -")
        if answer:
            boxes.append(schema.BoxAnswer(box=int(match.group(1)), answer=answer))
    # Keep the first statement of each box; explanations sometimes restate them.
    unique: dict[int, schema.BoxAnswer] = {}
    for box in boxes:
        unique.setdefault(box.box, box)
    return [unique[k] for k in sorted(unique)]


def strip_markers(head: str) -> str:
    """Remove question markers, stray `Answer:` tokens and type markers from a stem.

    Deliberately NOT line-anchored: in reflowed blocks the repeats run together
    inline ("Answer:Question: 266 Answer:Question: 266 …"), so a `^`-anchored sub
    strips only the first and leaves the rest embedded in the stem. Shared by both
    extractors — stage 2 hit exactly the same corruption on q266.
    """
    head = re.sub(r"Question:\s*\d+", "", head)
    head = re.sub(r"Answer:", "", head)
    return RE_TYPE_MARKER.sub("", head)


def normalise_block(block: str) -> str:
    """Strip watermark and page breaks BEFORE any section splitting.

    A page break lands immediately before `Explanation:` or `Reference:` often
    enough to matter: the heading regexes anchor at `^`, and a leading \\f stops
    `[ \\t]*` from reaching the word. Cleaning afterwards cost 66 explanation
    blocks and two thirds of the box answers.
    """
    block = WATERMARK.sub(" ", block)
    block = block.replace(PAGE_BREAK, "\n")
    return re.sub(r"[ \t]+\n", "\n", block)


def parse_block(qid: int, block: str, pages: list[int]) -> RawQuestion:
    notes: list[str] = []
    block = normalise_block(block)

    type_marker = RE_TYPE_MARKER.search(block)
    declared = type_marker.group(1) if type_marker else None

    head, explanation_raw, references_raw = split_sections(block)

    # Drop every `Question: N` marker and stray `Answer:` token from the stem
    # region, not just the first. A few blocks (q266 is the worst) repeat the
    # marker several times where the A5 layout reflowed, and removing only the
    # first leaves "Answer:Question: 266 Answer:Question: 266 …" as the stem.
    head = strip_markers(head)

    options, stem_end = parse_options(head)
    background, stem = parse_case_study(clean(head[:stem_end]))
    # Leading orphan punctuation left by the wrapped type-marker hyphen.
    stem = re.sub(r"^[\s\-–—:]+", "", stem)

    answer_match = schema.RE_ANSWER.search(block)
    correct = schema.parse_answer_key(answer_match.group(1)) if answer_match else []

    explanation = clean(explanation_raw)
    references = schema.RE_URL.findall(join_wrapped_urls(clean(references_raw)))
    if not references:
        references = schema.RE_URL.findall(join_wrapped_urls(clean(explanation_raw)))

    # Box answers only mean something for the image-only types. Nine MCQ
    # explanations mention boxes in passing; attaching them there is noise.
    boxes = parse_boxes(explanation) if declared else []

    if declared == "HOTSPOT":
        qtype = "hotspot"
    elif declared == "DRAG DROP":
        qtype = "dragdrop"
    else:
        qtype = "mcq-multi" if len(correct) > 1 else "mcq-single"

    # ── Confidence flags. Never drop a question; flag it and move on. ──
    if not stem:
        notes.append("empty stem after cleaning")
    if qtype.startswith("mcq"):
        if not options:
            notes.append("mcq with no text options; answer area is probably an image")
        if not correct:
            notes.append("no answer key in PDF text; candidate for DOCX merge")
        orphaned = sorted(set(correct) - {o.key for o in options})
        if options and orphaned:
            notes.append(f"answer key {orphaned} has no matching option")
    if qtype in ("hotspot", "dragdrop") and not boxes:
        notes.append("no Box N: structure; will need self-grading against the image")

    currency, currency_note = schema.classify_currency(block)
    if currency_note:
        notes.append(currency_note)

    return RawQuestion(
        id=qid,
        source="pdf",
        type=qtype,  # type: ignore[arg-type]
        stem=stem,
        options=options,
        correct=correct,
        explanation=explanation,
        references=list(dict.fromkeys(references)),
        boxAnswers=boxes,
        images=[],
        sourcePages=pages,
        caseStudyBackground=background,
        parseConfidence="low" if notes and not _only_currency(notes, currency_note) else "high",
        parseNotes=notes,
    )


def _only_currency(notes: list[str], currency_note: str | None) -> bool:
    """A currency flag alone is not a parse failure."""
    return bool(currency_note) and notes == [currency_note]


def main() -> int:
    text = extract_text()
    spans = build_page_map(text)
    marks = [(int(m.group(1)), m.start()) for m in schema.RE_QUESTION_MARKER.finditer(text)]

    if len(marks) != schema.TOTAL_QUESTIONS:
        print(f"WARNING: found {len(marks)} markers, expected {schema.TOTAL_QUESTIONS}")

    questions: list[RawQuestion] = []
    seen: set[int] = set()
    for i, (qid, start) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(text)
        if qid in seen:
            continue  # repeated marker for the same id — first wins
        seen.add(qid)
        questions.append(parse_block(qid, text[start:end], pages_for(spans, start, end)))

    questions.sort(key=lambda q: q.id)
    missing = sorted(set(range(1, schema.TOTAL_QUESTIONS + 1)) - seen)
    schema.write_json(schema.RAW_PDF, questions)
    summarise(questions, missing)
    return 0


def summarise(questions: list[RawQuestion], missing: list[int]) -> None:
    import collections

    by_type = collections.Counter(q.type for q in questions)
    low = [q for q in questions if q.parseConfidence == "low"]

    print(f"\nParsed {len(questions)} of {schema.TOTAL_QUESTIONS} questions -> {schema.RAW_PDF}")
    if missing:
        print(f"  MISSING: {missing}")
    print("\n  by type:")
    for qtype, count in sorted(by_type.items(), key=lambda kv: -kv[1]):
        print(f"    {qtype:<12} {count:>4}")

    print("\n  content:")
    print(f"    with options       {sum(1 for q in questions if q.options):>4}")
    print(f"    with answer key    {sum(1 for q in questions if q.correct):>4}")
    print(f"    with boxAnswers    {sum(1 for q in questions if q.boxAnswers):>4}")
    print(f"    with explanation   {sum(1 for q in questions if q.explanation):>4}")
    print(f"    with references    {sum(1 for q in questions if q.references):>4}")
    print(f"    case-study members {sum(1 for q in questions if q.caseStudyBackground):>4}")

    print(f"\n  parseConfidence=low: {len(low)}")
    reasons = collections.Counter(note for q in low for note in q.parseNotes)
    for note, count in reasons.most_common(8):
        print(f"    {count:>4}  {note[:70]}")

    keyless = [q.id for q in questions if q.type.startswith("mcq") and not q.correct]
    if keyless:
        print(f"\n  MCQ with no answer key ({len(keyless)}): {keyless}")


if __name__ == "__main__":
    raise SystemExit(main())
