"""Device, worker and thread resolution — explicit, never implicit.

Which device the model landed on used to be decided inside kokoro: `KPipeline`
was constructed with no `device`, so it fell back to kokoro's own
`cuda if torch.cuda.is_available() else cpu`. That produces the right answer and
reports nothing, which means a GPU deployment could only be INFERRED from
throughput — and the failure it hides is the expensive one: a rented GPU box
quietly serving from CPU at ~1x realtime looks exactly like a working service.

Everything here resolves explicitly, is logged once at startup, and is reported
on /health so the deployment can be verified rather than assumed.
"""

import logging

import torch

from .config import settings

logger = logging.getLogger(__name__)

# Device-SHAPED defaults, used only when the setting is unset.
#
# 2 x 4 was CPU-shaped by construction: the prod VPS is 12 vCPU and also serves
# the API, and Kokoro-82M barely scales with threads, so throughput came from
# several narrow workers (measured ~0.97x realtime each at 4 threads).
#
# On a GPU one process owns the card. uvicorn workers do NOT share the model, so
# a second worker is a second full copy of the weights for no extra throughput
# on a single device — and each concurrent synthesis measured ~2.9 GiB. The
# thread count goes UP rather than down because with one process there is no
# contention, and the CPU-side work (misaki/spaCy G2P, the LAME encode) is still
# on the critical path.
CPU_WORKERS = 2
CPU_THREADS = 4
GPU_WORKERS = 1
GPU_THREADS = 8

# Values that mean "decide for me". `None` is the unset default; the strings are
# accepted so an env file or compose default can say it out loud.
_AUTO = ("", "auto", "none")


def cuda_available() -> bool:
    """Whether torch can see a usable CUDA device right now."""
    return bool(torch.cuda.is_available())


def resolve_device() -> str:
    """The device to put the model on. Always a concrete value, never None."""
    configured = (settings.tts_device or "").strip().lower()
    if configured not in _AUTO:
        return configured
    return "cuda" if cuda_available() else "cpu"


def is_gpu(device: str | None = None) -> bool:
    """Whether `device` (default: the resolved one) is a CUDA device."""
    return (device or resolve_device()).startswith("cuda")


def device_name() -> str | None:
    """Marketing name of the active CUDA device, or None when not on one.

    This is the field that makes a GPU deployment verifiable at a glance: a
    /health showing `device=cuda` with a real name is proof, `device=cuda` with
    `cuda_available=false` is a misconfigured container.
    """
    if not is_gpu() or not cuda_available():
        return None
    try:
        return str(torch.cuda.get_device_name(0))
    except (RuntimeError, AssertionError):
        return None


def effective_workers() -> int:
    """uvicorn worker count for the resolved device."""
    device = resolve_device()
    configured = settings.tts_workers
    if configured is None:
        return GPU_WORKERS if is_gpu(device) else CPU_WORKERS

    if is_gpu(device) and configured > 1:
        # Honoured, not clamped: a multi-GPU host is a legitimate reason to run
        # several. It is warned about because on a SINGLE card it is pure cost.
        logger.warning(
            "TTS_WORKERS=%d on %s: workers do not share the model, so each one is "
            "another full copy of the weights (~2.9 GiB measured) for no extra "
            "throughput on a single card. Honouring the explicit value.",
            configured,
            device,
        )
    return configured


def effective_threads() -> int:
    """Torch intra-op threads per worker for the resolved device."""
    configured = settings.tts_threads_per_worker
    if configured is None:
        return GPU_THREADS if is_gpu() else CPU_THREADS
    return configured
