"""Shared record contract for the PL-400 extraction pipeline.

Every stage validates against this on write. Owned by the orchestrator: extractor
agents read it, none of them edit it. If a stage needs a field that is not here,
raise it rather than adding one locally — a silently divergent shape is exactly the
failure this module exists to prevent.

Stdlib only. `pandoc` and `pdftoppm` are not installed and are not needed.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Literal

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "references" / "docs"
PDF_SRC = DOCS / "PL-400-Exam-Questions.pdf"
DOCX_SRC = DOCS / "PL-400-Exam-Questions.docx"

OUT = ROOT / "pipeline" / "out"
PDF_TXT = OUT / "pdf.txt"
RAW_PDF = OUT / "raw_pdf.json"
RAW_DOCX = OUT / "raw_docx.json"
CLASSIFIED = OUT / "classified.json"

DATA = ROOT / "src" / "data"
QUESTIONS = DATA / "questions.json"
IMAGES = ROOT / "public" / "images"

# ── Vocabulary ───────────────────────────────────────────────────────────────

QuestionType = Literal["mcq-single", "mcq-multi", "hotspot", "dragdrop", "yesno-series"]
Source = Literal["pdf", "docx", "merged"]
Currency = Literal["current", "suspect", "superseded"]
Confidence = Literal["high", "low"]

TOTAL_QUESTIONS = 440

#: Blueprint as of 19 March 2026, verified against the published study guide.
#: Keys are fixed — simulator sampling and dashboard weighting both index on
#: them. Must stay identical to `SKILL_AREAS` in `src/types.ts`; that file
#: carries the full reasoning.
#:
#: `weight` is *not* the band midpoint. The published midpoints sum to 95%, not
#: 100% — five areas at 12.5 plus one at 32.5 — so each is scaled by 1 / 0.95,
#: giving 5/38 and 13/38, which sum to exactly 1 and leave every area inside its
#: own band. Putting the whole 5pp residual on one area instead pushes that area
#: out of the band printed beside it.
SKILL_AREAS: dict[str, dict[str, Any]] = {
    "technical-design": {"label": "Create a technical design", "band": (10, 15), "weight": 5 / 38},
    "build-solutions": {"label": "Build Power Platform solutions", "band": (10, 15), "weight": 5 / 38},
    "apps-improvements": {"label": "Implement Power Apps improvements", "band": (10, 15), "weight": 5 / 38},
    "extend-ux": {"label": "Extend the user experience", "band": (10, 15), "weight": 5 / 38},
    "extend-platform": {"label": "Extend the platform", "band": (30, 35), "weight": 13 / 38},
    "integrations": {"label": "Develop integrations", "band": (10, 15), "weight": 5 / 38},
}

# ── Regexes ──────────────────────────────────────────────────────────────────
# These are measured against the real files. Do not "tidy" them; see AGENTS.md.

#: Leading whitespace is mandatory. Anchoring at `^Question:` loses 47 questions.
RE_QUESTION_MARKER = re.compile(r"(?m)^\s*Question:\s*(\d+)")

#: Options are written `A.Add the code…` with NO space after the dot. Requiring
#: `\s+` here silently drops 66 questions while looking like clean output.
RE_OPTION = re.compile(r"(?m)^\s*([A-F])\.\s*(\S.*)$")

#: The key token MUST end its line. `\s*` here is a trap: it crosses newlines, so a
#: bare `Answer:` followed by `Explanation:` captures a phantom `E` — that produced
#: 192 fabricated answer keys before it was caught. The lookahead prevents it.
#: One optional newline is allowed because ~2 questions put the key on the next line.
#: Range is A-H, not A-F, so anomalies like q182's `Answer: H` surface as a validation
#: failure rather than being silently discarded.
RE_ANSWER = re.compile(
    r"(?m)^[ \t]*Answer:[ \t]*(?:\r?\n[ \t]*)?([A-H](?:[ \t,]*[A-H])*)[ \t]*(?=\r?\n|$)"
)
RE_BOX = re.compile(r"(?m)Box\s*(\d+)\s*:\s*(.+?)(?=\s*(?:Box\s*\d+\s*:|$))")
RE_URL = re.compile(r"https?://[^\s)>\]]+")
RE_HOTSPOT = re.compile(r"(?m)^\s*HOTSPOT")
RE_DRAGDROP = re.compile(r"(?m)^\s*DRAG DROP")
#: Membership test. The `Case study` heading is unreliable — its trailing hyphen
#: often wraps to its own line and the heading is missing entirely from most blocks
#: (13 of 69). The boilerplate paragraph is present in exactly 69, so test on that.
RE_CASE_STUDY = re.compile(r"This is a case study\.")
RE_CASE_STUDY_HEADING = re.compile(r"(?m)^[ \t]*Case study[ \t]*\r?\n?[ \t]*-?[ \t]*")

#: Terminology predating the 19 March 2026 skills update.
CURRENCY_PATTERNS: list[tuple[str, str]] = [
    (r"Common Data Service", "References Common Data Service; terminology superseded by Dataverse."),
    (r"\bCDS\b", "References CDS; terminology superseded by Dataverse."),
    (r"PowerApps portals", "References PowerApps portals; superseded by Power Pages."),
    (r"docs\.microsoft\.com", "Links to docs.microsoft.com; content has moved to learn.microsoft.com."),
    (r"Xrm\.Page", "Uses the deprecated Xrm.Page API; replaced by the execution context form API."),
    (r"\bUnified Service Desk\b", "Topic absent from the March 2026 blueprint."),
]

MIN_IMAGE_BYTES = 5 * 1024  #: Below this, DOCX media are icons and bullets, not content.


# ── Records ──────────────────────────────────────────────────────────────────


@dataclass
class Option:
    key: str
    text: str


@dataclass
class BoxAnswer:
    """An ordered answer slot recovered from `Box 1: … Box 2: …` in the explanation.

    Present for the 87 hotspot/dragdrop questions whose explanation states its
    selections in order. Those get real graded inputs; the rest are self-graded.
    """

    box: int
    answer: str


@dataclass
class RawQuestion:
    """One question as parsed from a single source, before reconciliation."""

    id: int
    source: Source
    type: QuestionType
    stem: str
    options: list[Option] = field(default_factory=list)
    correct: list[str] = field(default_factory=list)
    explanation: str = ""
    references: list[str] = field(default_factory=list)
    boxAnswers: list[BoxAnswer] = field(default_factory=list)
    images: list[str] = field(default_factory=list)
    sourcePages: list[int] = field(default_factory=list)
    caseStudyBackground: str | None = None
    parseConfidence: Confidence = "high"
    parseNotes: list[str] = field(default_factory=list)


@dataclass
class Question:
    """The merged, app-facing record. Shape mirrors `src/types.ts`."""

    id: int
    contentHash: str
    source: Source
    sourcePages: list[int]
    type: QuestionType
    caseStudyId: str | None
    stem: str
    options: list[Option]
    correct: list[str]
    boxAnswers: list[BoxAnswer]
    selfGraded: bool
    explanation: str
    references: list[str]
    images: list[str]
    skillArea: str
    subtopic: str
    currency: Currency
    currencyNote: str | None
    parseConfidence: Confidence
    parseNotes: list[str]
    codeBlock: str | None = None
    #: Populated only when PDF and DOCX disagree on the stated key.
    answerDisagreement: dict[str, list[str]] | None = None


@dataclass
class CaseStudy:
    id: str
    background: str
    questionIds: list[int]


# ── Helpers ──────────────────────────────────────────────────────────────────


def image_digest(path: str) -> str:
    """Content address for one image, so identity never smuggles in the question id.

    Image filenames are derived from the id (`q7-1.jpeg`), so hashing the *path*
    would reintroduce exactly the positional dependency `content_hash` exists to
    avoid. Hash the bytes instead.
    """
    return hashlib.sha256((IMAGES.parent / path).read_bytes()).hexdigest()[:12]


def content_hash(
    *,
    qtype: str,
    stem: str,
    options: Iterable[Any] = (),
    box_answers: Iterable[Any] = (),
    image_digests: Iterable[str] = (),
) -> str:
    """Stable identity for a question, used as the IndexedDB progress key.

    Derived from what a human would call "the same question" — NOT from the id or
    file position — so renumbering or re-merging the bank does not orphan the
    user's study history. Changing this function invalidates real progress data;
    don't, without a migration.

    Included: type, stem, the option texts, the ordered box answers, and the
    content digests of the images. Forty-one questions share a stem with another
    (the dump repeats a scenario with different choices, six times over for one
    rollup-field question), so a stem-only hash silently merged their progress
    records: drilling one marked five others as answered. Everything that
    distinguishes one variant from another has to be in here.

    Deliberately excluded: the answer key, the explanation, the references and the
    currency flags. Those are exactly the fields Phase 3 will correct, and a
    correction must not orphan the history attached to the question it corrects.

    Three pairs (402/410, 403/411, 409/412) are true duplicates — identical type,
    stem, options and key — and so hash alike by design. Answering one really does
    mean you have answered the other; the drill selector shows them once.
    """
    parts = [
        qtype,
        stem,
        *(f"{o.key}:{o.text}" for o in options),
        *(f"{b.box}:{b.answer}" for b in box_answers),
        *image_digests,
    ]
    normalised = re.sub(r"\s+", " ", "\x01".join(parts)).strip().lower()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:16]


def classify_currency(text: str) -> tuple[Currency, str | None]:
    """Flag legacy terminology. Heuristic only — live verification happens in Phase 3."""
    notes = [note for pattern, note in CURRENCY_PATTERNS if re.search(pattern, text)]
    if not notes:
        return "current", None
    return "suspect", " ".join(dict.fromkeys(notes))


def parse_answer_key(raw: str) -> list[str]:
    """`Answer: AD` and `Answer: A, D` both mean ['A', 'D']."""
    return sorted(dict.fromkeys(re.findall(r"[A-H]", raw or "")))


def infer_type(block: str, correct: Iterable[str]) -> QuestionType:
    if RE_HOTSPOT.search(block):
        return "hotspot"
    if RE_DRAGDROP.search(block):
        return "dragdrop"
    return "mcq-multi" if len(list(correct)) > 1 else "mcq-single"


def write_json(path: Path, payload: Any) -> None:
    """Deterministic JSON write — stable key order, LF endings, trailing newline.

    Stage output must be byte-identical across reruns; that is asserted in tests.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True, default=_encode)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _encode(obj: Any) -> Any:
    if hasattr(obj, "__dataclass_fields__"):
        return asdict(obj)
    raise TypeError(f"not JSON-serialisable: {type(obj).__name__}")


