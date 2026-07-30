"""Kokoro-82M synthesis: audio assembly plus Polly-compatible speech marks.

The mark format is dictated by the NestJS consumer and is NOT negotiable:
`audio-rendition.service.ts` derives `durationMs` from the last `word` mark and
joins `ssml` marks onto the read-along manifest. Emitting Polly's exact shape is
what lets the web and mobile players stay untouched.

The web parser additionally DROPS any mark line whose `start`/`end` are not
finite numbers (`apps/web/src/features/audio/lib/parse-marks.ts`), so those
fields are mandatory on every word and sentence mark even though their values
are not currently read.
"""

import json
import logging
from dataclasses import dataclass

import lameenc
import numpy as np
from kokoro import KPipeline

from .config import settings

logger = logging.getLogger(__name__)

# Kokoro's native output rate. The mp3 encode below preserves it.
SAMPLE_RATE = 24_000

# Pinned encode settings. NOT env-tunable: prod's existing renditions were
# re-measured frame-by-frame and are already 48 kbps mono, so matching it means
# no player change and no quality regression.
#
# lameenc is used rather than soundfile because libsndfile's `compression_level`
# is an inverted QUALITY knob, not a bitrate: measured on libsndfile 1.2.2 at
# 24 kHz mono it produced 160 kbps at 0.0, 144 at 0.15, 80 at 0.5 and 40 at 0.8,
# and raised LibsndfileError at 1.0. No value lands on 48 kbps.
MP3_BITRATE_KBPS = 48
MP3_CHANNELS = 1
# LAME algorithm quality: 0 best/slowest, 9 worst/fastest. 2 is the usual
# high-quality choice and is negligible next to Kokoro's own cost.
MP3_LAME_QUALITY = 2

# Kokoro voice prefixes -> pipeline lang_code ('a' = en-US, 'b' = en-GB).
_LANG_BY_PREFIX = {"a": "a", "b": "b"}


class MissingWordTimingsError(RuntimeError):
    """Raised when a segment yields no word timings.

    Never downgrade this to a skip: `durationMs` is read from the LAST word
    mark, so silently omitting word marks writes a wrong duration into
    `audio_renditions` and desynchronises every read-along built from it.
    """


@dataclass(frozen=True)
class _Token:
    """One timed word within a segment."""

    text: str
    start_s: float
    end_s: float


def resolved_device() -> str | None:
    """Torch device to pass to KPipeline, or None to leave kokoro's own choice.

    "auto" returns None so the CPU deployment behaves exactly as it did before
    this setting existed. An explicit value (the GPU image sets "cuda") is passed
    through, which also means a GPU host with no visible device fails LOUDLY at
    first synthesis instead of quietly running on CPU at ~1x realtime.
    """
    configured = settings.tts_device.strip().lower()
    return None if configured in ("", "auto") else configured


class KokoroSynthesizer:
    """Lazily-initialised Kokoro pipelines, one per language code."""

    def __init__(self) -> None:
        self._pipelines: dict[str, KPipeline] = {}

    def _pipeline(self, voice: str) -> KPipeline:
        lang = _LANG_BY_PREFIX.get(voice[:1], "a")
        if lang not in self._pipelines:
            device = resolved_device()
            logger.info(
                "Loading Kokoro pipeline lang=%s repo=%s device=%s",
                lang,
                settings.tts_model_repo,
                device or "kokoro-default",
            )
            kwargs: dict[str, object] = {
                "lang_code": lang,
                "repo_id": settings.tts_model_repo,
            }
            if device is not None:
                kwargs["device"] = device
            self._pipelines[lang] = KPipeline(**kwargs)
        return self._pipelines[lang]

    def synthesize_segment(self, text: str, voice: str) -> tuple[np.ndarray, list[_Token]]:
        """Synthesize one segment, returning its audio and per-word timings."""
        pipeline = self._pipeline(voice)
        chunks: list[np.ndarray] = []
        tokens: list[_Token] = []
        offset_s = 0.0

        for result in pipeline(text, voice=voice, speed=1.0):
            audio = getattr(result, "audio", None)
            if audio is None:
                continue
            array = np.asarray(
                audio.detach().cpu().numpy() if hasattr(audio, "detach") else audio,
                dtype=np.float32,
            )
            for token in getattr(result, "tokens", None) or []:
                start = getattr(token, "start_ts", None)
                end = getattr(token, "end_ts", None)
                word = (getattr(token, "text", "") or "").strip()
                if start is None or end is None or not word:
                    continue
                tokens.append(_Token(text=word, start_s=offset_s + start, end_s=offset_s + end))
            chunks.append(array)
            offset_s += len(array) / SAMPLE_RATE

        if not chunks:
            raise MissingWordTimingsError(f"Kokoro produced no audio for segment: {text[:80]!r}")
        if not tokens:
            raise MissingWordTimingsError(
                f"Kokoro produced no word timings for segment: {text[:80]!r}"
            )
        return np.concatenate(chunks), tokens


