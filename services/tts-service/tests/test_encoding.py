"""Asserts the ACTUAL encoded bitrate by decoding the MP3 frame header.

Do not weaken these to a parameter check. The previous candidate encode path
(libsndfile `compression_level = 48/320`) reads like it requests 48 kbps and
measurably produces 144 kbps — a 3x storage error across ~8,000 audio-hours.
The only trustworthy assertion is on the produced bytes.
"""

import numpy as np

from src.synthesis import MP3_BITRATE_KBPS, SAMPLE_RATE, encode_mp3

# MPEG-2 (LSF) Layer III bitrate table, kbps, indexed by the 4-bit header field.
MPEG2_L3_BITRATES = [None, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, None]
MPEG1_L3_BITRATES = [None, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, None]
SR_TABLE = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
CHANNEL_MODES = {0: "stereo", 1: "joint-stereo", 2: "dual-channel", 3: "mono"}


def parse_first_frame(data: bytes) -> dict:
    """Locate the first MP3 sync frame and decode its header fields."""
    for i in range(len(data) - 4):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
            version_id = (b1 >> 3) & 0x03  # 3=MPEG1, 2=MPEG2, 0=MPEG2.5
            layer = (b1 >> 1) & 0x03  # 1 = Layer III
            if layer != 1 or version_id == 1:
                continue
            bitrate_idx = (b2 >> 4) & 0x0F
            sr_idx = (b2 >> 2) & 0x03
            if bitrate_idx in (0, 15) or sr_idx == 3:
                continue
            table = MPEG1_L3_BITRATES if version_id == 3 else MPEG2_L3_BITRATES
            return {
                "bitrate_kbps": table[bitrate_idx],
                "sample_rate": SR_TABLE[version_id][sr_idx],
                "channel_mode": CHANNEL_MODES[(b3 >> 6) & 0x03],
            }
    return {}


def _speech_like(duration_s: float = 4.0) -> np.ndarray:
    t = np.linspace(0, duration_s, int(SAMPLE_RATE * duration_s), endpoint=False)
    return (
        0.4 * np.sin(2 * np.pi * 200 * t)
        + 0.2 * np.sin(2 * np.pi * 400 * t)
        + 0.1 * np.sin(2 * np.pi * 900 * t)
    ).astype(np.float32)


def test_frame_header_reports_the_pinned_bitrate() -> None:
    header = parse_first_frame(encode_mp3(_speech_like()))
    assert header, "no parseable MP3 frame header"
    assert header["bitrate_kbps"] == MP3_BITRATE_KBPS


def test_frame_header_reports_mono_at_the_native_rate() -> None:
    header = parse_first_frame(encode_mp3(_speech_like()))
    assert header["channel_mode"] == "mono"
    assert header["sample_rate"] == SAMPLE_RATE


def test_measured_average_bitrate_matches_the_pin() -> None:
    """CBR, so the whole-file average must land on the pinned rate."""
    duration_s = 4.0
    data = encode_mp3(_speech_like(duration_s))
    measured_kbps = len(data) * 8 / duration_s / 1000
    assert abs(measured_kbps - MP3_BITRATE_KBPS) < 3.0, (
        f"measured {measured_kbps:.1f} kbps, expected ~{MP3_BITRATE_KBPS}"
    )
