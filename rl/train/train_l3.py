"""Структурный RL A3 (L2 + L3 поверх диспетчеризации чемпионом): BC от лучшей эвристики → PPO с CVaR-парной наградой.

    rl/.venv/bin/python -m rl.train.train_l3 --seeds 1 2 3 --steps 500000      # → rl/train/checkpoints/l3_seed*_{bc,best,last}.zip

Протокол — rl/eval/prereg_a3.md §7 (зафиксирован до запуска): эпоха = неделя или экстренное событие, ≤ 3 хода за
эпоху, 13 ходов с масками SimEnv; учитель BC — H* экземпляра (лучшая эвристика на валидации, headroom_a3);
награда — терминальная парная (CRN) к H* на том же сценарии с весом хвоста 1 + κ (CVaR-фокус); смесь стрессов
base/shock по средам; ранняя остановка и выбор чекпойнта — только по баллу валидации к H* (seed 777, 32 сценария).
"""
from __future__ import annotations

import argparse
import json
import time
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.vec_env import SubprocVecEnv

from rl.env.l3_env import StructEnv, augment, rl_policy, run_struct
from rl.eval.a3_common import (A3_RES, N_TRAIN, N_VALID, TRAIN_BASE, a3_names, library, load_a3, metrics, save, scen,
                               score)
from rl.train.common import CKPT

PPO = dict(n_steps=256, batch_size=1024, learning_rate=5e-5, gamma=0.995, gae_lambda=0.95, clip_range=0.1, n_epochs=5,
           vf_coef=0.5, max_grad_norm=0.5, ent_coef=0.002, policy_kwargs=dict(net_arch=[256, 256]))   # [К] rl.a3.ppo
KAPPA, ALPHA, W_CASH = 4.0, 0.1, 0.5          # CVaR-вес хвоста, α, вес кассы в парной награде [К] rl.a3.reward
BC_SCEN, BC_EPOCHS, BC_SMOOTH = 48, 10, 0.05   # сценариев учителя на экземпляр и пул, эпох, сглаживание [К] rl.a3.bc
POOLS = ("base", "shock")


def champions() -> dict:
    return json.loads((A3_RES / "champions_a3.json").read_text(encoding="utf-8"))


def heuristic(name: str):
    lib = {h.name: h for h in library()}
    return lib[name]


def teacher(name: str):
    """Учитель H* экземпляра (None → noop); суффикс «+sweep» — H* + погашение линии излишком кассы (вариант B)."""
    if name.endswith("+sweep"):
        from rl.eval.struct_policies import with_sweep
        return with_sweep(teacher(name[: -len("+sweep")]))
    return None if name == "noop" else heuristic(name)


def _ref_one(args):
    name, rule, h, pool = args
    sc, base = scen("train", N_TRAIN, pool)
    rows = run_struct(load_a3(name), teacher(h), sc, list(range(N_TRAIN)), base, dispatch=(rule, []))
    return name, pool, {"profit": [r["profit"] for r in rows], "min_cash": [r["min_cash"] for r in rows]}


def reference(names: list[str], ch: dict, workers: int, tag: str = "l3") -> dict:
    """Прибыль/мин. касса учителя H* на ВСЕХ обучающих сценариях (база парной награды); кэш на диске."""
    path = A3_RES / ("ref_train_a3.json" if tag == "l3" else f"ref_train_a3_{tag}.json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    out: dict = {p: {} for p in POOLS}
    with ProcessPoolExecutor(workers) as ex:
        for n, pool, r in ex.map(_ref_one, [(n, ch[n]["rule"], ch[n]["h_star"], p) for n in names for p in POOLS]):
            out[pool][n] = r
    save(path, out)
    return out


def _bc_one(args):
    name, rule, h, pool, seed = args
    sc, base = scen("train", N_TRAIN, pool)
    idx = [int(i) for i in np.random.default_rng([seed, zlib.crc32(name.encode()), POOLS.index(pool)]).choice(N_TRAIN, BC_SCEN, replace=False)]
    rows = run_struct(load_a3(name), teacher(h), sc, idx, base, dispatch=(rule, []), record=True)
    o = np.asarray([t[0] for r in rows for t in r["_traj"]], np.float32); m = np.asarray([t[1] for r in rows for t in r["_traj"]], bool)
    a = np.asarray([t[2] for r in rows for t in r["_traj"]], np.int64)
    return augment(o, m, teacher(h)), m, a


def bc_dataset(names: list[str], ch: dict, seed: int, workers: int):
    with ProcessPoolExecutor(workers) as ex:
        parts = list(ex.map(_bc_one, [(n, ch[n]["rule"], ch[n]["h_star"], p, seed) for n in names for p in POOLS]))
    return (np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts]), np.concatenate([p[2] for p in parts]))


