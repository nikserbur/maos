"""Структурный RL A4 (rl/eval/prereg_a4.md §7): BC от C* → PPO с доверительной областью и CVaR по пакету общих
сценариев (Рокафеллар–Урясев), наблюдение A4 (последствия ходов, дескрипторы) + ход C*.

    rl/.venv/bin/python -m rl.train.train_l4 --variant A --seeds 1 2 3     # → rl/train/checkpoints/l4A_seed*_{bc,best,last}.pt

Итерация: для каждого экземпляра A3 — пакет из B = 32 обучающих сценариев (половина экземпляров — пул base,
половина — shock, чередование по итерациям); эпизоды политики (стохастической) и эталона C* — на одних и тех же
сценариях (CRN). Терминальная награда эпизода (η — α-квантиль прибыли политики по пакету):
    r = 100/V·[(1−λ)(Π − Π_C*) + λ((η − Π_C*)⁺ − (η − Π)⁺)/α + w_c(min(0, C_min) − min(0, C_min,C*))].
PPO: clip 0.1, target KL 0.01 (эпохи прерываются при KL > 1.5·цели), lr 3e-5, γ = 1, A = r − V(s).
Ранняя остановка / чекпойнт — по баллу валидации к C* (128 сценариев × 30 экземпляров A3, детерминированно).

Вариант C («лоза», TRPO vine, Schulman et al. 2015 §5.2): ствол — детерминированная текущая политика на B = 32
сценариях пакета; в одной случайной точке решения эпизода (≥ 2 допустимых хода) — ветви по ВСЕМ допустимым ходам,
каждая доигрывается текущей политикой на ТОМ ЖЕ сценарии (CRN, повтор префикса ходов); Q̂(s,a) = 100/V·[(1−λ)Π_a +
λ(η − (η − Π_a)⁺/α) + w_c·min(0, C_min,a)], η — α-квантиль прибыли ствола по пакету; обновление — градиент по всем
действиям Σ_a π(a|s)(Q̂ − Σ π_old Q̂) с доверительной областью KL(π_old‖π) ≤ цели.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import torch
from torch import nn

from rl.env.l3_env import N_ACT, augment
from rl.eval.a3_common import library
from rl.eval.a4_common import (A4_RES, N_OBS4, N_VALID4, la_family, load4, metrics, run4, save, scen4, score, set_names,
                               value_of)
from rl.train.common import CKPT

N_IN = N_OBS4 + 2 * N_ACT                                   # 80 + ход C* + ход LA* (поправка П2)
B_GROUP, N_TRAIN, ALPHA, W_CASH = 32, 512, 0.1, 0.5         # [К] rl.a4.reward
LAMBDA = {"A": 0.5, "B": 1.0, "C": 0.5, "D": 0.5}           # варианты §7 (+ П1: C — «лоза»; П4, пост-хок: D)
VINE = dict(lr=1e-4, epochs=20, target_kl=0.01, branch=1)   # [К] rl.a4.vine
# П4 (пост-хок, до holdout): в C доверительная область не связывала (KL 0.0005–0.006 за итерацию при 20 эпохах —
# ограничивал шаг lr), argmax не менялся. D — та же «лоза» с шагом, при котором связывает KL.
VINE_D = dict(lr=1e-3, epochs=50, target_kl=0.02, branch=1)  # [К] rl.a4.vine_d
PPO = dict(lr=3e-5, clip=0.1, target_kl=0.01, epochs=4, minibatch=4096, ent=0.001, vf=0.5, max_grad=0.5)  # [К] rl.a4.ppo
BC = dict(scen=48, epochs=10, smooth=0.05, lr=1e-3)         # [К] rl.a4.bc
POOLS = ("base", "shock")
TMP = A4_RES / "tmp"


# ── Сеть ──────────────────────────────────────────────────────────────────────────────────────────────────────────
class ActorCritic(nn.Module):
    def __init__(self, n_in: int = N_IN, n_act: int = N_ACT, hid: int = 256):
        super().__init__()
        self.pi = nn.Sequential(nn.Linear(n_in, hid), nn.Tanh(), nn.Linear(hid, hid), nn.Tanh(), nn.Linear(hid, n_act))
        self.v = nn.Sequential(nn.Linear(n_in, hid), nn.Tanh(), nn.Linear(hid, hid), nn.Tanh(), nn.Linear(hid, 1))

    def logits(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        return self.pi(x).masked_fill(~mask, -1e9)


def champions() -> dict:
    return json.loads((A4_RES / "champions_a4.json").read_text(encoding="utf-8"))


_LIB = None
_CACHE: dict = {}


def spec_of(ch: dict, n: str) -> str:
    """Подсказки экземпляра для входа RL: «C*|LA*» (имена неучащихся политик, выбранных на валидации)."""
    return f"{ch[n]['C*']}|{ch[n]['LA*']}"


def teacher(spec: str):
    """C* экземпляра (имя политики библиотеки A3 до «|»; noop → None) — учитель BC и эталон награды."""
    global _LIB
    if _LIB is None:
        _LIB = {h.name: h for h in library()}
    h = _LIB[spec.split("|")[0]]
    return None if (h.name == "noop" and not h.invest) else h


def la_teacher(spec: str):
    parts = spec.split("|")
    return {h.name: h for h in la_family()}[parts[1]] if len(parts) > 1 else None


def aug2(obs: np.ndarray, mask: np.ndarray, spec: str) -> np.ndarray:
    """Вход RL: признаки A4 + one-hot хода C* (как П3 A3) + one-hot хода LA* (поправка П2) на том же наблюдении."""
    obs = np.atleast_2d(obs).astype(np.float32); mask = np.atleast_2d(mask).astype(bool)
    x = augment(obs, mask, teacher(spec))
    la = la_teacher(spec)
    a = np.zeros(len(x), dtype=int) if la is None else np.asarray(la(obs, mask), dtype=int)
    oh = np.zeros((len(x), N_ACT), dtype=np.float32)
    oh[np.arange(len(x)), a] = 1.0
    return np.concatenate([x, oh], axis=1)


def _inst(name: str):
    if name not in _CACHE:
        _CACHE[name] = load4(name)
    return _CACHE[name]


def policy_fn(net: ActorCritic, spec: str, stochastic: bool, gen: torch.Generator | None):
    def f(obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        x = torch.as_tensor(aug2(obs, mask, spec)); mk = torch.as_tensor(np.atleast_2d(mask).astype(bool))
        with torch.no_grad():
            lg = net.logits(x, mk)
            if not stochastic:
                return lg.argmax(1).numpy()
            p = torch.softmax(lg, 1)
            return torch.multinomial(p, 1, generator=gen).squeeze(1).numpy()
    return f


_NET: dict = {}


def _net(path: str) -> ActorCritic:
    st = os.stat(path).st_mtime_ns
    if _NET.get("key") != (path, st):
        torch.set_num_threads(1)
        net = ActorCritic(); net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True)); net.eval()
        _NET.update(key=(path, st), net=net)
    return _NET["net"]


# ── Рабочие процессы ──────────────────────────────────────────────────────────────────────────────────────────────
def _rollout(args):
    """Пакет эпизодов одного экземпляра на общих сценариях: (наблюдения, маски, действия по эпизодам; итоги)."""
    name, rule, cstar, pool, idxs, ckpt, seed = args
    torch.set_num_threads(1)
    net, tch = _net(ckpt), teacher(cstar)
    gen = torch.Generator().manual_seed(seed)
    sc, base = scen4("train", N_TRAIN, pool)
    rows = run4(_inst(name), policy_fn(net, cstar, True, gen), sc, base, idxs, rule, record=True)
    eps = []
    for r in rows:
        tr = r.pop("_traj")
        o = np.asarray([t[0] for t in tr], np.float32).reshape(-1, N_OBS4); m = np.asarray([t[1] for t in tr], bool).reshape(-1, N_ACT)
        a = np.asarray([t[2] for t in tr], np.int64)
        x = aug2(o, m, cstar) if len(o) else np.zeros((0, N_IN), np.float32)
        ta = np.asarray(tch(o, m), np.int64) if (tch is not None and len(o)) else np.zeros(len(o), np.int64)
        eps.append({"x": x, "m": m, "a": a, "dev": int(np.sum(a != ta)), "profit": r["profit"], "min_cash": r["min_cash"],
                    "kinds": [mv["kind"] for mv in r["moves"]]})
    return name, pool, idxs, eps


def _ref_one(args):
    name, rule, cstar, pool = args
    sc, base = scen4("train", N_TRAIN, pool)
    rows = run4(_inst(name), teacher(cstar), sc, base, list(range(N_TRAIN)), rule)
    return name, pool, {"profit": [r["profit"] for r in rows], "min_cash": [r["min_cash"] for r in rows]}


def _bc_one(args):
    name, rule, cstar, pool, seed = args
    sc, base = scen4("train", N_TRAIN, pool)
    idx = [int(i) for i in np.random.default_rng([seed, zlib.crc32(name.encode()), POOLS.index(pool)]).choice(N_TRAIN, BC["scen"], replace=False)]
    tch = teacher(cstar)
    rows = run4(_inst(name), tch, sc, base, idx, rule, record=True)
    o = np.asarray([t[0] for r in rows for t in r["_traj"]], np.float32).reshape(-1, N_OBS4)
    m = np.asarray([t[1] for r in rows for t in r["_traj"]], bool).reshape(-1, N_ACT)
    a = np.asarray([t[2] for r in rows for t in r["_traj"]], np.int64)
    return aug2(o, m, cstar), m, a


def _val_one(args):
    name, rule, cstar, ckpt = args
    torch.set_num_threads(1)
    sv, bv = scen4("valid", N_VALID4)
    rows = run4(_inst(name), policy_fn(_net(ckpt), cstar, False, None), sv, bv, list(range(N_VALID4)), rule)
    kinds: dict[str, int] = {}
    for r in rows:
        for mv in r["moves"]:
            kinds[mv["kind"]] = kinds.get(mv["kind"], 0) + 1
    return name, metrics(rows), kinds


def _play(inst, rule: str, sc, base: int, jobs: list[tuple], net: ActorCritic, spec: str) -> list[dict]:
    """Эпизоды «по сценарию» шагом в ногу: job = (i, префикс ходов, точка ветвления d | −1, ход в точке d | −1);
    после префикса и ветвления — детерминированная текущая политика. record: (x, маска, ход) каждой эпохи."""
    from rl.env.l3_env import make_struct_env
    from rl.eval.a4_common import CFG4
    envs, k_dec, traj = [], [], []
    for i, pre, d, a in jobs:
        e = make_struct_env(inst, CFG4, (rule, []))
        e.reset(base + i, sc.scenario_json(i))
        envs.append(e); k_dec.append(0); traj.append([])
    pol = policy_fn(net, spec, False, None)
    active = list(range(len(envs)))
    while active:
        for k in active:
            if envs[k].level == 0 and not envs[k].done:
                envs[k].run_l0()
        l2 = [k for k in active if envs[k].level == 2 and not envs[k].done]
        if l2:
            obs = np.stack([envs[k].obs_l2() for k in l2]).astype(np.float32)
            mask = np.stack([envs[k].mask_l2() for k in l2]).astype(bool)
            acts = np.asarray(pol(obs, mask), dtype=int)
            for k, o, m, a_pol in zip(l2, obs, mask, acts):
                i, pre, d, a_br = jobs[k]
                n = k_dec[k]
                a = pre[n] if n < len(pre) else (a_br if n == d else int(a_pol))
                a = a if m[a] else 0
                traj[k].append((o, m, a)); k_dec[k] += 1
                envs[k].step(a)
        active = [k for k in active if not envs[k].done]
    out = []
    for e, t in zip(envs, traj):
        s = json.loads(e.summary())
        out.append({"profit": s["profit"], "min_cash": s["min_cash"], "traj": t, "kinds": [mv["kind"] for mv in s["moves"]]})
    return out


def _vine(args):
    """Ствол (B сценариев) + ветви по всем допустимым ходам в одной случайной точке решения каждого эпизода."""
    name, rule, cstar, pool, idxs, ckpt, seed = args
    torch.set_num_threads(1)
    net, inst = _net(ckpt), _inst(name)
    rng = np.random.default_rng(seed)
    sc, base = scen4("train", N_TRAIN, pool)
    trunk = _play(inst, rule, sc, base, [(i, [], -1, -1) for i in idxs], net, cstar)
    jobs, meta = [], []
    for i, tr in zip(idxs, trunk):
        cand = [d for d, (o, m, a) in enumerate(tr["traj"]) if m.sum() >= 2]
        for d in rng.choice(cand, min(VINE["branch"], len(cand)), replace=False) if cand else []:
            o, m, a0 = tr["traj"][d]
            pre = [t[2] for t in tr["traj"][:d]]
            acts = [int(a) for a in np.flatnonzero(m)]
            meta.append({"i": i, "d": int(d), "o": o, "m": m, "a0": int(a0), "acts": acts, "j0": len(jobs)})
            jobs += [(i, pre, int(d), a) for a in acts]
    br = _play(inst, rule, sc, base, jobs, net, cstar) if jobs else []
    states = []
    for mt in meta:
        res = br[mt["j0"]:mt["j0"] + len(mt["acts"])]
        x = aug2(mt["o"][None], mt["m"][None], cstar)[0]
        states.append({"x": x, "m": mt["m"], "acts": mt["acts"], "a0": mt["a0"], "profit": [r["profit"] for r in res],
                       "min_cash": [r["min_cash"] for r in res]})
    n_dec = sum(len(t["traj"]) for t in trunk) + sum(len(r["traj"]) for r in br)
    kinds: dict[str, int] = {}
    for t in trunk:
        for kd in t["kinds"]:
            kinds[kd] = kinds.get(kd, 0) + 1
    return name, pool, [t["profit"] for t in trunk], states, n_dec, kinds


def vine_q(st: dict, eta: float, v: float, lam: float) -> np.ndarray:
    """Q̂(s,a) по ветвям в % V: (1−λ)Π + λ·RU_η(Π) + w_c·min(0, C_min)."""
    X = np.asarray(st["profit"]); C = np.asarray(st["min_cash"])
    return 100.0 * ((1 - lam) * X + lam * (eta - np.maximum(0.0, eta - X) / ALPHA) + W_CASH * np.minimum(0.0, C)) / v


def vine_update(net: ActorCritic, opt, X, M, Q, QM, vc: dict = VINE) -> dict:
    """Градиент по всем действиям с доверительной областью: max Σ_s Σ_a π(a|s)·(Q̂ − Σ π_old Q̂), KL(π_old‖π) ≤ цели."""
    with torch.no_grad():
        p_old = torch.softmax(net.logits(X, M), 1)
        adv = torch.where(QM, Q - (p_old * torch.where(QM, Q, torch.zeros_like(Q))).sum(1, keepdim=True), torch.zeros_like(Q))
        adv = adv / (adv.abs().max(1, keepdim=True).values.mean() + 1e-8)
    st = {"kl": 0.0, "epochs": 0}
    for ep in range(vc["epochs"]):
        p = torch.softmax(net.logits(X, M), 1)
        loss = -(p * adv).sum(1).mean()
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.pi.parameters(), PPO["max_grad"]); opt.step()
        with torch.no_grad():
            lp_new = torch.log_softmax(net.logits(X, M), 1)
            kl = float((p_old * (torch.log(p_old.clamp_min(1e-12)) - lp_new)).masked_fill(~M, 0.0).sum(1).mean())
        st.update(kl=kl, epochs=ep + 1, loss=float(loss.detach()))
        if kl > vc["target_kl"]:
            break
    return st


def vine_iteration(net, opt, ex, names, ch, V, lam, it, rng, snap, vc: dict = VINE) -> tuple[int, dict]:
    tasks = []
    for j, n in enumerate(names):
        pool = POOLS[(j + it) % 2]
        idxs = [int(i) for i in rng.choice(N_TRAIN, B_GROUP, replace=False)]
        tasks.append((n, ch[n]["rule"], spec_of(ch, n), pool, idxs, str(snap), int(rng.integers(2**31))))
    xs, ms, qs, qm, dec, kinds, gain, dev = [], [], [], [], 0, {}, [], 0
    for n, pool, trunk_p, states, n_dec, kd in ex.map(_vine, tasks):
        dec += n_dec
        for k, c in kd.items():
            kinds[k] = kinds.get(k, 0) + c
        k_eta = max(1, int(np.floor(ALPHA * len(trunk_p))))
        eta = float(np.sort(trunk_p)[k_eta - 1])
        for st in states:
            q = vine_q(st, eta, V[n], lam)
            row = np.zeros(N_ACT, np.float32); msk = np.zeros(N_ACT, bool)
            row[st["acts"]] = q; msk[st["acts"]] = True
            xs.append(st["x"]); ms.append(st["m"]); qs.append(row); qm.append(msk)
            gain.append(float(q.max() - q[st["acts"].index(st["a0"])]) if st["a0"] in st["acts"] else 0.0)
            dev += int(st["a0"] in st["acts"] and q.max() > q[st["acts"].index(st["a0"])] + 1e-9)
    X = torch.as_tensor(np.stack(xs)); M = torch.as_tensor(np.stack(ms)); Q = torch.as_tensor(np.stack(qs)); QM = torch.as_tensor(np.stack(qm))
    stt = vine_update(net, opt, X, M, Q, QM, vc)
    return dec, {"n_states": len(xs), "best_gain_mean": float(np.mean(gain)), "best_ne_current": dev / max(1, len(xs)),
                 **stt, "kinds": kinds}



def ppo_iteration(net, opt, ex, names, ch, V, ref, lam, it, rng, snap) -> tuple[int, dict]:
    """Варианты A/B: стохастические эпизоды пакетов, награда RU-CVaR по пакету, обновление PPO (первая — только критик)."""
    tasks = []
    for j, n in enumerate(names):
        pool = POOLS[(j + it) % 2]
        idxs = [int(i) for i in rng.choice(N_TRAIN, B_GROUP, replace=False)]
        tasks.append((n, ch[n]["rule"], spec_of(ch, n), pool, idxs, str(snap), int(rng.integers(2**31))))
    Xs, Ms, As, Gs, devs, kinds = [], [], [], [], 0, {}
    for n, pool, idxs, eps in ex.map(_rollout, tasks):
        r = group_rewards(eps, ref[pool][n], idxs, V[n], lam)
        for e, ri in zip(eps, r):
            if len(e["a"]) == 0:
                continue
            Xs.append(e["x"]); Ms.append(e["m"]); As.append(e["a"]); Gs.append(np.full(len(e["a"]), ri, np.float32))
            devs += e["dev"]
            for kd in e["kinds"]:
                kinds[kd] = kinds.get(kd, 0) + 1
    X = torch.as_tensor(np.concatenate(Xs)); M = torch.as_tensor(np.concatenate(Ms)); A = torch.as_tensor(np.concatenate(As))
    G = torch.as_tensor(np.concatenate(Gs))
    with torch.no_grad():
        old_logp = torch.log_softmax(net.logits(X, M), 1).gather(1, A[:, None]).squeeze(1)
    st = ppo_update(net, opt, X, M, A, G, old_logp, critic_only=(it == 0))
    return len(X), {"n": int(len(X)), "reward_mean": float(G.mean()), "dev_share": devs / len(X), **st, "kinds": kinds}


# ── Главный процесс ───────────────────────────────────────────────────────────────────────────────────────────────
def reference(names: list[str], ch: dict, ex) -> dict:
    """Прибыль / мин. касса C* на всех обучающих сценариях обоих пулов (база парной награды; кэш)."""
    path = A4_RES / "ref_train_a4.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    out: dict = {p: {} for p in POOLS}
    for n, pool, r in ex.map(_ref_one, [(n, ch[n]["rule"], spec_of(ch, n), p) for n in names for p in POOLS]):
        out[pool][n] = r
    save(path, out)
    return out


def validate(ckpt: Path, names: list[str], ch: dict, base: dict, ex) -> dict:
    per = {}
    for n, m, kinds in ex.map(_val_one, [(n, ch[n]["rule"], spec_of(ch, n), str(ckpt)) for n in names]):
        b = base[n]
        s_rl = score(m, b["rule_val"][b["rule"]], b["V"])
        per[n] = {"score_vs_cstar": s_rl - b["val_scores"][b["C*"]], "score_vs_rule": s_rl, "moves": kinds,
                  "profit_cvar": m["profit_cvar"], "cash_min_cvar": m["cash_min_cvar"]}
    return {"score": float(np.mean([v["score_vs_cstar"] for v in per.values()])), "per_instance": per}


def behaviour_clone(net: ActorCritic, x: np.ndarray, m: np.ndarray, a: np.ndarray, seed: int) -> float:
    opt = torch.optim.Adam(net.pi.parameters(), lr=BC["lr"])
    X, M, Y = torch.as_tensor(x), torch.as_tensor(m), torch.as_tensor(a)
    g = torch.Generator().manual_seed(seed)
    loss_v = 0.0
    for _ in range(BC["epochs"]):
        perm = torch.randperm(len(X), generator=g)
        for i in range(0, len(X), 1024):
            b = perm[i:i + 1024]
            lp = torch.log_softmax(net.logits(X[b], M[b]), 1)
            valid = M[b].float()
            tgt = (1 - BC["smooth"]) * nn.functional.one_hot(Y[b], N_ACT).float() + BC["smooth"] * valid / valid.sum(1, keepdim=True)
            loss = -(tgt * torch.where(M[b], lp, torch.zeros_like(lp))).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step()
            loss_v = float(loss.item())
    return loss_v


def group_rewards(eps: list[dict], ref: dict, idxs: list[int], v: float, lam: float) -> np.ndarray:
    """RU-CVaR по пакету общих сценариев: η — α-квантиль прибыли политики в пакете; эталон C* — контрольная переменная."""
    X = np.array([e["profit"] for e in eps]); Cm = np.array([e["min_cash"] for e in eps])
    R = np.array([ref["profit"][i] for i in idxs]); Cr = np.array([ref["min_cash"][i] for i in idxs])
    k = max(1, int(np.floor(ALPHA * len(X))))
    eta = float(np.sort(X)[k - 1])
    ru = (np.maximum(0.0, eta - R) - np.maximum(0.0, eta - X)) / ALPHA
    return 100.0 * ((1 - lam) * (X - R) + lam * ru + W_CASH * (np.minimum(0.0, Cm) - np.minimum(0.0, Cr))) / v


def ppo_update(net: ActorCritic, opt, X, M, A, G, old_logp, critic_only: bool = False) -> dict:
    with torch.no_grad():
        adv = G - net.v(X).squeeze(1)
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    n = len(X)
    stats = {"kl": 0.0, "epochs": 0, "clipfrac": 0.0, "entropy": 0.0, "vloss": 0.0}
    for ep in range(PPO["epochs"]):
        perm = torch.randperm(n)
        for i in range(0, n, PPO["minibatch"]):
            b = perm[i:i + PPO["minibatch"]]
            lg = net.logits(X[b], M[b])
            logp_all = torch.log_softmax(lg, 1)
            lp = logp_all.gather(1, A[b][:, None]).squeeze(1)
            p_all = logp_all.exp()
            ent = -(p_all * torch.where(M[b], logp_all, torch.zeros_like(logp_all))).sum(1).mean()
            ratio = torch.exp(lp - old_logp[b])
            pg = -torch.min(ratio * adv[b], torch.clamp(ratio, 1 - PPO["clip"], 1 + PPO["clip"]) * adv[b]).mean()
            vloss = ((net.v(X[b]).squeeze(1) - G[b]) ** 2).mean()
            loss = PPO["vf"] * vloss + (0.0 if critic_only else pg - PPO["ent"] * ent)
            opt.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), PPO["max_grad"]); opt.step()
        with torch.no_grad():
            lp_all = torch.log_softmax(net.logits(X, M), 1).gather(1, A[:, None]).squeeze(1)
            r = torch.exp(lp_all - old_logp)
            kl = float(((r - 1) - (lp_all - old_logp)).mean())
            stats.update(kl=kl, epochs=ep + 1, clipfrac=float(((r - 1).abs() > PPO["clip"]).float().mean()),
                         entropy=float(ent), vloss=float(vloss))
        if not critic_only and kl > 1.5 * PPO["target_kl"]:
            break
    return stats


def train_seed(seed: int, variant: str, max_dec: int, min_dec: int, eval_every: int, workers: int, max_min: float) -> dict:
    torch.manual_seed(seed); np.random.seed(seed)
    CKPT.mkdir(parents=True, exist_ok=True); TMP.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    names, ch = set_names("A3"), champions()
    base = {n: json.loads((A4_RES / "base" / f"{n}.json").read_text(encoding="utf-8")) for n in names}
    V = {n: value_of(n) for n in names}
    lam = LAMBDA[variant]
    tag = f"l4{variant}_seed{seed}"
    paths = {k: CKPT / f"{tag}_{k}.pt" for k in ("bc", "best", "last")}
    snap = TMP / f"{tag}_snap.pt"
    with ProcessPoolExecutor(workers) as ex:
        ref = reference(names, ch, ex)
        parts = list(ex.map(_bc_one, [(n, ch[n]["rule"], spec_of(ch, n), p, seed) for n in names for p in POOLS]))
        bx = np.concatenate([p[0] for p in parts]); bm = np.concatenate([p[1] for p in parts]); ba = np.concatenate([p[2] for p in parts])
        net = ActorCritic()
        bc_loss = behaviour_clone(net, bx, bm, ba, seed)
        with torch.no_grad():
            agree = float((net.logits(torch.as_tensor(bx), torch.as_tensor(bm)).argmax(1).numpy() == ba).mean())
        torch.save(net.state_dict(), paths["bc"]); torch.save(net.state_dict(), paths["best"])
        v = validate(paths["bc"], names, ch, base, ex)
        best = v["score"]
        log = {"seed": seed, "variant": variant, "lambda": lam, "ppo": PPO, "bc_cfg": BC, "B": B_GROUP, "alpha": ALPHA, "w_cash": W_CASH,
               "bc": {"n": int(len(bx)), "loss": bc_loss, "agreement": agree, "score": v["score"], "sec": time.time() - t0},
               "curve": [{"decisions": 0, "score": v["score"], "phase": "bc", "sec": time.time() - t0}],
               "best": {"decisions": 0, "score": best, "phase": "bc", "validation": v}, "iters": []}
        print(f"{tag} BC: n={len(bx)} согласие {agree:.3f} валидация к C* {best:+.5f} [{time.time() - t0:.0f} с]", flush=True)
        opt = torch.optim.Adam(net.parameters(), lr=PPO["lr"], eps=1e-5)
        vc = VINE_D if variant == "D" else VINE
        if variant in ("C", "D"):
            opt = torch.optim.Adam(net.pi.parameters(), lr=vc["lr"], eps=1e-5)
        rng = np.random.default_rng(seed)
        dec, it, next_eval, stall = 0, 0, eval_every, 0
        while dec < max_dec and time.time() - t0 < max_min * 60:
            torch.save(net.state_dict(), snap)
            if variant in ("C", "D"):
                d_it, st = vine_iteration(net, opt, ex, names, ch, V, lam, it, rng, snap, vc)
                msg = (f"состояний {st['n_states']} выгода лучшего хода {st['best_gain_mean']:+.4f} "
                       f"лучший ≠ текущего {st['best_ne_current']:.3f}")
            else:
                d_it, st = ppo_iteration(net, opt, ex, names, ch, V, ref, lam, it, rng, snap)
                msg = f"r̄ {st['reward_mean']:+.4f} откл. от C* {st['dev_share']:.3f}"
            dec += d_it; it += 1
            log["iters"].append({"it": it, "decisions": dec, **st, "sec": time.time() - t0})
            print(f"{tag} it {it:3d} решений {dec:9d} {msg} KL {st['kl']:.4f} эпох {st['epochs']} [{time.time() - t0:.0f} с]", flush=True)
            if dec < next_eval:
                continue
            next_eval += eval_every
            torch.save(net.state_dict(), paths["last"])
            v = validate(paths["last"], names, ch, base, ex)
            log["curve"].append({"decisions": dec, "score": v["score"], "phase": "rl", "sec": time.time() - t0})
            print(f"{tag} ВАЛИДАЦИЯ {dec:9d}: к C* {v['score']:+.5f} (лучший {best:+.5f}) [{time.time() - t0:.0f} с]", flush=True)
            if v["score"] > best:
                best, stall = v["score"], 0
                torch.save(net.state_dict(), paths["best"])
                log["best"] = {"decisions": dec, "score": best, "phase": "rl", "validation": v}
            else:
                stall += 1
            if dec >= min_dec and stall >= 5:
                break
    log["decisions"] = dec; log["sec"] = time.time() - t0
    save(A4_RES / f"train_{tag}.json", log)
    return log


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=list(LAMBDA), default="A")
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--max-decisions", type=int, default=1_500_000)
    ap.add_argument("--min-decisions", type=int, default=500_000)
    ap.add_argument("--eval-every", type=int, default=100_000)
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--max-minutes", type=float, default=150.0)
    a = ap.parse_args()
    for s in a.seeds:
        train_seed(s, a.variant, a.max_decisions, a.min_decisions, a.eval_every, a.workers, a.max_minutes)


if __name__ == "__main__":
    main()
