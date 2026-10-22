# G2 — направляемый план, паспорт параметров, сценарий V2, деньги в KPI

> 2026-10-22, агент G, фаза G2 по `docs/UX-V2.md` §7 (с учётом решений владельца §8 и реальных эндпоинтов
> волн F и M). Только `src/` и этот отчёт; `backend/`, `rl/`, `src/brand`, `src/lib/api.ts`, версии не трогались.
> Проверки: `npx tsc --noEmit -p .` — чисто; `npx vitest run` — **159 тестов в 17 файлах** (было 134 в 13), все зелёные.
> Браузер: проект `maos`, демо-БД, 1440 × 900 — пройдены 7 шагов мастера от портфеля Стадии 2 до результата,
> запущена касса (`POST /api/optimize/cash`), открыты паспорта, три вкладки сценария, карта.

## 1. Что построено

### 1.1. Мастер плана — `src/features/plan/wizard/` (UX-V2 §4)

Маршрут `#/plan/new/<step>`; `#/plan` — история прогонов + последний результат; «Новый план» → поток.
Слева `Stepper` (7 шагов, глифы как на карте, цвет блока в подчёркивании), справа шаг, внизу «Назад · Далее · Запустить…»
(подсвечивает незавершённые). Источник истины для шага — маршрут (внутренние переходы идут через `navigate`, иначе
эффекты зацикливались — поймано в браузере и исправлено).

| Шаг | Файл | Что сделано |
|---|---|---|
| 1 Программа | `steps/ProgramStep.tsx` | Три источника как сегменты: «Портфель Стадии 2» (`GET /api/optimize/runs` + `run_get` → программа и сценарий наследуются), «Реестр заказов» (production_plan → заказы, правка через API), «Вручную». **Срок как дата** (`DateHoursInput`): `due_hours` остаётся техническим полем, подпись «720 ч · через 4 недели». Итог: N изделий, Σ штук, горизонт до даты, старт из `start_date` сценария или честный чип «дата сценария не задана». План создаётся в `PromptDialog`. |
| 2 Условия [1] | `steps/ConditionsStep.tsx` | Чип «Наследуется из портфеля → сценарий», «Сменить сценарий…» с предупреждением о расхождении со Стадией 2. Read-only сводка обученного генератора (`GET /api/macro/summary`, `/regimes`): данные cbr.ru, режимы, CRPS 0,976 / персистентность 1,141, покрытие 80 % с флагом недопокрытия ставки, бейджи «оценено по данным» / «синтетические данные» (паспорт r1.59). `ParamField` для ставки (ЦБ РФ [Н], ставка линии = ключевая + спред), инфляции (накопленный эффект «+189 % за 13 мес»), волатильности, ρ. Устаревшие ползунки — свёрнуто «не используются с волны M». |
| 3 Распределения [2] | `steps/DistributionsStep.tsx` | `tail_weight` — переопределение прогона с паспортом r1.03 (■ manual, в НСИ не пишется), `tail_index` r1.04, PERT σ r1.07, MTBF по типам, распределения цен сценария с `DensityMini`. «Оценить по план-факту» честно: R20 блокирует калибровку без `plan_fact_ops`; предпросмотр `GET /api/simulation/calibration` показывается. |
| 4 Ограничения [3] | `steps/ConstraintsStep.tsx`, `steps/FinancialCard.tsx` | Мощности, переключатель календаря (фонд ч/нед), `LaborWarning`, MRP под программу («материально осуществимо / дефицит N — с задержкой запуска»). **Карточка «Финансовые ограничения»** (решение владельца п. 5): `GET /api/fin_params` с бейджами серверного паспорта [К]/[НОРМ], черновик → явное «Сохранить в проект» = `PUT /api/fin_params`; L_min и β — параметры прогона. Раскрыта при пресете «Деньги». |
| 5 Цель и риск [5] | `steps/ObjectiveStep.tsx` | Пресеты «Срок / Деньги / Баланс / Экспертно» (веса — переопределения прогона), формула F живьём, «i» `plan.objective_weights`. **α — из сценария** (паспорт r1.19 [К]), переопределение с бейджем и чипом «портфель считался при α = …». Метод поиска: Авто · правило · конструктор эвристики · RL (в плане, волна 3). **Пресеты эвристик — в проекте** (`PUT /api/prefs/heuristic_presets`, локальные G1-пресеты переносятся; при сбое — чип «локально»). Критерий кассы: CVaR прибыли / CFaR / оба; финансирование рекурс / график заранее. |
| 6 Запуск | `steps/LaunchStep.tsx` | `DiffList` «Изменено · Наследовано · Не задано» с владельцем каждого значения и переходом на шаг; оценка времени; `RunProgress` по фазам (фронтовая оценка до `GET /api/runs/:id/progress`). |
| 7 Результат | `steps/ResultStep.tsx`, `PlanResult.tsx` | Оглавление (`ResultToc`, якоря KPI · узкое место · что определило · Гант · очереди · загрузка · правила · рабочие · касса), `PlanKpis` + `BottleneckBanner` + `GaImproverCard` + Гант/очереди/загрузка/правила (score и веса)/рабочие; **«Что определило результат»** (`WhatDrove.tsx`: хвост, календарь, труд, узкое место, ГА, пины — с переходом на узел карты); **плитки кассы** (`CashTiles.tsx`); пины → «Пересчитать с правками» (новый прогон); «Сравнить с…» — `RunsTable`. |

