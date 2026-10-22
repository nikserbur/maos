"""Обучение совместного макро-генератора: ridge-VAR(1) → SVD остатков → гауссов HMM →
блочная эмпирическая выборка остатков по режимам (METHODOLOGY-V2 §2.2, §2.6а).

Порт `research/revision/learning.py` пакета RJMF без изменения спецификации
(Бураков Н. С., 2026, IJPS 3-1, с. 47–66, EDN TPCNIM — модульная архитектура SVD/режимов/хвостов;
RJMF Methodology §6, §6.1). Параметры оцениваются на собственной истории cbr.ru, не копируются.

Собственная EM-реализация HMM сохранена из RJMF (диагональные дисперсии, нижняя граница 0.05,
псевдосчёты 0.5/0.1, 3 старта, ≤ 80 итераций) — hmmlearn не используется, чтобы обучение
воспроизводило эталон побитово при тех же данных.

Основной носитель — конечный (эмпирические блоки): конечные моменты на конечном горизонте,
невиданные экстремумы исключены. Неограниченный Student-t в логарифмах — только квантильный стресс.
"""
from __future__ import annotations

import numpy as np
from scipy import stats
from scipy.special import logsumexp

RIDGE_GRID = (0.01, 0.1, 1.0, 10.0)   # λ_R [О] по последним 12 переходам обучающего отрезка
RADIUS_CAP = 0.98                     # спектральный радиус [НОРМ]
SVD_ENERGY = 0.90                     # доля энергии SVD [НОРМ]
HMM_VAR_FLOOR = 0.05                  # нижняя граница дисперсий [НОРМ, как в RJMF]
HMM_PSEUDO_P, HMM_PSEUDO_PI = 0.5, 0.1
HMM_STARTS, HMM_ITERS = 3, 80
UNIFORMS_PER_ID, MAX_H = 3841, 1920   # отдельный поток SeedSequence([seed, 871]) (RJMF §6.1)


def fit_var(data):
    """Стандартизация → ridge-VAR(1) z_m = z_{m-1} A + ε_m; ridge по 1-шаговой RMSE на хвосте
    (последние 12 переходов обучающего отрезка); спектральный радиус ≤ 0.98."""
    data = np.asarray(data, float)
    cut = max(12, len(data) - 13)
    im = data[:cut + 1].mean(0)
    sd0 = np.maximum(data[:cut + 1].std(0, ddof=1), 1e-8)
    inn = (data - im) / sd0
    ix, iy = inn[:-1], inn[1:]
    opt = []
    for ridge in RIDGE_GRID:
        coef = np.linalg.solve(ix[:cut].T @ ix[:cut] + ridge * np.eye(3), ix[:cut].T @ iy[:cut])
        opt.append((float(np.mean((iy[cut:] - ix[cut:] @ coef) ** 2)), ridge))
    ridge = min(opt)[1]
    mean = data.mean(0)
    sd = np.maximum(data.std(0, ddof=1), 1e-8)
    z = (data - mean) / sd
    x, y = z[:-1], z[1:]
    A = np.linalg.solve(x.T @ x + ridge * np.eye(3), x.T @ y)
    radius = max(abs(np.linalg.eigvals(A)))
    if radius > RADIUS_CAP:
        A *= RADIUS_CAP / radius
    return {"mean": mean, "sd": sd, "A": A, "resid": y - x @ A, "last": z[-1], "ridge": ridge,
            "radius_before": float(radius), "radius_after": float(max(abs(np.linalg.eigvals(A)))),
            "ridge_scores": [{"ridge": r, "rmse_tail12": float(np.sqrt(s))} for s, r in opt]}


