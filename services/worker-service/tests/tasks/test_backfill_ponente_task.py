"""Regression tests for the ponente backfill SQL escaping.

PR #164 shipped a backfill task whose `_BAD_PONENTE_SQL` contained literal
`%` characters from ILIKE patterns. When psycopg2's `cursor.execute(sql,
params)` is called with a non-empty params tuple, every `%` in the SQL is
treated as a positional placeholder unless escaped as `%%`. The original
constant had 10 unescaped patterns and only 1–2 actual placeholders
(`%s`), so psycopg2 ran out of params and raised
`IndexError: tuple index out of range`.

These tests pin the escape rule so a future edit cannot regress it.
"""

from __future__ import annotations

import re

from src.tasks.backfill_ponente_task import _BAD_PONENTE_SQL


def test_bad_ponente_sql_has_no_unescaped_percent() -> None:
    """Every literal `%` in ILIKE patterns must be doubled to `%%`.

    psycopg2 interprets bare `%` as positional placeholders. The constant
    itself contains no `%s` markers — those live in the surrounding
    f-string — so any single `%` here would collide with the param tuple.
    """
    single_pct = re.findall(r"(?<!%)%(?!%)", _BAD_PONENTE_SQL)
    assert single_pct == [], (
        f"unescaped % in _BAD_PONENTE_SQL: {single_pct!r}"
    )


def test_full_query_param_count_matches_after_id_and_limit() -> None:
    """The full f-string wrapper around _BAD_PONENTE_SQL must parse under
    Python's % operator with exactly the param shape `_fetch_candidate_batch`
    builds — (after_id, limit) or (limit,). If the inner constant has
    unescaped `%`, Python's % operator raises the same way psycopg2 does.
    """
    after_clause = "AND id > %s"
    sql_with_after = f"""
        SELECT id, ponente FROM legal_documents
        WHERE {_BAD_PONENTE_SQL}
        {after_clause}
        ORDER BY id ASC LIMIT %s
    """
    sql_no_after = f"""
        SELECT id, ponente FROM legal_documents
        WHERE {_BAD_PONENTE_SQL}
        ORDER BY id ASC LIMIT %s
    """
    # Should not raise TypeError / IndexError.
    sql_with_after % ("some-uuid", 100)
    sql_no_after % (100,)
