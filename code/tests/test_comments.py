"""Tests for scut_telemetry.comments — structured comment parsing and serialization."""

from __future__ import annotations

import re
from datetime import datetime

import pytest

from scut_telemetry.comments import (
    add_comment,
    delete_comment,
    format_time_for_display,
    parse_comments,
    serialize_comments,
    split_note,
    update_comment,
)


# ── parse_comments ──────────────────────────────────────────────

def test_parse_empty():
    assert parse_comments("") == []
    assert parse_comments(None) == []


def test_parse_no_matches():
    assert parse_comments("just some free text") == []


def test_parse_single_entry():
    text = "[2026/5/13 14:30:00] Alice: hello world"
    result = parse_comments(text)
    assert len(result) == 1
    assert result[0].author == "Alice"
    assert result[0].text == "hello world"
    assert result[0].time == "2026/5/13 14:30:00"


def test_parse_multiple_entries():
    text = "[2026/5/13 14:30:00] Alice: first[2026/5/13 14:35:00] Bob: second"
    result = parse_comments(text)
    assert len(result) == 2
    assert result[0].author == "Alice"
    assert result[0].text == "first"
    assert result[1].author == "Bob"
    assert result[1].text == "second"


def test_parse_fullwidth_colon():
    text = "[2026/5/13 14:30:00] Alice：message with ：fullwidth"
    result = parse_comments(text)
    assert len(result) == 1
    assert result[0].author == "Alice"
    assert result[0].text == "message with ：fullwidth"


def test_parse_time_without_seconds():
    text = "[2026/5/13 14:30] Alice: short timestamp"
    result = parse_comments(text)
    assert len(result) == 1
    assert result[0].time == "2026/5/13 14:30"


def test_parse_trims_dangling_timestamp():
    # Simulated csv truncation: trailing bracket with partial timestamp
    text = "[2026/5/13 14:30:00] Alice: some text[2026/5/13 14:3"
    result = parse_comments(text)
    assert len(result) == 1
    assert result[0].author == "Alice"
    assert not result[0].text.endswith("[2026/5/13 14:3")


def test_parse_text_contains_brackets():
    text = "[2026/5/13 14:30:00] Alice: [important] check this"
    result = parse_comments(text)
    assert len(result) == 1
    assert "[important]" in result[0].text


def test_parse_author_with_spaces():
    text = "[2026/5/13 14:30:00] Zhang San: message here"
    result = parse_comments(text)
    assert len(result) == 1
    assert result[0].author == "Zhang San"


# ── split_note ───────────────────────────────────────────────────

def test_split_empty():
    prefix, comments = split_note("")
    assert prefix == ""
    assert comments == []


def test_split_no_header_only_text():
    prefix, comments = split_note("some free note text")
    assert prefix == "some free note text"
    assert comments == []


def test_split_with_header_no_comments():
    prefix, comments = split_note("prefix text--- 评论 ---")
    assert prefix == "prefix text"
    assert comments == []


def test_split_with_header_and_comments():
    text = "prefix text--- 评论 ---[2026/5/13 14:30:00] Alice: hello"
    prefix, comments = split_note(text)
    assert prefix == "prefix text"
    assert len(comments) == 1
    assert comments[0].author == "Alice"


def test_split_only_comments():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: hello"
    prefix, comments = split_note(text)
    assert prefix == ""
    assert len(comments) == 1


def test_split_comments_without_header():
    text = "[2026/5/13 14:30:00] Alice: hello"
    prefix, comments = split_note(text)
    assert prefix == ""
    assert len(comments) == 1
    assert comments[0].author == "Alice"


def test_split_multiline_prefix():
    text = "line1\nline2\n--- 评论 ---[2026/5/13 14:30:00] Alice: ok"
    prefix, comments = split_note(text)
    assert prefix == "line1\nline2"
    assert len(comments) == 1


# ── serialize_comments ───────────────────────────────────────────

def test_serialize_roundtrip():
    original = "my note--- 评论 ---[2026/5/13 14:30:00] Alice: hello[2026/5/13 14:35:00] Bob: world"
    prefix, comments = split_note(original)
    result = serialize_comments(prefix, comments)
    assert result == original


def test_serialize_prefix_only():
    result = serialize_comments("just a note", [])
    assert result == "just a note"


def test_serialize_comments_only():
    from scut_telemetry.comments import Comment

    comments = [Comment(author="Alice", text="hello", time="2026/5/13 14:30:00")]
    result = serialize_comments("", comments)
    assert result == "--- 评论 ---[2026/5/13 14:30:00] Alice: hello"


def test_serialize_both_empty():
    assert serialize_comments("", []) == ""


# ── add_comment ──────────────────────────────────────────────────

def test_add_to_empty():
    when = datetime(2026, 5, 13, 14, 30, 0)
    result = add_comment("", "Alice", "hello there", when=when)
    assert "Alice" in result
    assert "hello there" in result
    # datetime.strftime may zero-pad month/day — accept either format
    assert "2026/" in result


def test_add_prepends():
    text = "--- 评论 ---[2026/5/13 14:00:00] Bob: old message"
    when = datetime(2026, 5, 13, 15, 0, 0)
    result = add_comment(text, "Alice", "new message", when=when)
    # newest first
    idx_alice = result.find("Alice")
    idx_bob = result.find("Bob")
    assert idx_alice < idx_bob


def test_add_default_author():
    when = datetime(2026, 5, 13, 14, 30, 0)
    result = add_comment("", "", "text", when=when)
    assert "匿名: text" in result


def test_add_default_when():
    result = add_comment("", "Alice", "text")
    assert "Alice: text" in result


# ── update_comment ───────────────────────────────────────────────

def test_update_valid_index():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: original"
    result = update_comment(text, 0, "Alice", "modified")
    assert "modified" in result
    assert "original" not in result


def test_update_invalid_index():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: original"
    assert update_comment(text, 5, "X", "Y") == text
    assert update_comment(text, -1, "X", "Y") == text


def test_update_default_author():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: original"
    result = update_comment(text, 0, "", "modified")
    assert "匿名: modified" in result


# ── delete_comment ────────────────────────────────────────────────

def test_delete_valid():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: msg1[2026/5/13 14:35:00] Bob: msg2"
    result = delete_comment(text, 0)
    assert "Alice" not in result
    assert "Bob: msg2" in result


def test_delete_invalid():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: msg"
    assert delete_comment(text, 5) == text
    assert delete_comment(text, -1) == text


def test_delete_last_comment():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: only"
    result = delete_comment(text, 0)
    assert "Alice" not in result


# ── format_time_for_display ─────────────────────────────────────

def test_format_time_with_seconds():
    assert format_time_for_display("2026/5/13 14:30:00") == "2026-05-13 14:30"


def test_format_time_without_seconds():
    assert format_time_for_display("2026/5/13 14:30") == "2026-05-13 14:30"


def test_format_time_invalid():
    assert format_time_for_display("not a timestamp") == "not a timestamp"