`wizardStore.ts` — база унаследованных значений с владельцем («из сценария «Базовый»», «из fin_params проекта»,
«из календаря проекта») + переопределения `owner: 'run'`; чистые `effectiveFields / isChanged / diffFields / stepState`.
Ничего не пишется в НСИ/сценарий молча.

История прогонов (`RunsTable.tsx`): эндпоинта `GET /api/runs?kind=schedule` нет — таблица собрана из `GET /api/simulation/plans`
+ `GET /api/analytics/kpi_series` (дата, операции, E[Cmax], CVaR, OTD, загрузка, узкое место); две отметки → `DiffTable` A/B.

Старый `PlanScreen.tsx` (832 строки) разбит без изменения поведения: `Gantt.tsx`, `LoadBars.tsx`, `HeuristicModal.tsx`,
`MrpTable.tsx`, `PlanResult.tsx`, `PlanScreen.tsx` (108 строк).

### 1.2. Паспорт параметра — `src/ui/`, `src/features/passport/`

- `passportBadge.ts` (+ тест): один словарь бейджей для серверного статуса (Н/О/К/НОРМ/UI/техн./синтетика) и происхождения
  карты; правило «[К] и [НОРМ] никогда не «оценено»»; «UI» + deprecated → «UI · не в расчёте»; синтетика — предупредительный тон.
- `ProvenanceBadge.tsx`, `ParamField.tsx` (значение 20 px, единица меньше, бейдж 11 px caps, владелец, «изменено · вернуть»,
  ▲ вне диапазона, накопленный эффект, «i»), `PassportCard.tsx` (код, блок, источник, файл в коде, обновлено, note).
- `passportStore.ts`: кэш `GET /api/passport` (125 строк) и `GET/PUT /api/fin_params`, `savePassportParam` (`PUT /api/passport/:code`).
- Карта: `params.ts` получил `passportCode`/`deprecated` и новые паспорта (`macro.*`, `fin.*`), `derivePassports.ts` берёт
  статус/источник/note с сервера (`provenanceFromStatus`), ручные поля — `manual` при отходе от умолчания; `deriveState` помечает
  синтетические датасеты (`ext.prices.ds` → «синтетика»); `useMethodMapState` подаёт паспорт, fin_params, сводку генератора и
  кассу. Фолбэк без бэкенда сохранён (тест «reads provenance from the server passport…»). Панель карты показывает статус/источник/файл.

### 1.3. Сценарии V2 — `src/features/scenarios/` (UX-V2 §5)

- `ScenarioTabs.tsx`: шапка (имя, описание, `start_date/end_date`, горизонт, чип режима), **карточка критерия** — единственное место
  `objective / alpha / max_share`; вкладки в маршруте `#/scenarios/<conditions|distributions|forecast>` (узлы карты ведут прямо на вкладку).
