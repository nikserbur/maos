# G3b — chart-система, конструктор техкарт, Мониторинг (Tier 1: 1.1 · 1.4 · 1.5-часть)

> 2026-10-22. Агент G3b по `docs/research/X1-ux-audit.md` §2.1, §6.2, §8, §10. Стенд: фронт `:5173`, бэкенд `127.0.0.1:8080` v0.66.0, демо-БД `maos.db`, `admin`. Проверено в браузере: 1440×900 и 1024×768, тёмная и светлая темы. `npx tsc --noEmit -p .` — чисто; `npx vitest run` — **196/196** (было 159; +37: `src/ui/charts/scale.test.ts` 10, `src/ui/charts/charts.test.tsx` 10, `src/features/nsi/routing/routingModel.test.ts` 7, плюс перенесённые/расширенные проверки). Ничего не коммичено, версия не поднималась.

Скриншоты (8): `img/G3-nsi-constructor.jpg` · `G3-nsi-constructor-light.jpg` · `G3-nsi-1024.jpg` · `G3-charts-monitoring.jpg` · `G3-charts-monitoring-light-1024.jpg` · `G3-charts-analytics.jpg` · `G3-charts-sankey.jpg` · `G3-charts-scenarios.jpg`.

---

## 1. Приёмка по §10

| # | Критерий X1 | Статус | Где |
|---|---|---|---|
| 1.5 | Мониторинг открывается на демо-БД (`ForecastScreen.tsx:213` `p.fit.aic_normal.toFixed` на `undefined`) | **сделано** — `fitLabel()`/`aicTitle()` с проверкой `fit?.aic_*` (у ставки MacroSampler `fit = {data_driven, dist:'empirical_blocks', n_obs}` без AIC), все числа через `num/pct/money/signed` | `src/features/forecast/ForecastScreen.tsx` |
| 1.5 | «1 774,3 %» в таблице качества Сценариев | **сделано** — `mape`/`mape_naive` приходят в процентах, `pct()` умножал ещё раз; прокси CRPS — в рублях (`money`), а не `num(…, 3)` | `src/features/scenarios/ForecastTab.tsx` |
| 1.5 | `InfoTip` ref-cleanup, `ObjectiveStep` DOM-nesting | не моя зона — закрыто агентом G3a (коммит v0.67.2) | — |
| 1.1 | `src/ui/charts`: ChartFrame/Axis/Grid/Legend/Tooltip + LineChart/AreaChart/ColumnChart/BarList/Histogram/Scatter/Fan/Sparkline/StackBar/Meter | **сделано** (+ `Sankey`, `useMeasuredWidth`, `useHoverIndex`) | `src/ui/charts/*` (14 файлов, каждый ≤ 200 строк) |
| 1.1 | перенос `scale.ts` из opt-kit | **сделано** — `src/ui/charts/scale.ts` (+ `extent/yDomain/yTicks/labelStep/segments/linePath/areaPath/bandPath/wrapLabel`); в `optimization/kit/scale.ts` остался реэкспорт, экран «Портфель» и его 13 тестов не тронуты | |
| 1.1 | ни одного `stroke-dasharray` на сетке | **сделано** — сетка/оси/перекрестие сплошные (`charts.css`); пунктир только у тренда (проекция), порога ГА и линии «сейчас» (dataviz допускает «порог/проекцию») | тест `charts.test.tsx` проверяет отсутствие `2 4` |
| 1.1 | текст никогда цветом ряда | **сделано** — подписи/значения/легенда `--text*`; идентичность — образец рядом (`Swatch`, ключ-штрих в подсказке) | |
| 1.1 | легенда при ≥ 2 рядов | **сделано** — `ChartFrame` рисует легенду автоматически; у малых кратных (веера) одна общая легенда над сеткой (`fanLegend`, `showLegend={false}`) | |
| 1.1 | `aria-label` + «Таблица» у каждого графика | **сделано** — `role="img"` на теле, кнопка «Таблица» → `DataTwin` с каждым значением | |
| 1.1 | палитра только `--chart-*` | **сделано** в новых и мигрированных компонентах; `seriesColor(i)` → слоты 1…8, далее `--chart-other` | `palette.ts` |
| 1.1 | отчёт валидатора | ниже, §3 | |
| 1.1 | `toFixed` в фичах = 0 | в мигрированных файлах — 0 пользовательских `toFixed`; остались только координаты SVG-путей (`scale.ts`, `Scatter.tsx` — `x.toFixed(1)` это геометрия, не число для читателя) и `fmt()` статистики HUD (вне моего периметра — только SVG). Lint-правило `no-restricted-syntax` — не добавлял (ESLint-конфига в репо нет) | |
| 1.4 | экран `#/nsi/routing/:id` вместо модала | **сделано** — `NsiScreen` разбирает якорь: `#/nsi/<реестр>` и `#/nsi/routing/<id|new>`; «+ Создать» и клик по строке «Техкарты» ведут в конструктор; `CreateDialog` больше не знает о техкартах; `RoutingSchemeEditor.tsx` (794 строки, 52 inline-стиля) удалён | `src/features/nsi/NsiScreen.tsx`, `CreateDialog.tsx`, `src/shell/screens.tsx` (`anchors` — аддитивно) |
| 1.4 | `GraphCanvas` из workflow-builder → `src/ui/graph-canvas` | **сделано** — `useGraphView` (пан/зум/fit/toWorld) + `GraphCanvas` (колесо вокруг курсора, пан по фону, клавиши `+ − 0 F ←→↑↓`, кнопки масштаба, автофит при монтировании и ресайзе, слои svg/html); `WorkflowBuilder` переведён на движок (448 → 395 строк, собственные пан/зум удалены) | `src/ui/graph-canvas/*` |
| 1.4 | пан/зум/fit; подписи не обрезаны; одна primary; Esc/Cmd+S; 0 inline-стилей; та же модель | **сделано** — узлы-карточки 196×76 с переносом названия в 2 строки (`wrapLabel`, полный текст в `<title>`), маршрут укладывается «змейкой» ≤ 4 в ряд (8 операций читаются при 78 % без прокрутки), узкое место — кольцо `--ochre`, бейдж «● НСИ», режимы «Входы/выходы | Оборудование | Время», вкладка «Таблица», мини-полоса маршрута с перетаскиванием порядка; единственная primary — «Сохранить» (Cmd/Ctrl+S), «Отмена» — Esc с подтверждением при несохранённых изменениях; `grep style={{` по `nsi/routing` = 0; payload `api.routings.create` бит-в-бит прежний (`payloadFromState`, тест round-trip) | `src/features/nsi/routing/*` (5 файлов ≤ 230 строк) + `routing.css` |
| 1.4 | проверено сохранение | **сделано** — время A3 75 → 76, Cmd+S, перезагрузка: `GET /api/operations` отдаёт `t_norm = 76`, порядок/РЦ/коды `OP-010…OP-080` сохранены | |

