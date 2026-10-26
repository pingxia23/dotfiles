#!/usr/bin/env python3
"""Build a digest page from a content fragment written by the create-digest skill.

Usage: build_digest.py CONTENT.html -o OUT.html

The script checks the fragment against assets/example-content.html, numbers the
topics, adds badges, the "At a glance" overview, the filter toolbar and read
times, and wraps everything in assets/template.html. It prints the overview as
plain text for the chat reply. It exits with status 1 and writes nothing when a
required part is missing.
"""

import argparse
import html
import math
import re
import sys
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "template.html"
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
VISUAL_CLASSES = {"flow", "steps", "stats", "bars", "split", "voices", "diagram", "figure"}
EVIDENCE = {
    "measured": "Measured",
    "benchmark": "Benchmark",
    "vendor-claim": "Vendor claim",
    "anecdote": "Anecdote",
    "opinion": "Opinion",
    "proposal": "Proposal",
    "mixed": "Mixed evidence",
}
WORDS_PER_MINUTE = 220
MAX_TLDR_WORDS = 30


@dataclass
class Topic:
    attrs: dict
    start_tag_end: int
    title: str = ""
    tldr: str = ""
    parts: set = field(default_factory=set)
    h2_start_tag_end: int | None = None
    h2_end: int | None = None
    summary_insert: int | None = None
    words: int = 0
    deep_words: int = 0
    visuals: int = 0
    action: bool = False

    @property
    def tags(self) -> list[str]:
        return [t.strip().lower() for t in self.attrs.get("data-tags", "").split(",") if t.strip()]


class Scanner(HTMLParser):
    def __init__(self, src: str):
        super().__init__(convert_charrefs=True)
        self.src = src
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", src)]
        self.stack: list[tuple[str, set]] = []
        self.title = ""
        self.has_scope = False
        self.has_coverage = False
        self.topics: list[Topic] = []
        self.first_topic_start: int | None = None
        self.cur: Topic | None = None

    def _offset(self) -> int:
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def _inside(self, tag: str, cls: str | None = None) -> bool:
        return any(t == tag and (cls is None or cls in c) for t, c in self.stack)

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        cls = set(a.get("class", "").split())
        pos = self._offset()
        tag_end = pos + len(self.get_starttag_text())
        if tag == "article" and "topic" in cls:
            self.cur = Topic(attrs=a, start_tag_end=tag_end)
            if self.first_topic_start is None:
                self.first_topic_start = pos
        elif self.cur is None:
            self.has_scope |= tag == "p" and "scope" in cls
            self.has_coverage |= tag == "details" and "coverage" in cls
        else:
            t = self.cur
            if tag == "h2" and t.h2_start_tag_end is None:
                t.h2_start_tag_end = tag_end
            if tag == "section":
                t.parts |= cls & {"why", "takeaway"}
            if tag == "details" and "deep" in cls:
                t.parts.add("deep")
            if tag == "summary" and self._inside("details", "deep") and t.summary_insert is None:
                t.summary_insert = pos + len("<summary")
            if self._inside("details", "deep") and (cls & VISUAL_CLASSES or tag in {"table", "svg"}):
                t.visuals += 1
            t.action |= "callout" in cls and "action" in cls
        if tag not in VOID_TAGS:
            self.stack.append((tag, cls))

    def handle_endtag(self, tag):
        if tag in VOID_TAGS or not any(t == tag for t, _ in self.stack):
            return
        while self.stack.pop()[0] != tag:
            pass
        if self.cur is None:
            return
        if tag == "h2" and self.cur.h2_end is None:
            self.cur.h2_end = self.src.index(">", self._offset()) + 1
        if tag == "article":
            self.topics.append(self.cur)
            self.cur = None

    def handle_data(self, data):
        if self.cur is None:
            if self._inside("h1"):
                self.title += data
            return
        t = self.cur
        n = len(data.split())
        t.words += n
        if self._inside("h2"):
            t.title += data
        if self._inside("p", "tldr"):
            t.tldr += data
        if self._inside("details", "deep"):
            t.deep_words += n


