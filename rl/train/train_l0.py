"""Обучение L0 (диспетчер типа РЦ, одна политика на все типы, mean-field) — MaskablePPO с куррикулумом §7.4.

    rl/.venv/bin/python -m rl.train.train_l0 --seeds 1 2 3 --steps 60000 100000 100000

Куррикулум: (1) малые экземпляры, без поломок, базовый режим → (2) все экземпляры, хвосты и
поломки → (3) + редкие режимы HMM (половина сред — «кризис»). Финансовые действия — L2
(train_l2.py). Отжиг энтропии между стадиями (AI Economist). Ранняя остановка: лучший чекпойнт
по IQM отдачи на валидационных сценариях (seed 777 — не holdout). Сравнение с правилом EDD на
тех же сценариях (CRN) пишется в rl/results/train_l0_seed{s}.json.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.env.l0_env import L0Env
from rl.env.scenarios import STRESSES, ScenarioSet
from rl.train.common import CKPT, RESULTS, EvalSpec, iqm, load_instances, maos_instance_names, run_episodes, sb3_policy

# Гиперпараметры [К] rl.ppo.* (паспорт)
PPO = dict(n_steps=512, batch_size=256, learning_rate=3e-4, gamma=0.995, gae_lambda=0.95, clip_range=0.2,
           n_epochs=4, vf_coef=0.5, max_grad_norm=0.5, policy_kwargs=dict(net_arch=[128, 128]))
ENT = [0.02, 0.01, 0.003]          # отжиг энтропии по стадиям
N_ENVS = 8
TRAIN_SCEN_SEED, N_TRAIN_SCEN = 100, 64
VALID_N_PER_INSTANCE = 4     # [НОРМ] rl.valid: 4 сценария × все экземпляры (WAIT-тяжёлые политики дорого оценивать по-одному)


def stage_env(stage: int, names: list[str], seed: int, weeks: int, env_cls=L0Env, n_envs: int = N_ENVS) -> DummyVecEnv:
    small = [n for n in names if n.startswith("maos-rnd")][:4] or names
    insts_small, insts_all = load_instances(small), load_instances(names)
    base = ScenarioSet(N_TRAIN_SCEN, TRAIN_SCEN_SEED, weeks=weeks)
    crisis = ScenarioSet(N_TRAIN_SCEN, TRAIN_SCEN_SEED + 1, weeks=weeks, stress=STRESSES["crisis"])

    def mk(i: int):
        if stage == 1:
            return lambda: env_cls(insts_small, {"breakdowns": False}, base, seed_base=seed * 100000 + i * 1000)
        if stage == 2:
            return lambda: env_cls(insts_all, {"breakdowns": True}, base, seed_base=seed * 100000 + i * 1000)
        sc = crisis if i % 2 else base
        return lambda: env_cls(insts_all, {"breakdowns": True}, sc, seed_base=seed * 100000 + i * 1000)
    return DummyVecEnv([mk(i) for i in range(n_envs)])


def validate(model, names: list[str], weeks: int, spec: EvalSpec, policy_fn=sb3_policy) -> dict:
    """IQM отдачи и KPI на валидационных сценариях; EDD — на тех же (CRN)."""
    insts = load_instances(names)
    vs = ScenarioSet(VALID_N_PER_INSTANCE, spec.valid_seed, weeks=weeks)
    pol = policy_fn(model)
    out = {"instances": {}, "iqm_profit_rl": 0.0, "iqm_profit_edd": 0.0}
    rl_all, edd_all = [], []
    for n, inst in zip(names, insts):
        idx = list(range(VALID_N_PER_INSTANCE))
        rl = run_episodes(inst, pol, vs, idx, 10_000, {"breakdowns": True})
        edd = run_episodes(inst, "rule:EDD", vs, idx, 10_000, {"breakdowns": True})
        scale = max(1.0, abs(np.mean([r["profit"] for r in edd])))
        rl_p = np.array([r["profit"] for r in rl]) / scale; ed_p = np.array([r["profit"] for r in edd]) / scale
        out["instances"][n] = {"rl_profit_iqm": iqm(rl_p), "edd_profit_iqm": iqm(ed_p),
                               "rl_mk": float(np.mean([r["makespan_h"] for r in rl])), "edd_mk": float(np.mean([r["makespan_h"] for r in edd])),
                               "rl_tard": float(np.mean([r["tardiness_h"] for r in rl])), "edd_tard": float(np.mean([r["tardiness_h"] for r in edd]))}
        rl_all.extend(rl_p.tolist()); edd_all.extend(ed_p.tolist())
    out["iqm_profit_rl"] = iqm(np.array(rl_all)); out["iqm_profit_edd"] = iqm(np.array(edd_all))
    # Балл ранней остановки — СРЕДНЕЕ ПО ЭКЗЕМПЛЯРАМ разностей IQM (пул по эпизодам скрывал провалы на крупных экземплярах).
    out["score"] = float(np.mean([v["rl_profit_iqm"] - v["edd_profit_iqm"] for v in out["instances"].values()]))
    return out


def train_seed(seed: int, steps: list[int], names: list[str], weeks: int, spec: EvalSpec, eval_every: int,
               env_cls=L0Env, policy_fn=sb3_policy, tag: str = "l0", max_sec: float = float("inf"), n_envs: int = N_ENVS) -> dict:
    torch.manual_seed(seed); np.random.seed(seed)
    CKPT.mkdir(parents=True, exist_ok=True)
    log: dict = {"seed": seed, "stages": [], "validations": []}
    model = None
    best, best_path = -np.inf, CKPT / f"{tag}_seed{seed}_best.zip"
    t0 = time.time()
    total = 0
    for stage, n_steps in enumerate(steps, start=1):
        if time.time() - t0 > max_sec:            # бюджет времени на сид исчерпан
            log["stopped_by_time"] = True
            break
        venv = stage_env(stage, names, seed, weeks, env_cls, n_envs)
        if model is None:
            model = MaskablePPO("MlpPolicy", venv, seed=seed, verbose=0, ent_coef=ENT[0], **PPO)
        else:
            model.set_env(venv)
        model.ent_coef = ENT[min(stage - 1, len(ENT) - 1)]
        done_in_stage = 0
        while done_in_stage < n_steps and time.time() - t0 <= max_sec:
            chunk = min(eval_every, n_steps - done_in_stage)
            model.learn(total_timesteps=chunk, reset_num_timesteps=False)
            done_in_stage += chunk; total += chunk
            v = validate(model, names, weeks, spec, policy_fn)
            v.update({"stage": stage, "steps": total, "sec": time.time() - t0})
            log["validations"].append({k: v[k] for k in ("stage", "steps", "sec", "iqm_profit_rl", "iqm_profit_edd", "score")})
            print(f"seed {seed} stage {stage} steps {total:7d}  IQM(Π/EDD): RL {v['iqm_profit_rl']:.4f}  EDD {v['iqm_profit_edd']:.4f}  "
                  f"score {v['score']:+.4f}  [{time.time() - t0:.0f}s]", flush=True)
            if v["score"] > best:              # ранняя остановка: лучший чекпойнт по валидации
                best = v["score"]; model.save(best_path)
                log["best"] = {"stage": stage, "steps": total, "score": best, "validation": v}
        log["stages"].append({"stage": stage, "steps": n_steps, "ent_coef": model.ent_coef})
    model.save(CKPT / f"{tag}_seed{seed}_last.zip")
    log["total_steps"] = total; log["sec"] = time.time() - t0
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"train_{tag}_seed{seed}.json").write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    return log


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--steps", type=int, nargs="+", default=[60_000, 100_000, 100_000])
    ap.add_argument("--eval-every", type=int, default=20_000)
    ap.add_argument("--weeks", type=int, default=26)
    a = ap.parse_args()
    names = maos_instance_names()
    spec = EvalSpec(weeks=a.weeks)
    for s in a.seeds:
        train_seed(s, a.steps, names, a.weeks, spec, a.eval_every)


if __name__ == "__main__":
    main()