Консоль при проходе НСИ → конструктор → Мониторинг → Аналитика (KPI, Потоки) → Сценарии (Прогноз) → AI-воркфлоу: **0 новых ошибок** (счётчик `console.error`/`onerror`, установленный после полной перезагрузки). В истории вкладки остаются только старые записи до правок (`ForecastScreen …toFixed`, HMR-ошибки `orderColor` из параллельной работы G3a).

---

## 2. Chart-система `src/ui/charts/` — что внутри

| Файл | Назначение |
|---|---|
| `ChartFrame.tsx` | рамка: заголовок · подзаголовок · бейджи · действия; `Legend`/`Swatch` (линия/прямоугольник/точка/полоса, пунктир — только «проекция»); `DataTwin` (таблица-двойник, числовые колонки вправо, `tabular-nums`); `ChartEmpty`; `loading` — прежний кадр с opacity 0,45 без скелета-вспышки |
| `Axis.tsx` | `Grid` (сплошные волосяные `--chart-grid`), `YAxis` (подписи `--text-muted` 11 px mono, единица в углу), `XAxis` (по центру деления, у краёв прижимаются к плоту, наезжающие пропускаются), `Crosshair`, `Marker` (≥ 8 px, 2 px кольцо поверхности `--ch-surface`) |
| `Tooltip.tsx` | одна подсказка на все ряды внутри SVG через `<foreignObject>` в пиксельных координатах — не масштабируется, без inline-стилей; переворот у правого края; значение главное, имя вторичное, ключ-штрих цветом ряда |
| `hooks.ts` | `useMeasuredWidth` (callback-ref + ResizeObserver: плот рисуется в пикселях, текст не «плывёт» с шириной — X1 отмечал 8,5–10-unit подписи, масштабирующиеся с контейнером), `useHoverIndex` (ближайший X мышью, ←/→/Home/End/Esc с клавиатуры) |
| `scale.ts` | линейная шкала, круглые деления, `axisNum/axisMoney` (из `format.ts`), домен Y с полями, шаг подписей X, пути линий/областей/полос, перенос подписей |
| `Cartesian.tsx` | `LineChart`/`AreaChart`/`ColumnChart`: ≤ 4 линий сетки, маркеры только на hover и в конце, столбцы ≤ 24 px со скруглённым краем данных и 2 px зазором, площадь 10 %, `endLabels` ≤ 4 рядов |
| `BarList.tsx` | горизонтальные бары одного цвета (статусный цвет не кодирует величину), подпись в 2 строки без обрезки, значение `--text` справа, двуполярный режим от центра |
| `Bars.tsx` | `StackBar` (2 px зазоры поверхности, легенда) и `Meter` (дорожка — светлая ступень того же тона; двуполярный, с засечкой-порогом) |
| `Histogram.tsx` | корзины с зазором, выделенный хвост `--chart-4`, маркеры VaR/E/CVaR подписью `--text` с обводкой поверхности — база для будущей миграции `ProfitDistribution` |
| `Scatter.tsx` | зона попадания 24 px, приглушённые/выбранные точки, подписи с лидер-линией и `text-anchor=end` у правого края — база для `ParetoFrontier` |
| `Fan.tsx` | веер: история → «сейчас» → P10–P90 (+ P25–P75), медиана, тренд, ромбы факта и полоса бэктеста, высота 200, перекрестие + подсказка P10/P50/P90/факт, таблица-двойник по месяцам; `fanLegend()` для общей легенды сетки |
| `Sparkline.tsx` | один спарклайн на Аналитику и План: 1,5 px линия, 10 % заливка, маркер с кольцом |
| `Sankey.tsx` | поток «откуда → куда»: левое поле по длине подписи (2 строки, без обрезки), hover/фокус узла подсвечивает цепочку и показывает числа, топ-N лент подписаны |
| `charts.css` | только токены `--chart-*`, `--fs-*`, `--space-*`, `--text-*`, `--bg-*`; обе темы через `--ch-surface` |

