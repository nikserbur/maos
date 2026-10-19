# A1 — MAOS v0.58.0 UI/UX design audit (code-based, read-only)

Method: read every file in `src/styles`, `src/shell`, all feature CSS/TSX, cross-checked against `backend/src/{Scheduler,Optimizer,main}.cpp`. I did not take live screenshots; every claim cites file:line.

## 0. TL;DR

- The "design system" is thin: **30 tokens**, with no type, spacing, shadow, motion or chart scale. In practice there are **two dialects**: Blueprint at 2–3 px radius (NSI, Admin, shell) and a "soft" style at 6–12 px (Plan, Forecast, Scenarios, Analytics, Sim panel). On top of that sit **767 hardcoded colour literals** (362 in CSS, 405 in TS/TSX).
- `--surface`, `--surface-2`, `--surface-3` and `--danger` are **used but never defined**. Their dark-only fallbacks are what actually renders, so the light theme breaks on four screens.
- **The same KPI name is computed differently on different screens** (Throughput, Utilization, Makespan, "HHI"). Fix this before building the "i" layer, or the tooltips will document wrong formulas.
- Modelling is spread over three unrelated metaphors: 3D space, table forms and a linear IDEF0 SVG. Links drawn on the 3D scheme are **not read by the engine**.
- Explanations already exist, but they sit in **56 native `title=` tooltips**, one formula line in Analytics, and a methodology paragraph that is hidden when Forecast is embedded.

---

## 1. Design-token inventory

**Defined tokens** (`src/styles/tokens.css:6-53`, light overrides in `:55-67`):

| Group | Tokens |
|---|---|
| Surfaces | `--bg-app #111418`, `--bg-panel #1c2127`, `--bg-card #252a31`, `--bg-input #2f343c`, `--border #383e47`, `--border-strong #404854` |
| Text | `--text`, `--text-secondary`, `--text-muted`, `--text-disabled` |
| Accent | `--accent #2d72d2`, `--accent-hover`, `--accent-active` (1 use), `--focus #8abbff` |
| Intent | `--intent-success/warning/danger/info` (`--intent-info` has **0 uses**) |
| Type | `--font-sans` (system stack), `--font-mono`. **No size/weight/line-height scale.** |
| Geometry | `--grid 10px`, `--radius 2px`, `--radius-lg 3px`, `--control-compact 24`, `--control 30`, `--control-large 40` (0 uses) |
| Layout | `--rail-w 56`, `--topbar-h 48`, `--statusbar-h 28`, `--inspector-w 320` |
| Missing | spacing scale, shadows/elevation, motion durations and easing, z-index, chart/series palette, gradients, glass/overlay alpha. The light theme redefines only surfaces and text. |

**Used but undefined:** `--surface` (9 files), `--surface-2` (4), `--surface-3` (`global.css:162`), `--danger` (`scene.css:485`). Fallbacks such as `#161a20` and `#0f1318` are dark-only, so light theme breaks in `plan.css:68-113`, `forecast.css:16-158`, `scenario-compare.css:11-161`, `optimization.css:187`, `QueueChart.tsx:107` and `ParetoFrontier.tsx:104`.

**Fallback drift** points to a second, half-migrated palette: `var(--border, #2a2f37)` ×55 (the token is `#383e47`), `var(--radius-lg, 12px)` (the token is 3 px; `ErrorBoundary.tsx:40`) and `var(--intent-warning, #d9822b)` (the token is `#c87619`; `LaborWarning.tsx`).

