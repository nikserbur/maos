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

---

# Волна A — агенты (SimEnv, стенд RL, бенчмарки, правило «RL»)

Отчёт: [docs/research/A1-rl-wave.md](../docs/research/A1-rl-wave.md). Модуль `maos_env` (nanobind) собирается в `rl/env/`:

```bash
cmake -S backend -B backend/build -DMAOS_BUILD_PYENV=ON \
  -Dnanobind_DIR="$(rl/.venv/bin/python -m nanobind --cmake_dir)" -DPython_EXECUTABLE=$PWD/rl/.venv/bin/python
cmake --build backend/build --target maos_env -j8
rl/.venv/bin/pytest rl/                                   # macro + env + bench
rl/.venv/bin/python -m rl.bench.instances                 # ta01–ta10, mk01–mk10 (rl/bench/data/raw — недоверенные данные), 12 экземпляров MAOS
rl/.venv/bin/python -m rl.bench.run_v4 --cpsat-sec 60     # V4 → rl/results/v4_benchmarks.json
rl/.venv/bin/python -m rl.train.train_l0 --seeds 1 2 3    # L0 MaskablePPO, куррикулум §7.4 → rl/train/checkpoints
rl/.venv/bin/python -m rl.train.train_l2 --seeds 1 2 3 --l0 rule:EDD   # L2 поверх замороженной L0
rl/.venv/bin/python -m rl.eval.v5 --n 200 --seeds 1 2 3   # V5 holdout + стрессы + гейт → rl/results/v5_results.json
rl/.venv/bin/python -m rl.train.export_onnx --ckpt rl/train/checkpoints/l0_seed1_best.zip --out rl/results/l0_policy.onnx
```

Сервер ищет `l0_policy.onnx`/`l2_policy.onnx` в `$MAOS_RL_POLICY_DIR` → `rl/results`; без них правило `RL`
в `POST /api/schedule` отвечает `error_soft` с причиной (`GET /api/rl/status`).

---

# Волна A2 — CP-SAT в продукте, тёплый старт ГА, обогащённая НСИ, реактивный L0

Отчёт: [docs/research/A2-cpsat-warmstart.md](../docs/research/A2-cpsat-warmstart.md).

```bash
# Sidecar CP-SAT для правила «CP-SAT» Стадии 1 (только 127.0.0.1; backend ищет $MAOS_CPSAT_URL, по умолчанию :8091)
rl/.venv/bin/python -m rl.cpsat_service                     # GET /health, GET /schema, POST /solve
curl -s 127.0.0.1:8091/health
# POST /api/schedule {"rule":"CP-SAT","cpsat_time_limit":30,"improve_iters":20}  → поле cpsat + improver.mode_won

rl/.venv/bin/python -m rl.bench.instances                   # экземпляры (обогащённая НСИ; A1 — в data/instances/a1/)
rl/.venv/bin/python -m rl.bench.moves_census               # доступные структурные ходы A1 → A2
rl/.venv/bin/python -m rl.bench.run_v4_a2 --cpsat-sec 60    # V4: CP-SAT в продукте, ГА с тёплым стартом, цена детерминизма
rl/.venv/bin/python -m rl.bench.cpsat_keys --sec 60         # ключи CP-SAT экземпляров (действие L0 и базовая линия)
rl/.venv/bin/python -m rl.eval.headroom --n-val 32 --n 100  # запас: ручные оракулы против лучшего правила
rl/.venv/bin/python -m rl.train.train_l0_rule --seeds 1 2 3 # L0 «выбор правила»: BC → PPO (CVaR, RU)
rl/.venv/bin/python -m rl.eval.v5_a2 --n 200 --seeds 1 2 3  # V5 + стресс «шок» + экстренное реагирование + гейт
```

---

# Волна A3 — структурный RL (L2/L3) и инвестиционный агент

Отчёт: [docs/research/A3-structural-rl-invest.md](../docs/research/A3-structural-rl-invest.md); предрегистрация —
[rl/eval/prereg_a3.md](eval/prereg_a3.md) (записана до обучения; поправки П1–П4 с датами).

```bash
rl/.venv/bin/python -m rl.bench.instances_a3                  # 30 экземпляров семейства A3 → rl/bench/data/instances_a3
rl/.venv/bin/python -m rl.eval.headroom_a3 --n 100            # H0: лучшее правило / IIP / сетка эвристик / ex-post оракул
rl/.venv/bin/python -m rl.bench.keys_a3 --sec 60 --ga-sec 30  # ключи CP-SAT и ГА с тёплым стартом
rl/.venv/bin/python -m rl.train.train_l3 --seeds 1 2 3 --steps 500000                     # вариант A (учитель H*)
rl/.venv/bin/python -m rl.train.train_l3 --variant sweep --seeds 1 2 3 --steps 1000000    # вариант B (H* + погашение)
rl/.venv/bin/python -m rl.eval.v5_a3 --n 200 --seeds 1 2 3    # V5-A3, гейты → rl/results/a3/v5_a3.json, champion_a3.json
```

Структурный режим SimEnv: `EnvConfig.struct_mode` (эпохи — неделя и экстренные события; 13 ходов; `run_l0()` — L0 в C++),
`schedule_invest(c, week)` — статическая покупка; `invest_eval(...)` — CRN-оценка кандидата L3 (ЧДД/CVaR/окупаемость/P(разрыва)).
