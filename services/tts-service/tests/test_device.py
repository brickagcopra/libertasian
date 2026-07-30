"""Device, worker and thread resolution.

`torch.cuda.is_available` is monkeypatched throughout: these assert the
RESOLUTION rules, and a test whose outcome depended on whether the machine
running it happens to have a GPU would assert nothing (see PR #335).
"""

import pytest

from src import device as device_mod
from src.config import Settings, settings


@pytest.fixture(autouse=True)
def _unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Start every test from the unset defaults."""
    monkeypatch.setattr(settings, "tts_device", None)
    monkeypatch.setattr(settings, "tts_workers", None)
    monkeypatch.setattr(settings, "tts_threads_per_worker", None)


def _cuda(monkeypatch: pytest.MonkeyPatch, available: bool) -> None:
    monkeypatch.setattr(device_mod.torch.cuda, "is_available", lambda: available)


def test_defaults_are_unset_so_the_resolver_decides() -> None:
    """Nothing is hard-coded in the settings; device.py owns the defaults."""
    assert Settings.model_fields["tts_device"].default is None
    assert Settings.model_fields["tts_workers"].default is None
    assert Settings.model_fields["tts_threads_per_worker"].default is None


class TestResolveDevice:
    def test_auto_picks_cuda_when_available(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _cuda(monkeypatch, True)

        assert device_mod.resolve_device() == "cuda"
        assert device_mod.is_gpu() is True

    def test_auto_falls_back_to_cpu(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _cuda(monkeypatch, False)

        assert device_mod.resolve_device() == "cpu"
        assert device_mod.is_gpu() is False

    @pytest.mark.parametrize("configured", ["", "auto", " AUTO ", "none"])
    def test_auto_aliases(
        self, monkeypatch: pytest.MonkeyPatch, configured: str
    ) -> None:
        monkeypatch.setattr(settings, "tts_device", configured)
        _cuda(monkeypatch, False)

        assert device_mod.resolve_device() == "cpu"

    @pytest.mark.parametrize(
        ("configured", "expected"),
        [("cuda", "cuda"), ("CUDA", "cuda"), (" cuda:1 ", "cuda:1"), ("cpu", "cpu")],
    )
    def test_explicit_device_wins_over_availability(
        self, monkeypatch: pytest.MonkeyPatch, configured: str, expected: str
    ) -> None:
        """An explicit cuda on a box with no device must NOT be silently downgraded.

        Kokoro then raises `CUDA requested but not available` at first synthesis,
        which is the point: a rented GPU box quietly serving from CPU looks like
        a working service.
        """
        monkeypatch.setattr(settings, "tts_device", configured)
        _cuda(monkeypatch, False)

        assert device_mod.resolve_device() == expected


class TestDeviceName:
    def test_none_on_cpu(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _cuda(monkeypatch, False)

        assert device_mod.device_name() is None

    def test_reports_the_card_on_cuda(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _cuda(monkeypatch, True)
        monkeypatch.setattr(
            device_mod.torch.cuda, "get_device_name", lambda _i: "NVIDIA L4"
        )

        assert device_mod.device_name() == "NVIDIA L4"

    def test_none_when_configured_for_cuda_but_none_visible(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The `device=cuda` + `cuda_available=false` state /health exists to show."""
        monkeypatch.setattr(settings, "tts_device", "cuda")
        _cuda(monkeypatch, False)

        assert device_mod.resolve_device() == "cuda"
        assert device_mod.device_name() is None


class TestWorkersAndThreads:
    def test_cpu_defaults_match_the_measured_prod_shape(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _cuda(monkeypatch, False)

        assert device_mod.effective_workers() == 2
        assert device_mod.effective_threads() == 4

    def test_gpu_gives_one_process_the_card(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _cuda(monkeypatch, True)

        assert device_mod.effective_workers() == 1
        assert device_mod.effective_threads() == 8

    def test_explicit_values_win_on_either_device(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _cuda(monkeypatch, True)
        monkeypatch.setattr(settings, "tts_workers", 3)
        monkeypatch.setattr(settings, "tts_threads_per_worker", 2)

        # Honoured, not clamped — a multi-GPU host is a legitimate reason.
        assert device_mod.effective_workers() == 3
        assert device_mod.effective_threads() == 2

    def test_multiple_gpu_workers_are_warned_about(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        _cuda(monkeypatch, True)
        monkeypatch.setattr(settings, "tts_workers", 2)

        with caplog.at_level("WARNING"):
            assert device_mod.effective_workers() == 2

        assert "do not share the model" in caplog.text

    def test_multiple_cpu_workers_are_not_warned_about(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        _cuda(monkeypatch, False)
        monkeypatch.setattr(settings, "tts_workers", 2)

        with caplog.at_level("WARNING"):
            assert device_mod.effective_workers() == 2

        assert caplog.text == ""