**Hardcoded colours**
- CSS: `scene.css` 80, `plan.css` 77, `scenario-compare.css` 74, `forecast.css` 57.
- TS/TSX: mostly 3D files (`Decorations` 66, `FlowLinks` 43, `machines` 40, `RailYard` 39). There are 72 more in non-3D UI files (`RoutingSchemeEditor` 20, `ForecastScreen` 13, `PlanScreen` 10).
- Worst cases:
  - `STATUS_META` hex values (`types.ts:33-38`).
  - `ORDER_COLORS` (`PlanScreen.tsx:11`).
  - Raw `#8b5cf6` in `SERIES_COLORS` (`dashboardConfig.ts:39-42`).
  - The IDEF0 canvas `#0d1014`/`#4a9eff` (`RoutingSchemeEditor.tsx:142,281-305`).
  - `#171b21` (`LoadTimeline.tsx:8`).
  - Map `#1a73e8` (`WorldMap2D.tsx:26`).
  - Sim legend (`SimulationPanel.tsx:198-201`).

**Inconsistency**
- Radii: 19 distinct values (`8px` ×21, `999px` ×16, `10px` ×13, …) against 49 uses of the radius tokens. `forecast.css` and `scenario-compare.css` use **no** radius token; `nsi.css` and `admin.css` use only tokens.
- Font sizes: **20 distinct CSS values** (9–26 px, including 10.5, 11.5 and 12.5), plus 16 more inline in TSX.
- Shadows: 17 unique strings, none tokenised.
- Motion: 4 transitions, 2 keyframes, and no `prefers-reduced-motion`.
- Duplicates:
  - `.btn` is copied into `scene.css:468-487`.
  - There are 3 modals: `shell/Modal.tsx`, `ForecastScreen.tsx:314` and `PlanScreen.tsx:312`. Only the shell modal closes on Escape.
  - About 10 ad-hoc input classes exist next to `.form__input`.
  - `money()`/`pct()` are defined 13× with 4 money formats.
  - `.scn__item`, `.scn__list` and `.scn__name-input` are defined in 2 files (latent; `scenarios.css` is dead).
- Inline `style={{…}}`: **300** (`PlanScreen` 64, `RoutingSchemeEditor` 52, `SimulationPanel` 27).
- Missing states: no global `.btn:disabled`, `:active` or `:focus-visible` (only `nsi.css:121`). `outline:none` appears 7×; `:focus-visible` is used 0×. Disabled primary buttons look clickable.
- Dead code: `EditToolbar.tsx`, `Inspector.tsx`, `WorldMap.tsx`, `materials.ts`, `Placeholder.tsx`, `ScenariosScreen.tsx` (with `scenarios.css`), `scenarios-hub.css`, and the `monitoring` icon.

## 2. Shell & IA

- **Layout** (`shell.css:1-16`): a grid of topbar 48 px, body, statusbar 28 px. The body is a 56 px icon rail plus content. Everything is flat `--bg-panel` with 1 px borders: no depth, gradient, texture or motion.
- **Navigation** (`NavRail.tsx:13-28`, `screens.tsx:25-34`):
  - 8 icon-only buttons; the label shows only via `title`.
  - The active item gets a 3 px accent bar (`shell.css:89-98`).
  - There is no grouping, no labels, no shortcuts and no URL routing: active screen is `useState('scheme')` (`AppShell.tsx:15`), so a refresh returns to the scheme and deep links are impossible.
  - Screens unmount on switch, so the Plan result (`PlanScreen.tsx:412`) and the Optimization result are lost.
- **Order versus the data pipeline:**
  - The rail is Схема → НСИ → План (Stage 1) → Оптимизация (Stage 2) → Аналитика → Сценарии → Админ → AI.
  - Real data flow is НСИ → Сценарии → Оптимизация (Stage 2, *что*) → План (Stage 1, *как*) → Схема/симуляция → Аналитика.
  - "Stage 1" sits before "Stage 2" in the rail even though Stage 2 runs first.
- **Icons:** 8 stroke icons in `icons.tsx`, plus about 54 emoji/glyphs used as icons (📊💰⛓🔀📈💡📌⚙⛶). Examples: `AnalyticsScreen.tsx:121`, `KpiDashboard.tsx:155`, `SimulationPanel.tsx:140-144`.
- **Logo:**
  - TopBar: the text "MAOS" with letter-spacing (`TopBar.tsx:20`).
  - Login: a 36 px accent tile with "M" and radius 8 (`LoginScreen.tsx:62-70`).
  - The two don't match. There is no SVG asset and no favicon.
