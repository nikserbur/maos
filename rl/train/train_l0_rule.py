"""L0 как ВЫБОР ПРАВИЛА (Tang 2026; PLAN-V2 §8 п.3; приоритет владельца A2): BC → PPO с CVaR.

    rl/.venv/bin/python -m rl.train.train_l0_rule --seeds 1 2 3 --steps 1500000 --max-minutes 30

Действия (rl.env.l0_env): 0..6 — правило, 7 — очередь по ключу CP-SAT, 8 — статический чемпион экземпляра
(лучшее из 8 статиков по CVaR₀.₁ прибыли на ВАЛИДАЦИИ), 9 — «ускорить срочный» поверх чемпиона.
1) Клонирование поведения (BC): эпизоды статического чемпиона (стохастические обучающие сценарии + один
   детерминированный прогон; на экземплярах, где чемпион — CP-SAT, это и есть тёплый старт CP-SAT) →
   кросс-энтропия по действию 8. Политика начинает РОВНО с чемпиона (CRN-эквивалентность — тест).
2) PPO (MaskablePPO) с терминальной долей прибыли по Рокафеллару–Урясеву (cvar=(α, λ)): RL учится,
   КОГДА отклоняться от чемпиона после событий, раскрытых по ходу исполнения.
Ранняя остановка — только по валидации (seed 777, генератор базы с событиями; не holdout): балл =
среднее по экземплярам ΔCVaR₀.₁(Π)/|E Π| к чемпиону + 0,5·ΔCVaR₀.₀₅(C_min)/|E Π|. BC-чекпойнт — точка
отсчёта: если PPO не улучшает валидацию, лучшим остаётся BC (≈ чемпион).
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

from rl.env.l0_env import A_DEFAULT, N_ACTIONS, L0RuleEnv
from rl.env.scenarios import STRESSES, ScenarioSet
from rl.eval.reactive import load_cp_keys, rs_policy, static_champions
from rl.train.common import (ALPHA_PROFIT, BETA_CASH, CKPT, RESULTS, cvar_lower, load_instances, maos_instance_names,
                             run_episodes)

PPO = dict(n_steps=1024, batch_size=512, learning_rate=1e-4, gamma=0.999, gae_lambda=0.95, clip_range=0.1,
           n_epochs=4, vf_coef=0.5, max_grad_norm=0.5, ent_coef=0.003, policy_kwargs=dict(net_arch=[128, 128]))
TRAIN_SEED, N_TRAIN, VALID_SEED, N_VALID = 100, 64, 777, 16     # [К] rl.l0rule.* / [НОРМ] rl.valid
CVAR = (ALPHA_PROFIT, 0.5)                                      # α, λ смеси E/CVaR в терминальной награде [К]
DELTA_H, DENSE, PAIRED = 0.0, True, 0.0                         # макро-шаг Δ ч, плотная награда, κ парной награды
BC_EPISODES, BC_EPOCHS, BC_SMOOTH = 6, 8, 0.3          # [К] rl.l0rule.bc


def champions(names, insts, cp_keys) -> dict:
    path = RESULTS / "l0rule_champions.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    vs = ScenarioSet(N_VALID, VALID_SEED, stress=STRESSES["base"])
    ch = static_champions(names, insts, vs, N_VALID, cp_keys)
    path.write_text(json.dumps(ch, indent=1, ensure_ascii=False), encoding="utf-8")
    return ch


def make_venv(insts, names, ch, cp_keys, seed: int, n_envs: int) -> DummyVecEnv:
    base = ScenarioSet(N_TRAIN, TRAIN_SEED, stress=STRESSES["base"])
    shock = ScenarioSet(N_TRAIN, TRAIN_SEED + 1, stress=STRESSES["shock"])
    dflt = [ch[n]["champion_a"] for n in names]
    keys = [cp_keys.get(n) for n in names]

    def mk(i: int):
        sc = shock if i % 2 else base
        return lambda: L0RuleEnv(insts, {"breakdowns": True, "dense_reward": DENSE}, sc, seed_base=seed * 100000 + i * 1000,
                                 defaults=dflt, cp_keys=keys, cvar=CVAR, delta_h=DELTA_H, paired=PAIRED)
    return DummyVecEnv([mk(i) for i in range(n_envs)])


def bc_dataset(insts, names, ch, cp_keys, seed: int) -> np.ndarray:
    """Наблюдения эпизодов статического чемпиона (стохастика + 1 детерминированный прогон на экземпляр)."""
    obs = []
    sc = ScenarioSet(N_TRAIN, TRAIN_SEED, stress=STRESSES["base"])
    rng = np.random.default_rng(seed)
    for k, n in enumerate(names):
        for det in (True,) + (False,) * BC_EPISODES:
            env = L0RuleEnv([insts[k]], {"breakdowns": not det, "deterministic": det, "dense_reward": DENSE}, None if det else sc,
                            seed_base=seed * 7 + k, defaults=[ch[n]["champion_a"]], cp_keys=[cp_keys.get(n)], delta_h=DELTA_H)
            o, _ = env.reset(options={"instance": 0, "scenario": int(rng.integers(N_TRAIN))})
            done = False
            while not done:
                obs.append(o)
                o, _, done, _, _ = env.step(A_DEFAULT)
    return np.asarray(obs, dtype=np.float32)


def behaviour_clone(model: MaskablePPO, obs: np.ndarray, epochs: int, seed: int) -> float:
    """Кросс-энтропия логитов актора к действию «чемпион» (маска — все действия, как при PPO)."""
    pol = model.policy
    opt = torch.optim.Adam(pol.parameters(), lr=1e-3)
    y = torch.full((len(obs),), A_DEFAULT, dtype=torch.long)
    x = torch.as_tensor(obs)
    g = torch.Generator().manual_seed(seed)
    loss_v = 0.0
    for _ in range(epochs):
        perm = torch.randperm(len(x), generator=g)
        for i in range(0, len(x), 1024):
            b = perm[i:i + 1024]
            dist = pol.get_distribution(x[b])
            logits = dist.distribution.logits
            loss = torch.nn.functional.cross_entropy(logits, y[b], label_smoothing=BC_SMOOTH)   # p(чемпион) ≈ 0.7: PPO сохраняет разведку
            opt.zero_grad(); loss.backward(); opt.step()
            loss_v = float(loss.item())
    return loss_v


def validate(model, names, insts, ch, cp_keys) -> dict:
    vs = ScenarioSet(N_VALID, VALID_SEED, stress=STRESSES["base"])
    idx = list(range(N_VALID))
    pol = rs_policy({n: ch[n] for n in names}, cp_keys, model=model, delta_h=DELTA_H)
    per = {}
    for n, inst in zip(names, insts):
        a = run_episodes(inst, pol, vs, idx, 10_000, {"breakdowns": True})
        b_key = ("key", cp_keys[n]) if ch[n]["champion_a"] == 7 else None
        b = (run_episodes(inst, "key", vs, idx, 10_000, {"breakdowns": True}, key=cp_keys[n]) if b_key
             else run_episodes(inst, f"rule:{ch[n]['champion']}", vs, idx, 10_000, {"breakdowns": True}))
        pa, pb = np.array([r["profit"] for r in a]), np.array([r["profit"] for r in b])
        ca, cb = np.array([r["min_cash"] for r in a]), np.array([r["min_cash"] for r in b])
        s = max(1.0, abs(pb.mean()))
        per[n] = {"d_cvar": (cvar_lower(pa, ALPHA_PROFIT) - cvar_lower(pb, ALPHA_PROFIT)) / s,
                  "d_cash": (cvar_lower(ca, BETA_CASH) - cvar_lower(cb, BETA_CASH)) / s,
                  "d_mean": (pa.mean() - pb.mean()) / s}
    score = float(np.mean([v["d_cvar"] + 0.5 * v["d_cash"] for v in per.values()]))
    return {"score": score, "per_instance": per, "actions": {k: v.tolist() for k, v in pol.counts.items()}}


def train_seed(seed: int, steps: int, eval_every: int, max_sec: float, n_envs: int, tag: str = "l0rule") -> dict:
    torch.manual_seed(seed); np.random.seed(seed)
    CKPT.mkdir(parents=True, exist_ok=True)
    names = maos_instance_names(); insts = load_instances(names)
    cp_keys = load_cp_keys()
    ch = champions(names, insts, cp_keys)
    t0 = time.time()
    venv = make_venv(insts, names, ch, cp_keys, seed, n_envs)
    model = MaskablePPO("MlpPolicy", venv, seed=seed, verbose=0, **PPO)
    obs = bc_dataset(insts, names, ch, cp_keys, seed)
    bc_loss = behaviour_clone(model, obs, BC_EPOCHS, seed)
    model.save(CKPT / f"{tag}_seed{seed}_bc.zip")
    v = validate(model, names, insts, ch, cp_keys)
    log = {"seed": seed, "tag": tag, "delta_h": DELTA_H, "dense": DENSE, "paired": PAIRED, "bc": {"n_obs": int(len(obs)), "loss": bc_loss, "validation": v, "sec": time.time() - t0},
           "validations": [{"steps": 0, "score": v["score"], "sec": time.time() - t0, "phase": "bc"}], "cvar": CVAR, "ppo": PPO}
    best, best_path = v["score"], CKPT / f"{tag}_seed{seed}_best.zip"
    model.save(best_path)
    log["best"] = {"steps": 0, "score": best, "phase": "bc"}
    print(f"seed {seed} BC: n={len(obs)} loss={bc_loss:.4f} валидация {v['score']:+.5f} [{time.time() - t0:.0f}s]", flush=True)
    done = 0
    while done < steps and time.time() - t0 < max_sec:
        model.learn(total_timesteps=eval_every, reset_num_timesteps=False)
        done += eval_every
        v = validate(model, names, insts, ch, cp_keys)
        log["validations"].append({"steps": done, "score": v["score"], "sec": time.time() - t0, "phase": "ppo"})
        print(f"seed {seed} PPO {done:8d} валидация {v['score']:+.5f} [{time.time() - t0:.0f}s]", flush=True)
        if v["score"] > best:
            best = v["score"]; model.save(best_path)
            log["best"] = {"steps": done, "score": best, "phase": "ppo", "validation": v}
    model.save(CKPT / f"{tag}_seed{seed}_last.zip")
    log["total_steps"] = done; log["sec"] = time.time() - t0
    (RESULTS / f"train_{tag}_seed{seed}.json").write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")
    return log


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--steps", type=int, default=1_500_000)
    ap.add_argument("--eval-every", type=int, default=100_000)
    ap.add_argument("--max-minutes", type=float, default=30.0)
    ap.add_argument("--n-envs", type=int, default=16)
    ap.add_argument("--delta-h", type=float, default=0.0, help="макро-шаг: действие держится Δ часов (0 — каждое событие)")
    ap.add_argument("--no-dense", action="store_true", help="только терминальная награда (прибыль/касса, RU-CVaR)")
    ap.add_argument("--lam", type=float, default=0.5, help="λ: доля CVaR (RU) в терминальной прибыли")
    ap.add_argument("--tag", type=str, default="l0rule")
    ap.add_argument("--paired", type=float, default=0.0, help="κ: парная (CRN) награда к чемпиону, вес хвоста 1+κ (0 — выкл.)")
    a = ap.parse_args()
    global DELTA_H, DENSE, CVAR, PAIRED
    DELTA_H, DENSE, CVAR, PAIRED = a.delta_h, not a.no_dense, (ALPHA_PROFIT, a.lam), a.paired
    for s in a.seeds:
        train_seed(s, a.steps, a.eval_every, a.max_minutes * 60, a.n_envs, a.tag)


if __name__ == "__main__":
    main()