- `ConditionsTab.tsx`: группы «на что влияют» (Цены сбыта · Себестоимость · Деньги · Спрос · Режимы), `ParamField` с паспортом
  и накопленным эффектом; **меню режимов и стрессов** (`regimeMenu.ts` — чистый редьюсер ↔ `MacroMode`, 5 тестов; `RegimeMenuPanel.tsx`):
  Базовый (прогноз) · режим навязан · квантильный стресс · исторический эпизод · опора инфляции/ставки; `RegimeStrip` по
  `POST /api/macro/sample` (режимы путей по месяцам, доли, P(остаться)), совместные квантили ставка–курс–инфляция, покрытие holdout.
  Устаревшие ползунки — в `<details>` «не используются в расчёте». Сохранение — дебаунс 400 мс (как в G1), `macro_mode` уходит JSON-объектом.
- `DistributionsTab.tsx`: таблица сбыт + сырьё (плотность, тип, центр/оверрайд, σ абс. и %, хвосты, β, происхождение manual/UI),
  массовые действия «Применить тип к выбранным», «Сбросить к умолчанию»; «Оценить все по истории» — **недоступно честно**
  (истории синтетические R7, план-факта нет R20); строка раскрывается в редактор с живой плотностью; тепловая карта ρ ≈ β_s·β_t.
- `ForecastTab.tsx`: **сначала качество** — skill к наивному, покрытие 80 %, прокси CRPS (полусумма пинбол-потерь P10/P90, подписано как
  прокси), MASE «после план-факта»; бейджи `synthetic/demo/deprecated_fields` из ответа; `FanChart` (`src/ui/FanChart.tsx`: оси,
  P10/P50/P90, тренд, ромбы факта и область бэктеста, статус качества в углу с «i» `forecast.crps`); веер ставки — из генератора
  (synthetic:false, [Н]); вклад факторов — под веером.
- `ScenarioCompare.tsx`: **N сценариев** (отметки в списке), `DiffTable` условий (только отличающиеся, включая режим генератора)
  и результатов (лучше — зелёным); критерий — из каждого сценария.
- **Шаблоны**: серверного эндпоинта нет → `scenarioTemplates.ts` (Базовый · Ценовой кризис · Высокая ставка · Дезинфляция) с паспортом
  каждого числа, `ScenarioCreateDialog.tsx` показывает паспорт до создания; помечено «локально» (см. §4).
- «Оптимизация»: критерий наследуется из сценария (`optStore.inheritCriterion`), у полей — бейдж «из сценария» / «для прогона · вернуть».

### 1.4. Деньги в каталоге KPI — `src/explain/metrics.cash.ts`, `kpiCatalog.ts`

Категория **«Деньги»** (13 KPI по METHODOLOGY-V2 §6.0: CASH_MIN_P50, CFAR, P_BREACH, T_BREACH_P10, DSCR_MIN_P05, P_COVENANT,
DEBT_PEAK, INT_COST, WC_AVG, POL, NPV_O, NPV_B, TAX_PAID) с формулами, направлением, светофорами (пороги — из паспорта
`kpi.*` [К], не из кода) и «i» (11 записей `cash.*` с методом водопада §4.3 и оговорками). Значения берутся из последнего
`POST /api/optimize/cash` (`cashStore.ts`, `withCashKpis` вливает их в KPI-блок плана иммутабельно); в «Аналитике» подпись, откуда
числа. Узлы карты: `crit.cash` (8 формул), `dec.cash` (3 формулы, параметры L_min и β), `int.finance` (11 параметров fin_params),
`ext.generator` / `ext.regimes` / `mon.quality` переведены в `done` с живым состоянием; 9 новых детальных рёбер (генератор → портфель/касса,
fin_params → транши, водопад → CFaR, CRPS → мониторинг).

### 1.5. Карта: подписи рёбер (замечание G1 при 1440 px)

`mapLayout.placeLabels`: подпись сдвигается вдоль своей кривой (кандидаты t = 0,5 → 0,15…0,85) к первой позиции, свободной от
уже поставленных подписей и блоков; блоки — мягкое ограничение (длинная подпись между соседними блоками остаётся на кривой).
Тест: ни одна пара подписей не пересекается, подпись лежит на кривой, размещение идемпотентно. «Агенты» — заглушка без изменений.

## 2. Скриншоты (1440 × 900, демо-БД)