- **TopBar:** the theme toggle is a text button and its state is not persisted (`TopBar.tsx:9-15`).
- **StatusBar:** static "Локально · Демо-данные" text, with no live project, user or last-run info (`StatusBar.tsx:9-15`). The version is hardcoded in 3 places.
- **Login:** a flat card made of inline styles (`LoginScreen.tsx:47-58`). It is the natural place for the brand moment (gradient, grain, abstract mark).
- **Modal:** blur backdrop and Escape, but no focus trap and no animation.

## 3. Screen-by-screen

| Screen | What it shows / density | Charts | States | Weaknesses |
|---|---|---|---|---|
| **Схема** (`PlantScene.tsx`) | 3 drill-down levels: 2D MapLibre world → 3D site → 3D shop. Right EditorPanel; overlays for breadcrumbs, status legend, hint and sim button. | R3F; MapLibre with a recoloured "liberty" style (`WorldMap2D.tsx:21-33`) | text "Загрузка схемы из НСИ…" (`:361`); 5 silent `.catch(()=>[])` (`:49-53`) | Three palettes fight each other: Yandex-green map with Google blue, light-sky/grass site (`SceneEnvironment.tsx:15-16`), and dark UI. The sim button is absolutely positioned with magic `right: simOn?412:16` (`:348`). Shop/factory status is always "running" (`sceneModel.ts:240,312`) while the legend lists 4 states. About 3,800 lines are decorative (rail yard, cars, fences) and none of it encodes data. |
| **Справочники** (`NsiScreen.tsx`) | Left registry list plus table and search; row click opens an edit modal | none | loading row, empty row; fetch errors look like "Записей нет" (`:82`) | Generic CRUD tables. Raw IDs leak (routing `product_id` and `id` columns, `registries.ts:63-67`; `cellText` has no mapping). There is no delete, no relation view, and no org-unit/factory registry. |
| **План** (`PlanScreen.tsx`, 822 lines) | Title paragraph, 6 controls, orders table, MRP table, 11 KPI tiles, bottleneck banner, Gantt, queue chart, load bars/heat map, rules table, workers | Gantt is DOM spans; Queue/LoadTimeline are hand SVG/divs | `plan__empty` text; good guidance errors (`:476-480`) | Very long single scroll. There are **two Gantt legends with independent colour mappings** (by first appearance in `:66-67` versus by program index in `:757-758`, so they can disagree). Load-view toggle uses `opacity:0.55` instead of a segmented control (`:776-781`). The order delete ✕ has no confirmation (`:627`). Naming uses `window.prompt` (`:397,466`). |
| **Оптимизация** (`OptimizationScreen.tsx`) | Robust vs max-E portfolio cards, a "price of robustness" narrative, histogram, resource load, Pareto | Hand SVG (`ProfitDistribution`, `ParetoFrontier`) | pre-run validation (`:167-181`), soft-error banner | This is the best-explained screen. Even so, the CVaR tail is a line, not a shaded area (`ProfitDistribution.tsx:83-95`). Axes show only min and max. Out-of-sample validation from the backend is never shown. |
| **Аналитика** (`AnalyticsScreen.tsx`) | Tabs KPI / Узкие места / Инвест / Потоки. Pinned KPI cards plus 2 configurable charts, recommendations, A/B compare, KPI catalogue by category | `TimeChart`, `Spark`, a "Sankey" that is really a 2-column bipartite plot (`:463-493`) | "Загрузка аналитики…" | This is a "dashboard by numbers" layout with emoji tabs. Pinned cards hide the formula (`KpiDashboard.tsx:80` `title="Показать во времени"`). |
| **Сценарии** (`ScenarioCompareScreen.tsx` + embedded `ForecastScreen`) | Scenario list; detail with 11 sliders in 3 cards, overrides, price fan grid; compare mode | Hand SVG fan (`ForecastScreen.tsx:8-41`) plus a density preview | inline error, empty list | Every slider tick PUTs to the backend with no debounce (`:81-85`). Delete has no confirmation (`:232`). The compare table shows `product_id` instead of names (`:308`). **The methodology text is hidden in embedded mode** (`ForecastScreen.tsx:63,103-114`). |
| **Администрирование** (`AdminScreen.tsx`) | Audit log, users, roles (RBAC chips) | none | "Записей нет" | Clean, but generic. |
| **AI-воркфлоу** (`WorkflowBuilder.tsx`) | Node-graph canvas: pan/zoom/ports/bezier edges, localStorage autosave | n/a | — | Not part of the plant domain. Its canvas engine is the best seed for a plant **process-graph** modeller. |

