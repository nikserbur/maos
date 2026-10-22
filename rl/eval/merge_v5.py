"""Слияние частичных запусков V5 (по стрессам) в rl/results/v5_results.json + гейт §7.4 по базовым holdout."""
from __future__ import annotations

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parent.parent / "results"


def main() -> None:
    out: dict = {}
    for st in ("base", "crisis", "quantile", "joint"):
        p = RESULTS / f"v5_{st}.json"
        if not p.exists():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        if not out:
            out = {k: v for k, v in d.items() if k != "tables"}; out["tables"] = {}
        out["tables"].update(d["tables"])
    champion = {"policy": "best_rule", "score": 0.0, "note": "ни одна политика RL не прошла гейт §7.4 на базовых holdout-сценариях"}
    if "base" in out.get("tables", {}):
        for cand, c in out["tables"]["base"]["comparisons"].items():
            if cand == "GA":
                continue
            cc = c["vs_best_rule"]
            if cc["gate_pass"] and cc["d_cvar_profit"]["iqm"] > champion["score"]:
                champion = {"policy": cand, "score": cc["d_cvar_profit"]["iqm"], "ci95": cc["d_cvar_profit"]["ci95"], "holdout_seed": out["holdout_seed"], "n": out["n"]}
    out["champion"] = champion
    (RESULTS / "champion.json").write_text(json.dumps(champion, indent=1, ensure_ascii=False), encoding="utf-8")
    (RESULTS / "v5_results.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(champion, ensure_ascii=False))


if __name__ == "__main__":
    main()
