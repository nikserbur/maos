# G3c — планные графики на chart-системе, полировка Портфеля, Tier 3 (3.2–3.6) и остатки G3a/G3b/G3d

> 2026-10-23. Агент G3c по `docs/research/X1-ux-audit.md` §4 (Портфель, п. 1–6), §5.1, §8 (инвентарь графиков), §10 Tier 3 (3.2 · 3.3 · 3.4 · 3.5 · 3.6) и остаткам из `G3a-plan.md` §3, `G3b-nsi-charts.md` §5, `G3d-tier2.md` §5. Стенд: фронт `:5173`, бэкенд `127.0.0.1:8080`, демо-БД `maos.db`, `admin`. Проверено в браузере: `#/optimization` (прогон на демо-БД до и после), `#/plan` (результат из кэша, ГА-детали, очереди, загрузка по типам/станкам/во времени, касса с PoL и траншами, клавиатура на Ганте), `#/map`, `#/agents`, `#/admin`, `#/scheme`, `#/nsi`, `#/scenarios`, `#/monitoring`, `#/analytics`, `#/methodology`, `#/aiflow`, экран входа; тёмная и светлая темы; 1440×900 и 1024×768. Счётчик `console.error`/`onerror`, установленный после полной перезагрузки, при проходе всех маршрутов — **0 ошибок** (в истории вкладки остаются только HMR-ошибки промежуточных правок).
> `npx tsc --noEmit -p .` — чисто. `npx vitest run` — **251/251** (было 234; +8 `plant-scene/scenePalette.test.ts`, +7 `ui/charts/charts.test.tsx` — полосы ДИ/пунктир/аннотации, гистограмма с контуром, скобкой и окном оси, формы точек Scatter, `Heatmap`, `RangeStrip`, `StackBar` со штриховкой; +2 `optimization/profitDomain.test.ts`). Ничего не закоммичено, версия не поднималась.
> Работа велась в четыре руки: планные графики, Портфель, Гант, `MapCanvas` — ядро; 3.2 + остатки (токены, 3D-палитра, формы НСИ, `WorldMap.tsx`, иконка `more`), 3.3 + 3.6 (a11y, моушн, `ChoiceChip`), 3.5 (Агенты, Админ, Вход, Методика) — три параллельных исполнителя; всё проверено ядром в браузере.

Скриншоты (8, `docs/research/img/`): `G3c-portfolio-params.jpg` · `G3c-portfolio-hist.jpg` · `G3c-portfolio-pareto-load.jpg` · `G3c-plan-kpi.jpg` · `G3c-plan-queue-load.jpg` · `G3c-plan-heat.jpg` · `G3c-plan-cash.jpg` · `G3c-plan-light-1024.jpg`.

---

## 1. Приёмка по строкам задания