General: no chart library is used (14 hand-built SVGs). Each uses `viewBox` plus `width="100%"`, so 8.5–10-unit labels scale with container width. There are no skeletons, and **55 `.catch(() => {})`** turn failures into apparent empty states.

## 4. The modelling interaction (end-to-end)

1. **Login:** pick a project DB; a new one is seeded with demo data (`LoginScreen.tsx:81-93`).
2. **Справочники:**
   - Work-center types (with a 3D `kind`).
   - Products: BOM via a single "Входит в изделие" parent, plus price, demand, elasticity and batch (`ProductForm.tsx:96-205`).
   - Workers and skills.
   - Routings in the full-screen IDEF0 editor (`CreateDialog.tsx:30-35`).
3. **Схема:**
   - World map: factories cannot be created anywhere in the UI. `api.orgUnits.create` is called only from `handleCreateShop` (`PlantScene.tsx:264`), and `REGISTRIES` has no org-unit registry.
   - Site: create a shop with a name and building model (`EditorPanel.tsx:182-205`).
   - Shop: "+ станок" by type, move with a gizmo, ↔ connect (`StageObject.tsx:135-145`).
4. **Сценарии → Оптимизация** (save portfolio as program) **→ План → Схема** (▶ simulation) **→ Аналитика.**

**Friction**
- **Three metaphors and no single source view.** The 3D scene answers *where*, the forms answer *what* and IDEF0 answers *sequence*. Nothing shows the **process network** (product ← operation ← WC type ← machines and workers) that the engine actually computes on.
- **3D links are cosmetic.** `api.flows.create` (`PlantScene.tsx:194`) writes `flows`, but neither `Scheduler.cpp` nor `Optimizer.cpp` reads `flows`. Routing comes from `operation_inputs` (`Scheduler.cpp:182`).
- **There are two BOMs.** `products.parent_id` is edited in ProductForm, while the engine uses routing-op inputs (`Scheduler.cpp:182-222`).
- **The IDEF0 editor is linear and single-estimate.**
  - Blocks form a strict chain (`RoutingSchemeEditor.tsx:240-305`) with one WC type per operation.
  - It saves `t_norm = t_opt = t_pess` (`:731-733`), so the PERT σ silently falls back to 15 % (`Scheduler.cpp:203-204`). The user cannot model the heavy tail here.
  - ICOM C/M are free-text tags with no semantics.
  - Editing deletes and recreates the routing, so IDs change (`:718`).
- **Bug:** renaming any node calls `api.machines.update` (`PlantScene.tsx:180-183`), including shops and factories.
- There is no undo, deletes have no confirmation (`EditorPanel.tsx:461`), and there is no guided "setup progress" across the six prerequisites.

**Where a different interface would help**
- **Process graph (node editor):** reuse the `WorkflowBuilder` engine.
  - Nodes: Сырьё → Операция (coloured by WC type) → Полуфабрикат → Товар.
  - Edges: `operation_inputs`, with qty on the edge.
  - Badges from the last plan: load %, bottleneck, queue peak.
  - This replaces both the IDEF0 chain and the BOM dropdown, and supports assembly and branching.
