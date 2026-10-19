# A5 — GitHub mini-research: how apps like MAOS are built (as of 2026-10-18)

How the data was gathered: `gh` GraphQL lookups (stars, `pushedAt`, licence, latest release), plus README and tree reads. Sizes are **bundlephobia min+gzip for the whole package, without tree-shaking**, so each one is an upper bound. PyPI was used for Python release dates. Staleness flags: **STALE** means no push for 12 months or more; **ABANDONED** means no push for 24 months or more, or the repo is archived.

MAOS context (read-only): React 18.3, R3F 8, drei 9, @react-three/postprocessing 2, maplibre-gl 5, Vite 5, plain-CSS Blueprint tokens. Screens are already route-lazy (`dist/assets/*Screen-*.js`). The entry chunk is about 1.08 MB min. A hand-rolled `features/workflow-builder` and a `RoutingSchemeEditor` already exist.

> **Ecosystem warning (npm):** `@react-three/postprocessing@3.2.0` requires `react ^19` and `@react-three/fiber >=9.7`. The current lines are R3F 9.8.2 and drei 10.7.9. MAOS is now one major behind the whole pmndrs stack. Plan a React 19 / R3F 9 migration before you add any new 3D dependency.

> **Budget warning:** the current ~330 KB gz is already above the ≈300 KB app-page budget. For reference, maplibre-gl v6 alone is 280 KB gz and three is 180 KB gz. Every new library below must be route-lazy. Run `vite build` with a visualizer and confirm that three and maplibre are not in the entry chunk.

---

## 1. Open-source digital twin / APS / MES / simulation

| Repo | ★ | Last push | Licence | Verdict |
|---|---|---|---|---|
| google/or-tools | 14.2k | 2026-10-17 | Apache-2.0 | Has a native C++ CP-SAT API, so it can be linked straight into the MAOS backend. Its `jobshop_sat` / `flexible_job_shop_sat` examples make it the obvious **reference optimum** for benchmarking the heuristic scheduler and RL. |
| PyJobShop/PyJobShop | 176 | 2026-08-14 | MIT | CP models for FJSP, setups and deadlines on OR-Tools or CP Optimizer. Good for generating optimal or near-optimal labels, both for imitation learning and for evaluation. |
| Pabloo22/job_shop_lib | 106 | 2026-10-08 (v1.7.2) | MIT | The best-maintained modern JSP toolkit: Gymnasium env, GNN dispatcher, dispatching rules, CP-SAT and Gantt charts. |
| frePPLe/frepple | 764 | 2026-10-17 (9.19) | AGPL (community) | **Closest architectural sibling**: a C++ planning engine embedded in Python/Django with a Vue UI. Study how it surfaces plan "problems" and constraints. Ideas only (AGPL). |
| TimefoldAI/timefold-solver | 1.8k | 2026-10-16 | Apache-2.0 | JVM, so not your stack. Its *score analysis / constraint justification* concept is the best model for **explaining why a plan scores as it does**. The Python port is **archived**. |
| jaamsim/jaamsim | 238 | 2026-10-13 | Apache-2.0 | Java DES with 3D. A reference for modeller UX: object palette, entity-flow wiring, input editor. |
| salabim/salabim · SimPy (GitLab, 4.1.2, 2026-05) | 408 | 2026-05-29 | MIT | Python DES. Only useful for Python-side cross-checks of the C++ sim during RL work. |
| WayneChou-bot/WareTwin | 152 | 2026-09-11 | MIT | **The nearest UI sibling**: React 18 + Vite + R3F + zustand, a FastAPI WebSocket that sends one FULL state then per-tick PATCH diffs, a shared PRNG with parity tests between the TS and Python engines, and *explainable assignments* ("why each rejected candidate lost"). It's a single-developer repo, so copy patterns rather than depending on it. |
| eclipse-basyx (java-server-sdk / python-sdk / aas-web-ui) | 85 / 105 / 34 | 2026-10 | MIT | The Asset Administration Shell standard. Worth considering only as an **export format** for the plant model. Several BaSyx v1 repos are archived. |
| eclipse-ditto/ditto · ertis-research/opentwins | 937 / 279 | 2026-10-16 | EPL-2.0 / Apache | Heavy JVM/Kafka/Grafana twin platforms. Overkill for a single-plant APS. |
| cschwede1981/ofact (OpenFactoryTwin) | 3 | 2024-06-28 | Apache | **ABANDONED**. |
| jukbot/smart-industry | 442 | 2021-09 | Apache | **ABANDONED**. |