def fit_hmm(x, k, seed=1):
    """Гауссов HMM на k режимов (диагональные дисперсии), EM с 3 стартами — порт RJMF."""
    n, d = x.shape
    best = None
    for start in range(HMM_STARTS):
        rng = np.random.default_rng(seed + start)
        means = x[rng.choice(n, k, replace=False)].copy()
        var = np.tile(np.var(x, 0) + HMM_VAR_FLOOR, (k, 1))
        P = np.full((k, k), 1 / k)
        pi = np.full(k, 1 / k)
        prev = -np.inf
        ll = -np.inf
        la = np.zeros((n, k))
        for _ in range(HMM_ITERS):
            le = -.5 * (d * np.log(2 * np.pi) + np.log(var).sum(1)[None, :] + (((x[:, None, :] - means) ** 2) / var).sum(2))
            la = np.zeros((n, k))
            la[0] = np.log(pi) + le[0]
            for t in range(1, n):
                la[t] = le[t] + logsumexp(la[t - 1, :, None] + np.log(P), axis=0)
            ll = logsumexp(la[-1])
            lb = np.zeros((n, k))
            for t in range(n - 2, -1, -1):
                lb[t] = logsumexp(np.log(P) + le[t + 1, None, :] + lb[t + 1, None, :], axis=1)
            gam = np.exp(la + lb - ll)
            xi = np.zeros((k, k))
            for t in range(n - 1):
                xi += np.exp(la[t, :, None] + np.log(P) + le[t + 1, None, :] + lb[t + 1, None, :] - ll)
            P = (xi + HMM_PSEUDO_P) / (xi.sum(1)[:, None] + HMM_PSEUDO_P * k)
            pi = (gam[0] + HMM_PSEUDO_PI) / (1 + HMM_PSEUDO_PI * k)
            mass = gam.sum(0)
            means = gam.T @ x / mass[:, None]
            var = np.maximum((gam.T @ (x * x)) / mass[:, None] - means * means, HMM_VAR_FLOOR)
            if abs(ll - prev) < 1e-6:
                break
            prev = ll
        if best is None or ll > best["loglik"]:
            best = {"k": k, "means": means, "var": var, "P": P, "pi": pi,
                    "filtered": np.exp(la - logsumexp(la, axis=1)[:, None]), "loglik": float(ll)}
    best["filtered"] = hmm_filter(best, x)
    return best


def hmm_filter(h, x, initial=None):
    """Фильтрованные вероятности режимов p(h_t | x_1..t)."""
    prob = h["pi"] if initial is None else initial
    vals = []
    for t, row in enumerate(x):
        prior = prob @ h["P"] if t > 0 or initial is not None else prob
        lp = np.log(np.maximum(prior, 1e-300)) - .5 * (np.log(h["var"]).sum(1) + (((row - h["means"]) ** 2) / h["var"]).sum(1))
        prob = np.exp(lp - logsumexp(lp))
        vals.append(prob)
    return np.array(vals)


def model(data, k=1):
    """VAR + SVD остатков (≥ 90 % энергии) + HMM на q направлениях."""
    m = fit_var(data)
    u, s, v = np.linalg.svd(m["resid"], full_matrices=False)
    rank = int(np.searchsorted(np.cumsum(s * s) / sum(s * s), SVD_ENERGY) + 1)
    h = fit_hmm(m["resid"] @ v[:rank].T, k)
    m.update({"hmm": h, "svd_vectors": v, "svd_values": s, "rank": rank})
    return m


def pools_by_regime(h, N, block):
    """Множества допустимых начал блоков по режиму (фильтрованная метка argmax)."""
    labels = h["filtered"].argmax(1)
    lim = max(1, N - block + 1)
    pools = []
    for j in range(h["k"]):
        pool = np.flatnonzero(labels[:lim] == j)
        pools.append(pool if len(pool) else np.arange(lim))
    return pools


