"""Opt-in integration test for the classify_one CLI.

Disabled by default. To run against a real LLM (NOT CI):

    CLASSIFY_CLI_ALLOW_REAL_LLM=1 \\
        CLASSIFY_CLI_DOC_ID=<uuid> \\
        uv run pytest tests/test_classify_one_cli.py -s

The test delegates to the same `classify_document_subjects` path as the
nightly beat task, so the raw-output instrumentation added in
classification_generation_tasks.py fires and its log lines become the
diagnostic. Document the finding in the PR description.
"""

from __future__ import annotations

import os

import pytest


_ENABLED = (
    os.environ.get("CLASSIFY_CLI_ALLOW_REAL_LLM") == "1"
    and bool(os.environ.get("CLASSIFY_CLI_DOC_ID"))
)


@pytest.mark.skipif(
    not _ENABLED,
    reason="Set CLASSIFY_CLI_ALLOW_REAL_LLM=1 and CLASSIFY_CLI_DOC_ID=<uuid> to enable.",
)
def test_classify_one_against_real_llm(caplog: pytest.LogCaptureFixture) -> None:
    from src.tasks.classification_generation_tasks import classify_document_subjects

    doc_id = os.environ["CLASSIFY_CLI_DOC_ID"]

    with caplog.at_level("INFO"):
        result = classify_document_subjects.run(doc_id)

    # The instrumentation in classify_document_subjects MUST produce at least
    # one line beginning with "classify_document_subjects doc=" before the
    # validator runs — regardless of success/failure. If this fails, the
    # operator no longer has diagnostic logs, which defeats the fix.
    assert any(
        "classify_document_subjects doc=" in rec.getMessage() for rec in caplog.records
    ), "Instrumentation log is missing"

    assert result["status"] in {"completed", "abstained", "failed"}
