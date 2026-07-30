"""LIBERTASIAN TTS Service — FastAPI application."""

import base64
import logging

import torch
from fastapi import Depends, FastAPI, HTTPException

from .auth import auth_enabled, require_tts_token
from .config import settings
from .device import (
    cuda_available,
    device_name,
    effective_threads,
    effective_workers,
    resolve_device,
)
from .schemas import HealthResponse, SynthesizeRequest, SynthesizeResponse
from .synthesis import KokoroSynthesizer, MissingWordTimingsError, synthesize_document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Thread count is device-shaped: narrow on CPU (several workers share 12 vCPU),
# wider on GPU (one process owns the card). See src/device.py.
torch.set_num_threads(effective_threads())

# Voices this build is known to serve; kept explicit so /health is meaningful
# without touching the network.
LOADED_VOICES = ("af_heart", "am_michael", "bm_george")

app = FastAPI(
    title=settings.app_name,
    description="Self-hosted Kokoro-82M speech synthesis for legal narration",
    version=settings.app_version,
)

synthesizer = KokoroSynthesizer()

# Logged once at import so a misconfigured deployment is visible in the first
# lines of the container log rather than inferred from throughput. A GPU host
# that silently fell back to CPU is the failure this exists to catch.
logger.info(
    "TTS starting: device=%s cuda_available=%s device_name=%s "
    "workers=%d threads=%d auth=%s",
    resolve_device(),
    cuda_available(),
    device_name() or "-",
    effective_workers(),
    effective_threads(),
    "on" if auth_enabled() else "off",
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe, and the deployment's own account of its hardware."""
    return HealthResponse(
        status="ok",
        model=settings.tts_model_repo,
        voice_count=len(LOADED_VOICES),
        device=resolve_device(),
        cuda_available=cuda_available(),
        device_name=device_name(),
        workers=effective_workers(),
        threads_per_worker=effective_threads(),
    )


@app.post(
    "/synthesize",
    response_model=SynthesizeResponse,
    dependencies=[Depends(require_tts_token)],
)
async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
    """Synthesize a document to mp3 plus Polly-format speech marks."""
    segments = [(s.id, s.text, s.leadSilenceMs) for s in request.segments]
    try:
        audio, marks = synthesize_document(synthesizer, segments, request.voice)
    except MissingWordTimingsError as exc:
        # Fail the job rather than emit a rendition with a wrong durationMs.
        logger.error("Synthesis aborted: %s", exc)
        raise HTTPException(status_code=500, detail="word timings unavailable") from exc

    logger.info(
        "Synthesized %d segments -> %dB mp3, %dB marks (voice=%s)",
        len(segments),
        len(audio),
        len(marks.encode("utf-8")),
        request.voice,
    )
    return SynthesizeResponse(
        audio=base64.b64encode(audio).decode("ascii"),
        marks=marks,
    )
