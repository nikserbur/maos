# G3d — Tier 2: единый UI-кит, Сценарии, Аналитика, Схема, копия и типошкала (2.1 · 2.3 · 2.4 · 2.5 · 2.7 · 3.1 + палитра)

> 2026-10-22. Агент G3d по `docs/research/X1-ux-audit.md` §10 (Tier 2: 2.1, 2.3, 2.4, 2.5, 2.7; Tier 3: 3.1) + подстановка токенов палитры по `G3b-nsi-charts.md` §3. Стенд: фронт `:5173`, бэкенд `127.0.0.1:8080`, `admin`. Проверено в браузере: все экраны (`#/scheme` мир/площадка/цех/симуляция, `#/nsi/*`, конструктор техкарты, `#/scenarios/*` три вкладки, `#/optimization`, `#/plan` + мастер, `#/agents`, `#/monitoring`, `#/analytics`, `#/map`, `#/methodology`, `#/aiflow`, `#/admin`), тёмная и светлая темы, 1440×900 и 1024×768. Счётчик `console.error`/`onerror`, поставленный после полной перезагрузки, при проходе 17 маршрутов — **0 ошибок**, ErrorBoundary не срабатывал.
> `npx tsc --noEmit -p .` — чисто. `npx vitest run` — **234/234** (было 196; +38: `ui/kit/tableModel.test.ts` 9, `explain/format.test.ts` +2, `ui/charts/axisLayout.test.ts` 7, `analytics/chartData.test.ts` 8, `scenarios/distModel.test.ts` 6, `ui/labelParts.test.ts` 4, `scenarios/regimeMenu.test.ts` +2, `plant-scene/themeColors.test.ts` +1). Ничего не закоммичено, версия не поднималась.
> Работа велась в четыре руки: кит, НСИ, Админ, история прогонов, токены, копия и типошкала — ядро; 2.3 / 2.4 / 2.5 — три параллельных исполнителя на уже готовом ките; все их результаты проверены ядром в браузере.

Скриншоты (8, `docs/research/img/`): `G3d-kit-nsi-datatable.jpg` · `G3d-kit-admin.jpg` · `G3d-scenarios-conditions.jpg` · `G3d-scenarios-conditions-light.jpg` · `G3d-scenarios-forecast.jpg` · `G3d-analytics.jpg` · `G3d-scheme-world.jpg` · `G3d-scheme-sim-light.jpg`.

---

## 1. Приёмка по §10