- **Layered or abstract views** (zoom levels), all with synced selection:
  - L0 value stream: Scenarios → Stage 2 → Stage 1 → Simulation.
  - L1 product/process DAG.
  - L2 resource map (WC types × machines × workers bipartite, showing `min(machines, operators)`).
  - L3 spatial 3D.
- **Split 2D/3D:** an orthographic 2D schematic with flow ribbons (lot streaming) next to the 3D view, so 3D becomes presentation and 2D becomes editing.
- **Setup checklist / stepper** derived from the existing pre-run validations (`OptimizationScreen.tsx:167-181`, `PlanScreen.tsx:475-481`).

## 5. "How is this calculated" inventory (drives the "i" system)

Legend for the last column: **T** = native `title` only, **V** = visible text, **—** = none, **⚠** = label or formula mismatch.

| Number (where) | Formula / source | Explanation |
|---|---|---|
| Makespan (`PlanScreen.tsx:703`) | **mean** of MC runs `be.mkMean` (`Scheduler.cpp:993`); sub shows the deterministic value | — ⚠ Analytics MAKESPAN uses the deterministic value (`kpiCatalog.ts:41`) |
| Makespan CVaR / worst (`:704`, `kpiCatalog:42-46`) | `cvar_upper`: mean of the worst ⌊α·n⌋ runs (`Scheduler.cpp:559-563`) | V in Analytics only |
| Tardiness, OTD, n_late (`:705-706`) | Σmax(0, fin−due); (n−late)/n (`Scheduler.cpp:554-555,995`) | V in Analytics only |
| Загрузка (`:707`, `kpiCatalog:60`) | Σbusy / Σcalendar fund (`Scheduler.cpp:869-877,996`) | ⚠ the Analytics Bottleneck tab and the Sim panel use busy/makespan, 24/7 (`main.cpp:3311`, `AnalyticsScreen.tsx:67-89`) |
| Себестоимость, труд (`:708-709`) | Σ(dur/60·(hourRate+laborRate)) + setupCost; labor = busy·costPerHour (`Scheduler.cpp:931-937`) | V in Analytics only |
| Flow time, Доля ожидания, НЗП, Проходка (`:712-716`) | `flowSum/n`; `wait/(wait+proc)`; `ΣflowTime/makespan` (Little); `Σqty/days` (`Scheduler.cpp:900-922`) | ⚠ Catalogue says WIP = "партий" and THRU = "парт/дн" (`kpiCatalog.ts:68-71`); Plan says "единиц"; Sim "Проходка" = **nOrders/days** (`main.cpp:3321`, `SimulationPanel.tsx:234`). WAIT formula text differs from the code (`kpiCatalog:73`). |
| ТО и поломки (`:717`) | maintenance by MTBM; breakdown = Pareto-tail repairs (`Scheduler.cpp:999-1000,331-332`) | — |
| Availability (`kpiCatalog.ts:90-92`) | **frontend-only** 1−(maint+break)/makespan | V |
| Bottleneck banner (`PlanScreen.tsx:721-740`) | max wc utilization (`Scheduler.cpp:879-884`); rule chosen by `score = w_t·E + w_r·(CVaR−E) + w_c·setup + 0.5·tard` (`:729-730`) | V partial; "Вес риска" input (`:557`) — |
| Rules table (`:796-800`) | per-rule MC evaluation (`Scheduler.cpp:702-730`) | — |
| Load bars and idle (`:219-245`) | `wc_load`, `machine_load` (`Scheduler.cpp:869-898`) | V (infra note) |
| Queue peak (`QueueChart.tsx:41,85`) | `queue_timeline` from the schedule | V axis caption |
| Heat map (`LoadTimeline.tsx:27-40`) | frontend: overlap/bin over 24 bins | V comment only |
| MRP table (`PlanScreen.tsx:666-683`) | gross → net (stock, safety) → planned qty, place_by = need−lead (`main.cpp:3070-3095`) | — |
| E, CVaR, VaR, σ, P(loss), worst, max-regret (`OptimizationScreen.tsx:48-53`) | `metrics_of` (`Optimizer.cpp:293-313`), regret (`:755-768`), objective `robust_score` (`:316-320`) | T objective hint (`:284`) |
| n_products / effective_n / concentration (`:57-65`) | 1/HHI (`Optimizer.cpp:405-412`); max revenue share (`:399-403`) | T; ⚠ **Scenario compare labels max share as "Концентрация (HHI)"** (`ScenarioCompareScreen.tsx:31`) |
| Risk contribution (`:75-77`) | cov(item profit, portfolio profit)/var (`Optimizer.cpp:840-848`) | T "Вклад в риск" |
| Resource load (`:99-117`) | x·hours-per-unit / capacity (`Optimizer.cpp:869-875`) | — |
| Price of robustness (`:327-338`) | E[maxE] − E[robust] (`Optimizer.cpp:912`) | V narrative |
| Histogram and Pareto (`:345,367`) | bins (`Optimizer.cpp:907`); non-dominated (`:963`) | V legend |
| OOS validation, `stage1_calibrated`, `calendar_factor`, downside, best | `Optimizer.cpp:918-944,990-996` | **not rendered** |
| Forecast cumulative inflation, Δ%, P10/P50/P90, trend (`ForecastScreen.tsx:99,196,224-225`) | EMD trend + harmonics + MC residual (`main.cpp:2206-2440`) | V paragraph **hidden when embedded** |
| Fit (AIC) and backtest MAPE/skill/coverage (`:208-221`) | AIC (`main.cpp:2414-2437`), backtest (`:2651-2654`) | T |
| Factor contributions (`:234-263`) | `pctOf(exp(slope·months))` and similar (`main.cpp:2531-2533`) | T per row |
| Invest CAPEX/ΔCF/payback/NPV/IRR/ROI, util before/after, next bottleneck (`AnalyticsScreen.tsx:400-419`) | `main.cpp:584-607` | V mini-formula line (good pattern) |
| Bottleneck rank and "упор в труд" (`:294-323`) | frontend: mean per-machine util; operators < machines | V paragraph |
| Recommendations (`:191-203`) | frontend thresholds (≥0.9, OTD<0.9, wait>0.5, setup>0.2) | — |
| A/B delta (`:233-246`) | va−vb | — |
| Sankey widths (`:431-457`) | frontend: consecutive-op type transitions | V caption |
| Sim live: busy, done %, workers (`SimulationPanel.tsx:192-194`) | client sim state | — |
| Sim results: required/avg operators, avg util, throughput (`:229-235`) | peak/avg busy workers (`main.cpp:3300-3321`) | — ⚠ throughput |
| Calibration Δ% (`:289-298`) | realized mean vs t_norm | V paragraph (`:279`) |
| LaborWarning "N из M" (`LaborWarning.tsx`) | min(machines, eligible operators) | V |
| World-map card shops/machines (`WorldMap2D.tsx:124-135`) | counts | — |
| EditorPanel op time ranges (`EditorPanel.tsx:88-106`) | min–max t_norm per op name | — |