def check(scan: Scanner, src: str) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    if not scan.title.strip():
        errors.append("page: missing <h1> title")
    if not scan.has_scope:
        errors.append('page: missing <p class="scope"> line')
    if not scan.has_coverage:
        errors.append('page: missing <details class="coverage"> block')
    if not scan.topics:
        errors.append("page: no <article class=\"topic\">; for an empty result return the empty-result text instead")
    if re.search(r">\s*What to do\s*<", src):
        errors.append('page: remove the "What to do" section')
    for i, t in enumerate(scan.topics, 1):
        name = f"topic {i} ({' '.join(t.title.split())[:50] or 'untitled'})"
        if not t.title.strip() or t.h2_end is None:
            errors.append(f"{name}: missing <h2> title")
        if not t.tldr.strip():
            errors.append(f'{name}: missing <p class="tldr">')
        elif len(t.tldr.split()) > MAX_TLDR_WORDS:
            warnings.append(f"{name}: tldr has {len(t.tldr.split())} words; keep it under {MAX_TLDR_WORDS}")
        for part, markup in (("why", '<section class="why">'), ("takeaway", '<section class="takeaway">'),
                             ("deep", '<details class="deep">')):
            if part not in t.parts:
                errors.append(f"{name}: missing {markup}")
        if "deep" in t.parts and t.summary_insert is None:
            errors.append(f'{name}: <details class="deep"> needs a <summary>')
        if not t.tags:
            errors.append(f"{name}: missing data-tags")
        if t.attrs.get("data-evidence") not in EVIDENCE:
            errors.append(f"{name}: data-evidence must be one of {', '.join(EVIDENCE)}")
        if "deep" in t.parts and t.visuals == 0:
            warnings.append(f"{name}: the deep dive has no visual component")
    return errors, warnings


def minutes(words: int) -> int:
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


def build(scan: Scanner, src: str) -> str:
    inserts: list[tuple[int, str]] = []
    cards, tag_counts = [], {}
    for i, t in enumerate(scan.topics, 1):
        tid = t.attrs.get("id") or f"t{i}"
        if "id" not in t.attrs:
            inserts.append((t.start_tag_end - 1, f' id="{tid}"'))
        inserts.append((t.h2_start_tag_end - 1, f' data-n="{i}"'))
        ev = t.attrs["data-evidence"]
        badges = [f'<span class="ev ev-{ev}">{EVIDENCE[ev]}</span>']
        badges += [f"<span>{html.escape(tag)}</span>" for tag in t.tags]
        if t.action:
            badges.append('<span class="act">Action for you</span>')
        badges.append(f"<span>{minutes(t.words)} min read</span>")
        inserts.append((t.h2_end, f'\n<div class="badges">{"".join(badges)}</div>'))
        inserts.append((t.summary_insert, f' data-read="{minutes(t.deep_words)} min read"'))
        for tag in t.tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
        meta = " · ".join([EVIDENCE[ev], *t.tags, f"{minutes(t.words)} min"])
        cards.append(
            f'<a class="card{" has-action" if t.action else ""}" href="#{tid}">'
            f'<span class="num">{i}</span><span class="ctitle">{html.escape(" ".join(t.title.split()))}</span>'
            f'<span class="ctldr">{html.escape(" ".join(t.tldr.split()))}</span>'
            f'<span class="cmeta">{html.escape(meta)}</span></a>'
        )
    chips = ['<button class="chip" data-tag="*" aria-pressed="true">All</button>']
    chips += [
        f'<button class="chip" data-tag="{html.escape(tag)}" aria-pressed="false">{html.escape(tag)} ({n})</button>'
        for tag, n in sorted(tag_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    nav = (
        '<div class="toolbar"><input id="q" type="search" placeholder="Search topics" aria-label="Search topics">'
        f'{"".join(chips)}<span id="count"></span>'
        '<button id="expand">Expand all</button><button id="collapse">Collapse all</button></div>\n'
        '<nav class="overview" aria-label="Topics"><h2>At a glance</h2>'
        f'<div class="cards">{"".join(cards)}</div></nav>\n'
    )
    inserts.append((scan.first_topic_start, nav))
    body = src
    for pos, text in sorted(inserts, key=lambda p: p[0], reverse=True):
        body = body[:pos] + text + body[pos:]
    page = TEMPLATE.read_text()
    return page.replace("{{TITLE}}", html.escape(" ".join(scan.title.split()))).replace("{{BODY}}", body)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("content", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()
    src = args.content.read_text()
    scan = Scanner(src)
    scan.feed(src)
    scan.close()
    errors, warnings = check(scan, src)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"error: {e}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build(scan, src))
    print(f"Digest page: {args.output.resolve()}")
    for i, t in enumerate(scan.topics, 1):
        print(f"{i}. {' '.join(t.title.split())} — {' '.join(t.tldr.split())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
