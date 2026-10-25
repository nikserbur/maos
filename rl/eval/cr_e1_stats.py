"""Статистика CR-E1 (предрегистрация: эффект контрагентского риска на тот же план).

Все контрасты — ПАРНЫЕ: плечи считаются на одних общих случайных числах (CRN), сценарий id в обоих плечах один и
тот же, поэтому бутстреп берёт ОБЩИЕ индексы для обоих плеч. Хвостовые меры — эмпирические (как в продукте:
CashWaterfall.cpp:cvar_lower — среднее k = max(1, ⌊βN⌋) худших значений).

Методы:
  - парный перцентильный бутстреп B = 2000 (+ BCa как проверка: Efron 1987, ускорение по складному ножу);
  - интервал Уилсона 95 % для доли; интервал Ньюкомба для разности парных долей (метод 10, Newcombe 1998);
  - точный тест Мак-Немара по несогласованным парам; поправка Холма на два первичных исхода;
  - метод многократных репликаций (Mak, Morton & Wood 1999): t-интервал по K независимым репликациям.
"""
from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np
from scipy import stats as sps
from scipy.optimize import minimize_scalar

Z95 = 1.959963984540054
_N01 = NormalDist()


def cvar_lower(x: np.ndarray, beta: float) -> float:
    """Эмпирический CVaR нижнего хвоста: среднее k = max(1, ⌊βN⌋) наименьших значений."""
    x = np.asarray(x, dtype=float)
    k = max(1, int(math.floor(beta * len(x))))
    return float(np.mean(np.partition(x, k - 1)[:k]))


def _cvar_rows(m: np.ndarray, beta: float) -> np.ndarray:
    """CVaR нижнего хвоста по строкам матрицы бутстреп-выборок."""
    k = max(1, int(math.floor(beta * m.shape[1])))
    return np.mean(np.partition(m, k - 1, axis=1)[:, :k], axis=1)


def boot_indices(n: int, b: int, seed: int) -> np.ndarray:
    """Общие индексы бутстрепа (B × n) — один набор на все плечи контраста."""
    return np.random.default_rng(seed).integers(0, n, size=(b, n))


def _boot_p(boot: np.ndarray) -> float:
    """Двусторонний p бутстрепа (обращение перцентильного интервала): 2·min(P*(Δ ≤ 0), P*(Δ ≥ 0))."""
    return float(min(1.0, 2.0 * min(np.mean(boot <= 0), np.mean(boot >= 0))))


def _bca(theta: float, boot: np.ndarray, jack: np.ndarray, level: float = 0.95) -> list[float]:
    """BCa-интервал: смещение z0 по доле бутстреп-оценок ниже θ̂, ускорение a по складному ножу."""
    frac = float(np.clip(np.mean(boot < theta), 1e-6, 1 - 1e-6))
    z0 = _N01.inv_cdf(frac)
    d = jack.mean() - jack
    den = 6.0 * (np.sum(d ** 2) ** 1.5)
    a = float(np.sum(d ** 3) / den) if den > 0 else 0.0
    out = []
    for q in ((1 - level) / 2, 1 - (1 - level) / 2):
        zq = _N01.inv_cdf(q)
        adj = _N01.cdf(z0 + (z0 + zq) / (1 - a * (z0 + zq)))
        out.append(float(np.quantile(boot, adj)))
    return out


def _jack_cvar_delta(a: np.ndarray, b: np.ndarray, beta: float) -> np.ndarray:
    """Складной нож для ΔCVaR = CVaR(a) − CVaR(b) (удаляется одна пара)."""
    n = len(a)
    mask = np.ones(n, dtype=bool)
    out = np.empty(n)
    for i in range(n):
        mask[i] = False
        out[i] = cvar_lower(a[mask], beta) - cvar_lower(b[mask], beta)
        mask[i] = True
    return out


def delta_cvar(a: np.ndarray, b: np.ndarray, beta: float, idx: np.ndarray, bca: bool = False) -> dict:
    """ΔCVaR_β = CVaR(a) − CVaR(b), парный перцентильный бутстреп (общие индексы), p, опционально BCa."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    theta = cvar_lower(a, beta) - cvar_lower(b, beta)
    boot = _cvar_rows(a[idx], beta) - _cvar_rows(b[idx], beta)
    res = {"a": cvar_lower(a, beta), "b": cvar_lower(b, beta), "delta": theta,
           "ci": [float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))], "p_boot": _boot_p(boot)}
    if bca:
        res["ci_bca"] = _bca(theta, boot, _jack_cvar_delta(a, b, beta))
    return res


def boot_cvar_delta_samples(a: np.ndarray, b: np.ndarray, beta: float, idx: np.ndarray) -> np.ndarray:
    """Бутстреп-распределение ΔCVaR (для разности разностей с общими индексами)."""
    return _cvar_rows(np.asarray(a, float)[idx], beta) - _cvar_rows(np.asarray(b, float)[idx], beta)


def delta_mean(a: np.ndarray, b: np.ndarray, idx: np.ndarray) -> dict:
    """Δ средних (парный перцентильный бутстреп)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    boot = a[idx].mean(axis=1) - b[idx].mean(axis=1)
    return {"a": float(a.mean()), "b": float(b.mean()), "delta": float(a.mean() - b.mean()),
            "ci": [float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))], "p_boot": _boot_p(boot)}


def cvar_upper(x: np.ndarray, alpha: float) -> float:
    """CVaR верхнего хвоста (затраты, Стадия 1): среднее k = max(1, ⌊αN⌋) наибольших значений."""
    return -cvar_lower(-np.asarray(x, float), alpha)


