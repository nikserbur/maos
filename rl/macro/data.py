"""Данные макро-генератора: публичные месячные ряды Банка России (METHODOLOGY-V2 §2.1).

Порт конвейера `research/revision/data_pipeline.py` пакета RJMF (Бураков 2026; RJMF 2026):
сырые файлы неизменяемы, каждая подготовленная таблица имеет единицы и происхождение
(URL, дата выгрузки, SHA256 → `sources.json`). Скачанные файлы — недоверенные данные:
разбираются только pandas/ElementTree, никогда не исполняются.

Ряды: инфляция г/г (%), ключевая ставка (% годовых, конец месяца и календарная средняя),
курс USD/RUB (конец месяца). Период 2013-09 … последний полный месяц. Столбец
`synthetic` = 0 для всех наблюдений cbr.ru; обучение отказывает при synthetic = 1 (§3.3, Р7).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
PARAMS = ROOT / "params"

FIRST_MONTH = "2013-09"          # как в RJMF: 157 наблюдений на 2026-09 [Н]

URLS = {
    "inflation.html": "https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2013&UniDbQuery.To={to}",
    "keyrate.html":   "https://www.cbr.ru/hd_base/keyrate/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2013&UniDbQuery.To={to}",
    "fx_usd.xml":     "https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/01/2013&date_req2={to_slash}&VAL_NM_RQ=R01235",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False))


def fetch(to: dt.date | None = None, force: bool = False) -> list[dict]:
    """Скачивает три ряда в RAW (если нет) и пишет sources.json с SHA256. Сеть — только здесь."""
    to = to or dt.date.today()
    RAW.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, tmpl in URLS.items():
        url = tmpl.format(to=to.strftime("%d.%m.%Y"), to_slash=to.strftime("%d/%m/%Y"))
        f = RAW / name
        if force or not f.exists():
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:   # noqa: S310 — публичный https cbr.ru
                b = r.read()
            if not b or (name.endswith(".xml") and b[:5] != b"<?xml"):
                raise RuntimeError(f"cbr.ru: неожиданный ответ для {name}")
            f.write_bytes(b)
        rows.append({"file": name, "url": url, "retrieval_date": to.isoformat(),
                     "bytes": f.stat().st_size, "sha256": sha256(f),
                     "vintage": "revised downloadable history, not real-time vintage"})
    dump(ROOT / "data" / "sources.json", rows)
    return rows


def _read_inflation() -> pd.DataFrame:
    t = pd.read_html(StringIO((RAW / "inflation.html").read_text(encoding="utf-8")),
                     decimal=",", thousands=None, converters={0: str})[0]
    t.columns = ["month", "key_end_pp", "cpi_yoy_pp", "target_pp"]
    t["month"] = t["month"].map(lambda x: pd.Period(f"{x.split('.')[1]}-{int(x.split('.')[0]):02d}", freq="M"))
    for c in t.columns[1:]:
        t[c] = pd.to_numeric(t[c], errors="coerce")
    return t.sort_values("month").set_index("month")


def _read_fx_daily() -> pd.Series:
    x = ET.fromstring((RAW / "fx_usd.xml").read_bytes())
    fx = pd.Series({pd.to_datetime(r.attrib["Date"], format="%d.%m.%Y"):
                    float(r.findtext("Value").replace(",", ".")) / float(r.findtext("Nominal")) for r in x})
    return fx.sort_index()


def _read_key_daily() -> pd.Series:
    k = pd.read_html(StringIO((RAW / "keyrate.html").read_text(encoding="utf-8")), decimal=",", thousands=None)[0]
    return pd.Series(k.iloc[:, 1].to_numpy(float), index=pd.to_datetime(k.iloc[:, 0], dayfirst=True)).sort_index()


def _bridge_sigma(daily: pd.Series, monthly_end: pd.Series) -> tuple[float, int]:
    """σ_bb броуновского моста (§2.3) по дневным данным: отклонение 100·ln S_d от линейной
    интерполяции между концами месяцев, нормированное на sqrt(f(1−f)); [О]."""
    lv = 100 * np.log(daily)
    ends = monthly_end.index.to_timestamp(how="end").normalize()
    vals, n = [], 0
    for a, b in zip(ends[:-1], ends[1:]):
        seg = lv[(lv.index > a) & (lv.index < b)]
        if len(seg) < 5:
            continue
        la, lb = 100 * np.log(monthly_end.iloc[monthly_end.index.get_loc(a.to_period("M"))]), \
                 100 * np.log(monthly_end.iloc[monthly_end.index.get_loc(b.to_period("M"))])
        f = (seg.index - a).days / (b - a).days
        dev = seg.to_numpy() - (la + f * (lb - la))
        w = f * (1 - f)
        vals.extend((dev ** 2 / w)[w > 0.05].tolist())
        n += 1
    return (float(np.sqrt(np.mean(vals))) if vals else 0.0), n


def prepare() -> pd.DataFrame:
    """RAW → processed/macro_monthly.csv (+ meta.json). Единицы: % г/г, % годовых, руб./долл."""
    t = _read_inflation()
    fx = _read_fx_daily()
    last_month = t.index.max()
    end_day = last_month.to_timestamp(how="end").normalize()
    fxd = fx.reindex(pd.date_range(fx.index.min(), end_day, freq="D")).ffill()
    t["usd_rub_end"] = fxd.resample("ME").last().to_period("M")
    kd = _read_key_daily()
    kdd = kd.reindex(pd.date_range(kd.index.min(), end_day, freq="D")).ffill()
    t["key_calendar_mean_pp"] = kdd.resample("ME").mean().to_period("M")
    t["dlog_fx_percent"] = 100 * np.log(t["usd_rub_end"] / t["usd_rub_end"].shift())
    t["synthetic"] = 0
    t = t[t.index >= pd.Period(FIRST_MONTH, freq="M")].dropna(subset=["cpi_yoy_pp", "key_end_pp", "usd_rub_end"])
    assert t["cpi_yoy_pp"].between(-20, 100).all() and len(t) > 140, "проверка диапазона/длины ряда"
    OUT.mkdir(parents=True, exist_ok=True)
    t.to_csv(OUT / "macro_monthly.csv", index_label="month")
    sbb, nm = _bridge_sigma(fx[fx.index >= pd.Timestamp("2013-09-01")], t["usd_rub_end"])
    meta = {
        "n": int(len(t)), "first": str(t.index.min()), "last": str(t.index.max()),
        "units": {"cpi_yoy_pp": "арифметическая инфляция г/г, % (конец месяца)",
                  "key_end_pp": "ключевая ставка на конец месяца, % годовых",
                  "key_calendar_mean_pp": "календарно-взвешенная средняя ставка за месяц, % годовых",
                  "usd_rub_end": "официальный курс USD/RUB на конец месяца"},
        "sigma_bb": {"fx_pct_log": sbb, "fx_months_used": nm, "status": "О",
                     "key_pct": 0.0, "key_status": "Н: ставка меняется только в даты заседаний → ступень, σ_bb=0",
                     "cpi_pct": 0.0, "cpi_status": "НОРМ: дневного ряда нет → линейная интерполяция, σ_bb=0 (помечено)"},
        "synthetic_rows": 0,
        "sources": json.loads((ROOT / "data" / "sources.json").read_text()) if (ROOT / "data" / "sources.json").exists() else [],
        "retrospective_not_realtime": True,
    }
    dump(OUT / "meta.json", meta)
    return t


def load_monthly(path: Path | None = None) -> pd.DataFrame:
    """Читает подготовленный ряд; отказывает, если есть строки synthetic=1 (§3.3, Р7)."""
    f = pd.read_csv(path or OUT / "macro_monthly.csv")
    if "synthetic" in f.columns and (f["synthetic"].fillna(0).astype(int) == 1).any():
        raise ValueError("macro: synthetic=1 строки запрещены в обучении/валидации (METHODOLOGY-V2 §3.3, Р7)")
    f["month"] = pd.PeriodIndex(f["month"], freq="M")
    return f


if __name__ == "__main__":
    fetch()
    t = prepare()
    print("prepared", len(t), str(t.index.min()), "…", str(t.index.max()))