**Takeaway.** No open-source project combines APS, a 3D twin and RL. The winning architecture across frePPLe, WareTwin and OR-Tools users has four parts:
- a native solver core;
- a single typed state contract shared by backend and frontend;
- deterministic seeded simulation with parity tests;
- explanations produced *by the engine* (justifications), not written into the UI.

## 2. RL for scheduling, MARL, constrained RL, C++ inference

**Scheduling environments and papers**

| Repo | ★ | Last push | Licence | Verdict |
|---|---|---|---|---|
| ai4co/rl4co | 915 | 2026-09-14 (v0.7.0) | MIT | TorchRL/TensorDict-based, with envs for **jssp, fjsp, ffsp** and smtwtp. The strongest maintained source of GNN/attention policy designs and baselines. |
| proto-lab-ro/jobshoplab | 56 | 2026-04-28 | CC-BY-4.0 | Gym env with transport, buffers, breakdowns, setups, stochastic times and multiple objectives. The closest to MAOS's realism. Needs Python 3.12 or later. A CC licence on code is unusual. |
| Pabloo22/job_shop_lib | 106 | 2026-10-08 | MIT | See §1. A clean disjunctive-graph observation design. |
| ai-for-decision-making-tue/Job_Shop_Scheduling_Benchmark… | 213 | 2026-09-24 | MIT | Instances plus ports of many DRL methods. Good for regression benchmarks. |
| Lei-Kun/End-to-end-DRL-for-FJSP | 404 | 2023-03 | MIT | **STALE**. A multi-action (operation × machine) policy, which is relevant to splitting the decision between agents. |
| songwenas12/fjsp-drl (HGNN) | 351 | 2023-02 | Apache-2.0 | **STALE**, but licensed, so it can be ported. |
| zcaicaros/L2D · wrqccc/FJSP-DRL · RK0731/Deep-MARL-for-Dynamic-JSP | 391 / 199 / 98 | 2022–2025 | **none** | No licence: read the papers, don't copy code. RK0731 (machine-agents MARL) is the closest *concept* to single-plant MARL. |
| instadeepai/jumanji | 871 | 2026-10-16 | Apache | Has a JobShop env, but it is JAX-only. |

**MARL and RL libraries**

| Repo | ★ | Last push / release | Verdict |
|---|---|---|---|
| Farama-Foundation/PettingZoo | 3.5k | 1.27.0, 2026-08 | **The standard API** (`ParallelEnv`). Wrap the C++ env in this. |
| pytorch/rl (TorchRL) | 3.6k | 0.14.1, 2026-10-10 | Actively developed. Has MAPPO/IPPO tutorials, a PettingZoo wrapper and TensorDict. rl4co and BenchMARL build on it. |
| facebookresearch/BenchMARL | 675 | 1.5.2, 2026-02-07 | Config-driven sweeps (MAPPO, IPPO, QMIX, MASAC) on TorchRL. **Slowing**: 8 months since the last push. |
| DLR-RM/stable-baselines3 + sb3-contrib | 13.9k / 740 | 2.9.0, 2026-06 | **MaskablePPO** gives you a parameter-shared single-agent baseline in a day. ONNX export is documented. |
| vwxyzjn/cleanrl | 10.6k | 2026-04 | Single-file PPO, a good base for a hand-written MAPPO. |
| ray-project/ray (RLlib) | 44k | 2.59, 2026-10 | Multi-agent native, but heavy and cluster-oriented. Only worth it if training goes distributed. |
| bold-lab-ai/JaxMARL (formerly FLAIROx) · instadeepai/Mava | 859 / 938 | 2026-09 | Fast, but you would have to rewrite the env in JAX. Not compatible with a C++ scheduler. |
| marlbenchmark/on-policy (MAPPO) | 2.1k | 2024-07 | **ABANDONED** as a dependency. Still read it for the tricks: value normalisation and agent-specific global state for the centralised critic. |
| Replicable-MARL/MARLlib | 1.35k | 2024-11 | **STALE**, and it pins an old Ray. |
| PufferAI/PufferLib | 6.5k | 2026-10-14 | v5 writes envs as **single C headers** (`ocean/<env>/<env>.h`) with a CUDA trainer (`src/pufferl.cu`). Copy the *env-as-C-header* pattern; the CUDA-centric trainer doesn't fit macOS development. |

