#!/usr/bin/env python3
"""Word count and keyword-density helper for the seo-research skill.

Reads extracted main text (file or stdin) and prints JSON.
Does not fetch URLs. Strip nav/footer before passing text in.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter


WORD_RE = re.compile(r"[A-Za-z0-9]+(?:,[0-9]+)*(?:['-][A-Za-z0-9]+)*")


def tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in WORD_RE.finditer(text)]


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def phrase_pattern(phrase: str) -> re.Pattern[str]:
    """Match a multi-word phrase with flexible hyphen/space boundaries."""
    words = [re.escape(w) for w in tokenize(phrase)]
    if not words:
        return re.compile(r"(?!x)x")
    # "mini split" also matches mini-split and mini–split
    joiner = r"[\s\-–—]+"
    return re.compile(rf"\b{joiner.join(words)}\b", re.I)


def count_phrase(text: str, phrase: str) -> int:
    return len(phrase_pattern(phrase).findall(text))


def density(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return round((count / words) * 100.0, 2)


def ngrams(tokens: list[str], n: int) -> Counter[str]:
    return Counter(" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1))


def main() -> int:
    p = argparse.ArgumentParser(description="Count words and keyword density.")
    p.add_argument("--keyword", required=True, help="Primary phrase")
    p.add_argument("--file", help="UTF-8 text file. Defaults to stdin.")
    p.add_argument(
        "--variant",
        action="append",
        default=[],
        help="Extra phrase to count. Repeatable.",
    )
    p.add_argument("--top", type=int, default=15, help="Top n-grams to include")
    args = p.parse_args()

    if args.file:
        with open(args.file, encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    else:
        raw = sys.stdin.read()

    text = normalize_space(raw)
    tokens = tokenize(text)
    word_count = len(tokens)
    primary_count = count_phrase(text, args.keyword)

    variants = []
    seen = {args.keyword.lower()}
    for phrase in args.variant:
        key = phrase.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        c = count_phrase(text, phrase)
        variants.append(
            {"phrase": phrase, "count": c, "density_pct": density(c, word_count)}
        )

    top_ngrams = {}
    for n in (1, 2, 3):
        ranked = [
            {"phrase": k, "count": v}
            for k, v in ngrams(tokens, n).most_common(args.top)
            if v >= 2
        ]
        top_ngrams[f"{n}gram"] = ranked

    out = {
        "word_count": word_count,
        "char_count": len(text),
        "primary": {
            "phrase": args.keyword,
            "count": primary_count,
            "density_pct": density(primary_count, word_count),
        },
        "variants": variants,
        "top_ngrams": top_ngrams,
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
