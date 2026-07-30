"""Bearer-token auth on /synthesize.

`synthesize_document` is monkeypatched in every 200-path test: these assert the
AUTH decision, and running real Kokoro synthesis here would make the suite depend
on host CPU and on the model cache being present.
"""

import base64

import pytest
from fastapi.testclient import TestClient

from src import main
from src.config import settings

BODY = {
    "segments": [{"id": "seg-0", "text": "Alpha bravo.", "leadSilenceMs": 0}],
    "voice": "af_heart",
    "format": "mp3",
}

FAKE_AUDIO = b"ID3-audio"
FAKE_MARKS = '{"time":0,"type":"ssml","value":"seg-0"}'


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """TestClient with synthesis stubbed out to a fixed, cheap result."""
    monkeypatch.setattr(
        main, "synthesize_document", lambda *_args, **_kwargs: (FAKE_AUDIO, FAKE_MARKS)
    )
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _no_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default to prod's setting — unset — so each test opts INTO auth."""
    monkeypatch.setattr(settings, "tts_auth_token", "")


def test_synthesize_open_when_token_unset(client: TestClient) -> None:
    """Prod's in-network call keeps working after this deploys."""
    response = client.post("/synthesize", json=BODY)

    assert response.status_code == 200
    assert base64.b64decode(response.json()["audio"]) == FAKE_AUDIO


def test_synthesize_rejects_missing_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tts_auth_token", "s3cret")

    response = client.post("/synthesize", json=BODY)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_synthesize_rejects_wrong_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tts_auth_token", "s3cret")

    response = client.post(
        "/synthesize", json=BODY, headers={"Authorization": "Bearer wrong"}
    )

    assert response.status_code == 401


def test_synthesize_rejects_wrong_scheme(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tts_auth_token", "s3cret")

    response = client.post(
        "/synthesize", json=BODY, headers={"Authorization": "Basic s3cret"}
    )

    assert response.status_code == 401


def test_synthesize_accepts_correct_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tts_auth_token", "s3cret")

    response = client.post(
        "/synthesize", json=BODY, headers={"Authorization": "Bearer s3cret"}
    )

    assert response.status_code == 200
    assert response.json()["marks"] == FAKE_MARKS


def test_health_stays_open_with_auth_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The container HEALTHCHECK curls /health with no credentials."""
    monkeypatch.setattr(settings, "tts_auth_token", "s3cret")

    assert client.get("/health").status_code == 200