**Constrained RL.** OmniSafe (1.16k ★; last push 2025-03, last PyPI release 2024-05) and FSRL (264 ★, 2024-09) are both **STALE**. safety-gymnasium (593 ★) is robotics envs only. MACPO / MAPPO-L (chauncygu, 239 ★) is the multi-agent constrained reference. Recommendation: enforce hard constraints (precedence, calendars, capacity) with **action masking**. Handle soft ones (overtime, WIP caps, due dates) with a **PPO-Lagrangian** penalty, which is about 30 lines of your own code. Don't add a safe-RL framework as a dependency.

**Bindings and inference.** pybind/pybind11 has 18k ★ (v3.1.0, 2026-08). wjakob/nanobind has 3.7k ★, BSD-3, was pushed today, and gives smaller and faster binaries; it needs C++17, which MAOS already uses. microsoft/onnxruntime has 22k ★ (v1.31.0, 2026-10-09) and onnxruntime-inference-examples (1.7k ★) has C++ `Ort::Session` samples. The ORT shared library is large (tens of MB). jatinchowdhury18/RTNeural (853 ★, BSD-3) is a header-only option for small MLPs. Dobiasd/frugally-deep is Keras-only. pyg-team/pytorch_geometric (24k ★, 2.8.1) supplies GNN layers. **Check ONNX exportability of the policy on day one**: dense attention or GIN-style index_add ops export reliably, while exotic scatter kernels may not.

## 3. Frontend stack for data-dense, stylish industrial apps