- `img/G2-scenario-regimes-1440x900.jpg` — вкладка «Условия»: группы «Деньги»/«Спрос», меню режимов, полоса режимов по месяцам.
- `img/G2-plan-wizard-conditions.jpg` — шаг 2: сценарий наследуется из портфеля, сводка генератора с бейджами, поля с паспортом.
- `img/G2-plan-launch-diff.jpg` — шаг 6: «Изменено 0 · Наследовано 12 · Не задано 1» с владельцами.
- `img/G2-plan-result-cash.jpg` — шаг 7: оглавление, плитки кассы (CFaR −1,15 млн ₽, P(разрыв) 1 % [Уилсон 0,3; 2,9], DSCR 1 610, пик долга 92 % лимита, PoL 136 млн ₽ с кривой).
- `img/G2-map-labels-1440x900.jpg` — карта с разведёнными подписями и состояниями после F/M ([3] «120 станков», [5] «α = 0,1»).

## 3. Приёмка G2 (UX-V2 §7)

| Критерий | Статус |
|---|---|
| Путь «Портфель → Передать в План → мастер с унаследованными значениями → запуск → результат» без скрытого селекта | ✅ источники — сегменты; портфель наследует программу и сценарий; пройдено в браузере |
| Шаг 6 показывает корректный дифф | ✅ `diffFields` (тесты: наследовано/изменено/не задано, вернуть, пресет = умолчание → не «изменено») |
| Критерий задаётся в одном месте; «Портфель» и «Сравнить сценарии» считают одинаково | ✅ карточка критерия в сценарии; `optStore.inheritCriterion` + бейдж «для прогона»; сравнение N берёт критерий сценария |
| Хвосты и веса — с «i» и диапазонами | ✅ `ParamField` с range/step и `InfoTip` (`plan.makespan_cvar`, `plan.rule_score`, `plan.objective_weights`) |
| Конструктор эвристик хранится в проекте | ✅ `prefs.heuristic_presets` (существующий KV-эндпоинт проекта); фолбэк localStorage с чипом «локально» |
| Результат с оглавлением | ✅ `ResultToc` (IntersectionObserver), 9 якорей |
| Тесты хранилищ ≥ 80 % | ✅ `wizardStore.test.ts` (7), `dates.test.ts` (6), `regimeMenu.test.ts` (5), `passportBadge.test.ts` (5); реестр карты, `deriveState`, `mapLayout` расширены и зелёные |
| Паспорт с бейджами О/К/НОРМ/UI-deprecated/synthetic из `GET /api/passport`; узлы карты по серверному паспорту | ✅ с фолбэком на умолчания кода |
| Сценарий: три вкладки, β и массовая оценка, FanChart с CRPS, полоса режимов, сравнение N, замена ползунков меню | ✅; «оценить все» — честное «недоступно без план-факта»; CRPS для цен — прокси и подписан так, для генератора — настоящий (summary) |
| Деньги в каталоге KPI по §6.0 + узлы карты | ✅ категория «Деньги», 11 «i», узлы и рёбра |
| Подписи рёбер без наложений при 1440 px | ✅ `placeLabels` + тест |
| Срок заказа в датах (решение п. 2) | ✅ `DateHoursInput`, часы — техническое поле; старт — `start_date` сценария, иначе честный чип |
| Карточка «Финансовые ограничения» уже в G2 (решение п. 5) | ✅ не `planned`, а живые `fin_params` с паспортом и явным сохранением |
| Lighthouse a11y ≥ 95 на `#/map` (долг G1) | ⏳ Lighthouse в среде нет; вручную — роли/aria на степпере (`aria-current="step"`), полях (`role="group"`, `aria-labelledby`), меню режимов (`radiogroup`), таблицах; прогнать в G3 |

## 4. Отложено в G3/G4 и что нужно от бэкенда

- **Серверные шаблоны сценариев** (решение владельца п. 4): нужен `GET /api/scenarios/templates` → `{id, name, description, values, passport[]}`
  и `POST /api/scenarios?template=<id>`; фронт уже рисует паспорт шаблона и примет серверный список без изменения UI (`scenarioTemplates.ts` → заменить на запрос).
