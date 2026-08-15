"""Stage 3 — reconcile the two parses into the app-facing bank.

Both sources yield all 440 questions, so this is not the gap-fill prompt.md
describes: it is a 440-way cross-validation. Where the two disagree on an answer
key, BOTH are recorded and the question is marked low confidence. Nothing is
silently chosen.

    python pipeline/03_merge.py  ->  src/data/questions.json
"""

from __future__ import annotations

import hashlib
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import schema  # noqa: E402
from schema import BoxAnswer, CaseStudy, Option, Question, RawQuestion  # noqa: E402

#: Shorter than this, a captured "background" is a heading fragment, not a scenario.
MIN_BACKGROUND_CHARS = 200

#: Skill area is assigned in stage 4; until then every question carries this.
UNCLASSIFIED = "extend-platform"


def load(path: Path) -> dict[int, RawQuestion]:
    records = schema.read_json(path)
    out: dict[int, RawQuestion] = {}
    for record in records:
        record["options"] = [Option(**o) for o in record.get("options", [])]
        record["boxAnswers"] = [BoxAnswer(**b) for b in record.get("boxAnswers", [])]
        out[record["id"]] = RawQuestion(**record)
    return out


def better(pdf: RawQuestion | None, docx: RawQuestion | None, field: str):
    """PDF wins on text; fall back to the DOCX only where the PDF has nothing."""
    pdf_value = getattr(pdf, field, None) if pdf else None
    docx_value = getattr(docx, field, None) if docx else None
    return pdf_value if pdf_value else docx_value