| # | Критерий X1 | Статус | Где / доказательство |
|---|---|---|---|
| 2.1 | 1 `Segmented`, 1 `EmptyState`, 1 `ScreenHeader` | **сделано** — `grep -rl "export function Segmented\|EmptyState\|ScreenHeader" src` → по одному файлу в `src/ui/kit`; `optimization/kit/{kit.tsx,kit.css}`, `nsi/kit/*`, `plan/ui.tsx` удалены (в `optimization/kit` остался только реэкспорт `scale.ts` + его тест, как оставил G3b) | `src/ui/kit/*` |
| 2.1 | все заголовки экранов одной высоты | **сделано** для Портфеля, НСИ, Админа, Агентов, Мониторинга, Аналитики, Сценариев — один `ScreenHeader` (eyebrow · Unbounded-заголовок · чипы блоков · подзаголовок · действия · бренд-линия). Остались свои шапки у «Плана» (`plan__head`, не трогал по условию), у канвасов Карты/AI-воркфлоу и лонгрида Методики (у них верхняя панель, не шапка) | |
| 2.1 | НСИ / Админ / История прогонов / Качество прогноза — на `DataTable` | **сделано** — сортировка по клику (`aria-sort`), липкая caps-шапка, `.num` вправо с `tabular-nums`, липкие подзаголовки групп (`groupBy`), Enter/Space на строке, пустое состояние и skeleton внутри таблицы | `NsiScreen.tsx`, `AdminScreen.tsx`, `plan/RunsTable.tsx`, `scenarios/ForecastTab.tsx` (+ `DistributionsTab`, `analytics/KpiRegistry`, `Bottlenecks`, `plant-scene/SimulationRuns`, `nsi/LaborWarning`) |
| 2.1 | Портфель — поведение и вид без изменений | **сделано** — изменены только пути импорта (+ `<span class="no-caps">α</span>` в подписи «α хвоста» по 2.7); `dk-*` классы и `surfaces.css` (карточки, bento, KPI, легенда старых графиков) перенесены как есть | `OptimizationScreen.tsx`, `PortfolioCards.tsx` |
| 2.3 | «Условия» по §3.1: `size="md"` в 4 колонки, ползунок по фокусу, заметки в «i», «Режимы» свёрнуты | **сделано** — сетка `repeat(4)` (3 при ≤ 1180, 2 при ≤ 900); `ParamField collapsedSlider` (ползунок появляется по `:focus-within`/hover-intent 180 мс, высота карточки не прыгает, Tab на ползунок тоже открывает); заметки → `hint` в «i» (`InfoTip` секция «Примечание» или `NoteTip`); «Режимы генератора» — одна строка-сводка «базовый · 92 % спокойный / 8 % кризис · CRPS 0,98» с шевроном, `RegimeMenu` монтируется при раскрытии | `ConditionsTab.tsx`, `ui/ParamField.tsx`, `ui/fields.css` |
| 2.3 | ≤ 12 чисел выше сгиба; высота вкладки ≤ 1 500 px на 1440 | **сделано** — выше сгиба на 1440×900: шапка 3 (13 мес, α 10 %, ≤ 60 %) + первый ряд 7 (1 %/мес, +14 %, 10,5 %/мес, 38 %, 0,25, 13 мес, 9 360 ч) = **10**; высота `main.scrollHeight` свёрнутой вкладки — **1 290 px** (JS-замер) | `img/G3d-scenarios-conditions.jpg` |
| 2.3 | вкладка «Прогноз» — топ-10 + `DataTable`; веера ≥ 200 px | **сделано** — `DataTable` (худшие первыми, `defaultSort` по skill, подсказки колонок, человеческие подписи «Ошибка / Наивный / Качество против „как вчера“ / Покрытие / Прокси CRPS»), skill — двуполярный `Meter`, «все 76» сохранён; веера G3b (200 px, общая легенда) не тронуты | `ForecastTab.tsx`, `img/G3d-scenarios-forecast.jpg` |
| 2.3 | «Распределения» — плотность только при отличии; «Удалить» — в ⋯ | **сделано** — `DataTable` с липкой шапкой, `DensityMini` только для `isCustomDist` (тип ≠ normal, σ ≠ 12 %, β ≠ 0,7, хвосты, центр ≠ база), иначе текст «нормальное · σ 12 %»; шапка сценария — `ScreenHeader`: «Сохранено» чипом, «Клонировать» quiet, «Удалить сценарий» — в `Menu` ⋯ (danger, Esc/стрелки/возврат фокуса); блок критерия — одна строка «Критерий CVaR · α 10 % · доля изделия ≤ 60 % [изменить]», раскрывается в три поля | `ScenarioHeader.tsx`, `DistributionsTab.tsx`, `distModel.ts`, `ui/kit/Menu.tsx` |
| 2.4 | фильтры вне карточек; заголовки = метрики; реестр → `DataTable`; плитки без цветного текста; «инвест →» по hover | **сделано** — одна строка «План · Ось графиков · Период» над содержимым (ось общая для обоих графиков, формат сохранённого конфига прежний); карточки «Длина расписания и CVaR длины расписания» / «Доля заказов в срок (OTD)», тип по форме данных (построения → столбцы, часы → линия); реестр — `DataTable` с липкими группами каталога (Сроки / Ресурсы / Поток / Труд / Надёжность / Экономика / Деньги), формула — в «i»; числа плиток `--text`, статус — глиф + полоса, hover-lift снят, герой 44 px без `tabular-nums` + спарклайн по 23 построениям; «Узкие места» — `DataTable` + `Meter` на `--chart-1`, «Инвестпроект» виден у верхней строки, у остальных — по hover (`dk-table__hover`); инвест-форма на `ParamField size="md"`, результат «NPV · IRR · срок» рядом | `analytics/*` (9 файлов ≤ 150 строк + css 256), `img/G3d-analytics.jpg` |
| 2.4 | ось X без наездов | **сделано** — `placeXLabels` (ширина = `len × 6,7 px` моно, зазор 12, первая/последняя всегда, наезд → пропуск, > 40 % пропусков → равномерный шаг, поворот −30° опционально); тест на случай «10-22 18:35-22 19:46» из `G3-charts-analytics.jpg`; на скриншоте 10 подписей дат без пересечений | `ui/charts/Axis.tsx`, `axisLayout.ts` (+7 тестов) |
| 2.4 | `AnalyticsScreen` ≤ 300 строк | **сделано** — 489 → 139; `KpiPins` 91 · `KpiCharts` 92 · `KpiRegistry` 146 · `Bottlenecks` 68 · `InvestPanel` 142 · `FlowsSection` 36 · `chartData.ts` 136 · `useDashboard.ts` 85; адаптеры `TimeChart.tsx`/`Sparkline.tsx` удалены (chart-система вызывается напрямую) | |
| 2.5 | 0 эмодзи; карта в тёмной теме ≤ L 0,3; инспектор всегда содержателен | **сделано** — подложка по теме: dark → CARTO `dark-matter-gl-style` (фон L ≈ 0,1), light → CARTO `positron-gl-style`; смена `data-theme` → `map.setStyle` с восстановлением OSRM-трасс и подписей (`name:ru`, `--text-muted`), CSS-фолбэк `saturate(.6) brightness(.85)` на канвасе в тёмной теме; карточка объекта — React-портал вместо `innerHTML`; инспектор без выбора — `EmptyState` «Выберите завод / цех / станок» с мини-легендой ▣ ■ · и клавишами; авто-fit цеха по bbox станков (+ «Вписать» и `F`, сетка пола `--chart-grid`); панель симуляции: `Segmented kind="tab"` с иконками, «Выйти» — `IconButton stop`, выбор плана — `DataTable` (дата · операции · горизонт · OTD-чип), все числа через `format.ts`; один переключатель «Просмотр · Редактирование · Симуляция» над канвасом; `grep` эмодзи по `plant-scene` 10 → **0**, hex в css 50 → 0, `font-size` 55 → 0, inline-стили панелей 42 → 0 | `plant-scene/*` (17 новых файлов ≤ 312 строк), `img/G3d-scheme-world.jpg`, `G3d-scheme-sim-light.jpg` |
| 2.7 | подписи человеческие, коды/формулы в «i»; `Α` → «α»; числа через `format.ts`; тире | **сделано** в периметре — «Курс валют», «Чувствительность сырья к курсу», «Опора ставки», «Качество против „как вчера“», «Ошибка / Наивный», «Журнал и доступ», «Спрос в год»; коды b^FX, i_ref, SVD, формулы KPI — в «i»; `α` строчная везде (`.no-caps` в `global.css`, `CapsLabel`/`splitGreek` в `ParamField`, Портфель); `dateTime()` добавлен в `format.ts` (даты бэкенда «ГГГГ-ММ-ДД ЧЧ:ММ:СС» → «22.10.2026, 18:35»); `grep "toFixed\|toLocaleString" src/features` **25 → 3** (все 3 — `plan/**`, см. §4); `MINUS`/`DASH` вместо литералов в таблицах сценариев и аналитики; в UI-строках дефиса вместо тире не осталось (grep) | |
| 3.1 | `grep "font-size: [0-9]" src --include=*.css` вне `tokens.css` = 0; герои 44/24/16 | **сделано** в периметре — **179 → 4**, оставшиеся 4 — `src/brand/landscape/landscape.css` (запрещённая зона). Правило округления: ≤ 11,5 → `--fs-11`, 12–12,5 → `--fs-12`, 13 → `--fs-13`, 14–15 → `--fs-14`, 16–18 → `--fs-16`, 19–22 → `--fs-20`, 23–28 → `--fs-24`, 29–36 → `--fs-32`, ≥ 40 → `--fs-44`; добавлены `--fs-9` (микро-caps: группы рельсы, маркер ▲ в «i») и `--fs-code` (код/единицы внутри текста). Герои: Аналитика 44 (без `tabular-nums`) / плитки 24 / inline 16; Сценарии 20 → 24-ярус не вводился (поле `md` — одно число 20 px по §3.1) | `tokens.css`, все css фич |
| G3b §3 | палитра: полоса светлоты / порог хроматичности | **сделано** — см. §3 | `tokens.css` |

