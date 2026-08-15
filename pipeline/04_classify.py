"""Stage 4 — assign skill area and subtopic.

Two passes, by design:

1. The auditable keyword table in `rules.py` decides everything it can defend.
2. Whatever it cannot separate is written to `pipeline/out/needs_review.json` for
   an LLM pass, whose answers are cached in `pipeline/out/classified.json` and
   merged back here.

The cache means the expensive pass runs once. Deleting it forces a re-run; the
rule pass alone is always deterministic.

    python pipeline/04_classify.py   ->  rewrites src/data/questions.json in place
"""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import rules  # noqa: E402
import schema  # noqa: E402

NEEDS_REVIEW = schema.OUT / "needs_review.json"

COMPILED = [
    (area, subtopic, weight, [re.compile(p, re.IGNORECASE) for p in patterns])
    for area, subtopic, weight, patterns in rules.RULES
]


def score(text: str) -> tuple[dict[str, int], dict[str, str]]:
    """Total score per skill area, plus the best-scoring subtopic for each."""
    totals: dict[str, int] = collections.defaultdict(int)
    best: dict[str, tuple[int, str]] = {}

    for area, subtopic, weight, patterns in COMPILED:
        hits = sum(1 for pattern in patterns if pattern.search(text))
        if not hits:
            continue
        points = hits * weight
        totals[area] += points
        if points > best.get(area, (0, ""))[0]:
            best[area] = (points, subtopic)

    return dict(totals), {area: subtopic for area, (_, subtopic) in best.items()}


def classify(question: dict) -> tuple[str | None, str, dict[str, int]]:
    """Return (skillArea or None if unresolved, subtopic, raw scores)."""
    text = " ".join(
        [
            question.get("stem", ""),
            " ".join(o.get("text", "") for o in question.get("options", [])),
            question.get("explanation", ""),
            " ".join(question.get("references", [])),
        ]
    )
    totals, subtopics = score(text)
    if not totals:
        return None, "", {}

    ranked = sorted(totals.items(), key=lambda kv: -kv[1])
    top_area, top_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0

    if top_score < rules.MIN_SCORE or (top_score - runner_up) < rules.MIN_MARGIN:
        return None, subtopics.get(top_area, ""), totals

    return top_area, subtopics.get(top_area, ""), totals


def main() -> int:
    if not schema.QUESTIONS.exists():
        sys.exit("No bank yet. Run stage 3 first.")

    bank = schema.read_json(schema.QUESTIONS)
    questions = bank["questions"]

    cached: dict[str, dict] = {}
    if schema.CLASSIFIED.exists():
        cached = {str(k): v for k, v in schema.read_json(schema.CLASSIFIED).items()}

    resolved = 0
    from_cache = 0
    unresolved: list[dict] = []

    for question in questions:
        area, subtopic, totals = classify(question)

        if area is None:
            hit = cached.get(str(question["id"]))
            if hit:
                area = hit["skillArea"]
                subtopic = hit.get("subtopic", subtopic)
                from_cache += 1
            else:
                unresolved.append(
                    {
                        "id": question["id"],
                        "type": question["type"],
                        "stem": question["stem"][:400],
                        "topScores": dict(sorted(totals.items(), key=lambda kv: -kv[1])[:3]),
                    }
                )
                # Hold the blueprint's dominant band rather than inventing a class.
                area = "extend-platform"
                subtopic = subtopic or "unclassified"
        else:
            resolved += 1

        question["skillArea"] = area
        question["subtopic"] = subtopic or "general"

    schema.write_json(schema.QUESTIONS, bank)
    if unresolved:
        schema.write_json(NEEDS_REVIEW, unresolved)

    summarise(questions, resolved, from_cache, unresolved)
    return 0


def summarise(questions: list[dict], resolved: int, from_cache: int, unresolved: list[dict]) -> None:
    total = len(questions)
    print(f"\nClassified {total} questions -> {schema.QUESTIONS}")
    print(f"  by keyword rules   {resolved:>4}  ({resolved / total:.0%})")
    print(f"  from LLM cache     {from_cache:>4}")
    print(f"  unresolved         {len(unresolved):>4}  -> {NEEDS_REVIEW.name}")
    if unresolved:
        print("     (holding at extend-platform until the LLM pass runs)")

    print("\n  distribution vs March 2026 blueprint:")
    counts = collections.Counter(q["skillArea"] for q in questions)
    for key, meta in schema.SKILL_AREAS.items():
        n = counts.get(key, 0)
        lo, hi = meta["band"]
        actual = 100 * n / total
        flag = "" if lo <= actual <= hi else "   <- off blueprint"
        print(f"    {key:<20} {n:>4}  {actual:5.1f}%   target {lo}-{hi}%{flag}")

    print("\n  top subtopics:")
    for subtopic, n in collections.Counter(q["subtopic"] for q in questions).most_common(10):
        print(f"    {n:>4}  {subtopic}")


if __name__ == "__main__":
    raise SystemExit(main())
