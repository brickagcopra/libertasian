from __future__ import annotations

import json
from pathlib import Path

import pytest

from evals import compare
from evals.tests.helpers import qr, src

FAM = src("The Family Code of the Philippines", "Exec. Order No. 209 (1987)", "codal")
RPC = src("The Revised Penal Code", "Act No. 3815", "codal")
EXP = [{"statute": "Family Code Art. 36"}]


def test_flips_detects_each_transition() -> None:
    baseline = [
        qr("lost", expected=EXP, sources=[FAM]),
        qr("gained", expected=EXP, sources=[RPC]),
        qr("went_quiet", status="answered", expected=EXP, sources=[FAM]),
        qr("spoke_up", status="abstained", must_abstain=True),
        qr("broke", expected=EXP, sources=[FAM]),
        qr("only_old"),
    ]
    candidate = [
        qr("lost", expected=EXP, sources=[RPC]),
        qr("gained", expected=EXP, sources=[FAM]),
        qr("went_quiet", status="abstained", expected=EXP, sources=[FAM]),
        qr("spoke_up", status="answered", must_abstain=True),
        qr("broke", status="error", expected=EXP),
        qr("only_new"),
    ]
    f = compare.flips(baseline, candidate, k=3)
    assert f["hit@3 -> miss"] == ["lost"]
    assert f["miss -> hit@3"] == ["gained"]
    assert f["answered -> abstained"] == ["went_quiet"]
    assert f["abstained -> answered"] == ["spoke_up"]
    assert f["ok -> error"] == ["broke"]
    assert f["error -> ok"] == []


def test_compare_markdown_has_deltas_and_flips() -> None:
    baseline = [qr("a", expected=EXP, sources=[RPC], latency_ms=100)]
    candidate = [qr("a", expected=EXP, sources=[FAM], latency_ms=150)]
    md = compare.compare_markdown(baseline, candidate, k=3)
    assert "| authority_hit@3 | 0.000 | 1.000 | +1.000 |" in md
    assert "| latency_p50_ms | 100.000 | 150.000 | +50.000 |" in md
    assert "| n | 1 | 1 | +0 |" in md
    assert "**miss -> hit@3** (1): a" in md
    assert "| Civil Law | 0.000 | 1.000 | +1.000 |" in md


def test_compare_markdown_no_flips() -> None:
    same = [qr("a")]
    assert "- none" in compare.compare_markdown(same, same)


def test_main_reads_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    def write(name: str, sources: list[dict[str, object]]) -> Path:
        path = tmp_path / name
        result = qr("a", expected=EXP).to_json()
        result["sources"] = sources
        path.write_text(json.dumps({"meta": {}, "results": [result]}), encoding="utf-8")
        return path

    fam: dict[str, object] = {"title": FAM.title, "citation": FAM.citation, "gr_no": None,
           "document_type": "codal", "rerank_score": 0.9}
    b = write("base.json", [])
    c = write("cand.json", [fam])
    assert compare.main([str(b), str(c), "--k", "1"]) == 0
    out = capsys.readouterr().out
    assert "`base.json` -> `cand.json`" in out
    assert "**miss -> hit@1** (1): a" in out
