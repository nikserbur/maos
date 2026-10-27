# MAOS

**English** · [Русский](README.ru.md)

MAOS is the project's code name, used throughout the code and the docs. The web UI is branded
**PESCADITO**, and the Python layer in [`rl/`](rl/README.md) (macro generator, CP-SAT sidecar,
reinforcement learning) is code-named **AUREUS**.

MAOS is a production planning and optimization system that works under uncertainty. It is built on a
**two-stage stochastic model**. Stage 1 decides **how** to produce a programme, which means the
schedule of operations. Stage 2 decides **what** to produce: a product portfolio that holds up under
price risk. The bundled demo data describe an integrated steel plant. A local **C++17 backend** does
every calculation from a SQLite database; the frontend is a React/TypeScript app with a 3D plant
scheme. The UI and the documentation are in Russian.

![The plant scheme screen («Схема предприятия»): 3D view of the demo site](docs/research/img/X1-scheme-plant.jpg)

*The plant scheme screen («Схема предприятия»). Screenshot taken at v0.67.0.*

The current version is set in [`package.json`](package.json). The UI shows it in the status bar and
on the login screen, and the backend reports its own version at `GET /api/health`.

## The core idea: two stages, both under uncertainty

```
STAGE 1 — HOW to produce (execution):
  programme + plant graph + routings + workers + calendars
  → search for a good order of operations (simulation-based evaluation, dispatch rules, GA)
  → Gantt chart, equipment load, worker plans, bottlenecks, idle time
  → operation durations are HEAVY-TAILED (Monte Carlo) ⇒ risk of missing due dates

STAGE 2 — WHAT to produce (portfolio):
  cost and lead time from Stage 1 + stochastic, correlated sales PRICES
  → robust product PORTFOLIO (CVaR / worst case / mean-variance / min-regret)
  → diversification against price risk ("don't bet everything on one product")

LINK: the Stage 2 portfolio becomes the Stage 1 programme.
```

The goal is the decision that is **most robust** to external conditions, not the one that is most
profitable on average. Full model: [docs/SCHEDULING.md](docs/SCHEDULING.md) (Stage 1),
[docs/OPTIMIZATION.md](docs/OPTIMIZATION.md) (Stage 2), [docs/CONCEPT.md](docs/CONCEPT.md),
[docs/METHODOLOGY-V2.md](docs/METHODOLOGY-V2.md).

## External conditions and forecasts

- **Prices** of products and raw materials, and the **key rate**, are forecast from their history
  (`ts_data`, `macro_ts`) by a single engine (`POST /api/forecast`). The steps are: trend as the EMD
  residual, adaptive harmonics, and a residual distribution chosen by AIC among normal, Laplace,
  Student-t and α-stable. Monte Carlo sampling then produces a monthly P10/P50/P90 fan. Cross-price
  dependence comes from historical correlations (PCA, a one-factor model).
- **Macro scenarios** (key rate, USD/RUB, inflation) come from a generator trained on public Bank of
  Russia series in [`rl/macro`](rl/README.md). The pipeline is ridge-VAR(1), then SVD of the
  residuals, then a Gaussian HMM with 1–3 regimes, then a block bootstrap of residuals by regime. The
  backend's `MacroSampler` reads the saved parameters (`rl/macro/params/macro_params.json`) and
  reproduces the Python sampler's paths bit for bit.

## What is implemented

**Data and model**
- Master-data registries linked by ID with foreign keys: equipment types, equipment, products,
  routings, operations and workers. Costs and capacities follow the production chain (BOM,
  `operation_inputs`).
- The plant scheme is stored in the database (`GET /api/scheme`) and has three levels: world map,
  site and shop.
- Each project is a separate SQLite file, chosen or created on the login screen.
- Parameter passport: each model parameter has a status and a source (`param_passport`, `fin_params`).

**Stage 1: scheduling**
- Flexible job-shop (FJSP) list scheduling. The programme is expanded into operations and sequenced by
  a dispatch rule: EDD, SPT, CR, MWKR, MS, FIFO or LPT. You can also define your own weighted
  heuristic.
