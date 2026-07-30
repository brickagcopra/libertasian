"""Request/response schemas for the synthesis endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class SpokenSegment(BaseModel):
    """One plain-text unit to synthesize, mirroring `toSpokenSegments` output."""

    model_config = ConfigDict(strict=True)

    id: str = Field(min_length=1)
    text: str
    # camelCase matches the TypeScript contract on the wire.
    leadSilenceMs: int = Field(default=0, ge=0)  # noqa: N815


class SynthesizeRequest(BaseModel):
    """A full document to narrate, in segment order."""

    model_config = ConfigDict(strict=True)

    segments: list[SpokenSegment] = Field(min_length=1)
    voice: str = Field(default="af_heart", min_length=1)
    format: str = Field(default="mp3", pattern="^mp3$")


class SynthesizeResponse(BaseModel):
    """Base64 mp3 plus Polly-format NDJSON speech marks."""

    model_config = ConfigDict(strict=True)

    audio: str
    marks: str


class HealthResponse(BaseModel):
    """Liveness payload, plus enough to VERIFY a GPU deployment.

    `device` is what the model actually loads onto and `cuda_available` is what
    torch can see, so the two together distinguish the three states that used to
    be indistinguishable from outside: running on GPU, running on CPU because no
    device is visible, and configured for CUDA on a container that never got one
    (`device=cuda` with `cuda_available=false` — synthesis will fail).
    """

    model_config = ConfigDict(strict=True)

    status: str
    model: str
    voice_count: int
    device: str
    cuda_available: bool
    # Marketing name of the active CUDA device (e.g. "NVIDIA L4"); null on CPU.
    device_name: str | None = None
    workers: int
    threads_per_worker: int