Числа везде — `src/explain/format.ts` (`num/pct/money/hours/fmtValue/signed`).

### 2.1. Инвентарь: мигрировано / осталось

| Компонент (X1 §8) | Статус |
|---|---|
| `TimeChart` (Аналитика) | **мигрирован** — адаптер над `LineChart/AreaChart/ColumnChart`, контракт `ChartSeries` для `KpiDashboard` сохранён; пунктирная сетка, маркеры на каждой точке и масштабируемый текст ушли; `analytics/charts.css` удалён |
| `Sparkline` (Аналитика) | **мигрирован** — реэкспорт `ui/charts/Sparkline` |
| Sankey (inline в `AnalyticsScreen`) | **мигрирован** — `ui/charts/Sankey`: подписи целиком, hover-цепочка, числа, таблица |
| `FanChart` (Сценарии) | **мигрирован** — обёртка над `Fan`: качество «CRPS · skill · покрытие» строкой под заголовком (не плашкой в svg), высота 200, одна общая легенда на сетку, бейджи в шапке; `fields.css` веера сокращён до строки качества |
| `ForecastTab` (Сценарии): таблица качества, вклад факторов | **переделано** — худшие первыми, топ-10 + «все 76», skill — двуполярный `Meter`, вклад факторов — `BarList`; `pct` / `money` |
| `PriceFan`/`ContribBars` (Мониторинг) | **заменены** на `FanChart` + `BarList`; эмодзи ⛶ → `Icon expand`; 4 inline-стиля → 0; экран разбит на `ForecastScreen.tsx` (226) + `ForecastZoom.tsx`; `forecast.css` переведён на токены (30+ литералов `font-size` → `--fs-*`) |
| `LandscapeHud` Convergence (логин) | **мигрирован** только SVG: `areaPath/linePath` chart-системы, площадь 10 %, маркер последней точки, цвета `--chart-2/3/4`; поведение HUD прежнее |
| `GaImproverCard`, `Gantt`, `QueueChart`, `LoadBars`, `LoadTimeline`, `Sparkline` (kpiParts), `TailStrip/FundBar/pl-meter`, `CashTiles` — `src/features/plan/**` | **не трогал** (экран параллельно перестраивал G3a) — follow-up: `QueueChart` → `AreaChart` с фильтром снаружи; `LoadBars` → `BarList`; `kpiParts.Sparkline` → `ui/charts/Sparkline`; `FundBar/TailStrip` → `StackBar`/`Meter`; `CashTiles` PoL → `LineChart`, транши → `ColumnChart`; `GaImproverCard` → `LineChart` |
| `ProfitDistribution`, `ParetoFrontier` (Портфель) | **не трогал** по условию — follow-up: `Histogram` и `Scatter` написаны как их база (маркеры с подписями вне плота, лидер-линии), перевод — одним PR без изменения логики `optStore` |
| `DensityMini`, `RegimeStrip` | не трогал (Tier 2.3) |