| # | Критерий | Статус | Где / доказательство |
|---|---|---|---|
| 1.1 | `QueueChart` → chart-система, фильтр РЦ снаружи | **сделано** — `AreaChart` (сплошная сетка, 10 % заливка, одна подсказка, таблица-двойник); пик — маркер + лидер-подпись `--text` («пик 124 · Вертикально-фрезерный…»), не цветом ряда; строка «копится у …» — в подсказке; `QueueFilter` — в `tools` секции «Очереди операций» (`PlanResult`), состояние `queueWc` снаружи графика | `plan/QueueChart.tsx` (62 строки, 0 inline-стилей), `img/G3c-plan-queue-load.jpg` |
| 1.1 | `LoadTimeline` → chart-система | **сделано** — новый примитив `Heatmap` (последовательная шкала `--chart-1` через color-mix, 11 ступеней, подписи станков в 2 строки, ось «0 · середина · конец», шкала-легенда, таблица-двойник); 11 inline-стилей и hex/hsl цвета → 0 | `ui/charts/Heatmap.tsx`, `plan/LoadTimeline.tsx`, `img/G3c-plan-heat.jpg` |
| 1.1 | `LoadBars` — статусный цвет ≠ магнитуда | **сделано** — `BarList`: бар одного цвета ряда, ≥ 85 % — глиф ▲ у названия и `marked`, простой — вторичной строкой, названия в 2 строки без обрезки; инфраструктура без операций — прежняя плашка | `plan/LoadBars.tsx` |
| 1.1 | PoL-кривая и транши в `CashTiles` | **сделано** — `LineChart` с полосой ДИ 95 % (`Series.band`), вертикальная отметка текущего `L_min` и первой неразрешимой точки (`annotations kind=line`); транши — `LineChart` «долг · медиана» с полосой до p95, первый транш — точка с подписью суммы, подсказка «долг p95 · транш p50»; 2 inline-стиля → 0 | `plan/CashTiles.tsx`, `img/G3c-plan-cash.jpg` |
| 1.1 | ГА-сходимость в `GaImproverCard`/`WhatDrove` | **сделано** — `LineChart` с двумя рядами: «лучшее F по поколениям» и «правило CR» пунктиром (`Series.dashed` — порог, не данные), ось поколений, легенда, таблица; полоски драйверов «Что определило» — `Meter` (тон warn/good/neutral) | `plan/GaImproverCard.tsx`, `plan/WhatDrove.tsx` |
| 1.1 | Sparkline | **сделано** — `kpiParts.Sparkline` (градиент охрой) был мёртвым кодом после G3a, удалён; единственный спарклайн — `ui/charts/Sparkline` | `plan/kpiParts.tsx` |
| 1.1 | `TailStrip` / `FundBar` / `Meter` как примитивы кита | **сделано** — `RangeStrip` (○ дет · ● E · ▲ CVaR · ■ худший на одной оси, заштрихованная зона хвоста, числа только у CVaR и худшего, `role="img"`), `StackBar` с глифами в легенде и штриховкой «ТО/ремонт» (второй признак, не зависящий от цвета), итог «фонд N ч»; метр OTD — `Meter` (новый тон `good`); 4 inline-стиля → 0 | `ui/charts/RangeStrip.tsx`, `ui/charts/Bars.tsx`, `plan/kpiParts.tsx`, `plan/PlanKpis.tsx`, `img/G3c-plan-kpi.jpg` |
| 1.1 | Гант — свой рендерер, примитивы системы | **сделано** — легенда через `Legend`/`LegendItem` (слоты `--chart-n`, свои образцы штриховок через `swatchClass`), подсказка — карточка `.ch-tip` (та же, что у всех графиков) в фиксированной обёртке, ось — `--fs-11` моно `tabular-nums` вместо литерала `10px`, ширина дорожки подписей — CSS-переменная `--pl-lane-w`; **клавиатура**: дорожка станка фокусируется (`tabIndex`, `role="group"`), ←/→ — соседняя операция, Home/End, Esc; выбранная полоса — кольцо `--focus`, подсказка якорится к полосе; контейнер — `role="figure"` с описанием | `plan/Gantt.tsx`, `plan/GanttParts.tsx`, `plan/charts.css` |
| 1.2 | Остатки плана: `toFixed`/`toLocaleString` 3 → 0 | **сделано** — `dateTime()` в `PlanScreen` и `ProgramStep`, `num()` в очередях | |
| 1.2 | Эмодзи-глифы 5 → 0 | **сделано** — `Icon close` (×3), `Icon plus`, «Сохранено» чипом с глифом, «Сохранить как…» без 💾 | `HeuristicModal`, `ProgramStep`, `FinancialCard` |
| 1.2 | Inline-стили плана 68 → **10** | **сделано** в пределах возможного — осталась только динамическая геометрия Ганта (ширина трека, положение делений, `left/width` полос и долей наладки/ТО — 9) и позиция подсказки под курсором (1); всё статичное (`HeuristicModal` 15, `MrpTable` 6, `kpiParts` 4, `QueueChart` 12, `LoadTimeline` 11, `CashTiles` 2, `WhatDrove`, `PlanKpis`, `DistributionsStep`, `FinancialCard`) → CSS/примитивы | `plan/plan-screen.css`, `plan/kpi.css`, `plan/charts.css` |
| 1.2 | Шапка плана → `ScreenHeader` | **сделано** — eyebrow «Решения · Стадия 1», заголовок с метой «#1f3ad4 · CR + ГА · 22.10.2026, 22:46 · из кэша», чипы блоков, одно действие; `plan__head*` из CSS удалён | `plan/PlanScreen.tsx` |
| 2 | Портфель п. 1 — одна primary | **сделано** — в пустом состоянии кнопка карточки quiet («Найти робастное решение ↑»), primary — только в панели параметров | `OptimizationScreen.tsx` |
| 2 | п. 2 — шесть параметров `ParamField size="md"` | **сделано** — сценарий (select), критерий (`Segmented`), α, прогонов, макс. доля, горизонт — одна сетка 4 колонки (сценарий и критерий по две); паспорт ○ «из сценария «Базовый»» / ■ «этот прогон · вернуть» вместо локального `InheritBadge`; значения в `optStore` по-прежнему строки (`String(v)`) | `img/G3c-portfolio-params.jpg` |
| 2 | п. 3 — гистограмма: плашка вне плота, легенда 3, прямые подписи, **не сжимать робастное** | **сделано** — `Histogram` chart-системы: подзаголовок «худшие α = 10 % — левее VaR · прибыль за горизонт, ₽ · N = 3 000» вне плота; легенда «хвост / E / CVaR» (+ «портфель „макс. E“» при наличии); VaR — линия с прямой подписью, E и CVaR — точки на дорожке, «худший» — квадрат, подписи раскладываются автоматически без наездов (справа → слева → строкой ниже), скобка «E − CVaR = 112 млн»; хвост — `--chart-4` **плюс штриховка**; контур «макс. E» пунктиром. **Окно оси X** (`domain` = `robustDomain()`): собственный размах робастного распределения по корзинам (обрезка 0,5 % массы с краёв, марки VaR/CVaR/E/худший всегда внутри, отступ в полкорзины) — на демо-БД −200…400 млн вместо −1,08…2,66 млрд; контур «макс. E» за окном обрезан и отмечен у краёв «портфель «макс. E» → до 2,66 млрд» / «← от −1,08 млрд»; таблица-двойник — все 24 корзины. Корзины у бэкенда общие для обоих портфелей (24 на весь размах), поэтому робастное занимает 3 корзины — столбцы широкие, но честные | `ProfitDistribution.tsx` (`robustDomain`, тесты), `ui/charts/Histogram.tsx`, `img/G3c-portfolio-hist.jpg` |
| 2 | п. 4 — Парето: лидер-линии, подписи не у края | **сделано** — `Scatter`: фронт линией с 10 % заливкой, доминируемые приглушены, робастный — ▲ `--chart-2` «выбрано», «макс. E» — ■ `--chart-4`; подписи с лидер-линией и `text-anchor=end` у правого края; подсказка по точке с E/σ/CVaR/худший/P(убыток)/доля | `ParetoFrontier.tsx` (62 строки, было 173), `img/G3c-portfolio-pareto-load.jpg` |
| 2 | п. 5 — загрузка без обрезки названий | **сделано** — `BarList`: названия в 2 строки, бар одного цвета, ≥ 80 % — пометка «близко к пределу» глифом | |
| 2 | п. 6 — «Передать в План» в заголовке | **сделано** — quiet-кнопка «Передать в «План» ↓» в `actions` шапки (прокрутка к полю названия программы); primary внизу сохранена | |
| 2 | числа до/после на демо-БД | **совпадают** — см. §2 | |
| 3.2 | hex вне `tokens.css` в CSS = 0; 3D-материалы через `themeColors` | **сделано** — CSS: 62 → **0** (`scenarios-hub`, `scenario-compare`, `optimization`, `workflow-builder`; радиусы → `--radius*`, отступы → `--space-*`); 3D: `scenePalette.ts` (нейтрали ink→bone, приглушённые семейства red/orange/yellow/green/teal/blue/violet из `ThemeColors`, именованные роли газона/пола/лампы), литералы в `Decorations`/`Facility`/`RailYard`/`FlowLinks`/`machines`/`plantKit`/`WorkshopInterior`/`SceneEnvironment`/`Building`/`SimulationLayer`/`StageObject` **309 → 0**; геометрия и `graph/*` не тронуты | `plant-scene/scenePalette.ts` (+8 тестов) |
| 3.3 | hit-area ≥ 24 px, чекбоксы, `scope`, клавиатура Гант/очереди, `role="img"`, фокус | **сделано** — «i» уже 24×24 (`::before inset −4px`); новый `ChoiceChip` (≥ 26 px, `aria-pressed`, `--halo`) в ките, пины Аналитики на нём; `DataTable` — `scope` col/row/colgroup, `aria-sort`, `caption`, фокус на кликабельных строках (было от G3d, проверено); история прогонов — чекбокс 16 px в `label` на всю ячейку ≥ 32 px (`plan/runs.css`); клавиатура — Гант (см. 1.1), очереди через `useHoverIndex` (←/→/Home/End/Esc); `role="img"` — у всех графиков (`ChartFrame`, `Meter`, `RangeStrip`, `DensityMini`, `RegimeStrip`, диаграммы); фокус-кольцо у результатов поиска карты. axe офлайн недоступен — чек-лист вручную | `ui/kit/Chip.tsx`, `plan/RunsTable.tsx` |
| 3.5 | Агенты 1+3, Админ, Вход, Методика | **сделано** — Агенты: ведущая карточка «Правило «RL» рядом с EDD/SPT» (`--fs-20`, штрих `--block-6`) + нумерованный список из трёх; Админ: цвет только у «удаление», «Пользователи» и «Роли» стопкой (права ≤ 3 чипами + «+N»), две колонки от 1180; Вход: один логотип (в карточке), HUD 240 px на полупрозрачной подложке с `blur`, радиус `--radius`, 4 литерала кегля → токены, «Пароль» вместо «Пароль / ключ шифрования»; Методика: `StageChip` через кит `Chip` (глиф + тон). Чипов «● Блок N» в методике не оказалось — `BlockChip` там не нужен | `agents/*`, `admin/*`, `auth/*`, `brand/landscape/*`, `methodology/*` |
| 3.6 | моушн | **сделано** — шаг мастера: `key={step}` + fade/slide 4 px 200 мс (`wz-step-enter`), под `prefers-reduced-motion` выключен; hover-lift снят с узлов карты (`.mm-node:hover` без `translateY`); `prefers-reduced-motion` проверен: аврора/зерно (`atmosphere.css`), вход (`auth.css`), ГА-пейзаж (статичный кадр в `GaLandscape`), карта (`map.css`), глобальный фолбэк | `plan/wizard/wizard.css`, `method-map/map.css` |
| 4 | `MapCanvas` → `src/ui/graph-canvas` | **сделано, вид не изменился** — `GraphCanvas` с `className="mm-viewport"` (та же фоновая сетка), `controls={false}`, `grid={false}`, `minZoom/maxZoom` 0,4/2,2, `pad` 24 и границы мира `−40/−60 + 80/100` дают ту же формулу «вписать», что прежняя; рёбра и узлы — в HTML-слое `gc__world`; клавиатура узлов прежняя (Enter/стрелки), клавиши экрана доходят до `MapScreen`; движку добавлены `pad`, `nodeSelector`, `ariaRoleDescription`; `MapCanvas` 183 → 135 строк, собственные пан/зум/wheel/ResizeObserver удалены | `method-map/MapCanvas.tsx`, `ui/graph-canvas/GraphCanvas.tsx`, `map.css` |
| 4 | формы НСИ 21 inline → 0 | **сделано** — классы `.form__hint--warn/--danger`, `.form__checks`, `.form__group*`, `.form__inputs-row` и др. в `nsi.css` | |
| 4 | `plant-scene/WorldMap.tsx` | **удалён** (grep: ни одного импорта; упоминание в комментарии `PlantScene.tsx` → `WorldMap2D`) | |
| 4 | иконка `more`, `Menu` на ней | **сделано** — `icons.tsx` `more`, `Menu.tsx` без локального SVG | |
| 4 | кликабельный `ChoiceChip` | **сделано** (см. 3.3) | |
| 5 | все экраны, обе темы, 1440/1024, 0 ошибок консоли | **сделано** — см. преамбулу; `scrollWidth > clientWidth` на 1024 — false | `img/G3c-plan-light-1024.jpg` |

