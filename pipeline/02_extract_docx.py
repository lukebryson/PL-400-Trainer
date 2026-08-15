"""Stage 2 — extract text and answer-area images from the DOCX.

The DOCX is the image source and the gap-fill for questions the PDF text parses
poorly. It is read as raw OOXML rather than via pandoc: run ordering inside each
paragraph is what resolves image ownership, and pandoc discards it.

    python pipeline/02_extract_docx.py  ->  pipeline/out/raw_docx.json
                                            public/images/*.png|jpeg

Deterministic and re-runnable: identical JSON and identical image filenames.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows consoles default to cp1252; question text contains typographic marks.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import schema  # noqa: E402
from schema import RawQuestion  # noqa: E402

# Reuse stage 1's block parsing rather than maintaining a second copy. The module
# name starts with a digit, so it cannot be imported normally.
_spec = importlib.util.spec_from_file_location("stage1", Path(__file__).parent / "01_extract_pdf.py")
assert _spec and _spec.loader
stage1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stage1)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
V = "{urn:schemas-microsoft-com:vml}"

RE_MARKER_INLINE = re.compile(r"Question:\s*(\d+)")


def load_relationships(archive: zipfile.ZipFile) -> dict[str, str]:
    root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    return {rel.get("Id", ""): rel.get("Target", "") for rel in root}


def run_items(run: ET.Element) -> list[tuple[str, str]]:
    """Ordered ('TXT'|'IMG', payload) items inside one `w:r`.

    Covers both DrawingML (`a:blip`) and legacy VML (`v:imagedata`) images.
    """
    items: list[tuple[str, str]] = []
    text = "".join(node.text or "" for node in run.iter(W + "t"))
    if text:
        items.append(("TXT", text))
    for blip in run.iter(A + "blip"):
        rid = blip.get(R + "embed")
        if rid:
            items.append(("IMG", rid))
    for image in run.iter(V + "imagedata"):
        rid = image.get(R + "id")
        if rid:
            items.append(("IMG", rid))
    return items


def paragraph_items(paragraph: ET.Element) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for run in paragraph.iter(W + "r"):
        items.extend(run_items(run))
    return items


def collect_lines(paragraphs: list[ET.Element]) -> tuple[dict[int, list[str]], dict[int, list[str]]]:
    """Walk the document, assigning text lines and image rel-ids to question ids.

    ON THE "OFF-BY-ONE" — prompt.md asserts that images emitted before the
    `Question: N` text run belong to question N-1, and warns that a naive parser
    attaches every answer image to the wrong question. That is measurably WRONG for
    this document, and following it inverts 933 of 4,348 image references.

    Verified against the rendered images: the paragraph bearing `Question: 7` opens
    with the Email / Document storage answer area, and q7's parsed box answers are
    "Server-side synchronization" and "Server-side integration" — the very options
    in that image. It belongs to q7, the question the marker NAMES, not to q6.

    So: every image in a marker paragraph belongs to that marker's question,
    wherever it sits in the run order. Re-verify with `spot_check` before changing
    this — it is the single highest-risk assignment in the pipeline.
    """
    text_by_q: dict[int, list[str]] = {}
    images_by_q: dict[int, list[str]] = {}
    current: int | None = None

    for paragraph in paragraphs:
        items = paragraph_items(paragraph)
        if not items:
            continue

        marker_at: int | None = None
        marker_id: int | None = None
        accumulated = ""
        for index, (kind, payload) in enumerate(items):
            if kind != "TXT":
                continue
            accumulated += payload
            match = RE_MARKER_INLINE.search(accumulated)
            if match:
                marker_at, marker_id = index, int(match.group(1))
                break

        if marker_at is None:
            # Body paragraph: everything in it belongs to the question in scope.
            # This is the largest bucket (2,881 of 4,348 image references) and is
            # unambiguous — no marker, so no ownership question.
            if current is not None:
                line = "".join(p for k, p in items if k == "TXT")
                if line.strip():
                    text_by_q.setdefault(current, []).append(line)
                for kind, payload in items:
                    if kind == "IMG":
                        images_by_q.setdefault(current, []).append(payload)
            continue

        current = marker_id  # type: ignore[assignment]
        assert current is not None
        text_by_q.setdefault(current, [])
        images_by_q.setdefault(current, [])

        # `marker_at` splits IMAGES only. Text must be rejoined across the whole
        # paragraph: the marker straddles run boundaries ("Question:" + " 2"), so
        # slicing text at marker_at drops the "Question:" token and leaves a bare
        # number stranded at the head of the stem.
        line = "".join(p for k, p in items if k == "TXT")
        if line.strip():
            text_by_q[current].append(line)
        for kind, payload in items:
            if kind == "IMG":
                images_by_q[current].append(payload)

    return text_by_q, images_by_q


#: Below this, a PNG is a blank layout frame rather than content. Measured over the
#: 634 extracted PNGs: 628 sit at 0.006-0.009 B/px (empty white boxes from the A5
#: page furniture) and 6 real screenshots sit at 0.17-0.35. The gap is an order of
#: magnitude wide, so the exact threshold is not delicate. Size alone cannot do this
#: — the blanks are 8-11 KB, comfortably above MIN_IMAGE_BYTES.
MAX_BLANK_BYTES_PER_PIXEL = 0.02

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def is_blank_frame(payload: bytes) -> bool:
    """True for empty white PNG frames. JPEGs are always real content here."""
    if not payload.startswith(PNG_MAGIC) or len(payload) < 24:
        return False
    width = int.from_bytes(payload[16:20], "big")
    height = int.from_bytes(payload[20:24], "big")
    if not width or not height:
        return False
    return len(payload) / (width * height) < MAX_BLANK_BYTES_PER_PIXEL


def export_images(
    archive: zipfile.ZipFile,
    rels: dict[str, str],
    images_by_q: dict[int, list[str]],
) -> tuple[dict[int, list[str]], dict[str, int]]:
    """Write deduplicated image files, discarding decorative media.

    Media under 5 KB are icons, bullets and slivers (552 of 1693) — never content.
    Identical bytes are written once and shared by every question referencing them.
    """
    schema.IMAGES.mkdir(parents=True, exist_ok=True)
    for stale in schema.IMAGES.glob("q*"):
        stale.unlink()  # keep the directory a pure function of the source

    by_hash: dict[str, str] = {}
    result: dict[int, list[str]] = {}
    stats = {"kept": 0, "too_small": 0, "blank": 0, "missing": 0, "deduped": 0}

    for qid in sorted(images_by_q):
        names: list[str] = []
        for rid in images_by_q[qid]:
            target = rels.get(rid, "")
            if not target:
                stats["missing"] += 1
                continue
            member = "word/" + target.lstrip("/")
            try:
                payload = archive.read(member)
            except KeyError:
                stats["missing"] += 1
                continue

            if len(payload) < schema.MIN_IMAGE_BYTES:
                stats["too_small"] += 1
                continue

            if is_blank_frame(payload):
                stats["blank"] += 1
                continue

            digest = hashlib.sha256(payload).hexdigest()
            if digest in by_hash:
                stats["deduped"] += 1
                if by_hash[digest] not in names:
                    names.append(by_hash[digest])
                continue

            suffix = Path(target).suffix.lower() or ".png"
            filename = f"q{qid}-{len(names) + 1}{suffix}"
            (schema.IMAGES / filename).write_bytes(payload)
            by_hash[digest] = filename
            names.append(filename)
            stats["kept"] += 1

        result[qid] = [f"images/{name}" for name in names]

    return result, stats


def parse_question(qid: int, lines: list[str], images: list[str]) -> RawQuestion:
    notes: list[str] = []
    block = stage1.normalise_block("\n".join(lines))

    type_marker = stage1.RE_TYPE_MARKER.search(block)
    declared = type_marker.group(1) if type_marker else None

    head, explanation_raw, references_raw = stage1.split_sections(block)
    head = stage1.strip_markers(head)

    options, stem_end = stage1.parse_options(head)
    background, stem = stage1.parse_case_study(stage1.clean(head[:stem_end]))

    answer_match = schema.RE_ANSWER.search(block)
    correct = schema.parse_answer_key(answer_match.group(1)) if answer_match else []

    explanation = stage1.clean(explanation_raw)
    references = schema.RE_URL.findall(stage1.join_wrapped_urls(stage1.clean(references_raw)))
    if not references:
        references = schema.RE_URL.findall(stage1.join_wrapped_urls(stage1.clean(explanation_raw)))

    boxes = stage1.parse_boxes(explanation) if declared else []

    if declared == "HOTSPOT":
        qtype = "hotspot"
    elif declared == "DRAG DROP":
        qtype = "dragdrop"
    else:
        qtype = "mcq-multi" if len(correct) > 1 else "mcq-single"

    if not stem:
        notes.append("empty stem from DOCX text")
    if not options and qtype.startswith("mcq"):
        notes.append("mcq with no text options in DOCX")
    if not correct:
        notes.append("no answer key in DOCX text")

    return RawQuestion(
        id=qid,
        source="docx",
        type=qtype,  # type: ignore[arg-type]
        stem=stem,
        options=options,
        correct=correct,
        explanation=explanation,
        references=list(dict.fromkeys(references)),
        boxAnswers=boxes,
        images=images,
        sourcePages=[],  # the DOCX has no page numbering; the PDF supplies these
        caseStudyBackground=background,
        parseConfidence="low" if notes else "high",
        parseNotes=notes,
    )


def main() -> int:
    if not schema.DOCX_SRC.exists():
        sys.exit(f"Source DOCX not found: {schema.DOCX_SRC}\nSee AGENTS.md — source docs are gitignored.")

    with zipfile.ZipFile(schema.DOCX_SRC) as archive:
        rels = load_relationships(archive)
        document = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = list(document.iter(W + "p"))
        text_by_q, images_by_q = collect_lines(paragraphs)
        image_names, stats = export_images(archive, rels, images_by_q)

    questions = [
        parse_question(qid, text_by_q.get(qid, []), image_names.get(qid, []))
        for qid in sorted(text_by_q)
    ]
    schema.write_json(schema.RAW_DOCX, questions)
    summarise(questions, paragraphs, stats)
    spot_check(questions)
    return 0


def summarise(questions: list[RawQuestion], paragraphs: list[ET.Element], stats: dict[str, int]) -> None:
    import collections

    ids = {q.id for q in questions}
    missing = sorted(set(range(1, schema.TOTAL_QUESTIONS + 1)) - ids)
    by_type = collections.Counter(q.type for q in questions)

    print(f"\nParsed {len(questions)} of {schema.TOTAL_QUESTIONS} questions -> {schema.RAW_DOCX}")
    print(f"  paragraphs scanned: {len(paragraphs)}")
    if missing:
        print(f"  MISSING: {missing}")

    print("\n  media:")
    print(f"    written (unique)   {stats['kept']:>5}")
    print(f"    reused (duplicate) {stats['deduped']:>5}")
    print(f"    discarded <5KB     {stats['too_small']:>5}")
    print(f"    discarded blank    {stats['blank']:>5}")
    print(f"    unresolved rel ids {stats['missing']:>5}")

    with_images = [q for q in questions if q.images]
    print("\n  association:")
    print(f"    questions with >=1 image {len(with_images):>4}")
    print(f"    questions with no image  {len(questions) - len(with_images):>4}")
    for qtype, count in sorted(by_type.items(), key=lambda kv: -kv[1]):
        covered = sum(1 for q in questions if q.type == qtype and q.images)
        print(f"    {qtype:<12} {count:>4}  with images: {covered:>4}")

    print("\n  content:")
    print(f"    with options     {sum(1 for q in questions if q.options):>4}")
    print(f"    with answer key  {sum(1 for q in questions if q.correct):>4}")
    print(f"    with explanation {sum(1 for q in questions if q.explanation):>4}")


def spot_check(questions: list[RawQuestion]) -> None:
    """Required deliverable: prove the off-by-one was corrected the right way.

    For each sampled question the attached images should depict ITS answer area,
    described by its own stem — not the next question's.
    """
    print("\n  ANCHORING SPOT-CHECK (5 hotspot questions):")
    sample = [q for q in questions if q.type == "hotspot" and q.images][:5]
    for q in sample:
        print(f"\n    q{q.id}  images={q.images}")
        print(f"      stem: {q.stem[:110].strip()}…")
        if q.boxAnswers:
            print(f"      boxes: {[(b.box, b.answer[:40]) for b in q.boxAnswers]}")


if __name__ == "__main__":
    raise SystemExit(main())
