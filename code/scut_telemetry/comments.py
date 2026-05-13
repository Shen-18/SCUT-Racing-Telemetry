"""Structured comment parsing and serialization for telemetry files.

CSV-stored format (matches files exported from RaceStudio-style tools):
    --- 评论 ---[YYYY/M/D HH:MM:SS] 用户名: 文本[YYYY/M/D HH:MM:SS] 用户名: 文本...

We parse this back into a list of Comment(author, text, time) records and
serialize it back to the same on-disk shape so existing files round-trip.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime


COMMENT_HEADER = "--- 评论 ---"

# A single comment entry: [time] author: text  (text may include other [..] tokens)
_ENTRY_RE = re.compile(
    r"\[(?P<time>\d{4}/\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]\s*"
    r"(?P<author>[^:：\n]+?)\s*[:：]\s*"
)


@dataclass
class Comment:
    author: str
    text: str
    time: str  # raw timestamp string as stored in CSV (preserves the original format)

    def time_dt(self) -> datetime | None:
        for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
            try:
                return datetime.strptime(self.time, fmt)
            except ValueError:
                continue
        return None


def parse_comments(text: str) -> list[Comment]:
    """Extract structured comments from a free-form note string."""
    if not text:
        return []
    matches = list(_ENTRY_RE.finditer(text))
    if not matches:
        return []
    out: list[Comment] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end():end].strip()
        # Trim trailing dangling time prefix that the CSV truncates (e.g. "[2026/4/30 16:38")
        body = re.sub(r"\[\d{4}/\d{1,2}/\d{1,2}\s+\d{1,2}:\d{0,2}$", "", body).rstrip()
        out.append(Comment(author=m.group("author").strip(), text=body, time=m.group("time").strip()))
    return out


def split_note(text: str) -> tuple[str, list[Comment]]:
    """Return (free_note_prefix, comments). The prefix is everything before the
    first `--- 评论 ---` block (trimmed); comments are parsed from the rest."""
    if not text:
        return "", []
    idx = text.find(COMMENT_HEADER)
    if idx < 0:
        # No header; if any structured entries are present, treat them as comments.
        comments = parse_comments(text)
        if comments:
            # Strip parsed segments from prefix.
            first_match = _ENTRY_RE.search(text)
            prefix = text[: first_match.start()].strip() if first_match else ""
            return prefix, comments
        return text.strip(), []
    prefix = text[:idx].strip()
    rest = text[idx + len(COMMENT_HEADER):]
    return prefix, parse_comments(rest)


def serialize_comments(prefix: str, comments: list[Comment]) -> str:
    """Render (prefix, comments) back into the on-disk note format."""
    body_parts: list[str] = []
    if prefix:
        body_parts.append(prefix.strip())
    if comments:
        rendered = COMMENT_HEADER + "".join(
            f"[{c.time}] {c.author}: {c.text}" for c in comments
        )
        body_parts.append(rendered)
    return "".join(body_parts) if body_parts else ""


def update_comment(existing: str, index: int, author: str, text: str) -> str:
    """Update one parsed comment by index, preserving its stored timestamp."""
    prefix, comments = split_note(existing)
    if index < 0 or index >= len(comments):
        return existing
    comments[index] = Comment(
        author=author.strip() or "匿名",
        text=text.strip(),
        time=comments[index].time,
    )
    return serialize_comments(prefix, comments)


def delete_comment(existing: str, index: int) -> str:
    """Delete one parsed comment by index."""
    prefix, comments = split_note(existing)
    if index < 0 or index >= len(comments):
        return existing
    del comments[index]
    return serialize_comments(prefix, comments)


def add_comment(existing: str, author: str, text: str, when: datetime | None = None) -> str:
    """Append a new comment to the existing note text and return updated text.
    Newest comment goes to the front (matches the sample file's ordering)."""
    when = when or datetime.now()
    prefix, comments = split_note(existing)
    new = Comment(
        author=author.strip() or "匿名",
        text=text.strip(),
        time=when.strftime("%Y/%m/%d %H:%M:%S"),
    )
    return serialize_comments(prefix, [new] + comments)


def format_time_for_display(time_str: str) -> str:
    """Human-friendlier rendering of the raw timestamp."""
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            dt = datetime.strptime(time_str, fmt)
            return dt.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue
    return time_str