def behaviour_clone(model: MaskablePPO, obs: np.ndarray, mask: np.ndarray, act: np.ndarray, seed: int) -> float:
    """Кросс-энтропия маскированных логитов актора к действию учителя H*; сглаживание — только по ДОПУСТИМЫМ ходам."""
    pol = model.policy
    opt = torch.optim.Adam(pol.parameters(), lr=1e-3)
    x, mk, y = torch.as_tensor(obs), torch.as_tensor(mask), torch.as_tensor(act)
    g = torch.Generator().manual_seed(seed)
    loss_v = 0.0
    for _ in range(BC_EPOCHS):
        perm = torch.randperm(len(x), generator=g)
        for i in range(0, len(x), 1024):
            b = perm[i:i + 1024]
            logits = pol.get_distribution(x[b]).distribution.logits
            logp = torch.log_softmax(torch.where(mk[b], logits, torch.full_like(logits, -1e9)), dim=1)
            valid = mk[b].float()
            tgt = (1 - BC_SMOOTH) * torch.nn.functional.one_hot(y[b], logits.shape[1]).float() + BC_SMOOTH * valid / valid.sum(1, keepdim=True)
            loss = -(tgt * torch.where(mk[b], logp, torch.zeros_like(logp))).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step()
            loss_v = float(loss.item())
    return loss_v


def _val_one(args):
    name, rule, h, ckpt = args
    torch.set_num_threads(1)
    model = MaskablePPO.load(ckpt, device="cpu")
    sc, base = scen("valid", N_VALID)
    rows = run_struct(load_a3(name), rl_policy(model, teacher(h)), sc, list(range(N_VALID)), base, dispatch=(rule, []))
    kinds: dict[str, int] = {}
    for r in rows:
        for mv in r["moves"]:
            kinds[mv["kind"]] = kinds.get(mv["kind"], 0) + 1
    return name, metrics(rows), kinds


def validate(ckpt: Path, names: list[str], ch: dict, hr: dict, workers: int, ref_scores: dict | None = None) -> dict:
    """Балл валидации к H*: среднее по экземплярам [ΔCVaR₀.₁(Π) + 0.5·ΔCVaR₀.₀₅(C_min)]/V (score линеен по разностям)."""
    with ProcessPoolExecutor(workers) as ex:
        res = list(ex.map(_val_one, [(n, ch[n]["rule"], ch[n]["h_star"], str(ckpt)) for n in names]))
    per = {}
    for n, m, kinds in res:
        inst = hr["instances"][n]
        s_rl = score(m, inst["rule_val"][inst["rule"]], inst["V"])
        s_ref = ref_scores[n] if ref_scores else inst["val_scores"][inst["h_star"]]
        per[n] = {"score_vs_hstar": s_rl - s_ref, "score_vs_rule": s_rl, "moves": kinds,
                  "profit_cvar": m["profit_cvar"], "p_breach": m["p_breach"]}
    return {"score": float(np.mean([v["score_vs_hstar"] for v in per.values()])), "per_instance": per}


def make_venv(names: list[str], ch: dict, ref: dict, seed: int, n_envs: int) -> SubprocVecEnv:
    def mk(i: int):
        pool = POOLS[i % 2]

        def thunk():
            sc, base = scen("train", N_TRAIN, pool)
            return StructEnv([load_a3(n) for n in names], sc, base, [(ch[n]["rule"], []) for n in names],
                             ref=[ref[pool][n] for n in names], kappa=KAPPA, alpha=ALPHA, w_cash=W_CASH, seed=seed * 1000 + i,
                             teachers=[teacher(ch[n]["h_star"]) for n in names])
        return thunk
    return SubprocVecEnv([mk(i) for i in range(n_envs)], start_method="spawn")


