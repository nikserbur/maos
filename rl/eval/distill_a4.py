"""RL → эвристики (решение владельца, docs/THESIS-FINDINGS.md В1): дистилляция политик RL A3/A4 в неглубокие деревья
решений в стиле VIPER (Bastani et al. 2018) и правила «C* + исключения».

    rl/.venv/bin/python -m rl.eval.distill_a4 --workers 9      # → rl/results/a4/distill_a4.json, rl/results/a4/dist_*.pkl

1. Прогоны политики RL на ОБУЧАЮЩИХ сценариях экземпляров A3 (пулы base и shock, 16 + 16 сценариев) в среде A4
   (умолчания продукта A4); в каждом состоянии — признаки (наблюдение A4), ход RL, ход C* на том же наблюдении.
2. Выигрыш отклонения (VIPER: вес — разность Q): в состояниях, где RL ≠ C* (≤ 24 на экземпляр), две ветви на ТОМ ЖЕ
   сценарии (CRN, повтор префикса): ход RL и ход C*, обе доигрываются политикой RL; A = 100·(Π_RL − Π_C*)/V.
3. Метка: ход RL, если RL ≠ C* и A > 0, иначе «следовать C*»; вес: 1 для «следовать», 1 + |A|/медиана|A| для
   отклонений. Дерево глубины ≤ 4 (CART, min 40 в листе), признаки — наблюдение A4 (имена — по-русски).
4. Правило продукта-кандидата: «C* + дерево» — если дерево предсказывает ход (≠ «следовать») и он допустим, взять его,
   иначе ход C*. Верность дереву — на отложенной части датасета (другие сценарии).
Проверка правил — тем же гейтом, что RL (V5-A4: политики DIST_*).
"""
from __future__ import annotations

import argparse
import json
import pickle
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from rl.env.l3_env import ACTS, F, N_ACT, make_struct_env
from rl.eval.a3_common import A3_RES, library
from rl.eval.a4_common import A4_RES, CFG4, F4, N_OBS4, load4, save, scen4, set_names, value_of
from rl.train.common import CKPT

N_PER_POOL, MAX_BRANCH, POOLS = 16, 24, ("base", "shock")
FOLLOW = N_ACT                                  # метка «следовать C*»


