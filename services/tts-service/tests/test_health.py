"""/health reports the resolved hardware, so a GPU deployment is verifiable.

Before this, /health said only `status/model/voice_count` — enough to prove the
process was up and nothing about what it was running on. A rented GPU box serving
from CPU at ~1x realtime returned a green /health, which is how the whole class of
"is it actually on the card?" question became a throughput-watching exercise.
"""

import pytest
from fastapi.testclient import TestClient

from src import device as device_mod
from src import main
from src.config import settings


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "tts_device", None)
    monkeypatch.setattr(settings, "tts_workers", None)
    monkeypatch.setattr(settings, "tts_threads_per_worker", None)
    monkeypatch.setattr(settings, "tts_auth_token", "")


def _cuda(monkeypatch: pytest.MonkeyPatch, available: bool) -> None:
    monkeypatch.setattr(device_mod.torch.cuda, "is_available", lambda: available)


def test_reports_cpu(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _cuda(monkeypatch, False)

    body = client.get("/health").json()

    assert body["status"] == "ok"
    assert body["device"] == "cpu"
    assert body["cuda_available"] is False
    assert body["device_name"] is None
    assert body["workers"] == 2
    assert body["threads_per_worker"] == 4


def test_reports_the_card(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _cuda(monkeypatch, True)
    monkeypatch.setattr(
        device_mod.torch.cuda, "get_device_name", lambda _i: "NVIDIA L4"
    )

    body = client.get("/health").json()

    assert body["device"] == "cuda"
    assert body["cuda_available"] is True
    assert body["device_name"] == "NVIDIA L4"
    # One process owns the card.
    assert body["workers"] == 1
    assert body["threads_per_worker"] == 8


def test_exposes_the_misconfigured_gpu_container(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`--gpus all` forgotten: configured for CUDA, no device visible."""
    monkeypatch.setattr(settings, "tts_device", "cuda")
    _cuda(monkeypatch, False)

    body = client.get("/health").json()

    # Still 200 — this is a liveness probe and the process IS alive. The three
    # fields together are what say the run is not acceptable.
    assert body["device"] == "cuda"
    assert body["cuda_available"] is False
    assert body["device_name"] is None


def test_model_and_voice_count_are_unchanged(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _cuda(monkeypatch, False)

    body = client.get("/health").json()

    assert body["model"] == settings.tts_model_repo
    assert body["voice_count"] == len(main.LOADED_VOICES)