def delta_cvar_upper(a: np.ndarray, b: np.ndarray, alpha: float, idx: np.ndarray) -> dict:
    """ΔCVaR верхнего хвоста a − b (парный перцентильный бутстреп)."""
    r = delta_cvar(-np.asarray(a, float), -np.asarray(b, float), alpha, idx)
    return {"a": -r["a"], "b": -r["b"], "delta": -r["delta"], "ci": [-r["ci"][1], -r["ci"][0]], "p_boot": r["p_boot"]}


def delta_quantile(a: np.ndarray, b: np.ndarray, q: float, idx: np.ndarray) -> dict:
    """Δ q-квантиля (парный бутстреп; пропуски — +∞ для DSCR без обслуживания долга — уже заменены снаружи)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    boot = np.quantile(a[idx], q, axis=1) - np.quantile(b[idx], q, axis=1)
    return {"a": float(np.quantile(a, q)), "b": float(np.quantile(b, q)),
            "delta": float(np.quantile(a, q) - np.quantile(b, q)),
            "ci": [float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))]}


def wilson(k: int, n: int, z: float = Z95) -> list[float]:
    """Интервал Уилсона 95 % для k/n (при k = 0 верхняя граница > 0)."""
    if n <= 0:
        return [0.0, 1.0]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, c - h), min(1.0, c + h)]


def newcombe10(x1: np.ndarray, x2: np.ndarray) -> dict:
    """Разность парных долей p1 − p2 (x1, x2 ∈ {0,1} по одним id): интервал Ньюкомба (метод 10, без поправки на
    непрерывность) на интервалах Уилсона маргиналов с поправкой φ на корреляцию пар; точный Мак-Немар."""
    x1, x2 = np.asarray(x1, int), np.asarray(x2, int)
    n = len(x1)
    a = int(np.sum((x1 == 1) & (x2 == 1)))
    b = int(np.sum((x1 == 1) & (x2 == 0)))
    c = int(np.sum((x1 == 0) & (x2 == 1)))
    d = n - a - b - c
    p1, p2 = (a + b) / n, (a + c) / n
    l1, u1 = wilson(a + b, n)
    l2, u2 = wilson(a + c, n)
    den = (a + b) * (c + d) * (a + c) * (b + d)
    phi = (a * d - b * c) / math.sqrt(den) if den > 0 else 0.0
    delta = p1 - p2
    lo = delta - math.sqrt(max(0.0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2))
    hi = delta + math.sqrt(max(0.0, (p2 - l2) ** 2 - 2 * phi * (p2 - l2) * (u1 - p1) + (u1 - p1) ** 2))
    return {"p1": p1, "p2": p2, "p1_wilson": [l1, u1], "p2_wilson": [l2, u2], "delta": delta, "ci": [lo, hi],
            "discordant": [b, c], "concordant": [a, d], "phi": phi, "p_mcnemar": mcnemar_exact(b, c)}


def mcnemar_exact(b: int, c: int) -> float:
    """Точный двусторонний тест Мак-Немара: X ~ Bin(b + c, ½), p = min(1, 2·P(X ≤ min(b, c))); нет пар → 1."""
    m = b + c
    if m == 0:
        return 1.0
    return float(min(1.0, 2.0 * sps.binom.cdf(min(b, c), m, 0.5)))


def holm(pvals: dict[str, float]) -> dict[str, float]:
    """Поправка Холма: скорректированные p (монотонные) по семейству исходов."""
    items = sorted(pvals.items(), key=lambda kv: kv[1])
    m, out, run = len(items), {}, 0.0
    for j, (k, p) in enumerate(items):
        run = max(run, min(1.0, (m - j) * p))
        out[k] = run
    return out


def t_interval(d: np.ndarray, level: float = 0.95) -> dict:
    """t-интервал по K репликациям (метод многократных репликаций): среднее ± t_{K−1}·s/√K."""
    d = np.asarray(d, float)
    k = len(d)
    m = float(d.mean())
    if k < 2:
        return {"mean": m, "ci": [m, m], "k": k, "df": 0}
    s = float(d.std(ddof=1))
    t = float(sps.t.ppf(1 - (1 - level) / 2, k - 1))
    return {"mean": m, "ci": [m - t * s / math.sqrt(k), m + t * s / math.sqrt(k)], "sd": s, "k": k, "df": k - 1}


def gpd_alpha_grouped(counts: np.ndarray, sigma: float, cap: int) -> dict:
    """ОМП индекса хвоста α Ломакса по сгруппированным неделям задержки при известном масштабе σ.

    counts[k] — число задержек Δ = k недель, k = 1..cap−1 (Δ = ⌈x⌉, x ~ Ломакс: S(x) = (1 + x/σ)^{−α}), counts[cap] —
    цензурированные Δ ≥ cap (x > cap − 1). Аналог оценки Хилла для дискретизированных и цензурированных данных."""
    ks = np.arange(1, cap)

    def nll(alpha: float) -> float:
        s = lambda x: (1 + x / sigma) ** (-alpha)  # noqa: E731
        p = np.empty(cap)
        p[0] = 1 - s(1.0)
        p[1:cap - 1] = s(ks[:-1].astype(float)) - s(ks[1:].astype(float))
        p[cap - 1] = s(float(cap - 1))
        p = np.clip(p, 1e-300, 1)
        return -float(np.sum(counts[1:cap + 1] * np.log(p)))

    opt = minimize_scalar(nll, bounds=(0.05, 20), method="bounded")
    a = float(opt.x)
    h = 1e-4 * max(1.0, a)
    info = (nll(a + h) - 2 * nll(a) + nll(a - h)) / (h * h)
    se = 1 / math.sqrt(info) if info > 0 else float("nan")
    return {"alpha_hat": a, "se": se, "ci": [a - Z95 * se, a + Z95 * se], "n": int(np.sum(counts[1:cap + 1]))}

