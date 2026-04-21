"""Diagnostic CLI — classify a single document against the real LLM.

Usage (from services/worker-service/):
    CLASSIFY_CLI_ALLOW_REAL_LLM=1 \\
        uv run python -m src.scripts.classify_one <document_id>

The guard env var is a deliberate safety so operators don't accidentally
hit the LLM from a dev shell. The script runs the exact `classify_document_subjects`
task body, so the instrumentation added in classification_generation_tasks.py
(raw output preview + parsed-shape log) fires and prints to stderr.

This is intended to reproduce the nightly-batch validation failure
offline against a single known document_id so the actual LLM response
shape can be inspected directly.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from ..tasks.classification_generation_tasks import classify_document_subjects


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run classify_document_subjects against a single document. "
        "Requires CLASSIFY_CLI_ALLOW_REAL_LLM=1 to actually call the LLM.",
    )
    parser.add_argument("document_id", help="UUID of a legal_document row.")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    if os.environ.get("CLASSIFY_CLI_ALLOW_REAL_LLM") != "1":
        print(
            "Refusing to run: set CLASSIFY_CLI_ALLOW_REAL_LLM=1 to acknowledge "
            "that this will make a real LLM call against RAG_SERVICE_URL.",
            file=sys.stderr,
        )
        return 2

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    result = classify_document_subjects.run(args.document_id)
    json.dump(result, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0 if result.get("status") in ("completed", "abstained") else 1


if __name__ == "__main__":
    sys.exit(main())