---

## 2. Кит `src/ui/kit/` — что внутри

| Файл | Строк | Содержимое |
|---|---|---|
| `ScreenHeader.tsx` | 62 | `ScreenHeader` (eyebrow · title · blocks · subtitle · actions · rule), `Section` (h2 · meta · tools), `rise()` |
| `Segmented.tsx` | 139 | один `Segmented`: индикатор clip-path (измеряется по кнопке — работает и с равными колонками, и с `fit` по содержимому), `kind` radio / tab / nav, `size` sm / md / lg, `count`, `icon`, `disabled`, `idBase` для `aria-controls`, ←/→/Home/End; `PillTabs` — тонкая обёртка (`kind="tab" size="lg" fit`) для конструктора техкарт |
| `Chip.tsx` | 45 | `Chip` с единым словарём тонов `running/setup/idle/down/info` + синонимы `good/warn/bad` из «Плана» и `accent`; глиф из `glyphs.css`, `size="sm"`; `StatusChip` — прежнее имя |
| `States.tsx` | 172 | `Skeleton`, `SkeletonRows` (колонки разной ширины, `aria-busy`), `ErrorBanner`/`InlineError` (title · message · children · retry · dismiss · tone), `EmptyState` (схема из `src/diagrams` или `KandinskyMark` с предметным штрихом table/chart/flow/search/log), `errorText` |
| `Controls.tsx` | 46 | `Switch`, `IconButton` (icon · variant · size · pressed) |
| `DataTable.tsx` | 141 | таблица: `columns` (`num`, `get`, `render`, `rowHeader`, `sortable`, `hint`), `groupBy`, `defaultSort`/контролируемая сортировка, `onRowClick` с клавиатурой, `rowClassName(row, i)`, `rowTitle`, `empty`, `loading`, `caption`, `tight`, `framed` |
| `tableModel.ts` | 84 | чистая сортировка (числа по значению, строки по `Intl.Collator('ru')`, пустые в конце, стабильная), группировка по первому появлению, `nextSort` (текст asc→desc→нет, число desc→asc→нет) — 9 тестов |
| `Menu.tsx` + `menu.css` | 183 + 74 | меню действий ⋯ (Esc/стрелки/Home/End/Tab, возврат фокуса, клик снаружи, `danger`) |
| `kit.css` / `surfaces.css` / `table.css` | 275 / 164 / 92 | компоненты · поверхности Портфеля (карточки, bento, KPI, старая легенда/подсказка) · таблица и секции; только токены, обе темы |

