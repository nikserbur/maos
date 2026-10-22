# rl/ — Python-слой AUREUS/MAOS (волна M: обученный макро-генератор)

Блок [1] методологии ([docs/METHODOLOGY-V2.md §2](../docs/METHODOLOGY-V2.md)): совместный генератор
ключевой ставки, курса USD/RUB и инфляции, обученный на публичных рядах Банка России. Порт
архитектуры RJMF Methodology §6/§6.1 «как есть» (Бураков Н. С., 2026, IJPS 3-1; RJMF 2026):
признаки → ridge-VAR(1) → SVD остатков → гауссов HMM (1–3 режима) → совместная блочная
эмпирическая выборка остатков по режиму → точное лог-центрирование. C++ `backend/src/MacroSampler.*`
воспроизводит `sample.py` побитово по сохранённым параметрам.

## Установка

```bash
python3 -m venv rl/.venv
rl/.venv/bin/pip install -r rl/requirements.txt
```

## Данные (cbr.ru, [Н])

```bash
rl/.venv/bin/python -m rl.macro.data      # скачивает 3 ряда в rl/macro/data/raw, пишет sources.json (URL, дата, SHA256)
```

Сырые файлы — недоверенные данные: только разбор pandas/ElementTree, никогда не исполняются.
`processed/macro_monthly.csv`: 2013-09 … последний полный месяц; `synthetic = 0`. Строки `synthetic = 1`
запрещены в обучении и валидации — `data.load_monthly` отказывает (§3.3, решение Р7).

## Обучение и валидация (V1)

```bash
rl/.venv/bin/python -m rl.macro.fit              # ≈ 1 мин: выбор (R, b) по CRPS + отложенное покрытие
rl/.venv/bin/python -m rl.macro.fit --no-holdout # только обучение (≈ 5 с)
```

Выход: `rl/macro/params/macro_params.json` (A, масштабы, базис SVD, HMM, блоки остатков, выбор,
таблица CRPS, статистика режимов, квантили Student-t для стресса, σ_bb моста) и
`rl/macro/params/learning.json` (сетка выбора, отложенное покрытие 80/90 %, PIT, CRPS vs персистентность).
Сервер читает `macro_params.json` при старте (`MAOS_MACRO_PARAMS` или `rl/macro/params/`, иначе `backend/data/`).

## Выборка

```bash
rl/.venv/bin/python -m rl.macro.sample --n 5 --seed 42 --weeks 26
```

Поток чисел — `SeedSequence([seed, 871])`, 3841 равномерных на id (мост недель — `[seed, 872]`);
путь id не зависит от n и размера пакета. Меню §2.6б: `stress={"regime": h}`, `{"quantile_t": q}`,
`{"episode": "2022-03"}`; опора `ref={"cpi": "flat"|"nodes"|[...], "key": "flat"|[...]}`.

## Тесты

```bash
rl/.venv/bin/pytest rl/
```

`test_recovery.py` — восстановление A и режимов на синтетическом VAR/HMM (единственное законное
применение синтетики, §11.5); `test_sampler.py` — детерминизм по seed, независимость пути от n/пакета,
среднее путей → аналитическое E; `test_validation.py` — CRPS выбранной модели ≤ персистентности,
покрытие 80 % на отложенных месяцах (с флагом недопокрытия).

## Фикстуры C++

`python -m rl.macro.make_fixture` пишет `backend/tests/fixtures/macro_params_small.json` и
`macro_expected.json` (синтетические параметры + ожидаемые пути) для `test_macrosampler.cpp`.