- Operation durations are heavy-tailed (Monte Carlo). Work calendars, MRP material requirements,
  Gantt chart, queues and load, bottlenecks, KPIs (makespan, tardiness, OTD).
- A genetic-algorithm improver: a random-key GA over dispatch priorities.
- Optional exact **CP-SAT** rule through the Python sidecar `rl/cpsat_service.py` (OR-Tools). It is
  available through the backend API (`POST /api/schedule` with `"rule": "CP-SAT"`); the plan wizard
  does not offer it.
- Optional **RL** rule: an ONNX policy run with ONNX Runtime. The repository does not include a
  trained policy. Train and export one with `rl/` (see [rl/README.md](rl/README.md)); until then the
  rule returns an explanatory error.
- Plan simulation replayed on the 3D scheme. Observed durations can be written back to the norms after
  confirmation.

**Stage 2: portfolio**
- Robust portfolio chosen by Monte Carlo over correlated prices. Objectives: CVaR, worst case,
  mean-variance and min-regret. A demand model adds market capacity, price elasticity and competitor
  supply.
- An exact LP for CVaR and worst case (Rockafellar–Uryasev), solved with **HiGHS** on the same
  scenarios. It reports shadow prices; the screen also shows an out-of-sample check and a Pareto
  frontier.
- A chosen portfolio can be handed to Stage 1 as a plan.

**Finance**
- Cash: a weekly cash waterfall per scenario and a CVaR LP with cash, debt and a liquidity floor
  (HiGHS). The output includes a price-of-liquidity curve; results are shown in the «Касса» (cash)
  section of a plan.
- Investment projects: buying extra equipment (for the bottleneck by default) is evaluated with
  paired simulation runs on common random numbers. Outputs: E[NPV] with a confidence interval, CVaR of
  NPV, probability of a cash gap, and payback.

**Agents (RL/MARL)**
- A discrete-event environment in C++ (`SimEnv`) is exposed to Python through nanobind. The RL stand
  in `rl/` uses Gymnasium environments, MaskablePPO training, benchmarks and ONNX export.
- The «Агенты» screen shows the agent's status, the gate verdict, benchmark evidence and the agent's
  permissions.