---

## 2. Портфель — числа до и после (демо-БД `maos.db`, сценарий «Базовый», критерий E − λ·σ, α 10 %, 3 000 прогонов, доля ≤ 0,6, горизонт 13 мес)

Прогон запущен дважды — до правок (`ProfitDistribution`/`ParetoFrontier` на своих SVG) и после (на `Histogram`/`Scatter`). Логика `optStore` и расчёты не тронуты, генератор детерминирован (CRN), поэтому значения совпадают бит-в-бит.

| Показатель | До | После |
|---|---|---|
| CVaR (герой) | −53,3 млн ₽ | −53,3 млн ₽ |
| Ожидаемая прибыль E | 58,2 млн ₽ | 58,2 млн ₽ |
| Подпись VaR на графике | VaR = −44,1 млн | VaR = −44,1 млн |
| Деления оси прибыли | −1 млрд · −500 млн · 0 · 500 млн · 1 млрд · 1,5 млрд · 2 млрд · 2,5 млрд (общий размах с «макс. E» — робастное в 3 корзинах на 1/10 ширины) | −200 млн · −100 млн · 0 · 100 млн · 200 млн · 300 млн · 400 млн (окно робастного; «макс. E» → до 2,66 млрд / ← от −1,08 млрд отметками у краёв) |
| Ось долей | 20 % · 40 % | 0 % · 20 % · 40 % |
| E − CVaR (скобка) | скрыта (< 24 px при общем размахе) | E − CVaR = 112 млн |
| Плитки VaR / худший / P(убыток) / σ / макс. сожаление | −44,1 млн ₽ / −73,2 млн ₽ / 30,1 % / 85,6 млн ₽ / 2,35 млрд ₽ | те же |
| «Максимум ожидания»: E[Π] / CVaR / худший / σ / P(убыток) | 261 млн ₽ (+202 млн) / −696 млн ₽ (−643 млн) / −1,08 млрд ₽ (−1 млрд) / 709 млн ₽ (+623 млн) / 42,4 % (+12,3 %) | те же |
| Цена робастности | 202 млн ₽ · 77,7 % | те же |
| Вне выборки: E / CVaR | 62,5 млн ₽ (Δ −7,3 %) / −51,8 млн ₽ (Δ −2,7 %) | те же |
| Парето | 31 недоминируемых из 90; оси 50…250 млн / 200…600 млн | те же — область `Scatter` = размах всех кандидатов, как и прежде (`extent` + те же поля 6 %/8 %), фронт занимает весь плот, разрешение не потеряно |
| Загрузка портфелем (топ-14) | 17 · 13 · 10 · 10 · 10 · 8 · 8 · 6 · 6 · 5 · 5 · 5 · 5 · 4 % | те же, названия без обрезки |
| Состав портфеля | 8 изд., HHI 0,3, конц. 50 %; 968 · 39,2 млн ₽ … 25 · 318 тыс. ₽ | те же |