def simulate(m, n, H, seed=20261007, block=4, start_index=0):
    """Совместная блочная выборка остатков по режиму (порт RJMF `simulate`; эталон для валидации).
    Путь id не зависит от n и размера пакета: отдельный поток чисел на id (3841 равномерных)."""
    if H > MAX_H:
        raise ValueError("Maximum 1920 months")
    rgen = np.random.default_rng(np.random.SeedSequence([seed, 871]))
    rgen.bit_generator.advance(start_index * UNIFORMS_PER_ID)
    u = rgen.random((n, UNIFORMS_PER_ID))
    cur = np.tile(m["last"], (n, 1))
    out = np.empty((n, H, 3))
    h = m["hmm"]
    prob = np.tile(h["filtered"][-1], (n, 1))
    r = m["resid"]
    N = len(r)
    pools = pools_by_regime(h, N, block)
    selected = np.zeros(n, int)
    ids = np.zeros((n, H), np.int16)
    regime = np.zeros((n, H), np.int8)
    state = np.zeros(n, int)
    for t in range(H):
        if t % block == 0:
            prior = prob @ np.linalg.matrix_power(h["P"], 1 if t == 0 else block)
            state = np.minimum((u[:, t, None] > np.cumsum(prior, axis=1)).sum(1), h["k"] - 1)
            for j in range(h["k"]):
                mask = state == j
                pool = pools[j]
                selected[mask] = pool[np.minimum((u[mask, MAX_H + t] * len(pool)).astype(int), len(pool) - 1)]
            prob = np.eye(h["k"])[state]
        ids[:, t] = (selected + t % block) % N
        regime[:, t] = state
        cur = cur @ m["A"] + r[ids[:, t]]
        out[:, t] = cur * m["sd"] + m["mean"]
    return out, ids, regime


def conditional_log_path(m, H, block):
    """Точное условное ожидание реализованного конечного генератора (RJMF §6.1):
    μ_m = μ_{m-1} A + Σ_j p_{m,j} ε̄_{j, m mod b}; не зависит от числа симуляций."""
    r = m["resid"]
    N = len(r)
    h = m["hmm"]
    pools = pools_by_regime(h, N, block)
    poolmeans = np.asarray([[r[(pool + k) % N].mean(0) for k in range(block)] for pool in pools])
    prob = h["filtered"][-1].copy()
    cur = m["last"].copy()
    out = []
    for t in range(H):
        if t % block == 0:
            prob = prob @ np.linalg.matrix_power(h["P"], 1 if t == 0 else block)
        cur = cur @ m["A"] + np.einsum("j,jd->d", prob, poolmeans[:, t % block])
        out.append(cur * m["sd"] + m["mean"])
    return np.asarray(out)


def crps(samples, y):
    """CRPS эмпирического распределения (Gneiting & Raftery 2007), O(n log n)."""
    a = np.sort(np.asarray(samples, float))
    n = len(a)
    return float(np.mean(abs(a - y)) - np.sum((2 * np.arange(n) + 1 - n) * a) / (n * n))


def tails(resid, names=("log_CPI_YoY", "real_key_proxy", "detrended_log_FX")):
    """Диагностика хвостов остатков: Student-t MLE, эксцесс, оценки Хилла с обеих сторон."""
    out = []
    for j, name in enumerate(names):
        a = resid[:, j]
        df, loc, scale = stats.t.fit(a)
        hill = []
        for sign in (-1, 1):
            v = np.sort(sign * a[sign * a > 0])
            for frac in (.1, .15, .2):
                k = max(3, int(len(v) * frac))
                z = v[-k:]
                den = np.mean(np.log(z / z[0]))
                hill.append({"sign": sign, "tail_fraction": frac, "exceedances": k,
                             "alpha": float(1 / den) if den > 0 else None})
        out.append({"variable": name, "student_df_MLE": float(df), "student_loc": float(loc),
                    "student_scale": float(scale), "excess_kurtosis": float(stats.kurtosis(a, bias=False)),
                    "Hill_sensitivity": hill,
                    "warning": "малая выборка; неограниченный лог-Student без экспоненциального момента — только квантильный стресс"})
    return out