Правки по замечаниям исполнителей: `.btn--sm` (22 px) добавлен в `global.css`; липкость шапки ограничена `thead th` (строки-заголовки `th[scope=row]` больше не прилипают); `rowClassName`/`rowTitle` получают индекс строки после сортировки; `.dk-table tr.is-open` — общий модификатор выбранной строки.

Миграция импортов: `optimization/*`, `agents`, `method-map`, `plan/*` (10 файлов + 8 шагов мастера — только пути), `scenarios/*`, `nsi/routing`. CSS-селекторы `.pl-chip` → `.dk-chip` и `.pl-sec` → `.dk-sec` в `plan/charts.css`, `plan-screen.css`, `scenarios-v2.css`; мёртвые блоки `pl-seg/pl-chip/pl-alert/pl-skel/pl-sec` удалены из `plan.css`.

---

## 3. Палитра — подстановка токенов и валидатор

`src/styles/tokens.css` по рекомендации G3b §3 с уточнением по прогону (G3b предлагал ochre 0,67 и sky 0,72 — это выше полосы 0,48–0,67 тёмной темы):

| Слот | Было | Стало | Зачем |
|---|---|---|---|
| dark `--chart-2` | `oklch(0.78 0.15 75)` | `oklch(0.66 0.15 75)` | полоса светлоты |
| dark `--chart-3` | `oklch(0.70 0.11 172)` | `oklch(0.64 0.11 172)` | полоса светлоты |
| dark `--chart-5` | `oklch(0.84 0.08 232)` | `oklch(0.66 0.12 232)` | порог хроматичности + полоса |
| dark `--chart-7` | `oklch(0.91 0.16 104)` | `oklch(0.64 0.18 104)` | полоса; отделён от серого «прочее» |
| light `--chart-5` | `oklch(0.66 0.10 232)` | `oklch(0.58 0.13 232)` | контраст ≥ 3:1, хроматичность |
| light `--chart-6` | `oklch(0.42 0.15 318)` | `oklch(0.48 0.15 318)` | полоса светлоты |
| light `--chart-7` | `oklch(0.36 0.09 22)` | `oklch(0.46 0.14 30)` | полоса; ΔE к фиолету 17,2 (было 14,8) |