- **Прогресс расчёта** `GET /api/runs/:id/progress` (или SSE): `RunProgress` принимает `{phase, progress}` теми же пропсами; сейчас — фронтовая оценка по N и операциям.
- **История прогонов Стадии 1 с параметрами**: `simulation/plans` + `kpi_series` не хранят правило, сценарий и пины → колонки «сценарий / правило / пины» из UX-V2 §4.5 пока отсутствуют; нужен `GET /api/runs?kind=schedule` (или `rule/scenario_id/pins` в `plans`).
- **Оценка распределений и норм**: `POST /api/params/:id/estimate` и импорт план-факта (`POST /api/planfact/import`) — до них кнопки «Оценить» честно отключены (R7/R20).
- **CRPS по изделиям**: `/api/forecast` отдаёт только MAPE и пинбол P10/P90; для настоящего CRPS/MASE нужен бэктест с квантильной сеткой (волна F/M TODO).
- **Касса из списка `#/plan`** при источнике «реестр заказов»: программа живёт в мастере → кнопка ведёт на шаг «Результат» мастера; с `run_id` работает прямо из списка.
- G3: экран «Касса» (`CashScreen`, лента водопада по неделям — плитки и транши уже есть), живой слой карты, анимация прохода, `forecastStore` (прогноз в состоянии карты), Lighthouse.
- G4: правило «RL» (сейчас отключено с подсказкой «волна 3»), `GuardrailsCard`/`AlphaSlider` как единый паспорт α, командная палитра, экспорт SVG; §4.7–4.10 — только зарезервировано место в шаге 5 (метод «RL»).

## 5. Файлы

Создано: `src/ui/{passportBadge.ts,passportBadge.test.ts,ProvenanceBadge.tsx,ParamField.tsx,PassportCard.tsx,Stepper.tsx,DiffList.tsx,
DateHoursInput.tsx,RunProgress.tsx,RegimeStrip.tsx,FanChart.tsx,DensityMini.tsx,fields.css}`;
`src/features/passport/passportStore.ts`; `src/features/finance/cashStore.ts`; `src/explain/metrics.cash.ts`;
`src/features/analytics/cashKpis.ts`; `src/features/plan/{Gantt,LoadBars,HeuristicModal,MrpTable,PlanResult,ResultToc,RunsTable,WhatDrove,CashTiles}.tsx`,
`src/features/plan/heuristicPresets.ts`; `src/features/plan/wizard/{wizardStore.ts,wizardStore.test.ts,dates.ts,dates.test.ts,useWizardData.ts,
runSchedule.ts,PlanWizard.tsx,wizard.css}`, `src/features/plan/wizard/steps/{Program,Conditions,Distributions,Constraints,Objective,Launch,Result}Step.tsx`,
`FinancialCard.tsx`; `src/features/scenarios/{regimeMenu.ts,regimeMenu.test.ts,scenarioTemplates.ts,ScenarioCreateDialog.tsx,RegimeMenuPanel.tsx,
ConditionsTab.tsx,DistributionsTab.tsx,ForecastTab.tsx,ScenarioCompare.tsx,ScenarioTabs.tsx,scenarios-v2.css}`; `docs/research/img/G2-*.jpg`; этот отчёт.

Изменено: `src/explain/{format.ts (+'нед'),metrics.ts,metrics.forecast.ts (forecast.crps),metrics.plan.ts (plan.objective_weights),metrics.test.ts}`,
`src/features/analytics/{kpiCatalog.ts,AnalyticsScreen.tsx}`, `src/features/method-map/{types,stateMeta,params,deriveInput,derivePassports,deriveValues,
deriveNodes,deriveState,nodes.flow,nodes.loops,edges,mapLayout,useMethodMapState}.ts`, `{MapEdges,PassportTable}.tsx`, `map.css`, тесты карты,
`src/features/optimization/{optStore.ts,OptimizationScreen.tsx,opt-screen.css}`, `src/features/plan/{PlanScreen.tsx,plan-screen.css}`,
`src/features/scenarios/ScenarioCompareScreen.tsx`, `src/shell/{router.ts (вложенные якоря),screens.tsx}`.
Не трогались: `backend/`, `rl/`, `src/brand`, `src/lib/api.ts`, версии.