**Explanation**
- The methodology map: a graph of 8 blocks with live states and a parameter passport for each node.
- The methodology write-up («Методика»).
- [MENTAT](#mentat-llm-explanations): explanations of computed results by a local language model.

**System**
- Login against a user registry with roles and permissions (RBAC). After 5 failed attempts the
  account is locked for 5 minutes. An audit log records who changed what and when.
- Database migrations are tracked with `PRAGMA user_version` (currently up to v21). They are
  idempotent and keep existing data.

## Screens

| Screen (UI label) | What it does |
|---|---|
| Plant scheme («Схема предприятия») | The start screen. A 2D world map of sites (MapLibre) and 3D site and shop levels built from the database. Three modes: view, edit (changes are saved to the registries, with undo) and simulation (replays a plan on the scene) |
| Registries («Справочники») | Six registries: equipment types, equipment, products, routings, operations, workers. Includes a routing editor |
| Scenarios («Сценарии») | Scenario list and editor (conditions, distributions, price forecast). Has a preset gallery (forecast, historical episodes, stress tests), macro-generator settings and side-by-side comparison of up to 5 scenarios |
| Portfolio («Портфель», Stage 2) | Robust choice of what to produce: heuristic vs exact LP with shadow prices, out-of-sample check, Pareto frontier and equipment load. Hands the result to «План» |
| Plan («План», Stage 1) | Run history and a six-step wizard: programme, conditions, distributions, constraints, objective and risk, launch. Results: KPIs, bottleneck, agent moves, Gantt (drag a bar to pin it), queues and load, tables, cash |
| Agents («Агенты») | RL agent verdict, benchmark evidence, agent permissions, and how the agent layer works |
| Monitoring («Мониторинг») | What changed in external conditions and prices since the plan was made: signals, key-rate, inflation and FX fans, and a what-if panel |
| Analytics («Аналитика») | KPIs of a selected plan run, bottlenecks, investment projects, and material flows (bar list, heat map, Sankey) |
| Methodology map («Карта методологии») | Graph of the 8 methodology blocks with live states and a node panel |
| Methodology («Методика») | Long-form description of the methods, with formulas and references |
| AI workflow («AI-воркфлоу») | Node editor for drafting MENTAT dialogue flows. Drafts are kept in the browser's localStorage and can be exported to JSON; the backend does not run them |
| Administration («Администрирование») | Audit log, users, and a role × permission matrix |

To open the MENTAT panel from any screen, use the button in the top bar or press Cmd/Ctrl+J.

## MENTAT: LLM explanations

MENTAT answers "why" questions about a calculation that has already run: a portfolio, plan, cash
position, RL result or investment project. It builds a context from the calculation graph and sends a
prompt to a language model. Then it checks every number in the answer against the graph node the
answer cites, and marks each claim as verified, mismatched or unsupported. It does not forecast or
optimize. The backend never generates answers itself: with no model configured,
`POST /api/mentat/ask` returns 503 and the panel says that the local model is not connected.

- It needs a model server with an **OpenAI-compatible API** (vLLM, llama.cpp `llama-server`, LM
  Studio) or **Ollama**, reachable over **plain HTTP**. `https://` URLs are rejected; put TLS in a
  reverse proxy outside MAOS.
- Configure the model in MENTAT → «Подключение» (stored in the project settings) or with backend
  environment variables, which take precedence: `MAOS_LLM_URL`, `MAOS_LLM_MODEL`, `MAOS_LLM_FLAVOUR`
  (`openai` or `ollama`), and `MAOS_LLM_API_KEY` (read from the environment only, never stored).
- Only loopback hosts are accepted by default. Any other host must be listed in
  `MAOS_LLM_ALLOWED_HOSTS` (comma-separated); the host of `MAOS_LLM_URL` itself is always allowed.

```bash
cd backend/build
MAOS_LLM_URL=http://127.0.0.1:11434 MAOS_LLM_FLAVOUR=ollama MAOS_LLM_MODEL=qwen2.5:14b-instruct ./maos_server maos.db
```

For details (context format, prompt catalogue, how answers are verified), see
[docs/MENTAT.md](docs/MENTAT.md).

## Network access

The backend listens on `127.0.0.1:8080` only, and the frontend reaches it through the Vite proxy.
Everything runs locally, with these exceptions:

- **At runtime**, the 2D world map (the top level of the plant scheme) loads CARTO basemap styles and
  tiles from `basemaps.cartocdn.com`. It also requests road routes from the public OSRM server
  `router.project-osrm.org`. When offline, these requests fail and routes are drawn as straight
  lines.
- MENTAT sends requests only to the model server you configure.
- **At build and setup time**, CMake downloads the C++ dependencies (listed below) and `pnpm install`
  downloads npm packages. `python -m rl.macro.data` downloads Bank of Russia series, but only when
  you run it.

## Requirements

- **Node.js 18+** (20 LTS recommended) and **pnpm**. The lockfile is `pnpm-lock.yaml`.
- **A C++17 compiler, CMake 3.16+ and SQLite3** (library and headers). You also need **git and
  network access** for the first CMake configure, because FetchContent downloads:
  - cpp-httplib v0.16.3 and nlohmann/json v3.11.3 (header-only);
  - HiGHS v1.15.1, built from source as a static library (the exact LPs);
  - GoogleTest v1.15.2, when tests are enabled (`MAOS_BUILD_TESTS`, ON by default);
  - ONNX Runtime 1.20.1, a prebuilt macOS arm64 archive, when `MAOS_WITH_ONNX` is ON. That is the
    default on macOS arm64 only; elsewhere it is OFF and the RL rule is unavailable.
- **Optional: Python 3** with [`rl/requirements.txt`](rl/requirements.txt), for the CP-SAT sidecar,
  retraining the macro generator and the RL stand.

## Install and run

You need two processes: the C++ backend and the web frontend.

### 1. Backend (C++)

```bash
cd backend && mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release     # add -DMAOS_BUILD_TESTS=OFF to skip GoogleTest
cmake --build . -j
./maos_server maos.db                   # http://127.0.0.1:8080
```

Start the server **from `backend/build`**. It reads `schema.sql` from the working directory (CMake
copies it next to the binary), so starting it from anywhere else fails with
`schema.sql not found`. Database paths are relative to the working directory, and the project list
on the login screen shows the `*.db` files in it.

When the server starts on an empty database, it **seeds demo data automatically**: an integrated
steel plant with shops and equipment, products, routings, operations, workers, orders, scenarios, and
price and key-rate history. Migrations are idempotent and keep existing data.

Optional backend settings (environment variables):

| Variable | Purpose |
|---|---|
| `MAOS_LLM_*` | MENTAT model connection (see [MENTAT](#mentat-llm-explanations)) |
| `MAOS_CPSAT_URL` | CP-SAT sidecar URL, default `http://127.0.0.1:8091` |
| `MAOS_RL_POLICY_DIR` | Directory with `l0_policy.onnx`. If unset, the server looks in `rl/results`, `../rl/results`, `../../rl/results`, `backend/data` and `data`, relative to the working directory |
| `MAOS_MACRO_PARAMS` | Path to `macro_params.json`. If unset, the server finds `rl/macro/params/macro_params.json` relative to the working directory |

To use the CP-SAT rule, run the sidecar from the repository root:

```bash
python3 -m venv rl/.venv
rl/.venv/bin/pip install -r rl/requirements.txt
rl/.venv/bin/python -m rl.cpsat_service   # 127.0.0.1:8091
```

### 2. Frontend (web)

```bash
pnpm install
pnpm dev                     # http://localhost:5173 (proxies /api to 127.0.0.1:8080)
```

Open **http://localhost:5173**.

### 3. Sign in: account and project

The login screen has three fields:

| Field | Value |
|---|---|
| «Проект (производство)» (project) | the **database** to open (see below) |
| «Логин» (login) | `admin` |
| «Пароль» (password) | `maos2025` |

> [!WARNING]
> `admin` / `maos2025` are **demo credentials** that are seeded into every new database. Change them
> in «Администрирование» (Administration) before any real use. The built-in login is designed for
> local use only. Passwords are stored as salted FNV-1a hashes rather than with a password-hashing
> function, and the server listens on `127.0.0.1` only.

The `admin` account has the «Администратор» (Administrator) role. In «Администрирование» you can
reset passwords and manage users and roles. After 5 failed attempts, sign-in is blocked for 5 minutes.

**Projects are separate databases.** Each production site is its own SQLite file (`*.db`) in the
backend's working directory (`backend/build/`). The «Проект» list contains:

- **existing databases**: every `*.db` file in that directory (for example `maos.db`);
- **«+ Новый проект…»** (new project): creates a **new database** with demo data, `<name>.db`.

The selected project is opened when you sign in, so you can switch between sites from the login
screen without restarting the server. The `./maos_server <file>.db` argument only sets the database
opened at startup.

> If the app sends you back to the login screen after an action, your session has expired. Sessions
> live in the server's memory and last 12 hours, so a backend restart also ends them. Sign in again.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Frontend dev server with HMR |
| `pnpm build` | Type check + production build into `dist/` |
| `pnpm typecheck` | Type check only |
| `pnpm test` | Frontend unit tests (Vitest) |
| `pnpm preview` | Serve the production build locally |
| `cmake --build backend/build -j` | Build the backend |
| `cd backend/build && ./maos_server maos.db` | Run the backend |
| `cd backend/build && ctest --output-on-failure` | C++ tests (GoogleTest; you can also run `./maos_tests` directly) |
| `rl/.venv/bin/pytest rl/macro` | Python tests of the macro generator |
| `rl/.venv/bin/pytest rl/` | All Python tests. The `rl/env` tests need the native `maos_env` module, built with `-DMAOS_BUILD_PYENV=ON` (see [rl/README.md](rl/README.md)) |

## Tech stack

- **Frontend:** React 18, TypeScript and Vite 5. The 3D scheme uses three.js with @react-three/fiber,
  drei and postprocessing, and the 2D world map uses MapLibre GL. Tests run on Vitest. Styling comes
  from custom design tokens inspired by Blueprint's density (`src/styles/tokens.css`), with dark and
  light themes; there is no UI component library dependency.
- **Backend:** C++17 with cpp-httplib (HTTP on `127.0.0.1:8080`), SQLite and nlohmann/json. HiGHS
  solves the LPs; ONNX Runtime is optional. Tests use GoogleTest.
- **Python layer (`rl/`, AUREUS):** a macro generator (NumPy, SciPy, pandas, hmmlearn), an OR-Tools
  CP-SAT sidecar, and an RL stand: Gymnasium and Stable-Baselines3 (MaskablePPO) over the C++
  `SimEnv` through nanobind, with ONNX export.

## Project structure

```
backend/                     C++ backend (core + HTTP API)
├── src/
│   ├── main.cpp             HTTP server, endpoints, migrations, demo seed, forecast engine
│   ├── Database.{h,cpp}     SQLite wrapper
│   ├── Scheduler.*          Stage 1: FJSP scheduling (heavy-tailed durations)
│   ├── GaImprover.*         Stage 1: genetic-algorithm improver
│   ├── CpSatRule.*          client of the CP-SAT sidecar
│   ├── RlRule.*             RL rule (ONNX policy)
│   ├── SimEnv*.cpp          discrete-event environment for agents (pyenv.cpp: nanobind module)
│   ├── Optimizer.*          Stage 2: robust portfolio
│   ├── ExactCvar.*          exact CVaR / worst-case LP (HiGHS)
│   ├── Cash*.*              cash waterfall and cash LP
│   ├── Invest*.*            investment project evaluation
│   ├── MacroSampler.*       sampler of the trained macro generator
│   ├── Passport.*           parameter passport
│   ├── Mentat*.*            MENTAT gateway to the local LLM
│   └── schema.sql           database schema
├── tests/                   GoogleTest suite (maos_tests)
└── CMakeLists.txt
src/                         frontend (React + TS)
├── shell/                   app shell: navigation rail, top bar, status bar, screen registry (screens.tsx)
├── lib/api.ts               typed API client
├── features/                one folder per screen or feature: plant-scene, nsi, scenarios,
│                            optimization, plan, agents, forecast (Monitoring), analytics,
│                            method-map, methodology, workflow-builder, admin, auth,
│                            explain (MENTAT), finance, passport
├── explain/                 metric definitions, labels, number formatting
├── diagrams/                explanatory diagrams for the methodology
├── ui/                      UI kit and chart components
└── styles/                  design tokens
rl/                          Python layer (AUREUS): macro generator, CP-SAT sidecar, RL stand
docs/                        documentation (in Russian)
```

## Documentation

The documentation is in Russian.

- [docs/CONCEPT.md](docs/CONCEPT.md): the core model, i.e. how everything fits together.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture decisions (ADR).
- [docs/SCHEDULING.md](docs/SCHEDULING.md): Stage 1, the execution schedule.
- [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md): Stage 2, the robust portfolio.
- [docs/METHODOLOGY-V2.md](docs/METHODOLOGY-V2.md): methodology V2 (finance, RL, games).
- [docs/ANALYTICS.md](docs/ANALYTICS.md): requirements for the Analytics section.
- [docs/MENTAT.md](docs/MENTAT.md): MENTAT, the LLM explanations.
- [docs/UX-V2.md](docs/UX-V2.md): decision flows and the methodology map.
- [docs/RL-METHODOLOGY-PROPOSAL.md](docs/RL-METHODOLOGY-PROPOSAL.md): the agent layer (RL/MARL).
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): entities, database, requirements traceability.
- [docs/ROADMAP.md](docs/ROADMAP.md): the original stage plan. Most of its statuses date from about
  v0.47, so check the documents above for the current state.
- [rl/README.md](rl/README.md): the Python layer (macro generator, CP-SAT sidecar, RL stand).

## License

See [LICENSE](LICENSE).
