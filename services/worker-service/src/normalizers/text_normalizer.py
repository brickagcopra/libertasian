"""LIBERTASIAN Worker Service — Text normalization for legal documents.

Pure functions for normalizing Philippine legal text, citations, and
computing deduplication keys. Per CLAUDE.md: normalize "G.R. No." variations
to canonical format.
"""

import hashlib
import re


def normalize_whitespace(text: str) -> str:
    """Collapse whitespace and normalize line breaks.

    - Replaces \\r\\n and \\r with \\n
    - Collapses multiple blank lines to single blank line
    - Strips trailing whitespace from each line
    - Strips leading/trailing whitespace from the full text
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse runs of whitespace (not newlines) to single space
    text = re.sub(r"[^\S\n]+", " ", text)
    # Strip trailing spaces per line
    text = re.sub(r" +\n", "\n", text)
    # Collapse 3+ consecutive newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_gr_no(text: str) -> str:
    """Normalize G.R. No. variations to canonical 'G.R. No. XXXXXX' format.

    Per CLAUDE.md: strip whitespace, normalize "G.R. No." variations
    (GR, G.R., GRN) to canonical G.R. No. XXXXXX format.
    """
    # Match common variations: GR, G.R., GR., GRN, G.R. No., GR No., etc.
    pattern = r"(?i)\bG\.?\s*R\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"
    return re.sub(pattern, lambda m: f"G.R. No. {m.group(1)}", text)


def normalize_citation(text: str) -> str:
    """Normalize a Philippine legal citation string.

    - Strips excess whitespace
    - Normalizes G.R. No. format
    - Normalizes A.M. No., A.C. No., R.A. No. patterns
    """
    text = normalize_whitespace(text)
    text = normalize_gr_no(text)

    # Normalize A.M. No. variations
    text = re.sub(
        r"(?i)\bA\.?\s*M\.?\s*(?:No\.?\s*)?(\d[\d\-]+)",
        lambda m: f"A.M. No. {m.group(1)}",
        text,
    )

    # Normalize A.C. No. variations
    text = re.sub(
        r"(?i)\bA\.?\s*C\.?\s*(?:No\.?\s*)?(\d[\d\-]+)",
        lambda m: f"A.C. No. {m.group(1)}",
        text,
    )

    # Normalize R.A. No. variations
    text = re.sub(
        r"(?i)\bR\.?\s*A\.?\s*(?:No\.?\s*)?(\d[\d\-]+)",
        lambda m: f"R.A. No. {m.group(1)}",
        text,
    )

    return text.strip()


def compute_similarity_key(
    title: str | None,
    citation: str | None,
    date: str | None,
) -> str:
    """Compute a SHA-256 deduplication key from normalized fields.

    Used on ingestion_candidates.similarity_key to detect duplicates
    across fetches from different endpoints.
    """
    parts = [
        normalize_whitespace(title).lower() if title else "",
        normalize_citation(citation).lower() if citation else "",
        (date or "").strip(),
    ]
    combined = "|".join(parts)
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def compute_content_checksum(content: bytes) -> str:
    """Compute SHA-256 checksum of raw content bytes.

    Used on legal_documents.checksum for content-level deduplication.
    """
    return hashlib.sha256(content).hexdigest()
