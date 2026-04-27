"""Canonical input → expected normalized output fixture.

Drift mitigation: this same dict is committed independently in
services/worker-service/tests/citations/fixtures.py. If either
service's regex set drifts, that service's parity test fails in CI.
"""

from __future__ import annotations

# (label, input_text, expected_normalized_set)
PARITY_CASES: list[tuple[str, str, set[str]]] = [
    (
        "gr_standard",
        "The ruling in G.R. No. 123456 is binding precedent.",
        {"G.R. No. 123456"},
    ),
    (
        "ra_with_word",
        "Republic Act No. 9165 governs dangerous drugs.",
        {"R.A. No. 9165"},
    ),
    (
        "am_admin_matter",
        "A.M. No. 02-11-10 outlines the rules.",
        {"A.M. No. 02-11-10"},
    ),
    (
        "pd_decree",
        "Presidential Decree No. 1606 created the Sandiganbayan.",
        {"P.D. No. 1606"},
    ),
    (
        "bp_blg",
        "B.P. Blg. 22 penalises bouncing checks.",
        {"B.P. Blg. 22"},
    ),
    (
        "scra_reporter",
        "Cited in 123 SCRA 456 as authority.",
        {"123 SCRA 456"},
    ),
    (
        "phil_reports",
        "See 89 Phil. 100 for the leading case.",
        {"89 Phil. 100"},
    ),
    (
        "mixed_block",
        (
            "G.R. No. 200000 affirmed Republic Act No. 7610 and "
            "P.D. No. 1083, citing 200 SCRA 100."
        ),
        {
            "G.R. No. 200000",
            "R.A. No. 7610",
            "P.D. No. 1083",
            "200 SCRA 100",
        },
    ),
]