def feature_names() -> list[str]:
    ru = {"week": "неделя/горизонт", "t": "время/горизонт", "rho_rem": "загрузка узкого места на оставшееся время",
          "rho2": "загрузка второго типа", "queue_bn": "готовая очередь узкого места, недель фонда",
          "ot_active": "сверхурочные действуют", "ot_used": "доля недель со сверхурочными", "outage": "станок узкого места в отказе",
          "shock_seen": "шок уже случился", "rush_rem": "остаток срочного заказа", "rush_slack": "резерв срочного заказа",
          "supply_late": "срыв поставки вскрылся", "tard": "прогноз просрочки (норм.)", "late_share": "доля заказов с прогнозом просрочки",
          "late_value": "доля стоимости заказов с прогнозом просрочки", "min_slack": "минимальный резерв заказа",
          "fin_share": "доля завершённых заказов", "done_share": "доля выполненных операций", "cash": "касса/масштаб",
          "undrawn": "невыбранный лимит/лимит", "debt": "долг/лимит", "breach": "разрыв был", "min_cash": "минимум кассы/масштаб",
          "key": "ключевая ставка/0.2", "reg0": "режим 0", "reg1": "режим 1 (кризис)", "reg2": "режим 2", "fx": "курс к началу",
          "inv0": "станок 0 заказан", "inv1": "кандидат 1 заказан", "inv2": "кандидат 2 заказан", "moves": "ходов в эпохе",
          "shock_epoch": "эпоха шока", "rho_all": "средняя загрузка цеха", "weeks_left": "доля горизонта впереди"}
    names = [f"f{i}" for i in range(N_OBS4)]
    for k, i in F.items():
        names[i] = ru.get(k, k)
    for c in range(3):
        names[31 + c] = f"кандидат {c}: доля срока ввода впереди"
        names[34 + c] = f"кандидат {c}: CAPEX/(C+U)"
    names[37], names[38] = "плата субподряду накоплено/масштаб", "плата за сверхурочные накоплено/масштаб"
    names[39], names[40], names[41] = "режим: чемпион", "режим: EDD", "режим: срочный первым"
    names[46], names[47] = "станок 0 — на узком месте", "станков узкого места/10"
    a4 = {48: "сверхурочные: Δштрафов, % V", 49: "сверхурочные: Δпотерь маржи за горизонтом, % V", 50: "сверхурочные: плата, % V",
          51: "сверхурочные: чистая выгода, % V", 52: "субподряд: Δштрафов, % V", 53: "субподряд: Δпотерь маржи, % V",
          54: "субподряд: плата, % V", 55: "субподряд: чистая выгода, % V", 68: "запас ликвидности (C+U)/V", 72: "класс: малый",
          73: "класс: средний", 74: "класс: крупный", 75: "лимит/V", 76: "c0/V", 77: "постоянные×26/V", 78: "маржа/V", 79: "CAPEX станка 0/V"}
    for c in range(3):
        for q, nm in enumerate(("ΔCVaR(Π), % V", "ΔE[Π], % V", "ΔP(разрыва)", "ЧДД, % V")):
            a4[56 + 4 * c + q] = f"кандидат {c}: {nm}"
        a4[69 + c] = f"запас ликвидности после транша {c}, доли V"
    for i, nm in a4.items():
        names[i] = nm
    return names + ["ход C*"]


# ── Политики RL ───────────────────────────────────────────────────────────────────────────────────────────────────
def rl_fn(kind: str, name: str, ch4: dict):
    import torch
    torch.set_num_threads(1)
    if kind == "A3B":
        from sb3_contrib import MaskablePPO
        from rl.env.l3_env import rl_policy
        from rl.train.train_l3 import teacher as t3
        h = json.loads((A3_RES / "champions_a3.json").read_text(encoding="utf-8"))[name]["h_star"]
        f = rl_policy(MaskablePPO.load(str(CKPT / "l3s_seed1_best.zip"), device="cpu"), t3(h + "+sweep"))
        return lambda o, m: f(np.atleast_2d(o)[:, :48], m)
    from rl.train.train_l4 import ActorCritic, policy_fn
    net = ActorCritic(); net.load_state_dict(torch.load(str(CKPT / f"l4{kind[2:]}_seed1_last.pt"), map_location="cpu", weights_only=True))
    net.eval()
    return policy_fn(net, f"{ch4['C*']}|{ch4['LA*']}", False, None)


def cstar_fn(ch4: dict):
    h = {x.name: x for x in library()}[ch4["C*"]]
    return (lambda o, m: np.zeros(len(np.atleast_2d(o)), int)) if (h.name == "noop" and not h.invest) else h


def _episodes(inst, rule, sc, base, jobs, rl, cs):
    """Эпизоды шагом в ногу: job = (i, префикс, точка d, ход в d); иначе — RL. Запись (obs, маска, ход, ход C*)."""
    envs, kd, tr = [], [], []
    for i, pre, d, a in jobs:
        e = make_struct_env(inst, CFG4, (rule, [])); e.reset(base + i, sc.scenario_json(i))
        envs.append(e); kd.append(0); tr.append([])
    act = list(range(len(envs)))
    while act:
        for k in act:
            if envs[k].level == 0 and not envs[k].done:
                envs[k].run_l0()
        l2 = [k for k in act if envs[k].level == 2 and not envs[k].done]
        if l2:
            O = np.stack([envs[k].obs_l2() for k in l2]).astype(np.float32); M = np.stack([envs[k].mask_l2() for k in l2]).astype(bool)
            ar, ac = np.asarray(rl(O, M), int), np.asarray(cs(O, M), int)
            for j, k in enumerate(l2):
                i, pre, d, a_br = jobs[k]; n = kd[k]
                a = pre[n] if n < len(pre) else (a_br if n == d else int(ar[j]))
                a = a if M[j][a] else 0
                tr[k].append((O[j], M[j], a, int(ac[j]))); kd[k] += 1
                envs[k].step(a)
        act = [k for k in act if not envs[k].done]
    return [{"profit": json.loads(e.summary())["profit"], "traj": t} for e, t in zip(envs, tr)]