def validate(questions: list[Question]) -> list[str]:
    """Return human-readable problems. Empty list means the bank passes.

    Enforces the acceptance criteria that can be checked mechanically. Callers
    report every problem rather than dropping the offending question silently.
    """
    problems: list[str] = []
    seen: dict[int, int] = {}

    for q in questions:
        keys = {o.key for o in q.options}

        if q.type in ("mcq-single", "mcq-multi") and not q.selfGraded:
            if not q.options:
                problems.append(f"q{q.id}: {q.type} has an empty option list")
            if not q.correct:
                problems.append(f"q{q.id}: no answer key")
            orphaned = sorted(set(q.correct) - keys)
            if orphaned:
                problems.append(f"q{q.id}: answer key {orphaned} has no matching option")
            if q.type == "mcq-single" and len(q.correct) > 1:
                problems.append(f"q{q.id}: typed mcq-single but has {len(q.correct)} correct answers")

        # Acceptance criterion 2: nothing may render with no options and no fallback.
        # A self-graded card is a legitimate fallback ONLY if it has something to
        # reveal — an image or an explanation. With neither, it is a dead end.
        if q.selfGraded and not q.images and not q.explanation.strip():
            problems.append(f"q{q.id}: self-graded but has neither an image nor an explanation to reveal")

        if q.type in ("hotspot", "dragdrop") and not q.boxAnswers and not q.selfGraded:
            problems.append(f"q{q.id}: {q.type} has no box answers and is not marked selfGraded")

        if q.skillArea not in SKILL_AREAS:
            problems.append(f"q{q.id}: unknown skillArea {q.skillArea!r}")

        if not q.stem.strip():
            problems.append(f"q{q.id}: empty stem")

        if q.id in seen:
            problems.append(f"q{q.id}: duplicate id")
        seen[q.id] = q.id

    missing = sorted(set(range(1, TOTAL_QUESTIONS + 1)) - set(seen))
    if missing:
        problems.append(f"missing {len(missing)} of {TOTAL_QUESTIONS} question ids: {missing}")

    return problems
