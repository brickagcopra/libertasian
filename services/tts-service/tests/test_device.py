"""Device resolution for the CPU and GPU images."""

import pytest

from src.config import Settings, settings
from src.synthesis import resolved_device


@pytest.mark.parametrize("configured", ["auto", "AUTO", " auto ", ""])
def test_auto_leaves_kokoro_to_choose(
    monkeypatch: pytest.MonkeyPatch, configured: str
) -> None:
    """None means no `device` kwarg — the CPU image behaves as it always did."""
    monkeypatch.setattr(settings, "tts_device", configured)

    assert resolved_device() is None


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("cuda", "cuda"), ("CUDA", "cuda"), (" cuda:1 ", "cuda:1"), ("cpu", "cpu")],
)
def test_explicit_device_is_passed_through(
    monkeypatch: pytest.MonkeyPatch, configured: str, expected: str
) -> None:
    """The GPU image sets cuda explicitly so a CPU fallback fails loudly."""
    monkeypatch.setattr(settings, "tts_device", configured)

    assert resolved_device() == expected


def test_default_is_auto() -> None:
    """Nothing about the default deployment changes by adding this knob."""
    assert Settings.model_fields["tts_device"].default == "auto"