def _collect(args):
    kind, name, ch4, seed = args
    rng = np.random.default_rng(seed)
    inst, v, rule = load4(name), value_of(name), ch4["rule"]
    rl, cs = rl_fn(kind, name, ch4), cstar_fn(ch4)
    X, Y, W, G = [], [], [], []
    n_dev, adv = 0, []
    for p, pool in enumerate(POOLS):
        sc, base = scen4("train", 512, pool)
        idx = [int(i) for i in rng.choice(512, N_PER_POOL, replace=False)]
        eps = _episodes(inst, rule, sc, base, [(i, [], -1, -1) for i in idx], rl, cs)
        devs = [(e_i, d) for e_i, e in enumerate(eps) for d, t in enumerate(e["traj"]) if t[2] != t[3]]
        n_dev += len(devs)
        pick = [devs[j] for j in rng.choice(len(devs), min(MAX_BRANCH, len(devs)), replace=False)] if devs else []
        jobs = []
        for e_i, d in pick:
            pre = [t[2] for t in eps[e_i]["traj"][:d]]
            t = eps[e_i]["traj"][d]
            jobs += [(idx[e_i], pre, d, t[2]), (idx[e_i], pre, d, t[3])]
        br = _episodes(inst, rule, sc, base, jobs, rl, cs) if jobs else []
        a_of = {pk: 100.0 * (br[2 * j]["profit"] - br[2 * j + 1]["profit"]) / v for j, pk in enumerate(pick)}
        for e_i, e in enumerate(eps):
            for d, (o, m, a, ac) in enumerate(e["traj"]):
                X.append(np.concatenate([o, [ac]])); G.append(int(idx[e_i]) * 2 + p)
                if a == ac:
                    Y.append(FOLLOW); W.append(np.nan)
                elif (e_i, d) in a_of:
                    A = a_of[(e_i, d)]; adv.append(A)
                    Y.append(a if A > 0 else FOLLOW); W.append(abs(A))
                else:
                    Y.append(-1); W.append(np.nan)            # отклонение без оценки выигрыша — в обучение не идёт
    return name, np.asarray(X, np.float32), np.asarray(Y), np.asarray(W), np.asarray(G), n_dev, adv


def fit_tree(X, Y, W, G, depth: int = 4):
    from sklearn.tree import DecisionTreeClassifier
    keep = Y >= 0
    X, Y, W, G = X[keep], Y[keep], W[keep], G[keep]
    med = np.nanmedian(W) if np.isfinite(W).any() else 1.0
    w = np.where(np.isnan(W), 1.0, 1.0 + W / max(1e-9, med))
    test = (G % 5) == 0                                 # отложенная часть — по сценариям
    tree = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=40, random_state=1).fit(X[~test], Y[~test], sample_weight=w[~test])
    pred = tree.predict(X[test])
    dev = Y[test] != FOLLOW
    fid = {"n_train": int((~test).sum()), "n_test": int(test.sum()), "acc_all": float(np.mean(pred == Y[test])),
           "acc_deviation_states": float(np.mean(pred[dev] == Y[test][dev])) if dev.any() else None,
           "follow_kept": float(np.mean(pred[~dev] == FOLLOW)) if (~dev).any() else None, "n_dev_labels": int((Y != FOLLOW).sum())}
    return tree, fid