def sweep_scores(names: list[str], ch: dict, hr: dict, workers: int) -> dict:
    """Балл валидации учителя «H* + погашение» к лучшему правилу (вариант B; кэш)."""
    path = A3_RES / "sweep_val_a3.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    with ProcessPoolExecutor(workers) as ex:
        res = list(ex.map(_teacher_val, [(n, ch[n]["rule"], ch[n]["h_star"]) for n in names]))
    out = {n: score(m, hr["instances"][n]["rule_val"][hr["instances"][n]["rule"]], hr["instances"][n]["V"]) for n, m in res}
    save(path, out)
    return out


def _teacher_val(args):
    name, rule, h = args
    sc, base = scen("valid", N_VALID)
    return name, metrics(run_struct(load_a3(name), teacher(h), sc, list(range(N_VALID)), base, dispatch=(rule, [])))


def train_seed(seed: int, steps: int, eval_every: int, n_envs: int, workers: int, max_min: float, variant: str = "hstar") -> dict:
    torch.manual_seed(seed); np.random.seed(seed)
    CKPT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    names, ch = a3_names(), champions()
    hr = json.loads((A3_RES / "headroom_a3.json").read_text(encoding="utf-8"))
    tag, ref_scores = "l3", None
    if variant == "sweep":                 # вариант B: учитель и база награды — H* + погашение линии излишком кассы
        tag = "l3s"
        ch = {n: {**c, "h_star": c["h_star"] + "+sweep"} for n, c in ch.items()}
        ref_scores = sweep_scores(names, ch, hr, workers)
    ref = reference(names, ch, workers, tag)
    obs, mask, act = bc_dataset(names, ch, seed, workers)
    venv = make_venv(names, ch, ref, seed, n_envs)
    model = MaskablePPO("MlpPolicy", venv, seed=seed, verbose=0, device="cpu", **PPO)
    bc_loss = behaviour_clone(model, obs, mask, act, seed)
    agree = float(np.mean(np.asarray(model.predict(obs, action_masks=mask, deterministic=True)[0]) == act))
    print(f"seed {seed} BC готов: согласие с H* {agree:.4f} [{time.time() - t0:.0f} с]", flush=True)
    paths = {k: CKPT / f"{tag}_seed{seed}_{k}.zip" for k in ("bc", "best", "last")}
    model.save(paths["bc"]); model.save(paths["best"])
    v = validate(paths["bc"], names, ch, hr, workers, ref_scores)
    log = {"seed": seed, "variant": variant, "tag": tag, "ppo": PPO, "kappa": KAPPA, "alpha": ALPHA, "w_cash": W_CASH,
           "bc": {"n": int(len(obs)), "loss": bc_loss, "agreement": agree, "score": v["score"], "sec": time.time() - t0},
           "curve": [{"steps": 0, "score": v["score"], "phase": "bc", "sec": time.time() - t0}],
           "best": {"steps": 0, "score": v["score"], "phase": "bc", "validation": v}}
    best = v["score"]
    print(f"seed {seed} BC: n={len(obs)} loss={bc_loss:.4f} согласие {agree:.3f} валидация к H* {best:+.5f} [{time.time() - t0:.0f} с]", flush=True)
    while model.num_timesteps < steps and time.time() - t0 < max_min * 60:
        model.learn(total_timesteps=eval_every, reset_num_timesteps=False)
        model.save(paths["last"])
        v = validate(paths["last"], names, ch, hr, workers, ref_scores)
        log["curve"].append({"steps": int(model.num_timesteps), "score": v["score"], "phase": "ppo", "sec": time.time() - t0})
        print(f"seed {seed} PPO {model.num_timesteps:8d} валидация к H* {v['score']:+.5f} [{time.time() - t0:.0f} с]", flush=True)
        if v["score"] > best:
            best = v["score"]; model.save(paths["best"])
            log["best"] = {"steps": int(model.num_timesteps), "score": best, "phase": "ppo", "validation": v}
    venv.close()
    log["decisions"] = int(model.num_timesteps); log["sec"] = time.time() - t0
    save(A3_RES / f"train_{tag}_seed{seed}.json", log)
    return log


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--steps", type=int, default=500_000)
    ap.add_argument("--eval-every", type=int, default=100_000)
    ap.add_argument("--n-envs", type=int, default=16)
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--max-minutes", type=float, default=120.0)
    ap.add_argument("--variant", choices=["hstar", "sweep"], default="hstar")
    a = ap.parse_args()
    for s in a.seeds:
        train_seed(s, a.steps, a.eval_every, a.n_envs, a.workers, a.max_minutes, a.variant)


if __name__ == "__main__":
    main()