---

## 3. Chart-система — что добавлено (`src/ui/charts`)

| Файл | Добавлено |
|---|---|
| `Cartesian.tsx` | `Series.band` (полоса ДИ 14 % цвета ряда, разрывы по NaN, пункт легенды `shape: band`), `Series.dashed` (порог/базовая линия — только пунктир «проекции», никогда данные), `annotations` (точка ряда с лидер-подписью или вертикальная отметка), `tipRows(i)` (доп. строки подсказки), `compact`, `xHeader` таблицы |
| `Histogram.tsx` | штриховка выделения (`<pattern>`), `outline` (второе распределение пунктиром, в легенде и таблице), маркеры `kind: line / dot / square` с дорожкой под осью и стороной подписи (`side`), `bracket` между двумя X, `xExtent`, `tipRows`, `legend` снаружи |
| `Scatter.tsx` | `emphasis: alt`, `shape: dot / square / triangle`, `tip`/`tipTitle` на точке, `frontArea` (10 % под фронтом) |
| `Bars.tsx` | `StackBar`: `glyph` в легенде, `hatched` сегмент, `total`; `Meter`: тон `good`, `role="img"` только при `label` |
| `Heatmap.tsx` | новый: строка × интервал, последовательная шкала `--chart-1` (11 ступеней), `heatStep()` |
| `RangeStrip.tsx` | новый: отметки-глифы на одной оси, зона хвоста штриховкой, числа только у выбранных отметок |
| `ChartFrame.tsx`, `palette.ts` | `LegendItem.glyph` (глиф состояния вместо образца) и `swatchClass` (свой образец — штриховки Ганта) |
| `charts.css` | `ch-band`, `ch-hist__*`, `ch-range__*`, `ch-heat__*`, `ch-swatch--glyph/custom`, `ch-meter--good`, `ch-front__area` |

