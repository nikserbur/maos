"""Обучение L2 (планировщик: структурные + финансовые ходы) поверх ЗАМОРОЖЕННОЙ L0 — стадия 4 куррикулума §7.4.

    rl/.venv/bin/python -m rl.train.train_l2 --seeds 1 2 3 --steps 30000 --l0 rule:EDD
    rl/.venv/bin/python -m rl.train.train_l2 --seeds 1 --l0 ckpt:rl/train/checkpoints/l0_seed1_best.zip

Эпоха L2 — начало недели (и неделя 0); действие — один ход из маскированного меню (сдвиг запуска,
дробление/слияние, аутсорсинг, маршрут, назначение типа РЦ, транш/погашение) или noop; до
max_moves_per_week ходов за эпоху. Сценарии обучения — смесь базовых и кризисных (CRN).
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.env.l2_env import L2Env
from rl.env.scenarios import STRESSES, ScenarioSet
from rl.train.common import CKPT, RESULTS, EvalSpec, iqm, load_instances, maos_instance_names, run_episodes, sb3_policy
from rl.train.train_l0 import N_TRAIN_SCEN, TRAIN_SCEN_SEED, VALID_N_PER_INSTANCE

PPO_L2 = dict(n_steps=256, batch_size=128, learning_rate=3e-4, gamma=0.99, gae_lambda=0.95, clip_range=0.2,
              n_epochs=4, ent_coef=0.01, policy_kwargs=dict(net_arch=[128, 128]))
N_ENVS = 4


def l0_from_spec(spec: str):
    if spec.startswith("rule:"):
        return spec
    if spec.startswith("ckpt:"):
        model = MaskablePPO.load(spec[5:], device="cpu")
        pol = sb3_policy(model)
        return lambda obs, mask: int(pol(obs[None, :], mask[None, :].astype(bool))[0])
    raise ValueError(spec)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--steps", type=int, default=30_000)
    ap.add_argument("--eval-every", type=int, default=5_000)
    ap.add_argument("--l0", type=str, default="rule:EDD")
    ap.add_argument("--weeks", type=int, default=26)
    a = ap.parse_args()
    names = maos_instance_names(); insts = load_instances(names)
    spec = EvalSpec(weeks=a.weeks)
    base = ScenarioSet(N_TRAIN_SCEN, TRAIN_SCEN_SEED, weeks=a.weeks)
    crisis = ScenarioSet(N_TRAIN_SCEN, TRAIN_SCEN_SEED + 1, weeks=a.weeks, stress=STRESSES["crisis"])
    vs = ScenarioSet(VALID_N_PER_INSTANCE, spec.valid_seed, weeks=a.weeks)
    inner = l0_from_spec(a.l0)
    tag = "edd" if a.l0.startswith("rule:") else "l0"
    for seed in a.seeds:
        torch.manual_seed(seed); np.random.seed(seed)
        venv = DummyVecEnv([(lambda i=i: L2Env(insts, {"breakdowns": True}, crisis if i % 2 else base,
                                                 seed_base=seed * 100000 + i * 1000, l0_policy=inner)) for i in range(N_ENVS)])
        model = MaskablePPO("MlpPolicy", venv, seed=seed, verbose=0, **PPO_L2)
        best, log, t0, total = -np.inf, {"seed": seed, "l0": a.l0, "validations": []}, time.time(), 0
        best_path = CKPT / f"l2_{tag}_seed{seed}_best.zip"
        while total < a.steps:
            chunk = min(a.eval_every, a.steps - total)
            model.learn(total_timesteps=chunk, reset_num_timesteps=False); total += chunk
            pol = sb3_policy(model)
            rl_all, ref_all, nmoves = [], [], []
            l0_batch = inner if isinstance(inner, str) else (lambda o, m: np.array([inner(o[i], m[i]) for i in range(len(o))]))
            for inst in insts:
                idx = list(range(VALID_N_PER_INSTANCE))
                rl = run_episodes(inst, inner, vs, idx, 10_000, {"breakdowns": True, "l2_enabled": True}, l2_policy=pol, l0_inner=l0_batch)
                ref = run_episodes(inst, inner, vs, idx, 10_000, {"breakdowns": True}, l0_inner=l0_batch)
                scale = max(1.0, abs(np.mean([r["profit"] for r in ref])))
                rl_all += [r["profit"] / scale for r in rl]; ref_all += [r["profit"] / scale for r in ref]
                nmoves += [len(r["moves"]) for r in rl]
            v = {"steps": total, "sec": time.time() - t0, "iqm_profit_l2": iqm(np.array(rl_all)), "iqm_profit_ref": iqm(np.array(ref_all)),
                 "moves_per_episode": float(np.mean(nmoves))}
            v["score"] = v["iqm_profit_l2"] - v["iqm_profit_ref"]
            log["validations"].append(v)
            print(f"L2 seed {seed} steps {total:6d}  IQM(Π/ref): L2 {v['iqm_profit_l2']:.4f} ref {v['iqm_profit_ref']:.4f} "
                  f"score {v['score']:+.4f} moves/ep {v['moves_per_episode']:.2f} [{v['sec']:.0f}s]", flush=True)
            if v["score"] > best:
                best = v["score"]; model.save(best_path); log["best"] = v
        model.save(CKPT / f"l2_{tag}_seed{seed}_last.zip")
        RESULTS.mkdir(parents=True, exist_ok=True)
        (RESULTS / f"train_l2_{tag}_seed{seed}.json").write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