---

## 3. Валидатор палитры (`dataviz/scripts/validate_palette.js`)

Прогнано по значениям `--chart-1…8` из `tokens.css` против поверхности карточек (`--bg-card`: тёмная `#1b1e26`, светлая `#fffdfa`).

```
## dark (surface #1b1e26), 8 слотов
  [FAIL] Lightness band   outside band: #efa831 0.781, #47b497 0.699, #95d4f6 0.839, #f3e657 0.91
  [FAIL] Chroma floor     below floor:  #95d4f6 0.08, #83807a 0.01
  [PASS] CVD separation   worst adjacent #47b497↔#efa831 ΔE 12.1 (protan) · tritan 26.1
  [PASS] Normal-vision    worst adjacent #47b497↔#efa831 ΔE 21.3
  [PASS] Contrast         all 8 >= 3:1
## dark, 6 слотов (без лимона и «прочее»)
  [FAIL] Lightness band   #efa831, #47b497, #95d4f6   [FAIL] Chroma floor  #95d4f6
  [PASS] CVD 12.1 · normal 21.3 · contrast 6/6
## light (surface #fffdfa), 8 слотов
  [FAIL] Lightness band   #6d2981 0.42, #642627 0.36
  [FAIL] Chroma floor     #4a9dc5 0.10, #642627 0.09, #888681 0.008
  [PASS] CVD separation   worst adjacent #22876b↔#cd821a ΔE 10.5 (protan) · tritan 7.8
  [PASS] Normal-vision    worst adjacent #642627↔#6d2981 ΔE 15.0
  [WARN] Contrast         below 3:1: #4a9dc5 2.99
## light, 6 слотов
  [FAIL] Lightness band   #6d2981   [FAIL] Chroma floor  #4a9dc5   [WARN] contrast #4a9dc5 2.99
  [PASS] CVD 10.5 · normal 21.9
```

Вывод. Главные проверки — различимость при дальтонизме (ΔE 12,1 / 10,5 ≥ 8), нормальное зрение (21,3 / 15,0 ≥ 15) и контраст с поверхностью — **проходят** в обеих темах; A6 заявлял ΔE 8,3/8,9 — по скрипту лучше. Не проходят «полоса светлоты» (dark L 0,48–0,67: охра/вердигрис/sky/лимон слишком светлые; light L 0,43–0,77: фиолет/oxblood слишком тёмные) и «порог хроматичности» (sky `#95d4f6`/`#4a9dc5` и серый «прочее» читаются как серые). `--chart-8` серый — намеренно («прочее», вне категориальной проверки). Серый слот и ограничение ≤ 6 цветных рядов учтены в `seriesColor`. **Рекомендация для Tier 2.2 (словарь цветов, `tokens.css` не трогал):** sky → `oklch(0.72 0.12 232)` (dark) / `oklch(0.58 0.13 232)` (light); охра dark → `oklch(0.67 0.15 75)`; вердигрис dark → `oklch(0.64 0.11 172)`; лимон dark → `oklch(0.66 0.16 104)`; фиолет light → `oklch(0.48 0.15 318)`; oxblood light → `oklch(0.45 0.12 22)`; после подстановки прогнать скрипт повторно. Пока sky-ряды в светлой теме должны идти с видимыми подписями/таблицей — `ChartFrame` это даёт.

---

## 4. Конструктор техкарт — как устроен