def normalise_background(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def merge_one(qid: int, pdf: RawQuestion | None, docx: RawQuestion | None) -> Question:
    notes: list[str] = []
    notes += pdf.parseNotes if pdf else []
    if docx and not pdf:
        notes += docx.parseNotes

    source: schema.Source = "merged" if pdf and docx else ("pdf" if pdf else "docx")

    stem = better(pdf, docx, "stem") or ""
    options: list[Option] = better(pdf, docx, "options") or []
    explanation = better(pdf, docx, "explanation") or ""
    references: list[str] = better(pdf, docx, "references") or []
    boxes: list[BoxAnswer] = better(pdf, docx, "boxAnswers") or []
    images: list[str] = (docx.images if docx else []) or (pdf.images if pdf else [])
    pages: list[int] = (pdf.sourcePages if pdf else []) or []

    # ── Answer key reconciliation. The single most important step here. ──
    pdf_key = pdf.correct if pdf else []
    docx_key = docx.correct if docx else []
    disagreement: dict[str, list[str]] | None = None

    if pdf_key and docx_key and pdf_key != docx_key:
        correct = pdf_key  # PDF wins, but the conflict is recorded, not hidden
        disagreement = {"pdf": pdf_key, "docx": docx_key}
        notes.append(f"answer key disagreement: PDF={''.join(pdf_key)} DOCX={''.join(docx_key)}")
    else:
        correct = pdf_key or docx_key

    qtype = (pdf.type if pdf else None) or (docx.type if docx else "mcq-single")
    if qtype.startswith("mcq") and len(correct) > 1:
        qtype = "mcq-multi"
    elif qtype.startswith("mcq"):
        qtype = "mcq-single"

    # A question is self-graded when it cannot be machine-marked. Two ways in:
    #   - an image-only type with no parseable box answers, or
    #   - an MCQ whose options live in the image rather than the text (~15 of the
    #     late case-study questions), leaving nothing to render as choices.
    # Either way the card shows the question, image and explanation, and the user
    # grades their own recall. The UI says so rather than faking interactivity.
    self_graded = (qtype in ("hotspot", "dragdrop") and not boxes) or (
        qtype.startswith("mcq") and not options and not correct
    )

    background = better(pdf, docx, "caseStudyBackground")

    currency, currency_note = schema.classify_currency(
        " ".join([stem, explanation, " ".join(references)])
    )

    orphaned = sorted(set(correct) - {o.key for o in options})
    if options and orphaned:
        notes.append(f"answer key {orphaned} has no matching option")

    low = bool(disagreement or orphaned) or (pdf.parseConfidence == "low" if pdf else True)
    if qtype in ("hotspot", "dragdrop") and not boxes:
        low = True

    return Question(
        id=qid,
        contentHash=schema.content_hash(stem or str(qid)),
        source=source,
        sourcePages=pages,
        type=qtype,  # type: ignore[arg-type]
        caseStudyId=None,  # linked below
        stem=stem,
        options=options,
        correct=correct,
        boxAnswers=boxes,
        selfGraded=self_graded,
        explanation=explanation,
        references=references,
        images=images,
        skillArea=UNCLASSIFIED,
        subtopic="",
        currency=currency,
        currencyNote=currency_note,
        parseConfidence="low" if low else "high",
        parseNotes=list(dict.fromkeys(notes)),
        codeBlock=None,
        answerDisagreement=disagreement,
    )


def link_case_studies(
    questions: list[Question],
    backgrounds: dict[int, str],
) -> list[CaseStudy]:
    """Group questions sharing a scenario into parent records.

    The background is repeated inline per question in the source, so identical
    text is the grouping key. Children then render with their parent's background.
    """
    by_key: dict[str, CaseStudy] = {}
    for question in questions:
        background = backgrounds.get(question.id)
        if not background:
            continue
        # Group on the opening of the scenario, not the whole thing. Siblings share
        # an identical opening but each block trails off at a different point, so
        # hashing the full text yields one "parent" per question and defeats the
        # purpose. 200 characters is well past the point where two distinct
        # scenarios diverge.
        key = hashlib.sha256(normalise_background(background)[:200].encode()).hexdigest()[:12]
        case = by_key.get(key)
        if case is None:
            case = CaseStudy(id=f"cs-{key}", background=background.strip(), questionIds=[])
            by_key[key] = case
        case.questionIds.append(question.id)
        question.caseStudyId = case.id

    # A "background" of a few dozen characters is a stray heading fragment, not a
    # scenario. Publishing those as case studies would put an empty context panel
    # above the question, which is worse than showing none.
    kept: list[CaseStudy] = []
    for case in (by_key[k] for k in sorted(by_key)):
        if len(case.background) >= MIN_BACKGROUND_CHARS:
            kept.append(case)
            continue
        for qid in case.questionIds:
            for question in questions:
                if question.id == qid:
                    question.caseStudyId = None

    return kept


def main() -> int:
    for path in (schema.RAW_PDF, schema.RAW_DOCX):
        if not path.exists():
            sys.exit(f"Missing {path.name}. Run stages 1 and 2 first.")

    pdf_records = load(schema.RAW_PDF)
    docx_records = load(schema.RAW_DOCX)
    all_ids = sorted(set(pdf_records) | set(docx_records))

    questions = [merge_one(qid, pdf_records.get(qid), docx_records.get(qid)) for qid in all_ids]

    backgrounds = {
        qid: (pdf_records[qid].caseStudyBackground if qid in pdf_records else None)
        or (docx_records[qid].caseStudyBackground if qid in docx_records else None)
        or ""
        for qid in all_ids
    }
    case_studies = link_case_studies(questions, {k: v for k, v in backgrounds.items() if v})

    bank = {
        "questions": questions,
        "caseStudies": case_studies,
        "meta": {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "totalQuestions": len(questions),
            "sourceSplit": {
                "pdf": sum(1 for q in questions if q.source == "pdf"),
                "docx": sum(1 for q in questions if q.source == "docx"),
                "merged": sum(1 for q in questions if q.source == "merged"),
            },
        },
    }
    schema.write_json(schema.QUESTIONS, bank)
    summarise(questions, case_studies, pdf_records, docx_records)
    return 0


def summarise(
    questions: list[Question],
    case_studies: list[CaseStudy],
    pdf_records: dict[int, RawQuestion],
    docx_records: dict[int, RawQuestion],
) -> None:
    import collections

    comparable = [q for q in questions if pdf_records.get(q.id) and docx_records.get(q.id)]
    both_keyed = [
        q for q in comparable
        if pdf_records[q.id].correct and docx_records[q.id].correct
    ]
    disputed = [q for q in questions if q.answerDisagreement]
    rate = len(disputed) / len(both_keyed) if both_keyed else 0.0

    print(f"\nMerged {len(questions)} questions -> {schema.QUESTIONS}")
    print(f"  source split: {collections.Counter(q.source for q in questions)}")

    print("\n  CROSS-VALIDATION (the parser's report card):")
    print(f"    present in both sources        {len(comparable):>4}")
    print(f"    keyed in both sources          {len(both_keyed):>4}")
    print(f"    answer-key disagreements       {len(disputed):>4}  ({rate:.1%})")
    if rate > 0.05:
        print("    ALARM: above 5% — the parser is wrong, not the sources.")
    else:
        print("    Within prompt.md's 5% threshold.")
    for q in disputed[:8]:
        d = q.answerDisagreement or {}
        print(f"      q{q.id:<4} pdf={''.join(d['pdf'])} docx={''.join(d['docx'])}")

    print("\n  by type:")
    for qtype, n in collections.Counter(q.type for q in questions).most_common():
        graded = sum(1 for q in questions if q.type == qtype and not q.selfGraded)
        print(f"    {qtype:<12} {n:>4}   machine-graded {graded:>4}")

    print("\n  usability:")
    interactive = [q for q in questions if q.type.startswith("mcq") and q.options and q.correct]
    boxed = [q for q in questions if q.boxAnswers and not q.selfGraded]
    self_graded = [q for q in questions if q.selfGraded]
    broken = [q for q in questions if not q.options and not q.boxAnswers and not q.images]
    print(f"    fully interactive MCQ  {len(interactive):>4}")
    print(f"    graded box inputs      {len(boxed):>4}")
    print(f"    self-graded reveal     {len(self_graded):>4}")
    print(f"    no options/boxes/image {len(broken):>4}  {sorted(q.id for q in broken)[:20]}")

    print(f"\n  case studies: {len(case_studies)} parents covering "
          f"{sum(len(c.questionIds) for c in case_studies)} questions")
    print(f"  currency suspect: {sum(1 for q in questions if q.currency == 'suspect')}")
    print(f"  parseConfidence low: {sum(1 for q in questions if q.parseConfidence == 'low')}")


if __name__ == "__main__":
    raise SystemExit(main())
