"""Phase 1 checkpoint report.

Prints exactly what `prompt.md` asks for before any UI is built. Reports problems
rather than hiding them: if the bank is in poor shape this should say so plainly.

Run after stage 4:  python pipeline/validate.py
"""

from __future__ import annotations

import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows consoles default to cp1252; question text contains typographic marks.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import schema  # noqa: E402
from schema import SKILL_AREAS, TOTAL_QUESTIONS, Question  # noqa: E402

BAR = "─" * 78

#: prompt.md's own threshold: above this, the parser is wrong, not the sources.
DISAGREEMENT_ALARM = 0.05

#: The four ids prompt.md claims are unrecoverable. They are not — report them by name.
DISPUTED_IDS = (12, 259, 403, 408)


def heading(title: str) -> None:
    print(f"\n{BAR}\n{title}\n{BAR}")


def pct(n: int, total: int) -> str:
    return f"{100 * n / total:5.1f}%" if total else "    —"


def load() -> tuple[list[Question], list[dict], dict]:
    if not schema.QUESTIONS.exists():
        sys.exit(f"No bank at {schema.QUESTIONS}. Run stages 1-4 first.")
    bank = schema.read_json(schema.QUESTIONS)
    questions = []
    for record in bank["questions"]:
        record = dict(record)
        record["options"] = [schema.Option(**o) for o in record.get("options", [])]
        record["boxAnswers"] = [schema.BoxAnswer(**b) for b in record.get("boxAnswers", [])]
        questions.append(Question(**record))
    return questions, bank.get("caseStudies", []), bank.get("meta", {})


def report_coverage(questions: list[Question]) -> None:
    heading("COVERAGE")
    ids = {q.id for q in questions}
    missing = sorted(set(range(1, TOTAL_QUESTIONS + 1)) - ids)

    print(f"Parsed:  {len(questions)} of {TOTAL_QUESTIONS}   ({pct(len(questions), TOTAL_QUESTIONS)})")
    if missing:
        print(f"MISSING ({len(missing)}): {missing}")
    else:
        print("No gaps. Every id from 1 to 440 is present.")

    print("\nThe four ids prompt.md calls unrecoverable:")
    for qid in DISPUTED_IDS:
        q = next((x for x in questions if x.id == qid), None)
        if q is None:
            print(f"  q{qid:<4} ABSENT — prompt.md was right about this one")
        else:
            print(
                f"  q{qid:<4} present  source={q.source:<6} type={q.type:<10} "
                f"stem={len(q.stem)}ch options={len(q.options)} images={len(q.images)}"
            )


def report_sources(questions: list[Question]) -> None:
    heading("SOURCE SPLIT AND PARSER AGREEMENT")
    split = collections.Counter(q.source for q in questions)
    for src, n in sorted(split.items()):
        print(f"  {src:<8} {n:>4}  {pct(n, len(questions))}")

    disputed = [q for q in questions if q.answerDisagreement]
    comparable = [q for q in questions if q.source == "merged"]
    rate = len(disputed) / len(comparable) if comparable else 0.0

    print(f"\nQuestions present in both sources: {len(comparable)}")
    print(f"Answer-key disagreements:          {len(disputed)}  ({rate:.1%})")

    if not comparable:
        print("\n  Nothing cross-validated — the merge did not run as intended.")
    elif rate > DISAGREEMENT_ALARM:
        print(
            f"\n  ALARM: above the {DISAGREEMENT_ALARM:.0%} threshold.\n"
            "  Per prompt.md this means the PARSER is wrong, not the sources.\n"
            "  Fix the parser before building on this data."
        )
    else:
        print("  Within threshold — the two independent parses corroborate each other.")

    for q in disputed[:10]:
        d = q.answerDisagreement or {}
        print(f"    q{q.id:<4} pdf={''.join(d.get('pdf', []))!r:<8} docx={''.join(d.get('docx', []))!r}")
    if len(disputed) > 10:
        print(f"    … and {len(disputed) - 10} more")


def report_breakdown(questions: list[Question]) -> None:
    heading("BREAKDOWN BY TYPE")
    by_type = collections.Counter(q.type for q in questions)
    for typ, n in sorted(by_type.items(), key=lambda kv: -kv[1]):
        graded = sum(1 for q in questions if q.type == typ and not q.selfGraded)
        print(f"  {typ:<12} {n:>4}  {pct(n, len(questions))}   machine-graded: {graded:>3}")

    self_graded = [q for q in questions if q.selfGraded]
    print(f"\nSelf-graded (image answer, no parseable boxes): {len(self_graded)}")
    print("  These are the weakest cards in the bank. Nothing in the parser fixes")
    print("  them — the answers exist only as pixels.")

    heading("BREAKDOWN BY SKILL AREA")
    print("  The bank's own mix need not match the blueprint — the simulator samples")
    print("  TO the blueprint. What matters here is that each area has a deep enough")
    print("  pool to sample from without repeating questions.")
    by_area = collections.Counter(q.skillArea for q in questions)
    #: A 60-question paper at the top of the band, times three so a full mock can be
    #: sat repeatedly without recycling the same items.
    print(f"\n  {'key':<20} {'n':>4}  {'bank':>7}  {'blueprint':>10}  pool")
    for key, meta in SKILL_AREAS.items():
        n = by_area.get(key, 0)
        lo, hi = meta["band"]
        actual = 100 * n / len(questions) if questions else 0
        needed = round(60 * hi / 100) * 3
        pool = "ok" if n >= needed else f"thin (want {needed})"
        print(f"  {key:<20} {n:>4}  {actual:6.1f}%  {lo:>4}-{hi:<3}%  {pool}")

    unknown = set(by_area) - set(SKILL_AREAS)
    if unknown:
        print(f"\n  Unknown skill areas present: {sorted(unknown)}")