def _silence(duration_ms: int) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * duration_ms / 1000), dtype=np.float32)


def encode_mp3(audio: np.ndarray) -> bytes:
    """Encode float32 PCM to mono mp3 at exactly the pinned CBR bitrate."""
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(MP3_CHANNELS)
    encoder.set_quality(MP3_LAME_QUALITY)
    # Explicit CBR so every frame header carries the pinned bitrate. This is
    # lameenc's default, but stating it keeps the guarantee from depending on
    # an upstream default we do not control.
    encoder.set_vbr(lameenc.VBR_OFF)
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    return bytes(encoder.encode(pcm16.tobytes()) + encoder.flush())


def synthesize_document(
    synthesizer: KokoroSynthesizer,
    segments: list[tuple[str, str, int]],
    voice: str,
) -> tuple[bytes, str]:
    """Synthesize every segment and assemble audio plus Polly-format NDJSON marks.

    `segments` is a list of (id, text, lead_silence_ms) in narration order.
    Returns (mp3_bytes, ndjson_marks).
    """
    pieces: list[np.ndarray] = []
    marks: list[dict[str, object]] = []
    cursor_s = 0.0
    byte_cursor = 0

    for segment_id, text, lead_silence_ms in segments:
        if lead_silence_ms > 0:
            pad = _silence(lead_silence_ms)
            pieces.append(pad)
            cursor_s += len(pad) / SAMPLE_RATE

        audio, tokens = synthesizer.synthesize_segment(text, voice)
        segment_start_s = cursor_s
        encoded_text = text.encode("utf-8")

        # One ssml mark per segment, at the segment's own onset. REQUIRED: this
        # is what the read-along manifest join keys on.
        marks.append({"time": int(segment_start_s * 1000), "type": "ssml", "value": segment_id})
        # One sentence mark spanning the segment text.
        marks.append(
            {
                "time": int(segment_start_s * 1000),
                "type": "sentence",
                "value": text,
                "start": byte_cursor,
                "end": byte_cursor + len(encoded_text),
            }
        )

        # Running search cursor so a word repeated within a segment gets its own
        # offsets instead of every occurrence reporting the first one.
        search_from = 0
        for token in tokens:
            word_bytes = token.text.encode("utf-8")
            found = encoded_text.find(word_bytes, search_from)
            if found < 0:
                # Kokoro normalised the token past recognition; fall back to the
                # cursor so the field stays finite (the web parser drops
                # non-finite marks outright).
                found = search_from
            else:
                search_from = found + len(word_bytes)
            marks.append(
                {
                    "time": int((segment_start_s + token.start_s) * 1000),
                    "type": "word",
                    "value": token.text,
                    "start": byte_cursor + found,
                    "end": byte_cursor + found + len(word_bytes),
                }
            )

        pieces.append(audio)
        cursor_s += len(audio) / SAMPLE_RATE
        # +1 for the notional separator between segments, matching Polly's
        # monotonically increasing offsets across a document.
        byte_cursor += len(encoded_text) + 1

    combined = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
    ndjson = "\n".join(json.dumps(mark, ensure_ascii=False) for mark in marks)
    return encode_mp3(combined), ndjson