## 6. Candidate spots for abstract explanatory diagrams

1. **Two-stage pipeline with recourse loop:** Scenarios → Stage 2 *что* → Stage 1 *как* → feedback `stage1_feedback` (`Scheduler.cpp:939-958`) → Stage 2. Place it in the Optimization and Plan headers (`OptimizationScreen.tsx:228`, `PlanScreen.tsx:528`) and in the nav.
2. **CVaR/VaR tail:** a shaded α-tail on `ProfitDistribution`, plus a mini-diagram in the "i" for α (`OptimizationScreen.tsx:265`).
3. **Price of robustness:** two overlaid densities with arrows for "−E" and "+worst" (`:326`).
4. **Pareto dominance** explainer (`:362`).
5. **Correlation ρ → diversification σ** (OPTIMIZATION.md §5a; ρ appears in `:336`).
6. **Heavy-tailed durations:** PERT triangle plus Pareto tail (`Scheduler.cpp:203-206,331-332`). Use it in OperationForm, IDEF0 and "Прогонов (хвост)" (`PlanScreen.tsx:553`).
7. **Lot streaming / transfer batches:** sequential vs overlapped mini-Gantt (`Scheduler.cpp:276-282`) for "Размер партии" (`ProductForm.tsx:139`).
8. **Theory of constraints:** drum-buffer-rope pipe plus `min(machines, operators)`, for the Bottleneck tab (`AnalyticsScreen.tsx:300`), the Plan banner and LaborWarning.
9. **Little's law** (WIP = TH × FT) tying three KPIs together (`PlanScreen.tsx:712-716`).
10. **IDEF0 ICOM:** a proper labelled A-0 box replacing the text legend (`RoutingSchemeEditor.tsx:306`).
11. **Forecast decomposition:** history = trend (EMD) + harmonics + residual → fan (`ForecastScreen.tsx:107-111`).
12. **MRP explosion:** gross → net → offset by lead time (`PlanScreen.tsx:657`).
13. **Dispatch rules** EDD/SPT/CR/MWKR micro-examples (`PlanScreen.tsx:15-21`).
14. **NPV cash-flow timeline** with the bottleneck shift (`AnalyticsScreen.tsx:362`).
15. **Scheduler objective F** as a weighted stack (`Scheduler.cpp:729`) next to "Вес риска".

