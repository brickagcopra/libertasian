"""Answer-quality evaluation harness for rag-service.

Everything here is stdlib + httpx and never imports from ``src`` — the harness
measures the service over HTTP, exactly as the NestJS gateway sees it, so it
must not share code (or bugs) with the thing it measures.
"""