def rules_text(tree) -> str:
    from sklearn.tree import export_text
    names = feature_names()
    cls = [("следовать C*" if c == FOLLOW else ACTS[c]) for c in tree.classes_]
    txt = export_text(tree, feature_names=names, class_names=cls, decimals=3, show_weights=False)
    return txt.replace("class:", "→")


class Distilled:
    """«C* + исключения дерева»: ход дерева, если он ≠ «следовать» и допустим, иначе ход C* (без нейросети)."""

    def __init__(self, cstar, tree):
        self.cstar, self.tree = cstar, tree

    def __call__(self, obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        obs = np.atleast_2d(obs); mask = np.atleast_2d(mask).astype(bool)
        ac = np.asarray(self.cstar(obs, mask), int)
        pt = self.tree.predict(np.concatenate([obs, ac[:, None]], 1).astype(np.float32))
        ok = (pt != FOLLOW) & mask[np.arange(len(obs)), np.minimum(pt, N_ACT - 1)]
        return np.where(ok, pt, ac)


def load_distilled(kind: str, ch4: dict):
    tree = pickle.loads((A4_RES / f"dist_{kind}.pkl").read_bytes())
    return Distilled(cstar_fn(ch4), tree)


def refresh_rules() -> None:
    """Переписать текст правил из сохранённых деревьев (без пересчёта датасета)."""
    path = A4_RES / "distill_a4.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    for kind in d:
        if (A4_RES / f"dist_{kind}.pkl").exists():
            d[kind]["rules"] = rules_text(pickle.loads((A4_RES / f"dist_{kind}.pkl").read_bytes()))
    save(path, d)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-rules", action="store_true")
    ap.add_argument("--kinds", nargs="+", default=["A3B", "A4D"])
    ap.add_argument("--workers", type=int, default=9)
    a = ap.parse_args()
    if a.refresh_rules:
        refresh_rules(); return
    ch = json.loads((A4_RES / "champions_a4.json").read_text(encoding="utf-8"))
    names = set_names("A3")
    out = {}
    for kind in a.kinds:
        with ProcessPoolExecutor(a.workers) as ex:
            parts = list(ex.map(_collect, [(kind, n, ch[n], 7 + j) for j, n in enumerate(names)]))
        X = np.concatenate([p[1] for p in parts]); Y = np.concatenate([p[2] for p in parts])
        W = np.concatenate([p[3] for p in parts]); G = np.concatenate([p[4] for p in parts])
        tree, fid = fit_tree(X, Y, W, G)
        (A4_RES / f"dist_{kind}.pkl").write_bytes(pickle.dumps(tree))
        adv = np.concatenate([np.asarray(p[6], float) for p in parts]) if any(len(p[6]) for p in parts) else np.zeros(0)
        txt = rules_text(tree)
        out[kind] = {"n_states": int(len(X)), "n_deviation_states": int(sum(p[5] for p in parts)), "n_branched": int(len(adv)),
                     "adv_mean_pctV": float(adv.mean()) if len(adv) else None, "adv_pos_share": float(np.mean(adv > 0)) if len(adv) else None,
                     "per_instance_dev": {p[0]: int(p[5]) for p in parts}, "fidelity": fid, "rules": txt,
                     "classes": [("следовать C*" if c == FOLLOW else ACTS[c]) for c in tree.classes_]}
        print(f"[{kind}] состояний {len(X)}, отклонений {out[kind]['n_deviation_states']}, ветвлений {len(adv)}, "
              f"A̅ {out[kind]['adv_mean_pctV']}, верность {fid}\n{txt}", flush=True)
    prev = json.loads((A4_RES / "distill_a4.json").read_text(encoding="utf-8")) if (A4_RES / "distill_a4.json").exists() else {}
    save(A4_RES / "distill_a4.json", {**prev, **out})


if __name__ == "__main__":
    main()
