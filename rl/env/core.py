"""Загрузка nanobind-модуля и фабрики среды."""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any

ENV_DIR = Path(__file__).resolve().parent
REPO = ENV_DIR.parent.parent
DEFAULT_DB = REPO / "backend" / "build" / "maos.db"

# Конфигурация среды по умолчанию (коды паспорта rl.* — Passport.cpp).
DEFAULT_CFG: dict[str, Any] = {
    "event_mode": True, "k_max_cands": 16, "k_max_orders": 16, "k_max_wct": 32,
    "horizon_weeks": 26, "l2_enabled": False, "max_moves_per_week": 3,
    "breakdowns": True, "deterministic": False, "dense_reward": True,
    "c_tard": 1.0, "c_setup": 0.5, "w_profit": 1.0, "w_cash": 1.0, "lambda_breach": 1.0,
}


def load_module():
    """Импорт `maos_env` из rl/env (собранный .so)."""
    if str(ENV_DIR) not in sys.path:
        sys.path.insert(0, str(ENV_DIR))
    try:
        return importlib.import_module("maos_env")
    except ImportError as e:  # pragma: no cover - подсказка по сборке
        raise ImportError("maos_env не собран: см. rl/env/__init__.py (cmake … -DMAOS_BUILD_PYENV=ON)") from e


def make_config(overrides: dict[str, Any] | None = None):
    me = load_module()
    cfg = me.EnvConfig()
    merged = {**DEFAULT_CFG, **(overrides or {})}
    for k, v in merged.items():
        setattr(cfg, k, v)
    return cfg


def instance_from_json_file(path: str | Path):
    me = load_module()
    return me.Instance.from_json(Path(path).read_text(encoding="utf-8"))


def instance_from_db(db_path: str | Path = DEFAULT_DB, program: list[tuple[str, float]] | None = None,
                     due_hours: list[float] | None = None, use_calendar: bool = True):
    me = load_module()
    return me.instance_from_db(str(db_path), program or [], due_hours or [], use_calendar)


def make_env(instance, cfg: dict[str, Any] | None = None):
    me = load_module()
    return me.SimEnv(instance, make_config(cfg))


def run_rule(env, rule: str, seed: int, scenario_json: str = "") -> dict:
    me = load_module()
    return json.loads(me.evaluate_rule(env, rule, seed, scenario_json))


def run_key(env, key: list[float], seed: int, scenario_json: str = "") -> dict:
    me = load_module()
    return json.loads(me.evaluate_key(env, key, seed, scenario_json))