def report_quality(questions: list[Question], case_studies: list[dict]) -> None:
    heading("DATA QUALITY")
    low = [q for q in questions if q.parseConfidence == "low"]
    suspect = [q for q in questions if q.currency == "suspect"]
    superseded = [q for q in questions if q.currency == "superseded"]
    no_expl = [q for q in questions if not q.explanation.strip()]
    no_ref = [q for q in questions if not q.references]

    print(f"  parseConfidence=low     {len(low):>4}  {pct(len(low), len(questions))}")
    print(f"  currency=suspect        {len(suspect):>4}  {pct(len(suspect), len(questions))}")
    print(f"  currency=superseded     {len(superseded):>4}  {pct(len(superseded), len(questions))}")
    print(f"  no explanation          {len(no_expl):>4}")
    print(f"  no reference link       {len(no_ref):>4}")
    print(f"  case studies            {len(case_studies):>4} parents covering "
          f"{sum(len(cs.get('questionIds', [])) for cs in case_studies)} questions")

    if low:
        print(f"\n  Low-confidence ids: {sorted(q.id for q in low)}")
        for q in low[:5]:
            print(f"    q{q.id}: {'; '.join(q.parseNotes) or 'no reason recorded'}")


def report_images(questions: list[Question]) -> None:
    heading("IMAGE ASSOCIATION SPOT-CHECK")
    missing: list[str] = []
    tiny: list[str] = []
    for q in questions:
        for rel in q.images:
            path = schema.IMAGES / Path(rel).name
            if not path.exists():
                missing.append(f"q{q.id}: {rel}")
            elif path.stat().st_size < schema.MIN_IMAGE_BYTES:
                tiny.append(f"q{q.id}: {rel} ({path.stat().st_size}B)")

    print(f"  Broken image references:      {len(missing)}")
    print(f"  Sub-5KB decorative as content:{len(tiny)}")
    for row in (missing + tiny)[:10]:
        print(f"    {row}")

    print("\n  Five HOTSPOT questions and their attached images — confirm the")
    print("  off-by-one heading anchor was corrected in the right direction:")
    hotspots = [q for q in questions if q.type == "hotspot" and q.images][:5]
    for q in hotspots:
        print(f"\n    q{q.id}  pages={q.sourcePages}  boxes={len(q.boxAnswers)}")
        print(f"      stem: {q.stem[:100].strip()}…")
        for img in q.images:
            print(f"      img:  {img}")


def report_verdict(questions: list[Question]) -> None:
    heading("VERDICT — HOW MUCH OF THE BANK IS ACTUALLY USABLE")
    problems = schema.validate(questions)

    interactive = [q for q in questions if q.type in ("mcq-single", "mcq-multi") and q.options and q.correct]
    boxed = [q for q in questions if q.boxAnswers and not q.selfGraded]
    self_graded = [q for q in questions if q.selfGraded]
    # Dead end = nothing to answer with AND nothing to reveal. An explanation alone
    # still makes a usable self-graded card, so it does not count as broken.
    broken = [
        q for q in questions
        if not q.options and not q.boxAnswers and not q.images and not q.explanation.strip()
    ]

    total = len(questions)
    print(f"  Fully interactive (MCQ, graded)      {len(interactive):>4}  {pct(len(interactive), total)}")
    print(f"  Graded box inputs (hotspot/dragdrop) {len(boxed):>4}  {pct(len(boxed), total)}")
    print(f"  Self-graded reveal only              {len(self_graded):>4}  {pct(len(self_graded), total)}")
    print(f"  Dead ends (nothing to reveal)        {len(broken):>4}  {pct(len(broken), total)}")
    if broken:
        print(f"    ids: {sorted(q.id for q in broken)}")

    print(f"\n  Schema violations: {len(problems)}")
    for p in problems[:20]:
        print(f"    {p}")
    if len(problems) > 20:
        print(f"    … and {len(problems) - 20} more")

    drillable = len(interactive) + len(boxed)
    print(
        f"\n  Actively drillable today: {drillable} of {total} ({pct(drillable, total).strip()}).\n"
        f"  Passive review only:      {len(self_graded)}.\n"
        f"  Needs manual repair:      {len(broken)}."
    )
    return None


def main() -> int:
    questions, case_studies, meta = load()
    print(f"\nPL-400 bank generated {meta.get('generatedAt', 'unknown')}")
    report_coverage(questions)
    report_sources(questions)
    report_breakdown(questions)
    report_quality(questions, case_studies)
    report_images(questions)
    report_verdict(questions)
    print(f"\n{BAR}\n")
    return 1 if schema.validate(questions) else 0


if __name__ == "__main__":
    raise SystemExit(main())