Инвентарь X1 §8 после G3c: все компоненты плана и Портфеля — на системе; свой рендерер остался только у Ганта (полосы на HTML, по задумке), его легенда/подсказка/ось — из системы. Пунктир на сетке — 0 (тест `charts.test.tsx`).

---

## 4. Grep-счётчики до → после

| Метрика | До (старт G3c) | После | Примечание |
|---|---|---|---|
| inline `style={{` в `src/features` | 106 | **21** | `plan/Gantt.tsx` 9 + `GanttParts` 1 — динамическая геометрия полос и курсора; `OptimizationScreen` 1 — ширина полоски теневой цены (динамика); `workflow-builder` 4, `method-map` 4, `scenarios/DistributionsTab` 2 — CSS-переменные `--block`/`--cols`/`--rho` и геометрия канваса (вне периметра) |
| из них `src/features/plan/**` | 68 | **10** | только геометрия Ганта |
| hex в CSS вне `tokens.css` | 62 (+15 в комментариях `brand.css`) | **0** | комментарии `brand.css` оставлены |
| hex-литералы в 3D-файлах `plant-scene` | 309 | **0** | всё через `scenePalette`/`themeColors` (тесты и сам мост не считаются) |
| `font-size: Npx` в CSS вне `tokens.css` | 4 | **0** | `landscape.css` → `--fs-9/--fs-11` |
| `toFixed \| toLocaleString` в `src/features` | 3 | **0** | |
| эмодзи в `src/features/*.tsx` | 5 | **0** | |
| `stroke-dasharray` на сетке графиков | 0 | 0 | пунктир только у порога/проекции/отметок |
| графиков без `role="img"` | QueueChart (был на svg), LoadTimeline, HeurViz, PoL | **0** | |
| файлов > 400 строк среди затронутых | 1 (`plantKit.tsx` 1056 — 3D-модель) | 1 | не разбивался (вне периметра); всё новое ≤ 260 |
| тестов | 234 | **248** | |

