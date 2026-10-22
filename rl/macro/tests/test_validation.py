"""V1 по сохранённым результатам обучения (rl/macro/params/learning.json): CRPS выбранной модели
не хуже наивной персистентности на целях выбора; покрытие 80 % полос на отложенных месяцах
посчитано, согласовано со строками и помечено флагом недопокрытия, где оно есть."""
import json
from pathlib import Path

import numpy as np
import pytest

from rl.macro.data import OUT, PARAMS, load_monthly

LEARNING = PARAMS / "learning.json"
pytestmark = pytest.mark.skipif(not LEARNING.exists(), reason="нет rl/macro/params/learning.json — запустите python -m rl.macro.fit")


@pytest.fixture(scope="module")
def learning():
    return json.loads(LEARNING.read_text())


def test_selected_model_crps_not_worse_than_persistence(learning):
    sel = learning["selection"]
    assert sel["n_validation_targets"] == 24
    assert sel["joint_standardized_CRPS_13months"] <= sel["naive_persistence_joint_CRPS"]
    grid = learning["validation_grid"]
    assert sel["joint_standardized_CRPS_13months"] == min(g["joint_standardized_CRPS_13months"] for g in grid)
    assert len(grid) == 12


def test_holdout_coverage80_reported_and_consistent(learning):
    ho = learning.get("holdout")
    assert ho and ho["n"] >= 24
    rows = learning["holdout_rows"]
    for name, s in ho["variables"].items():
        cov = float(np.mean([r[name]["covered80"] for r in rows]))
        assert abs(cov - s["coverage80"]) < 1e-12
        assert 0.0 <= s["coverage80"] <= 1.0
        flagged = name in ho["flags"]["undercoverage80"]
        assert flagged == (s["coverage80"] < ho["flags"]["threshold"])
        assert s["mean_CRPS"] <= s["mean_CRPS_persistence"]       # генератор не хуже персистентности


def test_training_refuses_synthetic_rows(tmp_path):
    f = load_monthly()
    f["synthetic"] = 0
    f.loc[f.index[-1], "synthetic"] = 1
    p = tmp_path / "m.csv"
    f.to_csv(p, index=False)
    with pytest.raises(ValueError, match="synthetic"):
        load_monthly(p)


def test_processed_data_has_provenance():
    meta = json.loads((OUT / "meta.json").read_text())
    assert meta["n"] >= 150 and meta["synthetic_rows"] == 0
    assert {s["file"] for s in meta["sources"]} == {"inflation.html", "keyrate.html", "fx_usd.xml"}
    assert all(len(s["sha256"]) == 64 and s["url"].startswith("https://www.cbr.ru/") for s in meta["sources"])