`node dataviz/scripts/validate_palette.js` (hex из OKLCH пересчитаны скриптом; поверхность `--bg-card`):

```
## dark #1b1e26 — 6 слотов (#4a81eb,#c78200,#2fa284,#dc5426,#2f9ecf,#924da6)
  [PASS] Lightness band  all 6 inside L 0.48–0.67
  [PASS] Chroma floor    all 6 >= 0.1
  [PASS] CVD separation  worst adjacent #2fa284↔#c78200 ΔE 11.3 (protan) · tritan 23.3
  [PASS] Normal-vision   worst adjacent ΔE 19.5
  [PASS] Contrast        all 6 >= 3:1          → ALL CHECKS PASS
## dark — 8 слотов (+ #a08f00, #83807a)
  [PASS] Lightness · [PASS] CVD 11.3 · [PASS] Contrast
  [FAIL] Chroma floor    #83807a 0.01   — слот 8 «прочее» нейтрален намеренно
  [FAIL] Normal-vision   #83807a↔#a08f00 ΔE 13.3 — пара «оливковый ↔ серое прочее»
## light #fffdfa — 6 слотов (#304ccc,#cd821a,#22876b,#cf3b18,#0086b9,#7f3c93)
  [PASS] Lightness 0.43–0.77 · [PASS] Chroma · [PASS] CVD 10.0 (deutan) · tritan 21.6
  [PASS] Normal-vision ΔE 21.0 · [PASS] Contrast     → ALL CHECKS PASS
## light — 8 слотов (+ #973023, #888681)
  [PASS] Lightness · [PASS] CVD 10.0 · [PASS] Normal-vision 17.2 · [PASS] Contrast
  [FAIL] Chroma floor    #888681 0.008 — слот 8 «прочее»
```

Вывод: 6 цветных слотов проходят все шесть проверок в обеих темах (у G3b полоса светлоты и хроматичность не проходили). 8-слотовый прогон падает только на намеренно сером слоте 8 — `seriesColor` отдаёт ≤ 7 цветных рядов, серый идёт только как «прочее» (dataviz: 9-й ряд сворачивается в Other), поэтому принято как есть. Светлая тема при 8 слотах теперь проходит и normal-vision.

---

## 4. Grep-счётчики до → после