---

## 5. Отложено / замечания

1. **Гант — 9 inline-стилей динамической геометрии** (`left/width` полос, ширина трека и делений, доли наладки/ТО). Это координаты, вычисляемые из данных, как `x/y` в SVG; перевод на CSS-переменные ничего не меняет по сути. Оставлено осознанно, как и в G3a.
2. **Скобка «E − CVaR»** на гистограмме показывается при расстоянии ≥ 24 px (то же правило, что прежде); в окне робастного распределения она видна всегда, кроме очень узких окон — числа есть в подсказке и плитках.
3. **Разрешение гистограммы Портфеля** ограничено бэкендом: 24 корзины на общий размах робастного и «макс. E» (`Optimizer.cpp`), при σ 85 млн против 709 млн робастное попадает в 3 корзины. Окно оси показывает их во всю ширину (регрессия «игла» снята), но более тонкую форму даст только раздельное бинирование на бэкенде (вне периметра G3c; предложение: `histogram_robust` с 24 корзинами на собственный размах).
4. **`ParamField` для чисел Портфеля** отдаёт `number`, в `optStore` остаются строки (`String(v)`), контракт стора не менялся; ввод десятичных через контролируемый `number`-input проверен (React не перезаписывает «0,» при равном значении).
5. **axe** офлайн не запускался; проверка a11y — ручной чек-лист (hit-area 24/26/32 px, `scope`, `aria-sort`, `focus-visible`, `prefers-reduced-motion`, `role="img"` + «Таблица»).
6. **`plantKit.tsx` 1056 строк** — цвета переведены на палитру, файл не разбивался (3D-модель вне периметра G3).
7. **Срез «E − λ·σ»** в демо-БД: прогон перед правками дал критерий `meanvariance` (наследован из сценария) — так и сравнивалось; CVaR-критерий даст другие числа, но тот же код.
8. **Снимок экрана входа** в набор 8 не вошёл (HUD/один логотип проверены в браузере: `.login__mark` 0, `Lockup` в карточке 1, `.ga-hud` 240 px).

