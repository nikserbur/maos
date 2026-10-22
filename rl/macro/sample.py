"""Выборка путей из обученного генератора по сохранённым параметрам (METHODOLOGY-V2 §2.6а, §2.3, §2.6б).

Эталон для C++ `backend/src/MacroSampler.cpp`: при одном seed пути совпадают ПОБИТОВО.
Поэтому арифметика здесь — чистые float Python в фиксированном порядке (без BLAS/FMA/numpy-сумм),
а случайные числа — ровно numpy PCG64 + SeedSequence([seed, 871]) с 3841 равномерными на id
(как RJMF §6.1: добавление id и размер пакета не меняют существующие пути).

Режимы меню §2.6б (stress):
  None                      — «Базовый»: режимы по p_last и P_HMM, эмпирические блоки;
  {"regime": h}             — режим h навязан на весь горизонт (стресс, не прогноз);
  {"quantile_t": q}         — квантильный стресс: инновации = q-квантиль Student-t MLE (детерминированный путь);
  {"episode": "YYYY-MM", "months": 12} — блоки только из окна истории.
Базовая траектория (ref): {"cpi": "flat"|"nodes"|[...], "key": "flat"|[...]} — [НОРМ].
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .learning import MAX_H, UNIFORMS_PER_ID

PARAMS_PATH = Path(__file__).resolve().parent / "params" / "macro_params.json"
NODES_PATH = Path(__file__).resolve().parent / "params" / "reference_nodes.json"
WEEKS_PER_MONTH = 52.0 / 12.0
MAX_WEEKS = 520                       # 2·520 равномерных на id в потоке моста [seed, 872]
BRIDGE_STREAM = 872


def load_params(path: Path | str = PARAMS_PATH) -> dict:
    p = json.loads(Path(path).read_text())
    if p.get("schema") != "maos.macro_params/1":
        raise ValueError("macro_params: неизвестная схема")
    return p


# ── детерминированная линейная алгебра (порядок операций = C++) ───────────────────
def matmul(a, b):
    n, k, m = len(a), len(b), len(b[0])
    out = []
    for i in range(n):
        row = []
        for j in range(m):
            s = a[i][0] * b[0][j]
            for l in range(1, k):
                s = s + a[i][l] * b[l][j]
            row.append(s)
        out.append(row)
    return out


def vecmat(v, b):
    return matmul([list(v)], b)[0]


def mat_pow2(P, block):
    """P^block для block ∈ {1,2,4,8}: повторное возведение в квадрат (тот же порядок в C++)."""
    r = [list(row) for row in P]
    steps = {1: 0, 2: 1, 4: 2, 8: 3}[block]
    for _ in range(steps):
        r = matmul(r, r)
    return r


def pools_of(labels, N, block):
    lim = max(1, N - block + 1)
    k = max(labels[:lim]) + 1 if lim else 1
    pools = []
    for j in range(k):
        pool = [s for s in range(lim) if labels[s] == j]
        pools.append(pool if pool else list(range(lim)))
    return pools


def pool_means(resid, pools, N, block):
    """ε̄_{j,k}: последовательная сумма / len (без попарного суммирования numpy)."""
    out = []
    for pool in pools:
        rows = []
        for k in range(block):
            s = [0.0, 0.0, 0.0]
            for idx in pool:
                r = resid[(idx + k) % N]
                s = [s[0] + r[0], s[1] + r[1], s[2] + r[2]]
            rows.append([s[0] / len(pool), s[1] / len(pool), s[2] / len(pool)])
        out.append(rows)
    return out


class Sampler:
    def __init__(self, params: dict):
        self.p = params
        self.A = params["A"]
        self.mean, self.sd = params["mean"], params["sd"]
        self.resid = params["resid"]
        self.N = len(self.resid)
        self.block = int(params["block"])
        self.k = int(params["hmm"]["k"])
        self.P = params["hmm"]["P"]
        self.Pb = mat_pow2(self.P, self.block)
        self.p_last = list(params["hmm"]["filtered_last"])
        self.labels = params["hmm"]["labels"]
        self.pools = pools_of(self.labels, self.N, self.block)
        while len(self.pools) < self.k:
            self.pools.append(list(range(max(1, self.N - self.block + 1))))
        self.last = list(params["last"])
        self.tq = params["student_t"]

    # ── §6.1 точное условное ожидание ────────────────────────────────────────────
    def expected_path(self, H: int):
        pm = pool_means(self.resid, self.pools, self.N, self.block)
        prob, cur, out = list(self.p_last), list(self.last), []
        for t in range(H):
            if t % self.block == 0:
                prob = vecmat(prob, self.P if t == 0 else self.Pb)
            k = t % self.block
            drift = [0.0, 0.0, 0.0]
            for j in range(self.k):
                drift = [drift[d] + prob[j] * pm[j][k][d] for d in range(3)]
            nxt = vecmat(cur, self.A)
            cur = [nxt[d] + drift[d] for d in range(3)]
            out.append([cur[d] * self.sd[d] + self.mean[d] for d in range(3)])
        return out

    # ── выборка месячных состояний ───────────────────────────────────────────────
    def _episode_pool(self, episode: str, months: int):
        hist = self.p["history"]["month"]
        if episode not in hist:
            raise ValueError(f"episode {episode}: нет в истории {hist[0]}…{hist[-1]}")
        lo = max(0, hist.index(episode) - 1)             # остаток r соответствует месяцу r+1
        hi = min(self.N, lo + months)
        pool = list(range(lo, max(lo + 1, hi - self.block + 1)))
        return pool

    def sample_months(self, n: int, H: int, seed: int, start_index: int = 0, stress: dict | None = None):
        if H > MAX_H:
            raise ValueError("Maximum 1920 months")
        stress = stress or {}
        if "quantile_t" in stress:
            return self._quantile_path(n, H, float(stress["quantile_t"]))
        forced = int(stress["regime"]) if "regime" in stress else -1
        if forced >= self.k:
            raise ValueError(f"regime {forced}: всего режимов {self.k}")
        episode_pool = self._episode_pool(stress["episode"], int(stress.get("months", 12))) if "episode" in stress else None
        rgen = np.random.default_rng(np.random.SeedSequence([int(seed), 871]))
        rgen.bit_generator.advance(start_index * UNIFORMS_PER_ID)
        u = rgen.random((n, UNIFORMS_PER_ID)).tolist()
        z = np.empty((n, H, 3))
        regime = np.zeros((n, H), np.int16)
        block_id = np.zeros((n, H), np.int32)
        for i in range(n):
            prob, cur, state, selected = list(self.p_last), list(self.last), 0, 0
            for t in range(H):
                if t % self.block == 0:
                    if forced >= 0:
                        state = forced
                    else:
                        prior = vecmat(prob, self.P if t == 0 else self.Pb)
                        cum, cnt = 0.0, 0
                        for j in range(self.k):
                            cum = cum + prior[j]
                            if u[i][t] > cum:
                                cnt += 1
                        state = min(cnt, self.k - 1)
                    pool = episode_pool if episode_pool is not None else self.pools[state]
                    selected = pool[min(int(u[i][MAX_H + t] * len(pool)), len(pool) - 1)]
                    prob = [1.0 if j == state else 0.0 for j in range(self.k)]
                idx = (selected + t % self.block) % self.N
                nxt = vecmat(cur, self.A)
                r = self.resid[idx]
                cur = [nxt[0] + r[0], nxt[1] + r[1], nxt[2] + r[2]]
                for d in range(3):
                    z[i, t, d] = cur[d] * self.sd[d] + self.mean[d]
                regime[i, t] = -1 if episode_pool is not None else state
                block_id[i, t] = idx
        return {"z": z, "regime": regime, "block_id": block_id}

    def _quantile_path(self, n: int, H: int, q: float):
        key = f"{q:g}"
        try:
            eps = [self.tq[d]["quantiles"][key] for d in range(3)]
        except KeyError as e:
            raise ValueError(f"quantile_t {q}: допустимы {list(self.tq[0]['quantiles'])}") from e
        cur, path = list(self.last), []
        for _ in range(H):
            nxt = vecmat(cur, self.A)
            cur = [nxt[d] + eps[d] for d in range(3)]
            path.append([cur[d] * self.sd[d] + self.mean[d] for d in range(3)])
        z = np.tile(np.asarray(path)[None, :, :], (n, 1, 1))
        return {"z": z, "regime": np.full((n, H), -2, np.int16), "block_id": np.full((n, H), -1, np.int32)}

    # ── базовые траектории [НОРМ] ────────────────────────────────────────────────
    def reference(self, H: int, ref: dict | None = None):
        ref = ref or {}
        lo = self.p["last_obs"]
        cpi_mode = ref.get("cpi", "flat")
        if isinstance(cpi_mode, list):
            cpi = [float(v) for v in cpi_mode][:H]
            cpi += [cpi[-1]] * (H - len(cpi))
        elif cpi_mode == "nodes":
            cpi = _interp_nodes(lo["month"], float(lo["cpi_yoy_pp"]), H, json.loads(NODES_PATH.read_text()))
        else:
            cpi = [float(lo["cpi_yoy_pp"])] * H
        key_mode = ref.get("key", "flat")
        if isinstance(key_mode, list):
            key = [float(v) for v in key_mode][:H]
            key += [key[-1]] * (H - len(key))
        else:
            key = [float(lo["key_pp"])] * H
        return {"cpi": cpi, "key": key}

    # ── перевод в уровни (§2.6а, RJMF §6.1, §6.3) ──────────────────────────────────
    def to_levels(self, z, Ez, ref):
        n, H = z.shape[0], z.shape[1]
        lo = self.p["last_obs"]
        pi0, s0 = float(lo["cpi_yoy_pp"]), float(lo["usd_rub"])
        usd = float(self.p.get("usd_inflation", 0.02))
        pi = np.empty((n, H)); key = np.empty((n, H)); fx = np.empty((n, H))
        for i in range(n):
            levels = [(1.0 + pi0 / 100.0) ** (-j / 12.0) for j in range(11, -1, -1)]   # P_{-11..0}
            for t in range(H):
                e_pi = float(z[i, t, 0]) - Ez[t][0]
                e_i = float(z[i, t, 1]) - Ez[t][1]
                e_s = float(z[i, t, 2]) - Ez[t][2]
                p = (100.0 + ref["cpi"][t]) * math.exp(e_pi / 100.0) - 100.0
                pi[i, t] = p
                key[i, t] = ref["key"][t] + e_i + (p - ref["cpi"][t])
                P = levels[-12] * (1.0 + p / 100.0)
                levels.append(P)
                fx[i, t] = s0 * P / (1.0 + usd) ** ((t + 1) / 12.0) * math.exp(e_s / 100.0)
        return {"cpi": pi, "key": key, "fx": fx}

    # ── месяц → неделя (§2.3) ───────────────────────────────────────────────────
    def to_weeks(self, levels, W: int, seed: int, start_index: int = 0, bridge: bool = True):
        if W > MAX_WEEKS:
            raise ValueError("Maximum 520 weeks")
        n, H = levels["cpi"].shape
        need = int(math.floor((W * 12.0) / 52.0)) + 2
        if H < need:
            raise ValueError(f"недостаточно месяцев: нужно {need}, есть {H}")
        lo = self.p["last_obs"]
        sbb = float(self.p.get("sigma_bb", {}).get("fx_pct_log", 0.0)) if bridge else 0.0
        rgen = np.random.default_rng(np.random.SeedSequence([int(seed), BRIDGE_STREAM]))
        rgen.bit_generator.advance(start_index * 2 * MAX_WEEKS)
        u = rgen.random((n, 2 * MAX_WEEKS)).tolist()
        cpi = np.empty((n, W)); key = np.empty((n, W)); fx = np.empty((n, W))
        for i in range(n):
            pc = [float(lo["cpi_yoy_pp"])] + [float(v) for v in levels["cpi"][i]]
            pk = [float(lo["key_pp"])] + [float(v) for v in levels["key"][i]]
            ps = [100.0 * math.log(float(lo["usd_rub"]))] + [100.0 * math.log(float(v)) for v in levels["fx"][i]]
            m_prev, f_prev, bridge_val = -1, 0.0, 0.0
            for w in range(W):
                tau = ((w + 1) * 12.0) / 52.0
                m = int(math.floor(tau))
                f = tau - m
                if m != m_prev:                                            # новый месяц: мост начинается с 0
                    m_prev, f_prev, bridge_val = m, 0.0, 0.0
                cpi[i, w] = pc[m] + f * (pc[m + 1] - pc[m])              # линейно, σ_bb = 0 (помечено)
                key[i, w] = pk[m]                                          # ступень: ставка действует до заседания
                # Броуновский мост последовательно (маргинал = σ_bb·sqrt(f(1−f)), приращения зависимы):
                # B_f | B_{f'} ~ N(B_{f'}(1−f)/(1−f'), σ²(f−f')(1−f)/(1−f')).
                eta = math.sqrt(-2.0 * math.log(1.0 - u[i][2 * w])) * math.cos(2.0 * math.pi * u[i][2 * w + 1])
                if f > 0.0:
                    bridge_val = bridge_val * (1.0 - f) / (1.0 - f_prev) \
                        + sbb * math.sqrt((f - f_prev) * (1.0 - f) / (1.0 - f_prev)) * eta
                else:
                    bridge_val = 0.0
                f_prev = f
                lf = ps[m] + f * (ps[m + 1] - ps[m]) + bridge_val
                fx[i, w] = math.exp(lf / 100.0)
        return {"cpi": cpi, "key": key, "fx": fx, "sigma_bb_fx": sbb}

    # ── полный вызов ─────────────────────────────────────────────────────────────
    def sample(self, n: int, seed: int, horizon_weeks: int = 0, horizon_months: int = 0,
               start_index: int = 0, stress: dict | None = None, ref: dict | None = None, bridge: bool = True):
        H = horizon_months or int(math.floor((horizon_weeks * 12.0) / 52.0)) + 2
        months = self.sample_months(n, H, seed, start_index, stress)
        Ez = self.expected_path(H)
        rf = self.reference(H, ref)
        levels = self.to_levels(months["z"], Ez, rf)
        out = {"months": H, "z": months["z"], "regime": months["regime"], "block_id": months["block_id"],
               "expected_z": Ez, "reference": rf, "monthly": levels,
               "streams": {"macro": [int(seed), 871], "bridge": [int(seed), BRIDGE_STREAM]}}
        if horizon_weeks:
            out["weekly"] = self.to_weeks(levels, horizon_weeks, seed, start_index, bridge)
        return out


def _interp_nodes(last_month: str, pi0: float, H: int, nodes: dict):
    """Узлы ЦБ (квартальные, конец квартала) → месячная опора интерполяцией в ln(1+π/100)."""
    y0, m0 = int(last_month[:4]), int(last_month[5:7])
    xs, ys = [0], [math.log1p(pi0 / 100.0)]
    for nd in nodes["cpi_quarterly_nodes"]:
        y, m = int(nd["month"][:4]), int(nd["month"][5:7])
        k = (y - y0) * 12 + (m - m0)
        if k > 0:
            xs.append(k)
            ys.append(math.log1p(float(nd["midpoint_pp"]) / 100.0))
    out = []
    for t in range(1, H + 1):
        if t >= xs[-1]:
            v = ys[-1]
        else:
            j = max(i for i in range(len(xs)) if xs[i] <= t)
            v = ys[j] + (ys[j + 1] - ys[j]) * (t - xs[j]) / (xs[j + 1] - xs[j])
        out.append(100.0 * math.expm1(v))
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--weeks", type=int, default=26)
    ap.add_argument("--params", type=Path, default=PARAMS_PATH)
    a = ap.parse_args()
    s = Sampler(load_params(a.params))
    r = s.sample(a.n, a.seed, a.weeks)
    print(json.dumps({"months": r["months"], "regime0": r["regime"][0].tolist(),
                      "cpi_w0": r["weekly"]["cpi"][0].tolist()[:6], "key_w0": r["weekly"]["key"][0].tolist()[:6],
                      "fx_w0": r["weekly"]["fx"][0].tolist()[:6]}, indent=1))