| Library | ★ / last push | Licence | gz (full pkg) | React 18? | Verdict |
|---|---|---|---|---|---|
| **@xyflow/react** 12.12 | 38.7k / 2026-10-16 | MIT | **58 KB** | yes (>=17) | The de facto node-graph editor (Langflow uses it at 156k ★; vue-flow is its Vue analogue). Lazy-load it on the plant-modelling route. Decide whether it replaces the hand-rolled workflow-builder or RoutingSchemeEditor. |
| rete 2.0.6 | 12.3k / 2026-09 (last release 2025-06) | MIT | 3 KB core + plugins | — | Only pick it if you need its dataflow/engine execution. The community is smaller. |
| litegraph.js (jagenjo) / @comfyorg/litegraph | 8.2k / 2024-08 · 83 KB | MIT | 83 KB | n/a (canvas) | The original is **ABANDONED** and the fork was absorbed into ComfyUI_frontend (GPL-3). Avoid. |
| tldraw 5.5 | 51k / active | custom (needs a production licence key) | **517 KB** | — | Avoid. |
| @dagrejs/dagre 3.1 | 5.8k / 2026-08 | MIT | **15 KB** | — | Use it for automatic layered layout of the node graph. |
| elkjs 0.12 | 2.8k / 2026-10 | EPL-2.0 | **423 KB** | — | Only in a Web Worker, and only if you need orthogonal port routing. |
| d3-scale / d3-shape | d3 113k | ISC | 15 / 5 KB | — | Keep the hand-rolled SVG charts on these primitives. |
| @visx/* 4.0 (2026-06) | 21k | MIT | shape 10, scale 17 KB | yes | Per-package helpers for axes, tooltips and brushes if hand-rolling gets painful. |
| uPlot 1.6.32 | 10.6k / 2026-10-17 | MIT | **21 KB** | n/a | Canvas time-series for 100k+ points, e.g. load and queue histories. |
| @observablehq/plot 0.6.17 | 5.4k / 2026-09 (last release 2025-02) | ISC | 124 KB | n/a | Great for explanatory static diagrams, but heavy and with a slowing release cadence. |
| echarts 6.1 | 67.5k | Apache | **359 KB** | — | Avoid as a default; tree-shaking via `echarts/core` still costs a lot. |
| @nivo/line 0.99 · recharts 3.10 | 14k · 27.6k | MIT | 93 KB · not measured | yes | Overlaps the existing SVG charts. Avoid. |
| motion 14.3 | 34k / 2026-10-16 | MIT | 50 KB (LazyMotion `m` is much smaller) | yes | Only for layout/FLIP panel animations. CSS covers everything else. |
| @react-spring/web 10.1 | 29k | MIT | 19 KB | yes | A lighter physics alternative. |
| Radix popover / tooltip | 19.4k / 2026-10-14 | MIT | 22 / 18 KB (shared deps) | yes | Accessible popovers if you want ready focus management. |
| @base-ui/react 1.9 | 11.2k / 2026-10-17 | MIT | 162 KB full; import per component | yes | The modern successor to Radix (shadcn supports it). Import per component. |
| react-aria-components 1.22 | 16k | Apache | 272 KB full | yes | The best a11y, but too heavy to adopt wholesale. |
| **@floating-ui/react-dom** 2.1.9 | 32.8k / 2026-10-16 | MIT | **9 KB** | yes | Positioning for the "i" popovers. Pair it with the native Popover API (Baseline since 2024). CSS anchor positioning isn't universal yet. |
| cmdk 1.1.1 (dip/cmdk) | 13k / 2025-10 (last release 2025-03) | MIT | 14 KB | yes | A command palette. Maintenance is **slowing**. |
| style-dictionary 5.7 | 4.9k / 2026-10-16 | Apache | 0 KB (build-time) | — | Only if tokens must also feed C++ reports, docs or Figma. |
| culori 4.0.2 · colorjs.io 0.7.1 | 1.2k · 2.3k | MIT | tree-shakable · 31 KB | — | Use at build or dev time only. At runtime, rely on CSS `oklch()`, `color-mix()` and relative colour syntax. |
| @tanstack/react-virtual 3.14 · react-table 9.3 | 7.2k · 28.5k | MIT | 9 · 30 KB | yes | For the large NSI registries. |
| zustand 5 | 58.8k | MIT | ~1 KB | yes | React Flow already depends on it. Fine for scene and graph state. |

## 4. Background and visual effects; generative logo

| Repo | ★ / last push | Licence | gz | Verdict |
|---|---|---|---|---|
| paper-design/shaders (`@paper-design/shaders` 0.0.81, `-react`) | 3.8k / 2026-10-17 | Apache-2.0 (no attribution needed) | 62 KB vanilla / 81 KB react, full | Zero-dependency canvas shaders (MeshGradient, DotOrbit and others; catalogue at shaders.paper.design). The README warns of **breaking changes under 0.0.x**, so pin the exact version. A good option for the login and hub hero only. |
| ruucm/shadergradient (`@shadergradient/react` 2.4.20) | 2.9k / 2026-09 | MIT on npm, **no LICENSE file in the repo** | 48 KB + three/R3F peers | Redundant with your own three.js shader. Avoid. |
| oframe/ogl | 4.7k / 2025-04 (**STALE**) | Unlicense | 33 KB | Redundant, because MAOS already ships three. |
| tengbao/vanta | 7.2k / 2024-03 (**ABANDONED**) | MIT | 2 KB + old three | Avoid. |
| jordienr/whatamesh (Stripe gradient) | 138 / 2024-08 | **none** | — | Avoid: no licence, and the code is lifted from Stripe. |
| cjimmy/grainy-gradients | 175 / 2026-03 | **none** | — | Copy the *technique*, not the code: SVG `feTurbulence` noise plus a gradient, then CSS `filter: contrast() brightness()` and blend modes. |
| processing/p5.js 2.3.4 | 24k | LGPL-2.1 | **325 KB** | Fine for offline logo exploration. Never ship it at runtime. |
| ideo/generative-kandinsky · brunurb/zurich · reyrove/Deconstructed-Stage | 13 / 2 / 1 | MIT / Unlicense / MIT | — | Inspiration only (all tiny; IDEO's dates from 2020). |

**Zero-dependency recipe (recommended):**
1. **Animated gradient.** Register `@property --a { syntax:'<angle>'; inherits:false; initial-value:0deg }` and animate the angles and stops of `conic-gradient`/`radial-gradient` layers. Registered custom properties are Baseline across all engines since 2024. For a "mesh" look, stack 3–4 blurred `radial-gradient` blobs and animate only `transform`.
2. **Grain.** Use an inline SVG `<filter><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/></filter>` as a data-URI background layer, with `mix-blend-mode: soft-light` and opacity around 0.06–0.12. It is static, so it costs nothing per frame.
3. **WebGL option.** A single full-screen-quad `ShaderMaterial` in the three.js you already ship adds 0 KB. Run it at DPR 0.5, pause it on `visibilitychange`, outside the viewport and under `prefers-reduced-motion`. Keep it off the 3D scene screens.
4. **Kandinsky-style logo.** Write an in-house seeded SVG generator (~150 LOC): a mulberry32 PRNG, then concentric circles, a triangle, crossing lines and arcs, using a Bauhaus palette expressed in OKLCH. Pick a seed, freeze it as a static `logo.svg` and favicon, and optionally animate it on hover with CSS. The seed also yields the per-scenario "identicons".

## 5. Reference architectures

| Repo | ★ / last push | Patterns worth copying |
|---|---|---|
| rerun-io/rerun | 11.6k / 2026-10-17 (0.39) | A Rust core with an egui viewer compiled to WASM. **Blueprints**: view layout is data and can be driven from the SDK. **Multiple timelines with one global time cursor** shared by all views. An Arrow chunk store. For MAOS: one shared simulated-time cursor across the 3D scene, Gantt and charts. |
| foxglove/studio → lichtblick-suite/lichtblick | archived 2024-07 → 1.2k / 2026-10-16 | A monorepo (`suite-base`, `theme`, `hooks`, `message-path`, `den`, …). **Panel registry plus layouts as JSON**, a *Player* (data-source) abstraction feeding a message-pipeline store, and an extension API. Foxglove went closed-source, so this fork is the living open version. |
| grafana/scenes (+ grafana/grafana, AGPL) | 206 / 2026-10-18 (v8.22) | A tree of scene objects with state and **URL sync** (time range, variables). Grafana's *panel Inspect* drawer (data, query, JSON) is a good pattern for the "i" metric explanations. |
| palantir/blueprint | 22k / 2026-09 (v6.21) | The source of MAOS's tokens. v6 exists. Keep mirroring its *tokens*, not the component library. |
| shadcn-ui/ui | 126k / active | Copy-paste components on Radix or Base UI. Take the *ownership* model (components live in your repo) without adopting Tailwind. |

**Patterns these share:**
- feature folders (MAOS already has them);
- a single typed state contract shared with the backend;
- views and dashboards declared as data (`dashboardConfig.ts` is already this);
- URL as state for the scenario, time range and selected entity;
- theme tokens as CSS variables with a light/dark ladder;
- Storybook or Playwright visual regression of key panels.

---

## Adopt / Consider / Avoid — tailored to MAOS

**ADOPT**
1. **A zero-dependency visual layer** (0 KB): OKLCH tokens with `color-mix()` accents, `@property` animated gradients, SVG `feTurbulence` grain, and View Transitions or CSS transitions for motion.
2. **A seeded in-house SVG Kandinsky logo generator** (0 KB at runtime), frozen to a static SVG at build time.
3. **The background shader as a three.js `ShaderMaterial`** (0 KB extra), mounted only on the login and hub screens and paused when hidden or under reduced motion.
4. **A metric "i" system.** Give `kpiCatalog.ts` a registry entry per metric: formula (rendered as text or SVG), inputs with units, the source endpoint, and a worked example using live numbers, all returned **by the backend**. Model it on Timefold's justifications and WareTwin's "why rejected". Show it in a popover built from the native Popover API plus **@floating-ui/react-dom (9 KB)**.
5. **@xyflow/react (58 KB, lazy) + @dagrejs/dagre (15 KB, lazy)** for node-graph plant modelling, with dagre doing the layout.
6. **The RL pipeline**, in order:
   - expose the C++ scheduler as a step/reset/mask API via **nanobind**;
   - wrap it in a **PettingZoo `ParallelEnv`**;
   - train an **sb3-contrib MaskablePPO** baseline with shared parameters;
   - move to a **TorchRL MAPPO** (consider rl4co or job_shop_lib GNN encoders);
   - add a **PPO-Lagrangian** penalty for the soft constraints;
   - export to ONNX (opset 17+) and run it in the backend with the **ONNX Runtime C++ API**;
   - use **OR-Tools CP-SAT / PyJobShop** as the optimality yardstick.

**CONSIDER**
- A React 19 / R3F 9 / drei 10 / postprocessing 3 migration. It is needed to stay on maintained pmndrs releases.
- **uPlot** (21 KB) for dense time series and **@visx/*** helpers (10–17 KB) if the hand-rolled SVG grows painful.
- **motion** with LazyMotion for layout/FLIP panel transitions only. **react-spring** (19 KB) is the lighter alternative.
- **@paper-design/shaders**: pin the exact version, lazy-load it, and use it on hero surfaces only (62 KB upper bound). Use it only if the hand-written shader takes too long to tune.
- **cmdk** (14 KB) for a command palette, noting its slowing maintenance.
- **Radix** popover/tooltip or per-component **Base UI** if the a11y and focus needs outgrow the native Popover API.
- **TanStack Virtual/Table** for the NSI registries.
- **zustand** for the scene and graph store.
- **Style Dictionary**, if tokens must be shared with C++ PDF reports or docs.
- **BenchMARL** for algorithm sweeps. **RLlib** only for distributed training.
- **elkjs** in a Worker for orthogonal port routing.
- **RTNeural** or a hand-rolled MLP if the ONNX Runtime binary size matters.
- The **PufferLib** C-header env pattern and **AAS (BaSyx)** export, both for interop.

**AVOID**
- These blow the budget: tldraw (517 KB plus a licence key), full ECharts (359 KB), p5 at runtime (325 KB, LGPL), react-aria-components wholesale (272 KB), elkjs on the main thread (423 KB). nivo and recharts duplicate the existing SVG charts.
- **Effects:** vanta (abandoned), whatamesh and other Stripe-gradient copies (no licence), shadergradient (redundant, no LICENSE file), ogl (stale, redundant with three).
- **Node editors:** litegraph.js (abandoned, canvas, GPL fork). Rete is fine if a dataflow engine is ever needed, but React Flow is the safer default.
- **RL:** the JAX stacks (JaxMARL, Mava, Jumanji) because they need a JAX rewrite of the env. MARLlib, on-policy MAPPO, OmniSafe and FSRL as *dependencies* (stale; read them instead). PufferLib 5's CUDA trainer on macOS. Copying code from unlicensed repos (L2D, wrqccc/FJSP-DRL, Deep-MARL-for-Dynamic-JSP).
- **Platforms:** Eclipse Ditto, OpenTwins, a BaSyx server or iTwin.js as runtime dependencies. They are heavy JVM/Kafka stacks that don't fit a single-plant local-first app.
