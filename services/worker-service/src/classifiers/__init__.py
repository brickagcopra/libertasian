"""LIBERTASIAN Worker Service — Classifiers package.

Contains classification logic for the ingestion pipeline:
- dedup_classifier: 5-tier duplicate detection and classification
"""

from .dedup_classifier import DedupClassifier, DedupResult, DedupTier

__all__ = ["DedupClassifier", "DedupResult", "DedupTier"]