```
src/features/nsi/routing/
  routingModel.ts      типы, редьюсер (без мутаций: ADD/UPDATE/TAG/INPUT/DELETE/MOVE/MOVE_TO/INIT),
                       opsFromApi ← GET /api/operations, payloadFromState → POST /api/routings (как прежде),
                       validateRouting, bottleneckId, totalMinutes            + routingModel.test.ts (7)
  RoutingScreen.tsx    #/nsi/routing/:id — шапка (крошки, имя, изделие, «n оп · Σ мин», «● изменено»,
                       Отмена / Сохранить), PillTabs «Маршрут | Таблица» + режим узлов, тело, полоса маршрута,
                       Esc / Cmd+S, подтверждение при уходе с несохранёнными изменениями
  RoutingCanvas.tsx    GraphCanvas + svg-узлы: змейка ≤ 4 в ряд, рёбра --chart-1 со стрелкой и «коленом»
                       между рядами, IDEF0-стрелки C/M только в режиме «Входы/выходы», кольцо узкого места
  RoutingInspector.tsx операция (название, РЦ с бейджем «● НСИ»/«▲ нет в НСИ», время, I/O/C/M, порядок,
                       удалить) + «Добавить операцию» (из реестра одним «+», новая — раскрывается);
                       ни одной btn--primary
  RoutingTable.tsx     таблица-двойник (№ · операция · РЦ · мин · I · O · C · M · Σ) и RouteStrip
                       (чипы 1 ▸ 2 ▸ … с drag-and-drop порядка, узкое место — охристый номер)
  routing.css          токены; узлы в языке карточек wf-node / карты методологии
```

Маршрут `#/nsi/<реестр>` теперь тоже в адресе (реестр переживает F5), `ScreenDef.anchors` документирует вложенные маршруты экрана.

---

## 5. Отложено (follow-ups)

1. **Планные графики** (`src/features/plan/**`) и **Портфель** (`ProfitDistribution`, `ParetoFrontier`) — перевод на `ui/charts` отдельными PR (см. §2.1); примитивы готовы.
2. **`MapCanvas` → `GraphCanvas`**: движок совместим (fitToken, onViewChange, autoFit, className), но у карты свои классы `mm-viewport/mm-world`, клавиатура по узлам и «вписать с margin 48» — перевод нетривиален без риска для «хорошего» экрана (X1 §6.4), оставлен.
3. **Мини-карта** канваса (optional в ТЗ) — не делал; есть кнопки масштаба и «Вписать».
4. **Lint-правило** `no-restricted-syntax` на `toFixed/toLocaleString` — в репозитории нет ESLint-конфига; добавить вместе с Tier 2.7.
5. **Палитра** — поправки токенов по §3 (Tier 2.2).
6. **Сохранение техкарты = удалить + создать** (как и раньше): id меняется, `created_at` обновляется; черновик/undo не делал (в X1 отмечено, но не в критериях 1.4).
7. В `ForecastTab` остались чипы `Chip` из `plan/ui` и `ProvenanceBadge` — к единому киту в Tier 2.1.

---

## 6. Файлы

Новые: `src/ui/charts/{index.ts, palette.ts, hooks.ts, scale.ts, ChartFrame.tsx, Axis.tsx, Tooltip.tsx, Cartesian.tsx, BarList.tsx, Bars.tsx, Histogram.tsx, Scatter.tsx, Fan.tsx, Sparkline.tsx, Sankey.tsx, charts.css, scale.test.ts, charts.test.tsx}`; `src/ui/graph-canvas/{index.ts, useGraphView.ts, GraphCanvas.tsx, graph-canvas.css}`; `src/features/nsi/routing/{routingModel.ts, routingModel.test.ts, RoutingScreen.tsx, RoutingCanvas.tsx, RoutingInspector.tsx, RoutingTable.tsx, routing.css}`; `src/features/forecast/ForecastZoom.tsx`; скриншоты `img/G3-nsi-*.jpg`, `img/G3-charts-*.jpg`.

Изменены: `src/features/forecast/{ForecastScreen.tsx, forecast.css}`, `src/features/scenarios/{ForecastTab.tsx, scenarios-v2.css}`, `src/ui/{FanChart.tsx, fields.css}`, `src/features/analytics/{TimeChart.tsx, Sparkline.tsx, AnalyticsScreen.tsx}`, `src/features/nsi/{NsiScreen.tsx, CreateDialog.tsx}`, `src/features/workflow-builder/{WorkflowBuilder.tsx, workflow-builder.css}`, `src/features/optimization/kit/scale.ts` (реэкспорт), `src/brand/landscape/{LandscapeHud.tsx, landscape.css}`, `src/shell/screens.tsx` (`anchors`), `vitest.config.ts` (`*.test.{ts,tsx}`).

Удалены: `src/features/nsi/RoutingSchemeEditor.tsx`, `src/features/analytics/charts.css`.

Не трогал: `src/features/plan/**`, логику `optimization/**`, `src/ui/InfoTip.tsx`, `PipelineStrip.tsx`, `NavRail.tsx`, `src/lib/api.ts`, `backend/`, `rl/`, `tokens.css`.