| Метрика | До | После | Примечание |
|---|---|---|---|
| определений `Segmented` / `EmptyState` / `ScreenHeader` / `Skeleton` | 3 / 3 / 2 / 3 | **1 / 1 / 1 / 1** | `src/ui/kit` |
| `toFixed\|toLocaleString` в `src/features` (без тестов и комментариев) | 25 | **3** | все три — `plan/PlanScreen.tsx:29`, `plan/wizard/steps/ProgramStep.tsx:19` (даты → `dateTime`), `plan/QueueChart.tsx:4` (число → `num`); `plan/**` не трогал по условию — замена по одной строке |
| `font-size: Npx` в css вне `tokens.css` | 179 | **4** | все 4 — `src/brand/landscape/landscape.css` (запрещённая зона) |
| эмодзи в `src/features/*.tsx` | 20 | **5** | все 5 — `plan/HeuristicModal.tsx` (💾, ✕ ×2), `plan/wizard/steps/FinancialCard.tsx` (✓), `plan/wizard/steps/ProgramStep.tsx` (✕) |
| inline `style={{` в `src/features` | ≈ 279 (X1) / 165 на старте волны | **106** | `plan/**` 68 (не трогал); вне плана 24: формы НСИ (`WorkerForm` 8, `OperationForm` 7, `ProductForm` 3, `WorkCenterTypeForm` 2, `CreateDialog` 1), `scenarios/DistributionsTab` 2 (CSS-переменные `--cols`/`--rho`), `plant-scene/WorldMap.tsx` 1 (мёртвый файл) |
| файлов > 400 строк в затронутых папках | — | 3 | `plant-scene/{plantKit 1056, FlowLinks 985, Facility 498}` — 3D-модель, запрещённая зона; всё новое ≤ 312 |
| console.error при проходе 17 маршрутов | 3 падения (X1) | **0** | счётчик после перезагрузки |

---

## 5. Отложено / не сделано

1. **`plan/**`** — три `toLocaleString`/`toFixed`, пять глифов-эмодзи в кнопках, 68 inline-стилей и своя шапка `plan__head`: не трогал по условию («только пути импорта»); все замены точечные (`dateTime`, `num`, `Icon close/check`, `ScreenHeader`) — на следующую волну или G3a.
2. **`src/brand/landscape.css`** — 4 литерала `font-size` (10/10,5 px в HUD логина) — запрещённая зона.
3. **Формы НСИ** (`WorkerForm`, `OperationForm`, `ProductForm`, `WorkCenterTypeForm`, `CreateDialog`) — 21 inline-стиль размеров полей; в 2.1–2.7 не входили, диалог создания X1 отметил как «лучший в продукте», оставил.
4. **`plant-scene/WorldMap.tsx`** (259 строк, старая 3D-карта мира) — не импортируется нигде, 1 inline-стиль; кандидат на удаление отдельным коммитом (вне 2.5).
5. **Иконка «⋯»** — `Menu.tsx` рисует три точки локальным SVG; в `icons.tsx` имя `more` не добавлял (у исполнителя 2.5 добавлены `stop`, `rewind`, `enter`, `swap`).
6. **`Chip` кликабельный** (`ChoiceChip` для редактора пинов) — Аналитика держит локальный `an-chip`; в кит не выносил, пока один потребитель.
7. **Высота шапок Плана / Карты / AI-воркфлоу / Методики** — не на `ScreenHeader` (План — запрет; у остальных верхняя панель канваса/лонгрида, замена не улучшит).
8. **Аналитика: загрузка ряда KPI** — `kpi_series` на 23 построениях отвечает 3–5 с; пока ряд грузится, карточки показывают прежний кадр с `loading` (добавлен `seriesLoading`), а не «Нет данных» — но спарклайн героя появляется только после ответа; скелет для плиток не делал.
9. **3D-цех в превью** — авто-fit проверен по коду и тестом `CameraFit` не покрыт (Canvas); в фоновом превью rAF стоит (см. память проекта), кадр цеха снять не удалось — скриншот симуляции сделан на уровне площадки/цеха с панелью.

---

## 6. Файлы

