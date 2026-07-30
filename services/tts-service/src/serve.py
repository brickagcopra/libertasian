"""Entrypoint that sizes uvicorn to the resolved device.

The CPU image starts uvicorn from the shell with `--workers ${TTS_WORKERS:-2}`,
which cannot know what device the model will land on — the worker count is fixed
before any of the resolution in src/device.py happens. That is fine on a box with
no GPU and wrong on one with a card, where the right answer is ONE process owning
it.

This module resolves first and then launches, so `TTS_WORKERS` becomes an
override rather than a requirement. Used by the GPU image; the CPU image keeps
its shell CMD unchanged.
"""

import logging
import os

import uvicorn

from .device import cuda_available, device_name, effective_workers, resolve_device

logger = logging.getLogger(__name__)


def main() -> None:
    """Resolve the device, report it, and run the app sized to match."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    workers = effective_workers()
    logger.info(
        "Serving on device=%s cuda_available=%s device_name=%s with %d worker(s)",
        resolve_device(),
        cuda_available(),
        device_name() or "-",
        workers,
    )
    uvicorn.run(
        "src.main:app",
        # Container-internal only: prod uses `expose`, never `ports`, and the
        # service is absent from the nginx config.
        host="0.0.0.0",
        port=int(os.environ.get("TTS_PORT", "8003")),
        workers=workers,
    )


if __name__ == "__main__":
    main()