## 7. Prioritised findings

Evidence for each item is in §§1–5.

- **CRITICAL**
  - C1. KPI meanings diverge across screens (§5 ⚠ rows).
  - C2. The token foundation cannot carry a restyle (§1).
- **HIGH**
  - H1. IA order, icon-only rail, no routing, state lost on screen switch (§2).
  - H2. Fragmented modelling, cosmetic 3D links, rename bug, linear IDEF0 (§4).
  - H3. Explanations are undiscoverable: 56 `title=`, 2 "ⓘ" (§5).
  - H4. No disabled/focus/active states (§1).
  - H5. 55 swallowed errors (§3).
  - H6. Four colour worlds: map, sky, UI, sim (§3).
- **MEDIUM**
  - M1. No type scale and no display font.
  - M2. Duplicate formatters, modals, inputs and CSS classes.
  - M3. Emoji used as icons.
  - M4. Chart legibility and two Gantt legends that can disagree.
  - M5. Fake shop status; deletes with no confirm; `window.prompt` ×3.
  - M6. Dead modules.
  - M7. Slider PUT on every tick.
- **LOW**
  - L1. Inconsistent logo; no favicon.
  - L2. Static StatusBar; theme not persisted.
  - L3. OOS and calibration outputs not rendered.
  - L4. "«Планы»" copy (`OptimizationScreen.tsx:209`).

### Quick wins (≤ ½ day each)
1. Define `--surface`, `--surface-2`, `--surface-3` and `--danger` in `tokens.css`, with light variants. This fixes light theme on 4 screens.
2. Add global `.btn:disabled`, `:active` and `:focus-visible`, plus an input focus ring.
3. Fix the "Концентрация (HHI)" label, unify the Проходка/НЗП unit text, and pick one "Makespan" headline.
4. Build an `<InfoTip>` fed by `KPI_CATALOG.formula`. Wire it into Plan KPIs, pinned cards and the Optimization `Metric`s.
5. Show the Forecast methodology as a collapsible block in embedded mode.
6. Persist the active screen (hash) and the theme. Lift the Plan and Optimization results into a module store.
7. Reorder the rail to match the pipeline and add hover-expand labels and stage numbers.
8. Replace emoji with `icons.tsx` icons; add a favicon and an SVG mark (a natural slot for the Kandinsky logo).
9. Move `STATUS_META`, `ORDER_COLORS`, `SERIES_COLORS` and the sim legend to CSS variables.
10. Shade the CVaR tail in `ProfitDistribution`.