**Новые**: `src/ui/kit/{index.ts, ScreenHeader.tsx, Segmented.tsx, Chip.tsx, States.tsx, Controls.tsx, DataTable.tsx, tableModel.ts, tableModel.test.ts, Menu.tsx, kit.css, surfaces.css, table.css, menu.css}`; `src/ui/{NoteTip.tsx, labelParts.ts, labelParts.test.ts}`; `src/ui/charts/{axisLayout.ts, axisLayout.test.ts}`; `src/features/analytics/{KpiPins, KpiCharts, KpiRegistry, Bottlenecks, InvestPanel, FlowsSection}.tsx`, `chartData.ts(+test)`, `useDashboard.ts`; `src/features/scenarios/{ScenarioHeader.tsx, distModel.ts(+test)}`; `src/features/plant-scene/{CameraFit, SceneModeBar, SceneLegend, InspectorEmpty, EditorAdd, MachineCard, RegisterForm, SimulationRuns, SimulationResults, SimulationCalib, SimKpi}.tsx`, `simModel.ts`, `useDevHooks.ts`, `editor-panel.css`, `simulation.css`, `worldmap2d/{basemap.ts, MapCard.tsx}`; скриншоты `img/G3d-*.jpg` (8).

**Изменены**: `src/styles/{tokens.css, global.css}`, `src/explain/{format.ts, format.test.ts}`, `src/shell/{icons.tsx, shell.css}`, `src/ui/{ParamField.tsx, fields.css, InfoTip.tsx, infotip.css, DensityMini.tsx, charts/Axis.tsx, charts/index.ts}`, `src/features/nsi/{NsiScreen.tsx, nsi.css, registries.ts, LaborWarning.tsx, forms/OperationForm.tsx, forms/ProductForm.tsx, routing/RoutingScreen.tsx}`, `src/features/admin/{AdminScreen.tsx, admin.css}`, `src/features/forecast/{ForecastScreen.tsx, forecast.css}`, `src/features/optimization/{OptimizationScreen.tsx, PortfolioCards.tsx, optimization.css, opt-screen.css}`, `src/features/agents/AgentsStub.tsx`, `src/features/method-map/{MapScreen.tsx, NodePanel.tsx, PassportTable.tsx, derivePassports.ts, map.css}`, `src/features/methodology/methodology.css`, `src/features/workflow-builder/workflow-builder.css`, `src/features/plan/{RunsTable.tsx (DataTable + dateTime), CashTiles, GaImproverCard, Gantt, GanttParts, KpiTable, PlanKpis, PlanResult, PlanScreen, ResultTables}.tsx` и 8 шагов мастера (пути импорта), `plan/{plan.css, plan-screen.css, charts.css}` (селекторы чипов/секций, мёртвые блоки, 5 литералов кегля), `src/features/scenarios/{ConditionsTab, DistributionsTab, ForecastTab, ScenarioTabs, ScenarioCompareScreen, ScenarioCompare, ScenariosScreen, RegimeMenuPanel}.tsx`, `regimeMenu.ts(+test)`, 4 css; `src/features/analytics/{AnalyticsScreen.tsx, KpiDashboard.tsx, analytics.css}`; `src/features/plant-scene/{PlantScene, EditorPanel, SimulationPanel, WorldMap2D, SceneEnvironment}.tsx`, `scene.css`, `themeColors.ts(+test)`, `worldmap2d/worldmap2d.css`.

**Удалены**: `src/features/optimization/kit/{kit.tsx, kit.css}`, `src/features/nsi/kit/{PillTabs.tsx, ScreenHeader.tsx, States.tsx, kit.css}`, `src/features/plan/ui.tsx`, `src/features/analytics/{TimeChart.tsx, Sparkline.tsx}`, `src/features/plant-scene/Inspector.tsx`.

**Не трогал**: `backend/`, `rl/`, `src/lib/api.ts`, `src/brand/**`, логика `optimization/**` (`optStore`, вычисления, графики), `src/features/plan/**` сверх путей импорта и `RunsTable`, `src/ui/charts/**` сверх `Axis.tsx`/`axisLayout.ts`/`index.ts`, 3D-модель сцены (`graph/*`, `sceneModel`, `objects/*`, `Decorations`, `Facility`, `materials`).