---

## 6. Файлы

**Новые**: `src/ui/charts/{Heatmap.tsx, RangeStrip.tsx}`, `src/features/plant-scene/{scenePalette.ts, scenePalette.test.ts}`, `src/features/plan/runs.css`, `docs/research/img/G3c-*.jpg` (8), этот отчёт.

**Изменены (ядро)**: `src/ui/charts/{Cartesian, Histogram, Scatter, Bars, ChartFrame}.tsx`, `palette.ts`, `index.ts`, `charts.css`, `charts.test.tsx`; `src/features/plan/{QueueChart, LoadTimeline, LoadBars, kpiParts, PlanKpis, WhatDrove, CashTiles, GaImproverCard, PlanResult, PlanScreen, HeuristicModal, MrpTable, Gantt, GanttParts}.tsx`, `plan/{charts, kpi, plan-screen}.css`, `plan/wizard/steps/{ProgramStep, FinancialCard, DistributionsStep}.tsx`, `plan/wizard/wizard.css`; `src/features/optimization/{OptimizationScreen, ProfitDistribution, ParetoFrontier, PortfolioCards}.tsx`, `opt-screen.css`; `src/features/method-map/MapCanvas.tsx`, `map.css`; `src/ui/graph-canvas/GraphCanvas.tsx`; `src/ui/kit/Menu.tsx`.

**Изменены (исполнители)**: 3.2 — `scenarios/{scenarios-hub, scenario-compare}.css`, `optimization/optimization.css`, `workflow-builder/workflow-builder.css`, `plant-scene/{Decorations, Facility, RailYard, FlowLinks, WorkshopInterior, SceneEnvironment, Building, SimulationLayer, StageObject, PlantScene, plantKit, objects/machines}.tsx`, `nsi/forms/*.tsx`, `nsi/CreateDialog.tsx`, `nsi/nsi.css`, `shell/icons.tsx`; 3.3/3.6 — `ui/kit/{Chip.tsx, index.ts, kit.css}`, `analytics/{KpiPins.tsx, analytics.css}`, `plan/RunsTable.tsx`, `plan/wizard/PlanWizard.tsx`; 3.5 — `agents/*`, `admin/*`, `auth/*`, `brand/landscape/{LandscapeHud.tsx, landscape.css}`, `methodology/{blocks.tsx, methodology.css}`.

**Удалены**: `src/features/plant-scene/WorldMap.tsx`.

**Не трогал**: `backend/`, `rl/`, `src/lib/api.ts`, `src/styles/tokens.css`, `optimization/optStore.ts` и расчёты, `src/explain/metrics*.ts`, 3D-геометрия (`graph/*`, `sceneModel`), маршрутизация.
