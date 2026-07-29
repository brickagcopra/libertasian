"""LIBERTASIAN TTS Service — FastAPI application."""

import base64
import logging

import torch
from fastapi import FastAPI, HTTPException

from .config import settings
from .schemas import HealthResponse, SynthesizeRequest, SynthesizeResponse
from .synthesis import KokoroSynthesizer, MissingWordTimingsError, synthesize_document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Each uvicorn worker is deliberately narrow — see Settings.tts_threads_per_worker.
torch.set_num_threads(settings.tts_threads_per_worker)

# Voices this build is known to serve; kept explicit so /health is meaningful
# without touching the network.
LOADED_VOICES = ("af_heart", "am_michael", "bm_george")

app = FastAPI(
    title=settings.app_name,
    description="Self-hosted Kokoro-82M speech synthesis for legal narration",
    version=settings.app_version,
)

synthesizer = KokoroSynthesizer()


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe."""
    return HealthResponse(
        status="ok",
        model=settings.tts_model_repo,
        voice_count=len(LOADED_VOICES),
    )


@app.post("/synthesize", response_model=SynthesizeResponse)
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
