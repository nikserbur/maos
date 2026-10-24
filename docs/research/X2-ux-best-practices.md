# X2 — UX по лучшим практикам: единый план исправлений (PESCADITO v0.74.1)

> 2026-10-24. Ведущий дизайнер. Вход: аудиты экранов волны UX2 (скриншоты `docs/research/img/ux2/*.jpg`), прежний аудит `X1-ux-audit.md` и отчёты волн `G3a-plan.md`, `G3b-nsi-charts.md`, `G3c-charts-polish.md`, `G3d-tier2.md`, `G4-agents-ui.md`, `L1-mentat.md`. Также свод практик для класса приложений APS / системы поддержки решений / enterprise-UI / визуализация неопределённости / ИИ-ассистент / доступность (источники в §1.2).
>
> Вердикт владельца, на который отвечает план: «в целом красиво, но должно быть читаемо, логично, связно и в одной дизайн-системе; часть экранов перегружена; акценты перебалансировать; графики сделать заметно красивее; информацию систематизировать».
>
> Как собран план. Находки 10 аудитов объединены и очищены от дублей, затем распределены по владельцам файлов. Всё, что повторяется на нескольких экранах (токены, словари имён и состояний, KPI-плитка, примитивы графиков, крошки, URL-состояние, ошибки и пустые состояния, Esc-стек, доступность), собрано в группу **system** и исправляется один раз. В плане все пункты S1 и S2; пункты S3 — только дешёвые. Бэкенд C++ не трогается, RL не перезапускается (данные A2–A4 берутся из готовых снимков). «Портфель» — только полировка: логика и числа не меняются.

---

## 1. Источники и принципы

### 1.1 Принципы — планка для каждой группы

1. **Одно имя — одна вещь.** Экран, объект и показатель называются одинаково везде: в рельсе, верхней панели, заголовке, палитре, крошках, PipelineStrip, на карте и в MENTAT. Сырые идентификаторы API (`meanvariance`, `key_pp`, `time_limit`, `SAMPLE`) пользователь не видит: подписи идут только через общие словари (`shell/screens.tsx`, `explain/labels.ts`, `explain/format.ts`).
2. **Сначала ответ.** Экран результата открывается одной строкой вердикта и не более чем тремя главными числами, каждое рядом со своим риском. Первая цифра стоит не ниже ≈ 220 px при 1440×900, над сгибом не больше 14 чисел. Подзаголовок — одна строка до 140 знаков. Объяснения уходят в «i» или Методику.
3. **У цвета одна работа.** `--accent` — только для взаимодействия: primary, фокус, выбор. Статусные оттенки — только для отклонений, всегда с глифом и словом. Норма нейтральна, числа — цветом текста. Цвета блоков [1]–[8] — только на чипах, полосе и обводках. Охра ▲ означает только «цель / выбрано». Данные — палитрой `--chart-*`, отделённой от акцента. Вне графиков не больше трёх насыщенных оттенков.
4. **Один primary, и это следующий шаг конвейера.** В каждом регионе одна заливная кнопка, и она ведёт дальше: Сценарий → Портфель → План → Мониторинг. Опасные действия — danger-кнопки отдельно или в меню ⋯, с подтверждением, где названы объект и последствие. Primary не блокируется заранее: что не так, объясняем по нажатию.
5. **Конвейер виден и переживает перезагрузку.** У каждого результата указано происхождение (сценарий, прогон №, время, N), есть метка «устарело ▲», если входы изменились, и ссылка на следующий шаг. Всё, к чему хочется вернуться (вкладка, объект, прогон, фильтр), хранится в URL. F5 возвращает тот же вид.
6. **Неопределённость показывается честно.** Число Монте-Карло никогда не стоит одно: рядом названный интервал (охват; «разброс исходов» или «ДИ оценки»; N). Вероятности даём частотами («в 3 из 100 сценариев»). Качество модели сравниваем с номиналом и пишем простыми словами. В сравнениях — явная Δ к названной базе и доля побед.
7. **Таблицы вместо стен карточек.** Однородный набор больше 8 элементов — это kit DataTable: липкая шапка, человекочитаемый первый столбец, числа справа с единицами, сортировка, «N из M», top-N и ссылка «все N». Запись правится в немодальной боковой панели, список остаётся на виду.
8. **Честные состояния.** Загрузка, «пусто» (первый раз / ничего не найдено / недоступно) и ошибка — три разных состояния. Ошибка по-русски говорит, что случилось и что делать; сырой текст — за «Подробнее». Каждый оверлей и каждая панель — под своим ErrorBoundary. Иллюстративные данные никогда не выглядят как результат. Вместо «не рассчитано» не показываем «0».
9. **Безопасное изменение.** Правка — это черновик с «Отмена / Сохранить», предупреждением о несохранённом и отменой после записи. Никаких молчаливых записей в справочники, сценарий или граф. Сохранение не теряет ни одного поля (round-trip). ИИ и RL только предлагают, применяет человек.
10. **Доступно всем.** Фокус виден всегда, включая forced-colors. Esc закрывает только верхний слой. Цели — от 24 px. Контраст текста не ниже 4,5:1. Учитываем `prefers-reduced-motion`, у бесконечной анимации есть кнопка паузы. Все числа проходят через `format.ts`: десятичная запятая, минус U+2212, неразрывный пробел перед единицей.

### 1.2 Источники

**Планирование производства (APS), MES, сценарии**
- SAP Fiori — Gantt chart usage: https://www.sap.com/design-system/fiori-design-web/v1-148/ui-elements/gantt-chart/usage
- Oracle — планировщик производства (ASCP UI): https://docs.oracle.com/cd/E18727-01/doc.121/e13652/T321962T321975.htm
- LiveGantt (интерактивный Гант для расписаний): https://idclab.skku.edu/assets/LiveGantt.pdf
- Asprova — визуальное управление: https://www.asprova.com/en/asprova/modules/visual_management.html
- Asprova — загрузка оборудования и рабочих: https://lib.asprova.com/en/library/profits/323-load-equipment-workers.html
- Microsoft Dynamics AX — планирование производства: https://technet.microsoft.com/library/hh803027(v=ax.60)
- DELMIA Ortems — Manufacturing Planner: https://www.3ds.com/products/delmia/ortems/manufacturing-planner
- DELMIA — сценарии в Company Planner / MPS: https://3dswym.3dexperience.3ds.com/post/delmia-planning-optimization/scenarios-in-companyplanner-mps_htwKKNgHShOMjj35WfJsZA
- DELMIA Scheduling Analyst: https://3dswym.3dexperience.3ds.com/wiki/3dexperience-platform-user-s-community/delmia-scheduling-analyst_NzqnAZJhS3qQFZFPq18Zyw
- DELMIA Quintiq: https://www.3ds.com/products-services/delmia/products/delmia-quintiq/
- Kinaxis — Supply planning (брошюра): https://www.kinaxis.com/sites/default/files/resources/Kinaxis-Brochure-Supply-planning.pdf
- Kinaxis — S&OP: https://www.kinaxis.com/en/sop
- SAP PP/DS — справка: https://help.sap.com/doc/2e4fc95360267614e10000000a174cb4/1610%20002/en-US/0f4ec95360267614e10000000a174cb4.html
- SAP PP/DS — Alert Monitor: https://learning.sap.com/courses/exploring-advanced-production-planning-with-sap-s-4hana-pp-ds/explaining-the-alert-monitor-1
- PlanetTogether — what-if-сценарии: https://www.planettogether.com/aps/why-you-should-use-what-if-scenarios-in-production-planning
- PlanetTogether — возможности: https://www.planettogether.com/features
- Siemens Opcenter APS 2304: https://static.sw.cdn.siemens.com/siemens-disw-assets/public/4LThJGql1ue6mJNHAUcQhG/en-US/Siemens%20SW%20What%E2%80%99s%20new%20in%20Opcenter%20APS%202304%20Fact%20Sheet.pdf
- Odoo 18 — спецификации (BoM): https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html
- Odoo 18 — рабочие центры: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html
- ISA-101 HMI (Tatsoft): https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to
- Palantir Foundry — сценарии онтологии: https://palantir.com/docs/foundry/ontology/overview-ontology-scenario/
- Anaplan — стандарты дашбордов: https://community.anaplan.com/discussion/160760/design-standards-for-a-superior-user-experience-part-1-effective-dashboarding
- Исследования интерфейсов планирования: https://opus.bibliothek.uni-augsburg.de/opus4/files/128225/128225.pdf · https://dl.gi.de/items/4ed81e6c-ad42-4372-b52c-b49e7e5ae5c1/full

**Enterprise-UX и дизайн-системы**
- NN/g: https://www.nngroup.com/articles/complex-application-design/ · https://www.nngroup.com/articles/comparison-tables/ · https://www.nngroup.com/articles/wizards/ · https://www.nngroup.com/articles/dashboards-preattentive/ · https://www.nngroup.com/articles/progressive-disclosure/ · https://www.nngroup.com/articles/data-tables/ · https://www.nngroup.com/articles/ten-usability-heuristics/ · https://www.nngroup.com/articles/vertical-nav/ · https://www.nngroup.com/articles/breadcrumbs/ · https://www.nngroup.com/articles/the-power-of-defaults/ · https://www.nngroup.com/articles/progress-indicators/ · https://www.nngroup.com/articles/onboarding-tutorials/ · https://www.nngroup.com/articles/tooltip-guidelines/ · https://www.nngroup.com/articles/choosing-chart-types/
- SAP Fiori: https://www.sap.com/design-system/fiori-design-web/v1-148/foundations/best-practices/ui-elements/charts-vizframe/color-palettes/usage · https://www.sap.com/design-system/fiori-design-web/v1-142/page-types/page-layouts/flexible-column-layout/usage · https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-rail/usage
- IBM Carbon: https://carbondesignsystem.com/patterns/status-indicator-pattern/ · https://carbondesignsystem.com/components/button/usage/ · https://carbondesignsystem.com/data-visualization/legends/ · https://carbondesignsystem.com/data-visualization/dashboards/ · https://carbondesignsystem.com/data-visualization/chart-anatomy/ · https://carbondesignsystem.com/data-visualization/color-palettes/ · https://carbondesignsystem.com/components/data-table/usage/ · https://carbondesignsystem.com/patterns/empty-states-pattern/ · https://carbondesignsystem.com/patterns/notification-pattern/
- Siemens iX: https://ix.siemens.io/docs/styles/colors · https://ix.siemens.io/version-alpha/docs/components/kpi/code
- Atlassian: https://atlassian.design/components/button/usage · https://atlassian.design/foundations/color · https://atlassian.design/foundations/color/data-visualization-color
- GitHub Primer: https://primer.style/product/ui-patterns/saving/ · https://primer.style/product/components/page-header/ · https://primer.style/accessibility/patterns/keyboard-shortcuts/ · https://primer.style/product/ui-patterns/forms/ · https://primer.style/product/ui-patterns/loading/ · https://primer.style/product/ui-patterns/empty-states/
- GOV.UK — таблица: https://design-system.service.gov.uk/components/table/
- Microsoft Fluent 2: https://fluent2.microsoft.design/layout · https://fluent2.microsoft.design/typography
- Laws of UX: https://lawsofux.com/hicks-law/ · https://lawsofux.com/doherty-threshold/
- Vercel — Web Interface Guidelines: https://vercel.com/design/guidelines
- Linear — редизайн: https://linear.app/now/behind-the-latest-design-refresh · https://linear.app/now/how-we-redesigned-the-linear-ui
- Refactoring UI: https://www.refactoringui.com/previews/labels-are-a-last-resort · https://www.refactoringui.com/previews/building-your-color-palette
- M. Ström — плотность UI: https://mattstromawn.com/writing/ui-density

**Визуализация данных и неопределённости**
- C. Wilke — Visualizing uncertainty: https://clauswilke.com/dataviz/visualizing-uncertainty.html
- Bank of England — веерная диаграмма: https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1998/the-inflation-report-projections-understanding-the-fan-chart
- MU Collective / Hullman: https://mucollective.northwestern.edu/project/uncertainty-bus · https://mucollective.northwestern.edu/project/when-ish-is-my-bus · https://mucollective.northwestern.edu/projects · https://www.hullmanlab.northwestern.edu/paper/2020/02/01/visualizing-inferential-uncertainty.html
- Сравнения в визуализации (VisSnacks): https://pages.graphics.cs.wisc.edu/VisSnacks/papers/comparison
- Частотное представление риска (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC4646698/
- arXiv: https://arxiv.org/abs/2302.12389 · https://arxiv.org/abs/2301.07687
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/charting-data · https://developer.apple.com/design/human-interface-guidelines/charts
- Power BI — советы по дашбордам: https://learn.microsoft.com/en-us/power-bi/create-reports/service-dashboards-design-tips
- UK Analysis Function: https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/ · https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-colours-in-charts/
- Perceptual Edge (S. Few): https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf · https://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf · https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf
- Datawrapper: https://www.datawrapper.de/blog/text-in-data-visualizations · https://www.datawrapper.de/automatic-dark-mode
- Chartability: https://chartability.github.io/POUR-CAF/
- W3C — сложные изображения: https://www.w3.org/WAI/tutorials/images/complex/
- Внутренний стандарт dataviz (локальная копия навыка): `/private/tmp/claude-501/bundled-skills/2.1.299/99294346fb731dd675fb722f0ac078eb/SKILL.md`, `…/references/anti-patterns.md`, `…/references/marks-and-anatomy.md`, `…/references/interaction.md`, `…/references/components.md`, `…/references/color-formula.md`, `…/references/choosing-a-form.md`, `…/dataviz/references/choosing-a-form.md`, `…/dataviz/references/marks-and-anatomy.md`, `…/dataviz/references/anti-patterns.md`, `…/dataviz/references/color-formula.md`

**ИИ-ассистенты и объяснимость**
- Google PAIR: https://pair.withgoogle.com/chapter/explainability-trust/ · https://pair.withgoogle.com/chapter/mental-models/
- Microsoft HAX: https://www.microsoft.com/en-us/haxtoolkit/library/ · https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-how-well-the-system-can-do-what-it-can-do/

**Доступность**
- WCAG 2.2 Understanding: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html · https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html · https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html · https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html · https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html · https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html · https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- WCAG техника C40: https://www.w3.org/WAI/WCAG22/Techniques/css/C40
- MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors · https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Apple HIG — Dark mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode

Идентификаторы правил (`aps-*`, `decision-*`, `dataviz-*`, `enterprise-*`, `a11y-ai-*`) в каждом пункте плана — это свод практик из этих источников. Каждое правило содержит проверку, которую можно сделать по скриншоту или коду.

---

## 2. Находки по экранам

Ниже кратко по каждому экрану: что сохранить и главные дефекты со ссылками на пункты плана (§3).

### 2.1 Шелл и вход
- **Сохранить.** Рельса с подписями и шестью группами методологии. Hash-роутер с глубокими ссылками. Ошибка внутри экрана не роняет шелл. Палитра команд с корректным ARIA. Тихая верхняя панель. Честный MENTAT («модель не подключена», показ промпта). Брендовый экран входа.
- **Главное.** Открытие MENTAT после кассы со статусом `time_limit` стирает всё приложение → P-01, P-119. У одного экрана до трёх имён, доступное имя пункта рельсы расходится с видимым → P-02. PipelineStrip есть только на 4 экранах, ведёт на карту, а не к экрану-владельцу, и красит тревогу без видимой причины → P-03, P-04, P-120. F5 требует нового входа, 401 молча перезагружает страницу → P-12. MENTAT сжимает рабочую область и теряет черновик, Esc закрывает не тот слой → P-13, P-130. Стадийные пилюли в рельсе выглядят как счётчики; акцент совпадает с серией 1 графиков → P-14, P-08. StatusBar повторяет имя экрана и не показывает фоновые задачи → P-15. Хлебных крошек нет → P-10. Вход прячет недоступный сервер → P-17.

### 2.2 Схема предприятия
- **Сохранить.** Одна полоса режимов. Тёмная подложка карты. Глифы и «спокойные» кольца по ISA-101. Токены в 3D. Замкнутый цикл «симуляция → калибровка справочников».
- **Главное.** 3D декоративен: у всех цехов «В работе», нет загрузки и связи с планом → P-27. Статусы противоречат друг другу («Авария» и «Техобслуживание» у одного станка) → P-28. Режимы, которые на мировом уровне ничего не делают; панель симуляции спорит с инспектором → P-29. Тихие записи в справочники без подтверждения и отмены → P-30. Чёрный экран после возврата из цеха → P-31. Инспектор без навигации → P-32. Дубли навигации и глобальные клавиши → P-33. Подписи ≈ 8 px → P-34. Выдуманная точка на карте мира → P-35. Цвет и плотность симуляции → P-36, P-37. Состояние не попадает в URL → P-38. Бесконечная анимация → P-39. Ультрамарин на данных → P-40.

### 2.3 Справочники (НСИ) и конструктор техкарты
- **Сохранить.** Kit ScreenHeader с одним primary. Реестр в URL. Техкарта — отдельный маршрут со Cmd/Ctrl+S. Kit DataTable с группами. Понятные сообщения валидации. Чистые токены.
- **Главное.** Сохранение техкарты теряет PERT-разброс и входы и молча делает альтернативу действующей → P-42. Правка операции стирает связи; на кнопке правки написано «Создать» → P-43. Не видно, какая техкарта действует, а 404 открывается как пустой редактор → P-44. Справочники — остров: нет влияния и ссылок → P-45. Реестры перегружены и местами показывают неверные числа → P-46…P-49. Правка идёт в огромном модале → P-50. Конструктор: мелкий текст, конфликт глифов, обрезанный инспектор → P-51, P-52, P-54. Ошибки загрузки выдаются за пустоту → P-53. Навигация и счётчики → P-55.

### 2.4 Сценарии и Мониторинг
- **Сохранить.** Список и деталь на одном экране, сравнение как режим. Автосохранение. Последствие у каждого поля. Критерий в одном месте. Шаблоны с паспортом. Прогноз начинается с качества. Скелет веера.
- **Главное.** Экран показывает не те значения, что считает движок (35 % против 60 %, ρ = 0 превращается в 0,5), бейджи врут → P-56. Просмотр сценария молча меняет рабочий сценарий; состояния нет в URL → P-57. Нет следующего шага; мёртвый код → P-58. Сравнение вводит в заблуждение → P-59. Редактор распределения открывается за пределами экрана → P-60. Δ на веере противоречит самому графику → P-61. Данные и тексты не готовы к защите → P-62. «Мониторинг» — копия прогноза, а не монитор, и не подключён к конвейеру → P-63, P-64, P-121. Веера завышают уверенность → P-65. Перегруженные шапка, «Условия», «Прогноз», таблица распределений, цвета → P-66…P-71.

### 2.5 Портфель (только полировка)
- **Сохранить.** Порядок героя. Карточка «Для сравнения» с направленной Δ. Анатомия гистограммы CVaR. Эталонный Парето. «i» с подстановкой. `format.ts` везде. Наследование из сценария. Хранилище результата.
- **Главное.** «σ прибыли» отображается как «Σ ПРИБЫЛИ» → P-72. Ложная тревога «переобучение» → P-73. «Состав» смешивает две величины → P-74. Цвета сущностей перепутаны между графиками → P-75. Слабая передача в План → P-76. После F5 результат пропадает, происхождения нет → P-77. Иерархия, вердикт, цвета, гистограмма, «i», параметры, LP, Парето, имена → P-78…P-86.

### 2.6 План
- **Сохранить.** Хранилище планов (переживает F5), сводка запуска с DiffList, ярусы KPI, сортированная загрузка, группировка Ганта, клавиатура, MovesPanel до/после, A/B прогонов.
- **Главное.** У результата два дома, и URL не идентифицирует прогон → P-87. Провал кассы показан как идеальный результат → P-88. История противоречит себе и почти не открывается → P-89. Один прогон с разными временем и номером → P-90. Иллюстративные ходы выглядят как результат → P-91. Узкое место, оглавление, Гант, цвета, мастер, KPI → P-92…P-100.

### 2.7 Агенты
- **Сохранить.** Честная формулировка, общий кит, `format.ts`, глиф и слово в вердикте ДИ, образцовый α, видимое происхождение снимка, чистые тестируемые модели данных.
- **Главное.** Экран рассказывает устаревшую историю (A1) и расходится с MENTAT; «правило из RL» нигде не показано → P-101. Нечитаемый герой с вырожденной полосой ДИ → P-102. Полномочия, которые ничего не делают, и скрытая глобальная запись α → P-103. Архитектура, дубли, цвет, таблицы, тексты, шаг, акцент → P-104…P-110.

### 2.8 Аналитика
- **Сохранить.** Один ряд фильтров. Числа цветом текста. Реестр показателей как DataTable. «Узкие места» с Meter. Двойники-таблицы. Набор дашборда в БД.
- **Главное.** Инвестпроект отбрасывает вердикт движка (CRN) и начинает со случайного типа → P-111. Ложная пустота во время загрузки, ответ не первым → P-112. Плитки отличаются от Плана → P-113. Статусный цвет на норме → P-114. Малоинформативные графики → P-115, P-116. Нет URL-состояния → P-117.

### 2.9 Карта методологии и Методика
- **Сохранить.** Чистое выведение состояния с тестами. URL узла. Клавиатурная модель. Затемнение по фокусу. Цепочка «KPI → формула → параметр → экран». Лонгрид Методики. Эталонный рисунок CVaR.
- **Главное.** Таймаут LP показан как две жёсткие ошибки на английском → P-120. Граница «реализовано / в плане» отстала на 16 версий, главного результата диссертации нет → P-122. Ссылки идут только в одну сторону → P-123. Глифы и цвета значат разное → P-124. Наложение подписей рёбер → P-125. Панель сжимает граф → P-126. Многоточия и цветной текст → P-127, P-128. Сырые id и одинокие числа → P-129.

### 2.10 AI-воркфлоу и Администрирование
- **Сохранить.** Журнал на DataTable с группами по дням. Компактная колонка пользователей и ролей. Зависимое поле «Цех». Общий движок GraphCanvas. Иммутабельные правки графа. Валидированное хранилище.
- **Главное.** Журнал не отвечает «кто что изменил» → P-133. Ошибка выдаётся за пустоту → P-134. «Очистить» без подтверждения и отмены → P-135. AI-воркфлоу — сирота, расходится с MENTAT → P-136. Узлы, холст, раскладка, колонки, безопасность, права, правка пользователей, рёбра → P-137…P-145.

---

## 3. План по группам

### 3.0 Порядок работ и зависимости

1. **Фундамент (system, сначала):** P-05 (форматтер), P-06 (словарь подписей), P-07 (словарь состояний), P-08 (роли цвета), P-09 (KpiTile / DeltaChip / CapsLabel), P-10 (крошки и шапка), P-11 (URL-состояние и защита ухода), P-16 (ошибки, пустые состояния, загрузка), P-18 и P-19 (графики), P-20 (цвет сущности), P-21 (GraphCanvas), P-22 (SidePanel / UndoToast), P-23 (DataTable), P-24 (фокус и движение). Экранные группы опираются на них.
2. **Затем все S1:** P-01…P-04 и S1 каждой группы.
3. **Затем S2 по группам, в конце S3.** P-26 (охранные тесты) вводится сразу со списком текущих нарушений; каждая группа этот список сокращает, к концу волны он пуст.

Межгрупповые зависимости: P-02 → P-55, P-63, P-86, P-136, P-139 · P-05 → P-87, P-89, P-90, P-113, P-118 · P-06 → P-59, P-65, P-86, P-97, P-120, P-129 · P-07 → P-56, P-124 · P-09 → P-59, P-99, P-113 · P-10 → P-33, P-55, P-66, P-87, P-128 · P-13 → P-33, P-130 · P-18 → P-61, P-65, P-69 · P-19 → P-85, P-100, P-102, P-106, P-116 · P-20 → P-36, P-95 · P-21 → P-51, P-126, P-137, P-138 · P-22 → P-50, P-60, P-133, P-143 · P-24 → P-17, P-39, P-131 · P-38 → P-45, P-92, P-117 · P-64 → P-121.

Решения владельца (в коде не делать без подтверждения): P-49 (удалить три тестовые записи рабочих через «Уволить»), P-62 (переименовать или удалить демо-сценарии), P-42 (зависимость от бэкенда: GET `/api/routings/:id` должен отдавать `operation_inputs`), P-81 (смена биннинга отображения гистограммы).

### 3.1 system — шелл, кит, токены, графики (исправляется один раз)

#### P-01 · S1 · Оверлеи MENTAT и палитры под собственным ErrorBoundary
- **Исправление.** В `AppShell.tsx` обернуть `<MentatPanel>` и `<CommandPalette>` в `<ErrorBoundary key="mentat|palette" variant="panel">`. Вариант `panel` в `ErrorBoundary.tsx` сохраняет боковую панель 480 px с кнопкой «Закрыть» и пишет «MENTAT не смог собрать контекст этого экрана — закройте панель или повторите», рядом кнопка «Повторить» (сбрасывает boundary). В обоих вариантах заглушки сырой `error.message` уходит в `<details>Подробнее</details>`. Текст — `--text-secondary`, состояние показывает глиф ✕ вместо красного моно-текста `.screen-error__msg`. Причина самого падения устраняется в P-119.
- **Файлы.** `src/shell/AppShell.tsx`, `src/shell/ErrorBoundary.tsx`, `src/shell/shell.css`
- **Приёмка.** Искусственный `throw` в `buildContext` открывает заглушку панели; рельса, TopBar и экран живы, `#root` не пуст. На тексте заглушки нет `--intent-danger`; сырой текст виден только в «Подробнее».
- **Правила.** enterprise-errors-plain-and-local, a11y-ai-18, decision-assistant-scope-and-grounding

#### P-02 · S1 · Одно каноническое имя у каждого экрана
- **Исправление.** `label` в `screens.tsx` — каноническое имя. TopBar, палитра, `document.title` и ScreenHeader берут его без изменений через новую функцию `screenTitle(id)`. `short` может только сокращать имя. Изменения: optimization — `label` «Портфель», ключевые слова палитры «оптимизация, optimization, робастный»; aiflow — `label` и `short` «AI-воркфлоу»; nsi — `label` «Справочники», `short` «НСИ» (явный allow-list). В `NavRail` убрать `aria-label={hint}` и `aria-hidden` с видимой подписи, чтобы доступное имя совпало с видимым; подсказку стадии подключить через `aria-describedby` к визуально скрытому span. Добавить `screens.test.ts`: `short` — префикс `label` либо в allow-list. Заголовки экранов переходят на `screenTitle` в P-55, P-63, P-86, P-136, P-139.
- **Файлы.** `src/shell/screens.tsx`, `src/shell/NavRail.tsx`, `src/shell/useCommandItems.ts`, `src/shell/screens.test.ts` (новый)
- **Приёмка.** На всех 12 экранах подпись рельсы, TopBar, ScreenHeader и `document.title` совпадают (исключение «НСИ» / «Справочники» в allow-list). Доступное имя каждой ссылки рельсы начинается с её видимого текста (WCAG 2.5.3). Тест зелёный.
- **Правила.** enterprise-one-name-per-destination, enterprise-screen-header-contract, decision-consistent-screen-anatomy, enterprise-rail-labelled-grouped

#### P-03 · S1 · PipelineStrip ведёт к экрану-владельцу блока и показывает происхождение
- **Исправление.** Создать `src/shell/blockHome.ts` с картой `BLOCK_HOME`: external → scenarios; distributions → `scenarios/<id>/distributions`; internal → nsi; decisions → optimization; criteria → plan; agents → agents; monitoring → monitoring; llm → `overlayActions.openMentat()`. Клик по ячейке открывает экран-владелец; ячейки текущего экрана ведут на `#/map/<block>`; подсказка заканчивается ссылкой «на карте ↗». Включить `pipeline: true` у nsi, agents, analytics. Текст «Карта ↗» заменить сегментом происхождения из `useDecisionContext` + `optStore`/`planStore`: «Базовый · портфель 17:02 · план №28 · 17:38», каждая часть — ссылка. Если вход новее зависимого результата (сценарий › портфель › план), рядом ▲ «устарело». Ссылка на карту становится IconButton «Открыть на карте».
- **Файлы.** `src/ui/PipelineStrip.tsx`, `src/ui/pipeline.css`, `src/shell/blockHome.ts` (новый), `src/shell/screens.tsx`, `src/shell/context.ts`
- **Приёмка.** На Плане клик по [2] открывает «Сценарии › Распределения», по [4] — Портфель. Полоса есть на 7 экранах. Сегмент происхождения кликабелен. После правки сценария появляется «портфель ▲ устарело».
- **Правила.** aps-connected-pipeline, enterprise-connected-flow, decision-connected-lineage, aps-state-persistence

#### P-04 · S1 · Ячейка PipelineStrip называет причину, а не красит тревогу
- **Исправление.** Для состояний error, stale и unconfigured вторая строка ячейки — `${label}: ${detail ?? reason}` (например «▲ устарело: касса — лимит времени LP») вместо основного бейджа. Удалить `.is-error .pstrip__badge { color: var(--status-down) }`: текст остаётся `--text-secondary`, состояние несёт глиф (для ошибки ✕ из P-07). Фон текущей ячейки — `var(--bg-card)`; цвет блока только на номере и подчёркивании 2 px. Задать `.shell__content { container-type: inline-size }`, а медиазапросы 1279/820 px в `pipeline.css` заменить на `@container`, чтобы пристыкованный MENTAT не обрезал бейджи.
- **Файлы.** `src/ui/PipelineStrip.tsx`, `src/ui/pipeline.css`, `src/shell/shell.css`
- **Приёмка.** После кассы со статусом `time_limit` видна одна ячейка ▲ с текстом причины и без красного текста. В оттенках серого ошибка (✕) отличается от «вручную» (■). При открытом MENTAT в бейджах нет «…».
- **Правила.** aps-status-not-color-alone, decision-one-state-vocabulary, enterprise-color-one-meaning, decision-calm-normal-color, a11y-ai-12

#### P-05 · S1 · Форматтер: серверное время в UTC, единая подпись прогона, недостающие помощники
- **Исправление.** В `format.ts` функция `toDate` читает строку без зоны `YYYY-MM-DD HH:MM:SS` как UTC (дописывает «Z»). Добавить:
  - `runLabel({seq,id,rule,createdAt})` → «План №28 · CR · 24.10 17:38» (никогда не хеш);
  - `dateTimeShort` («24.10 14:38»), `time`;
  - `plural(n, forms)` — перенести из `plan/wizard/dates.ts`, там оставить реэкспорт;
  - `rangeText(lo, hi, unit)`: «54–86,7 тыс. ₽», а со знаком «от −150 до −50 млн ₽»;
  - `bp(x)` — базисные пункты; `pp(Δ)` — п. п.;
  - `freqText(p)` — «в 3 из 100».

  На каждую функцию тесты, включая U+2212 и неразрывный пробел.
- **Файлы.** `src/explain/format.ts`, `src/explain/format.test.ts`, `src/features/plan/wizard/dates.ts`
- **Приёмка.** Один прогон (после внедрения в группах) показывает 14:38 в шапке Плана, в RunsTable и в Аналитике. Тесты покрывают разбор UTC, `plural` для 1/2/5/21, диапазоны со знаком и `freqText`.
- **Правила.** enterprise-numbers-first-class, a11y-ai-12, a11y-ai-13, decision-frequency-framing, aps-connected-pipeline

#### P-06 · S2 · Общий словарь доменных подписей `src/explain/labels.ts`
- **Исправление.** Создать модуль:
  - `objectiveLabel(id, 'short'|'long')`: meanvariance «E − λ·σ» / «среднее − риск (E − λ·σ)», cvar «CVaR», worstcase «худший случай», minregret «мин. сожаление»;
  - `ruleLabel`: auto — «авто (лучшее правило)», для EDD, CR и других — человекочитаемые имена;
  - `macroVarLabel`: key_pp «ключевая ставка», cpi_yoy_pp «инфляция», usd_rub «курс $/₽»;
  - `financingLabel`: recourse «по факту», first «график заранее»;
  - `fitLabel(fit)`: normal без ν, Стьюдент с ν, `empirical_blocks` — «эмпирическое (блочный бутстреп)», по умолчанию «другое распределение»;
  - `lpStatusLabel`.

  Неизвестный id даёт очеловеченную подпись и предупреждение в консоли в dev-режиме. Тест: ни одна функция не возвращает сырой латинский или snake-id. Внедрение в группах: P-59, P-65, P-86, P-97, P-120, P-129.
- **Файлы.** `src/explain/labels.ts` (новый), `src/explain/labels.test.ts` (новый)
- **Приёмка.** В видимом тексте мастера плана, карты и сравнения сценариев нет `meanvariance`, `key_pp`, `empirical_blocks`. Тест зелёный.
- **Правила.** enterprise-one-name-per-destination, aps-kpi-vocabulary, aps-connected-pipeline, decision-one-state-vocabulary

#### P-07 · S2 · Один словарь состояний и происхождения
- **Исправление.** Создать `src/ui/stateVocabulary.ts` — единственный источник состояний.
  - Происхождение: ● оценено по данным (калибровка и наблюдение уходят в подсказку), ◆ норматив, ■ вручную, ○ по умолчанию (поглощает «для UI» и «код»), ▲ устарело / синтетика.
  - Расчёт: ✕ ошибка, ◌ не задано.
  - «В плане» — не глиф, а пунктирная рамка и текстовый чип «в плане · волна N».

  Слова везде одинаковые. Изменения в смежных модулях:
  - `passportBadge.ts`: SPECS выводятся из словаря, синтетика получает ▲;
  - `StateLegend`: принимает `present` и показывает только присутствующие на экране состояния словами бейджей;
  - правила `.mm-glyph` переезжают из `method-map/map.css` в глобальный `styles/glyphs.css`, туда же добавляется глиф ✕;
  - `ProvenanceBadge`: значение `manual` побеждает `status`.

  Карта переходит на словарь в P-124.
- **Файлы.** `src/ui/stateVocabulary.ts` (новый), `src/ui/passportBadge.ts`, `src/ui/StateLegend.tsx`, `src/ui/ProvenanceBadge.tsx`, `src/styles/glyphs.css`, `src/features/method-map/map.css` (только перенос `.mm-glyph`), `src/ui/passportBadge.test.ts`
- **Приёмка.** При первой загрузке (без захода на карту) легенда Сценариев показывает глифы. На экране не больше 6 стилей бейджей. Поле, заданное вручную, никогда не показывает «◆ НОРМАТИВ». Ни один глиф внутри семейства не означает двух состояний.
- **Правила.** decision-one-state-vocabulary, enterprise-defaults-with-provenance, aps-status-not-color-alone, enterprise-color-one-meaning

#### P-08 · S2 · Роли цвета: акцент ≠ данные ≠ идентичность блока
- **Исправление.**
  - **Токены, обе темы (`tokens.css`).** `--ultramarine`/`--block-2` больше не равны `--accent`: снизить хрому до ≈ 0,14. `--chart-1` развести с акцентом: |Δh| ≥ 30° или |ΔL| ≥ 0,12. Например, тёмная тема `oklch(0.70 0.13 258)`, светлая `oklch(0.64 0.15 250)`. Обе темы проверить `validate_palette.js` на реальной поверхности `--bg-card`.
  - **Метки данных и хром.** `.ch-range__dot` перевести на `--chart-1`. Неинтерактивные заливки `var(--ultramarine)` в `shell.css` и в `auth.css .login__g--sys` сделать нейтральными или в стиле блок-чипа.
  - **Stepper.** Текущий шаг отмечается `--accent`, цвет блока остаётся только на чипе [n].
  - **Правило.** Статусные оттенки никогда не заливают метки данных.
  - **Тест.** Добавить `tokens.test.ts`, который проверяет разведение accent / chart-1 и полосы L/C категориальной палитры.
- **Файлы.** `src/styles/tokens.css`, `src/styles/tokens.test.ts` (новый), `src/ui/charts/charts.css`, `src/ui/charts/palette.ts`, `src/shell/shell.css`, `src/features/auth/auth.css`, `src/ui/Stepper.tsx`, `src/ui/fields.css`
- **Приёмка.** Тест зелёный, валидатор возвращает 0 в обеих темах. На экране в покое ультрамариновые только primary-кнопка, кольцо фокуса и выбранный пункт рельсы. Первая серия графика заметно отличается от кнопки.
- **Правила.** dataviz-color-jobs-disjoint, decision-calm-normal-color, enterprise-color-one-meaning, dataviz-dark-mode-selected-validated, a11y-ai-11

#### P-09 · S2 · В ките: KPI-плитка, Δ-чип и безопасные капс-подписи
- **Исправление.** Перенести `Tile` и `TailStrip` из `plan/kpiParts` в `src/ui/kit` как `KpiTile` и `TailStrip`. Анатомия `KpiTile`: подпись · значение · единица · глиф и слово · Δ к названной базе · интервал или RangeStrip; обязательный `metric` id, который находится в `src/explain/metrics.*`. Добавить `DeltaChip({value, unit, better:'high'|'low', base})`: минус U+2212, ▲▼, тон по направлению × «что лучше», подпись базы «к №27». Экспортировать `CapsLabel` (через `splitGreek`) из кита и использовать в eyebrow `ScreenHeader`, заголовке `Section` и подписи `KpiTile`. `DiffList` рисует `DeltaChip` в ячейке и сравнивает переданные эффективные значения. Удалить цветовые правила `.is-best`/`.is-worst` в `ui/fields.css`. `plan/kpiParts` реэкспортирует из кита, чтобы сборка не ломалась.
- **Файлы.** `src/ui/kit/KpiTile.tsx` (новый), `src/ui/kit/DeltaChip.tsx` (новый), `src/ui/kit/index.ts`, `src/ui/kit/ScreenHeader.tsx`, `src/ui/DiffList.tsx`, `src/ui/fields.css`, `src/ui/ParamField.tsx`, `src/ui/labelParts.test.ts`, `src/features/plan/kpiParts.tsx` (реэкспорт)
- **Приёмка.** Кит экспортирует `KpiTile`, `TailStrip`, `DeltaChip`, `CapsLabel`. «σ прибыли» в любом капс-контексте остаётся σ, а не Σ (тест). В `fields.css` у `.is-best` нет цвета.
- **Правила.** aps-kpi-vocabulary, dataviz-kpi-needs-comparator, decision-explicit-delta-vs-baseline, decision-never-lone-point

#### P-10 · S2 · Хлебные крошки и контракт шапки экрана
- **Исправление.** Kit `Breadcrumbs` строится из `useHashRoute`; у экрана может быть резолвер `ScreenDef.crumbs?(anchor)`. Последняя крошка — `<span aria-current="page">`, разделитель ›, строка не переносится (средние крошки сокращаются многоточием), родительские крошки — `<a href>`. TopBar показывает крошки вместо `.topbar__screen`; на экранах верхнего уровня — только название. `ScreenHeader` получает:
  - вариант `compact` (eyebrow и заголовок в одну строку, ≤ 56 px) для маршрутов результата и детали;
  - слот `provenance` (чип справа от заголовка);
  - подзаголовок в одну строку (clamp 1 + `title`).

  На экранах с `pipeline: true` шапка не рисует блок-чипы. Локальные крошки мигрируют в P-33, P-55, P-128.
- **Файлы.** `src/ui/kit/Breadcrumbs.tsx` (новый), `src/ui/kit/ScreenHeader.tsx`, `src/ui/kit/index.ts`, `src/ui/kit/kit.css`, `src/shell/TopBar.tsx`, `src/shell/screens.tsx`
- **Приёмка.** На `#/nsi/routing/<id>` в TopBar одной строкой «Справочники › Техкарты › ТК …», родитель кликабелен. В шапке Плана нет чипов [3][4][5]. Высота ScreenHeader ≤ 64 px.
- **Правила.** enterprise-breadcrumbs-for-depth, enterprise-screen-header-contract, enterprise-quiet-chrome, aps-display-hierarchy

#### P-11 · S2 · URL хранит состояние; защита от ухода с несохранённым
- **Исправление.** В `router.ts` добавить `useHashParams()` и `setHashParams(patch, {replace})` для query (`#/admin?type=errors&q=…`), а также помощники для якорей. В `screens.tsx` объявить якоря:
  - scheme: `<factoryId>/<shopId>?sel=`;
  - scenarios: `<scenarioId>/<tab>` и `compare/<ids>`;
  - plan: `run/<id>[/<section>]` и `new/<step>`;
  - agents: `<tab>`;
  - analytics: `<tab>[/<planId>]`.

  Добавить `useLeaveGuard(dirty, message)` — перехват роутера и `beforeunload`. Его используют формы Справочников, конструктор техкарты, поля сценария и финансовая карточка мастера.
- **Файлы.** `src/shell/router.ts`, `src/shell/screens.tsx`, `src/shell/useLeaveGuard.ts` (новый), `src/shell/router.test.ts` (новый)
- **Приёмка.** Unit-тест прогоняет параметры туда и обратно. Если изменить техкарту и кликнуть другой пункт рельсы, появляется «Есть несохранённые изменения — уйти?». Перезагрузка на любом объявленном якоре восстанавливает вид (проверяют группы).
- **Правила.** enterprise-url-is-state, aps-state-persistence, enterprise-save-and-undo

#### P-12 · S2 · Сессия переживает F5; истечение — модально, без потери экрана; меню аккаунта
- **Исправление.**
  - `App.tsx`: `useState(() => Boolean(токен в sessionStorage))`; один раз проверить сессию (GET `/api/health` или `/auth/me`), на 401 вернуть экран входа.
  - `api.ts`: на 401 генерировать событие `session-expired` вместо `window.location.reload()`.
  - `AppShell`: по этому событию открыть kit Modal «Сессия истекла — войдите снова, открытый экран сохранится» с формой входа; React-состояние сохраняется.
  - TopBar справа: меню аккаунта «admin · Администратор», «Проект: maos», «Сменить проект…», «Выйти». «Выйти» очищает сессию и открывает вход с выбранным проектом.
  - Текст «пользователь · проект» в StatusBar открывает это же меню.
- **Файлы.** `src/App.tsx`, `src/lib/api.ts`, `src/shell/AppShell.tsx`, `src/shell/TopBar.tsx`, `src/shell/StatusBar.tsx`, `src/shell/session.ts`
- **Приёмка.** F5 на `#/plan/run/<id>` не показывает вход. После перезапуска бэкенда появляется модал, черновик мастера переживает повторный вход. «Выйти» возвращает на экран входа.
- **Правила.** aps-state-persistence, enterprise-url-is-state, enterprise-errors-plain-and-local, enterprise-save-and-undo

#### P-13 · S2 · Стек Esc и MENTAT без сжатия рабочей области
- **Исправление.** В `overlays.ts` — стек `useEscapeLayer(id, onClose, active)`; Esc закрывает самый внутренний слой: подсказка → меню → палитра → боковая панель / модал → MENTAT. События с `e.defaultPrevented` игнорируются; первый Esc в textarea или select только снимает фокус. В стек встают InfoTip, Menu, CommandPalette и Modal; MentatPanel — в P-130, сцена — в P-33. В `shell.css` MENTAT пристыковывается только при ширине от 1600 px, ширина панели — `clamp(360px, 30vw, 480px)` в переменной `--mt-w`. От 1280 до 1599 px панель лежит поверх без отступа, у основных скролл-контейнеров `scroll-padding-right: var(--mt-w)`. `AppShell` держит MentatPanel смонтированной и закрытой (обёртка `hidden` + `inert`), чтобы вопрос, шаблон, вкладка и ответ сохранялись.
- **Файлы.** `src/shell/overlays.ts`, `src/shell/AppShell.tsx`, `src/shell/shell.css`, `src/ui/InfoTip.tsx`, `src/ui/kit/Menu.tsx`, `src/ui/CommandPalette.tsx`, `src/shell/Modal.tsx`
- **Приёмка.** При 1440 px открытый MENTAT на Плане не вызывает горизонтального переполнения `.plan`. Esc в палитре закрывает только палитру. После закрытия и открытия MENTAT набранный вопрос на месте.
- **Правила.** a11y-ai-04, a11y-ai-08, enterprise-keyboard-and-focus, decision-assistant-scope-and-grounding

#### P-14 · S2 · Рельса: без «счётчиков» стадий, подписи групп читаемы
- **Исправление.** Не рисовать `.rail__badge--s1/--s2`: стадия уже есть в eyebrow шапки. Место бейджа оставить только для настоящих счётчиков (например, числа устаревших ▲, нейтрально). Подписи групп — `--fs-11`, `--text-muted`, без `aria-hidden`. Каждая группа — `<div role="group" aria-labelledby="rail-g-<id>">`.
- **Файлы.** `src/shell/NavRail.tsx`, `src/shell/shell.css`, `src/shell/screens.tsx`
- **Приёмка.** В рельсе нет залитых пилюль. Контраст подписей групп ≥ 4,5:1. Скринридер объявляет 6 групп.
- **Правила.** enterprise-quiet-chrome, aps-accent-budget, enterprise-rail-labelled-grouped, a11y-ai-01

#### P-15 · S2 · StatusBar: спокойная норма, фоновые задачи, худшее исключение, версия из package.json
- **Исправление.**
  - **Связь.** В покое «Сервер: на связи» в `--text-muted` с нейтральным глифом. Без связи — «■ Нет связи с сервером · Повторить»; цвет только на глифе.
  - **Убрать «Экран: …».**
  - **Чип задачи.** Пока идёт Монте-Карло плана, поиск портфеля, CP-SAT или LP кассы, показывать чип из `planStore`/`optStore`/`cashStore`, например «План: сценарий 312 из 1000 · Отменить», со ссылкой на экран задачи.
  - **Чип худшего исключения.** Один чип из `useMethodMapState`: «✕ 1 ошибка» или «▲ 2 устарело»; клик открывает экран-владелец блока (`BLOCK_HOME`).
  - **Версия.** В `vite.config.ts` задать `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`, объявить в `vite-env.d.ts` и использовать в StatusBar и на экране входа.
- **Файлы.** `src/shell/StatusBar.tsx`, `src/shell/shell.css`, `src/features/auth/LoginScreen.tsx`, `vite.config.ts`, `src/vite-env.d.ts`
- **Приёмка.** Литерала версии в `src` нет. В покое в строке нет зелёного. Если запустить план и перейти в Сценарии, виден чип задачи с отменой.
- **Правила.** aps-exceptions-inbox, enterprise-loading-and-progress, decision-calm-normal-color, enterprise-quiet-chrome

#### P-16 · S2 · Ошибки, пустые состояния и загрузка — один механизм кита
- **Исправление.**
  - **Тексты ошибок.** `errorText(e)` сопоставляет коды с понятными фразами:

    | Ошибка | Текст |
    |---|---|
    | 401 | «Неверный логин или пароль» (при входе) / «Сессия истекла» |
    | 403 | «Нет прав на это действие» |
    | 404 / «not found» | «Объект не найден» |
    | 5xx | «Ошибка сервера — повторите» |
    | сеть / «Failed to fetch» | «Сервер недоступен — проверьте, что запущен maos-server» |

    `ErrorBanner` и `InlineError` показывают этот текст, ссылку «Подробнее» (сырой текст) и, если нужно, «Повторить».
  - **Пустые состояния.** `EmptyState` получает `kind: 'first-use'|'no-results'|'unavailable'` (no-results с кнопкой «Сбросить фильтры») и `quiet` — без фона-«авроры».
  - **Скелетоны.** `Skeleton`/`SkeletonRows` появляются через 150 мс, держатся не меньше 300 мс, высота строки — как у итоговой.
  - **Графики.** В `ChartFrame`/`Cartesian`: `empty = isEmpty && !loading`. Загрузка без данных — скелет сетки зарезервированной высоты. Перезагрузка с данными — прежний кадр с прозрачностью 0,55 и пометкой «пересчитывается» (`.is-refetching`).

  Тесты на vitest.
- **Файлы.** `src/ui/kit/States.tsx`, `src/ui/kit/kit.css`, `src/ui/charts/ChartFrame.tsx`, `src/ui/charts/Cartesian.tsx`, `src/ui/charts/charts.css`, `src/ui/charts/charts.test.tsx`
- **Приёмка.** При `loading=true` и пустых рядах `.ch-empty` не рендерится (тест). При остановленном бэкенде на экране один понятный баннер (проверяют группы). «Failed to fetch» нигде не виден.
- **Правила.** enterprise-errors-plain-and-local, enterprise-designed-empty-states, enterprise-loading-and-progress, decision-temporal-feedback

#### P-17 · S2 · Вход: честные поля, недоступный сервер, понятные ошибки; полировка
- **Исправление.**
  - **Честность.** Убрать плейсхолдер «•••••••••» у пароля (или заменить на «Введите пароль»). Ошибку загрузки проектов не глотать: над формой баннер «Сервер недоступен — запустите maos-server · Повторить». Пустой список проектов — текст «Проектов нет — при входе будет создан демо-проект» вместо предвыбранного «+ Новый проект…». Ошибки — через `errorText`.
  - **Полировка (S3, дёшево).**
    - Одна мысль в герое и в карточке: «Планирование производства в условиях неопределённости» / «Войдите, чтобы открыть проект».
    - «MAOS» → «PESCADITO» в подписи HUD.
    - Подпись σ — через `splitGreek`.
    - «Применить» в HUD — вторичная и включённая кнопка.
    - Подписи HUD — `--fs-11`, подвал — `--text-muted`.
    - Переключатель «Пауза» в HUD (с учётом reduced motion).
    - `GaLandscape` монтировать после первой отрисовки (`requestIdleCallback`).
- **Файлы.** `src/features/auth/LoginScreen.tsx`, `src/features/auth/auth.css`, `src/brand/landscape/LandscapeHud.tsx`, `src/brand/landscape/landscape.css`, `src/brand/landscape/GaLandscape.tsx`
- **Приёмка.** Пустое поле пароля выглядит пустым. При выключенном бэкенде баннер виден до отправки формы. Нет «HTTP 401» и «Failed to fetch». На экране входа нет «MAOS» и «Σ МУТАЦИИ». Форма интерактивна раньше, чем отрисован пейзаж.
- **Правила.** enterprise-form-validation, enterprise-errors-plain-and-local, enterprise-designed-empty-states, enterprise-one-name-per-destination, a11y-ai-07

#### P-18 · S2 · Единая грамматика вееров и неопределённости в `ui/charts`
- **Исправление.**
  - **Легенда (`Fan.tsx`, `fanLegend`).** «медиана (P50)», «P25–P75 · 5 из 10 исходов», «P10–P90 · 8 из 10 исходов», «◆ факт проверки», «окно проверки N мес».
  - **Стили меток.** Тренд — пунктир `--text-secondary` (без `--chart-2`). Окно бэктеста — нейтральная заливка `--chart-grid`. Ромбы факта — обводка `--text`. `yTicks(lo, hi, 4)`, не меньше 3 делений.
  - **Новые свойства.**
    - `yDomain` — общая шкала для малых множеств;
    - `scaleNote` — подпись «своя шкала»;
    - `refLines` — подписанные пунктирные линии, видны в легенде и в таблице-двойнике;
    - `caveat` — строка «не учтено: смена режима внутри горизонта»;
    - `quality: 'ok'|'warn'|'bad'` — при warn/bad внешняя полоса штрихуется (≈ 8 %).
  - **Качество в подписи.** `QualityLine` в `FanChart` принимает от вызывающего готовые фразы простыми словами; CRPS уходит в «i».
  - **CSS.** Убрать `--chart-2` из `.ch-fan__bt` и `.ch-fan__fact`.
- **Файлы.** `src/ui/charts/Fan.tsx`, `src/ui/FanChart.tsx`, `src/ui/charts/charts.css`, `src/ui/charts/charts.test.tsx`
- **Приёмка.** Легенда называет P50, P25–P75 и P10–P90 с охватом и все нарисованные элементы. Тест проверяет не меньше 3 делений по y и применение общей шкалы. В CSS вееров нет `--chart-2`.
- **Правила.** decision-fan-chart-grammar, decision-name-the-interval, dataviz-uncertainty-graded-and-framed, dataviz-single-axis-honest-scales, aps-chart-palette-discipline

#### P-19 · S2 · Примитивы графиков для вердиктов: RangeStrip, Forest, BarList, Histogram, Sankey, оси-даты
- **Исправление.**
  - **`RangeStrip`.** Свойства `domain?` и `zoneKind: 'tail'|'ci'`: штриховка только для хвоста, для ДИ — однотонная полоса 15 %. Подписи концов, точка в `--chart-1`.
  - **Новый `Forest`.** Строки «имя · Δ · ДИ · доля побед», общая шкала по x, подписанные линии нуля и порога, `ChartFrame` с таблицей-двойником.
  - **`BarList`.** Свойства `mark` (волосяная линия с подписью, например «80 % — близко к пределу") и `limit` с раскрытием «Все N». В компактном режиме колонка подписей шире.
  - **Метки-цели.** Для них использовать уже существующий `Meter.mark`.
  - **`Histogram`.** Диапазоны в подсказке — через `rangeText`.
  - **`Sankey`.** Свойство `emphasis` (id узлов), остальные связи — `--chart-other` с прозрачностью 15 %. Подписи переносятся до 3 строк без многоточия, полное имя в подсказке, `aria-label` передаётся.
  - **`Cartesian`/`AreaChart`.** Принимают `tickIndices` и подписи-даты.
- **Файлы.** `src/ui/charts/RangeStrip.tsx`, `src/ui/charts/Forest.tsx` (новый), `src/ui/charts/BarList.tsx`, `src/ui/charts/Histogram.tsx`, `src/ui/charts/Sankey.tsx`, `src/ui/charts/Cartesian.tsx`, `src/ui/charts/index.ts`, `src/ui/charts/charts.css`, `src/ui/charts/charts.test.tsx`
- **Приёмка.** Тесты: ДИ в RangeStrip без штриховки, у Forest есть линия нуля, у BarList — метка, у Sankey нет многоточий. В `charts.css` нет `var(--accent)`.
- **Правила.** dataviz-uncertainty-graded-and-framed, decision-pairwise-win-share, dataviz-bullet-not-gauge, dataviz-labels-selective-text-tokens, dataviz-emphasis-over-rainbow

#### P-20 · S2 · Один цвет на сущность во всех графиках
- **Исправление.** В `palette.ts` — функция `slotForEntity(kind, id, universe)`. Слот детерминирован порядком справочника (сортировка по id): до 6 именованных слотов `--chart-1…6`, остальное — «прочие» (`--chart-8` со штриховкой). Никакого деления по модулю. Плюс `entityLegend()`. Используют Гант (P-95), слой симуляции (P-36) и графики изделий. Unit-тест: одно изделие всегда в одном слоте независимо от фильтра и порядка; седьмое и дальше — «прочие».
- **Файлы.** `src/ui/charts/palette.ts`, `src/ui/charts/palette.test.ts` (новый)
- **Приёмка.** Тест зелёный. Поиск `% batchColors.length` и деления по модулю для цветов в features ничего не находит.
- **Правила.** dataviz-categorical-fixed-order-cap, aps-gantt-color-budget, enterprise-chart-system-discipline

#### P-21 · S2 · GraphCanvas: вписывание один раз, центр вида, единый стиль узла
- **Исправление.**
  - **Новые свойства.** `fitOnMount` — вписать один раз. `refitOnResize` — по умолчанию true; для карты и воркфлоу передаётся false.
  - **Хэндл.** Отдаёт `getViewportCenterWorld()`.
  - **Управление.** Свойство размещения `controls="top-right"`; `pad` вписывания с нижним отступом ≥ 56 px.
  - **Стиль узла.** В `graph-canvas.css` общий класс `.gc-node`:
    - `--bg-card`, рамка 1 px `--border-strong`, `--radius-lg`, `--shadow-1`;
    - врезная полоса 3 px `var(--node-stripe)`;
    - выбранный узел — рамка `--focus` плюс кольцо 1 px.
  - **Внедрение.** Карта, техкарта и воркфлоу переходят на стиль в P-51, P-126, P-137.
- **Файлы.** `src/ui/graph-canvas/GraphCanvas.tsx`, `src/ui/graph-canvas/useGraphView.ts`, `src/ui/graph-canvas/graph-canvas.css`
- **Приёмка.** Открытие панели узла на карте не меняет зум. Стартовый граф воркфлоу целиком виден при 1440×900.
- **Правила.** aps-display-hierarchy, enterprise-keyboard-and-focus, decision-consistent-screen-anatomy

#### P-22 · S2 · Кит: немодальная боковая панель, тост с отменой, подтверждение с именем объекта
- **Исправление.**
  - **`SidePanel`.** Правая колонка ≈ 360–400 px; шапка с заголовком и ⋯; прокручиваемое тело. Липкий подвал: «Отмена» (secondary) и «Сохранить изменения» (primary), опасная зона слева за разделителем. Esc — через стек; фокус возвращается на строку; встроен `useLeaveGuard`.
  - **`UndoToast`.** `role=status`, 8 с, кнопка «Отменить», одновременно только один, внизу слева.
  - **`ConfirmDialog`.** Обязательные свойства `objectName` и `consequence`; действия — в слоте `footer` модала.
- **Файлы.** `src/ui/kit/SidePanel.tsx` (новый), `src/ui/kit/UndoToast.tsx` (новый), `src/ui/kit/index.ts`, `src/ui/kit/kit.css`, `src/ui/ConfirmDialog.tsx`, `src/shell/Modal.tsx`
- **Приёмка.** Тест проверяет порядок кнопок подвала SidePanel. Компоненты внедряются в P-50, P-60, P-133, P-143.
- **Правила.** aps-master-data-list-detail, enterprise-save-and-undo, enterprise-table-filter-actions-edit, decision-sandboxed-what-if

#### P-23 · S2 · DataTable: единая база
- **Исправление.**
  - **Сортировка.** Стрелка только у отсортированного столбца, у остальных — при наведении. Добавить `defaultSort`.
  - **Группы.** Заголовок группы — `groupLabel(key, count)`, например «Сегодня · 24».
  - **Счётчик.** Слот `countSlot`: «12 из 82 записей» (через `plural`).
  - **Колонки.** Режим `clip`: текст в одну строку, многоточие, полный текст в `title`. Текстовые колонки слева, числовые справа с `tabular-nums`.
  - **Плотность.** `tight` (32 px) по умолчанию для реестров и журналов.
  - **Загрузка и пустота.** `loading` оставляет прежние строки полупрозрачными. Пустая таблица показывает `EmptyState` нужного вида и без шапки.
- **Файлы.** `src/ui/kit/DataTable.tsx`, `src/ui/kit/tableModel.ts`, `src/ui/kit/table.css`, `src/ui/kit/tableModel.test.ts`
- **Приёмка.** В покое видна одна стрелка сортировки. Заголовок группы — «Сегодня · 24». Реестр при 1440×900 показывает не меньше 20 строк.
- **Правила.** enterprise-table-baseline, dataviz-tables-for-lookup, enterprise-table-filter-actions-edit, decision-tables-not-card-walls

#### P-24 · S2 · Фокус, контраст, размер целей и движение
- **Исправление.**
  - **Фокус.** В `global.css`: `@media (forced-colors: active) { :focus-visible { outline: 2px solid Highlight; outline-offset: 2px } }`. Рядом с каждым `outline: none` в `shell.css`, `pipeline.css`, `kit.css`, `palette.css` добавить `outline: 2px solid transparent`.
  - **Контраст.** Плейсхолдеры и информационный текст 11 px — `--text-muted`. Рамка `.topbar__cmd` — `--border-control`.
  - **Цели.** У `.btn--sm` минимальная высота 24 px.
  - **Движение.** Общие хуки в `src/ui/motion.ts`: `usePrefersReducedMotion()` и `useAnimationPaused()` (в sessionStorage) плюс компонент `AnimationToggle` — IconButton «Пауза анимации» с `aria-pressed`. Внедрение — в P-17, P-39, P-131.
- **Файлы.** `src/styles/global.css`, `src/shell/shell.css`, `src/ui/pipeline.css`, `src/ui/kit/kit.css`, `src/ui/palette.css`, `src/ui/motion.ts` (новый)
- **Приёмка.** При эмуляции forced-colors кольцо фокуса видно на рельсе, Segmented и Switch. Консольный поиск целей меньше 24 px находит только «существенные» элементы канваса. Хуки покрыты тестами.
- **Правила.** a11y-ai-03, a11y-ai-01, a11y-ai-05, a11y-ai-06, a11y-ai-07

#### P-25 · S3 · Командная палитра: все экраны, сценарии и реестры, клавиши
- **Исправление.** Только дешёвая часть:
  - лимит на группу вместо общего `LIMIT 14`: при пустом запросе видны все 12 экранов;
  - группа «Недавние» — последние 5 маршрутов (localStorage в try/catch);
  - новые источники: сценарии (`#/scenarios/<id>`) и реестры Справочников (`#/nsi/<registry>`);
  - `CommandItem.shortcut` рисуется в `<kbd>` с учётом платформы (⌘J / Ctrl+J); подвал определяет платформу так же, как TopBar;
  - переименовать «Полномочия агента и единый α» в «Агенты: полномочия и уровень риска α».
- **Файлы.** `src/shell/useCommandItems.ts`, `src/shell/commandIndex.ts`, `src/ui/CommandPalette.tsx`, `src/ui/palette.css`
- **Приёмка.** При пустом запросе видны «Администрирование» и «AI-воркфлоу». Часть имени сценария находит сценарий. На Windows отображается «Ctrl K».
- **Правила.** enterprise-command-palette, enterprise-keyboard-and-focus, enterprise-one-name-per-destination

#### P-26 · S2 · Охранные тесты дизайн-системы
- **Исправление.** `src/design-guards.test.ts` сканирует `src/features` и `src/ui` и запрещает:
  - литералы hex и `oklch(` вне `tokens.css`;
  - `.toFixed(`, `toLocaleString(` и `Intl.NumberFormat` вне `format.ts`;
  - `.catch(() => {})`;
  - `var(--accent)` в CSS графиков;
  - `rotate(` в осях;
  - `var(--status-*|--intent-*)` в `color:` у классов чисел (список классов в тесте).

  Тест стартует с явным allow-list текущих нарушений; каждая группа его сокращает, цель — пустой список. Удалить мёртвый CSS кита: пунктирный `.dk-grid` и `.dk-cross` в `surfaces.css`.
- **Файлы.** `src/design-guards.test.ts` (новый), `src/ui/kit/surfaces.css`
- **Приёмка.** Тест запускается в `npm test`, allow-list задокументирован. Когда все группы закончат, allow-list пуст.
- **Правила.** aps-accent-budget, dataviz-precision-and-units, enterprise-errors-plain-and-local, dataviz-recessive-solid-chrome

### 3.2 scheme — Схема предприятия (`src/features/plant-scene/**`)

#### P-27 · S1 · Схема показывает реальное состояние завода и связь с планом
- **Исправление.** Новый хук `useSceneOps.ts` берёт последний `KpiBundle` (`api.analytics.kpiSeries`), а если его нет — `planStore.result`. Он отдаёт загрузку по станкам, по цехам и заводам (максимум), число станков в ТО и признак узкого места по `wc_type_id`. Чистая функция `aggregateStatus()` вычисляет статус цеха или завода как худший статус потомков вместо зашитого `running`; геометрию `sceneModel` не трогать.
  - **Инспектор, под названием.** «Загрузка · план №28 от 24.10 14:38» — kit Meter с меткой 85 %, выше неё ▲ «перегрузка». «Очередь, пик N партий». «Узкое место ▲», если это оно.
  - **Инспектор, ссылки.** «Открыть в Плане →» (`#/plan/run/<id>`) и «Карточка в Справочниках →».
  - **SceneModeBar.** Строка-вердикт «План №28 · узкое место ▲ Резьбонарезной 94 % · в ТО 2 станка».
  - **MapCard.** Строки «Цехов · Станков · Загрузка узкого места».
- **Файлы.** `src/features/plant-scene/useSceneOps.ts` (новый), `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/graph/sceneModel.ts`, `src/features/plant-scene/EditorPanel.tsx`, `src/features/plant-scene/SceneModeBar.tsx`, `src/features/plant-scene/worldmap2d/MapCard.tsx`
- **Приёмка.** Если есть план, инспектор цеха показывает Meter загрузки и обе ссылки. В `sceneModel` нет зашитого `status: 'running'` у цехов и заводов. Есть unit-тест `aggregateStatus`.
- **Правила.** aps-bottleneck-protagonist, aps-display-hierarchy, decision-connected-lineage, dataviz-bullet-not-gauge, aps-linked-views

#### P-28 · S1 · Один словарь статусов станка
- **Исправление.** В `types.ts` одна карта по значению из справочника:
  - active → «В работе» ● running;
  - maintenance → «ТО / ремонт» ▲ setup;
  - decommissioned → «Выведен» ○ idle;
  - «Авария» ■ — только для событий симуляции и мониторинга.

  `mapStatus` ищет статус в этой карте. `MACHINE_STATUS` в `MachineCard` удалить, использовать `STATUS_META`. У станка убрать чип в шапке инспектора, оставить чип карточки. `SceneLegend` показывает только состояния, которые есть на уровне, со счётчиками: «● В работе 118 · ▲ ТО 2».
- **Файлы.** `src/features/plant-scene/types.ts`, `src/features/plant-scene/graph/sceneModel.ts`, `src/features/plant-scene/MachineCard.tsx`, `src/features/plant-scene/EditorPanel.tsx`, `src/features/plant-scene/SceneLegend.tsx`
- **Приёмка.** Станок в ТО одинаково показан ▲ «ТО / ремонт» в чипе, легенде и кольце. «Наладка» с нулём объектов в легенде не появляется.
- **Правила.** decision-one-state-vocabulary, aps-status-not-color-alone, enterprise-color-one-meaning, decision-calm-normal-color

#### P-29 · S1 · Режимы зависят от уровня; симуляция не спорит с инспектором
- **Исправление.**
  - **Мировой уровень, «Симуляция».** Сразу входит в выбранный или единственный завод. Если заводов несколько, пункт выключен с подсказкой «Симуляция видна на площадке и в цехе — войдите в завод».
  - **Мировой уровень, «Редактирование».** Выключено с подсказкой «Заводы создаются в Справочниках › Подразделения».
  - **Транспорт симуляции.** Play, перемотка, скорость, часы и ползунок переезжают в нижнюю полосу времени поверх канваса `.scene__timeline` высотой 56 px.
  - **Вкладки «Прогон / Результаты / В справочники».** Рисуются в правой колонке шириной 360 px вместо `EditorPanel`.
  - **Клик по станку в симуляции.** Там же показывает занятость %, очередь и текущую операцию.
  - **Плавающая панель.** `.sim` шириной 420 px удалить.
- **Файлы.** `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/SceneModeBar.tsx`, `src/features/plant-scene/SimulationPanel.tsx`, `src/features/plant-scene/SimulationRuns.tsx`, `src/features/plant-scene/simulation.css`, `src/features/plant-scene/WorldMap2D.tsx`
- **Приёмка.** В режиме симуляции на скриншоте одна правая колонка, полоса времени снизу, канвас ничем не перекрыт. ▶ на мировом уровне всегда что-то делает.
- **Правила.** aps-linked-views, decision-consistent-screen-anatomy, aps-display-hierarchy, enterprise-one-primary-per-region, dataviz-density-budget

#### P-30 · S1 · Редактирование схемы без тихих записей
- **Исправление.**
  - **Куда сохранять.** По `refType`: цех или завод → `api.orgUnits.update(orgUnitId, {name})`, станок → `machines.update`.
  - **Когда сохранять.** По blur или Enter, а не на каждое нажатие клавиши.
  - **Удаление.** «Удалить» переезжает в меню ⋯. ConfirmDialog называет объект и последствие: «Цех №3 будет удалён; 36 станков перейдут в „Без цеха“».
  - **Ошибки.** Все `.catch(() => {})` заменить на `InlineError` или `ErrorBanner` с «Повторить».
  - **Отмена.** После каждой записи — `UndoToast` на 8 с.
  - **Калибровка.** Диалог-подтверждение со списком «операция · было → станет, мин», затем `UndoToast`, который возвращает прежние `t_norm`.
- **Файлы.** `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/EditorPanel.tsx`, `src/features/plant-scene/SimulationCalib.tsx`, `src/features/plant-scene/SimulationPanel.tsx`
- **Приёмка.** Новое название цеха сохраняется после перезагрузки. Поиск `.catch(() => {})` в plant-scene пуст. «Удалить» никогда не стоит рядом с «Войти внутрь».
- **Правила.** decision-sandboxed-what-if, enterprise-save-and-undo, enterprise-errors-plain-and-local, aps-safe-exploration, a11y-ai-22

#### P-31 · S1 · Камера: позиция для каждого уровня, вписывание без чёрного экрана
- **Исправление.** Изменения в `CameraFit`:
  - кэш позиции камеры по уровням `Map<levelKey, {position, target}>`: сохранять при уходе с уровня, восстанавливать при `GO_TO_LEVEL`;
  - автовписывание при первом посещении любого 3D-уровня, а не только цеха;
  - границы считать по процентилям P5–P95 координат узлов;
  - для вытянутого цеха (соотношение сторон > 2) смотреть перпендикулярно длинной оси под углом 50–60°.

  Дистанцию вписывания передать в `SceneEnvironment`: `maxDistance ≥ 1,2 × fit`, `fogNear ≥ fit + radius`. Гарантировать `camera.y ≥ target.y + 2`. Тесты на `levelBounds` с выбросом и на восстановление позиции.
- **Файлы.** `src/features/plant-scene/CameraFit.tsx`, `src/features/plant-scene/SceneEnvironment.tsx`, `src/features/plant-scene/PlantScene.tsx`
- **Приёмка.** После Esc из цеха площадка видна сразу, без чёрного экрана. После `__maos.enterShop(0)` станки не меньше 20 px. Тесты зелёные.
- **Правила.** aps-display-hierarchy, decision-length-position-sorted, enterprise-keyboard-and-focus

#### P-32 · S2 · Инспектор как навигация и таблица-двойник сцены
- **Исправление.** Пустой инспектор показывает «Объекты уровня (N)» — компактную DataTable со столбцами:
  - имя (rowHeader);
  - глиф и слово статуса;
  - загрузка, % (число, по убыванию, ▲ от 85 %);
  - очередь.

  Клик по строке отправляет `NODE_CLICK` и подсвечивает объект в 3D; Enter или двойной клик — `ENTER_NODE`. Если строк больше 10 — первые 10 и «все N». У выбранного завода или цеха — блок «Состав» с такой же таблицей детей. Пины мира получают `tabindex=0`: Enter или Space выбирают, Shift+Enter входит внутрь.
- **Файлы.** `src/features/plant-scene/InspectorEmpty.tsx`, `src/features/plant-scene/EditorPanel.tsx`, `src/features/plant-scene/WorldMap2D.tsx`, `src/features/plant-scene/editor-panel.css`
- **Приёмка.** Карточка станка открывается со Схемы не больше чем за 3 клика или клавиши. Tab доходит до пинов.
- **Правила.** dataviz-table-twin-and-alt, enterprise-keyboard-and-focus, enterprise-designed-empty-states, a11y-ai-05, decision-tables-not-card-walls

#### P-33 · S2 · Навигация по уровням без дублей; клавиши только в сцене
- **Исправление.**
  - **Крошки.** Kit Breadcrumbs (P-10) встают в `SceneModeBar` вместо `LEVEL_LABEL`: «Предприятие › Цех №3 · 36 станков». Последняя крошка — `span` с `aria-current`. Локальный `Breadcrumbs.tsx` удалить.
  - **Подсказка управления.** `.scene__hint` удалить. Вместо неё IconButton «?» «Управление» с поповером: ЛКМ / 2×ЛКМ / колесо / ПКМ / F / Esc. У «Вписать» — `aria-keyshortcuts="F"`.
  - **Легенда.** Переезжает в полосу режимов как компактный ряд чипов.
  - **Клавиши.** Обработчик ограничен `.scene__canvas` (`tabIndex=0`) или работает через стек Esc (P-13). Esc внутри MENTAT не поднимает уровень.
- **Файлы.** `src/features/plant-scene/SceneModeBar.tsx`, `src/features/plant-scene/Breadcrumbs.tsx` (удалить), `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/scene.css`, `src/features/plant-scene/SceneLegend.tsx`
- **Приёмка.** Название уровня видно один раз. Ничего не перекрывает атрибуцию MapLibre. Esc в MENTAT оставляет уровень на месте.
- **Правила.** enterprise-breadcrumbs-for-depth, enterprise-quiet-chrome, enterprise-keyboard-and-focus, a11y-ai-08

#### P-34 · S2 · Подписи в сцене читаемы и без наведения
- **Исправление.**
  - Убрать `distanceFactor`. Ярлык — фиксированный `--fs-12` с `occlude`.
  - Контейнеры (до 12 на уровне) подписаны постоянно: глиф + короткое имя + «94 % ▲» из `useSceneOps`.
  - У станков подпись только при наведении или выборе. Узкое место и перегруженные станки получают постоянный маркер ▲.
  - Текст ярлыков — только токены текста.
- **Файлы.** `src/features/plant-scene/StageObject.tsx`, `src/features/plant-scene/PlantLayout.tsx`, `src/features/plant-scene/scene.css`
- **Приёмка.** На площадке имена трёх цехов читаются (≥ 12 px) без наведения.
- **Правила.** dataviz-labels-selective-text-tokens, aps-bottleneck-protagonist, decision-length-position-sorted

#### P-35 · S2 · Мировой уровень — только когда есть что показать
- **Исправление.**
  - **Вход.** Если после `LOAD_GRAPH` заводов не больше одного — `ENTER_NODE` на площадку; «Мир» остаётся корневой крошкой.
  - **Карта мира.** Рисуется, только если у двух и более площадок есть настоящие координаты.
  - **Название уровня.** «Предприятия (N)»; «· склады (M)» — только при M > 0.
  - **Завод без координат.** Не ставить фиктивный пин; в инспекторе текст «Расположение не задано — укажите в Справочниках › Подразделения» со ссылкой.
  - **Пустые состояния.** «Недоступно» — ErrorBanner с «Повторить». «Первый раз» — «Заводов пока нет — создайте подразделение в Справочниках» с кнопкой действия.
  - **Ошибки списков.** `.catch(() => [])` у списков удалить.
- **Файлы.** `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/SceneModeBar.tsx`, `src/features/plant-scene/worldmap2d/cities.ts`, `src/features/plant-scene/InspectorEmpty.tsx`, `src/features/plant-scene/WorldMap2D.tsx`
- **Приёмка.** Демо-вход открывается сразу на площадке. При выключенном бэкенде виден баннер, а не пустая карта.
- **Правила.** aps-display-hierarchy, decision-answer-first, enterprise-designed-empty-states, enterprise-errors-plain-and-local

#### P-36 · S2 · Цвет в симуляции: у каждого кольца одна работа
- **Исправление.**
  - **Кольца статуса.** В режиме симуляции скрыты или нейтральны.
  - **Кольцо загрузки.** Одноцветная шкала (`--chart-8` → `--chart-1`, 3 шага) и ▲ выше 85 %; величина не кодируется прозрачностью.
  - **Партии.** Цвет по изделию через `slotForEntity` (P-20), без деления по модулю. В легенде — образцы изделий и «прочие».
  - **Рабочие.** `--text-secondary`.
  - **Столбец OTD.** Простое число; чип ▲ «под риском» только ниже 90 %.
- **Файлы.** `src/features/plant-scene/SimulationLayer.tsx`, `src/features/plant-scene/SimulationRuns.tsx`, `src/features/plant-scene/StageObject.tsx`
- **Приёмка.** На сером скриншоте симуляции загрузка читается по ▲. Одно изделие окрашено так же, как на Ганте Плана. При OTD 100 % зелёных чипов нет.
- **Правила.** dataviz-color-jobs-disjoint, dataviz-categorical-fixed-order-cap, aps-gantt-color-budget, decision-calm-normal-color, a11y-ai-11

#### P-37 · S2 · Панель симуляции: одна правда о рабочих и меньше чисел
- **Исправление.**
  - **LaborWarning.** В симуляции заменить его одной строкой InlineError: «▲ Операторов с допуском не хватает на 3 типа оборудования · подробнее → Справочники › Рабочие».
  - **Текст «Результатов».** «Всего хватает (нужно 41 из 84), но по допускам не хватает на 3 типа».
  - **Легенда.** Свёрнута: «Обозначения (4)».
  - **Прогоны.** 3 строки и «все N».
  - **Заголовки.** «Операций», «В срок».
  - **Часы.** Дата и смена от начала плана: «24.10 · смена 2 · 14:00» (`simModel`).
- **Файлы.** `src/features/plant-scene/SimulationRuns.tsx`, `src/features/plant-scene/SimulationResults.tsx`, `src/features/plant-scene/simModel.ts`
- **Приёмка.** Во вкладке «Прогон» нет горизонтальной прокрутки в колонке 360 px. Видно не больше 14 чисел.
- **Правила.** dataviz-density-budget, decision-two-level-disclosure, enterprise-progressive-disclosure, dataviz-statement-titles

#### P-38 · S2 · Уровень и выбранный объект Схемы — в URL
- **Исправление.** Якорь из P-11: `#/scheme/<factoryId>/<shopId>?sel=<machineId>`. `ENTER_NODE`, `GO_TO_LEVEL` и `NODE_CLICK` пишут hash (выбор — через replace). `PlantScene` восстанавливает путь и выбор после `LOAD_GRAPH`. Экспортировать `schemeHref(machineId)` для ссылок из Плана (P-92), Справочников (P-45) и Аналитики (P-117).
- **Файлы.** `src/features/plant-scene/PlantScene.tsx`, `src/features/plant-scene/graph/graphReducer.ts`, `src/features/plant-scene/schemeHref.ts` (новый)
- **Приёмка.** F5 в цехе с выбранным станком восстанавливает и цех, и выбор.
- **Правила.** enterprise-url-is-state, aps-state-persistence, aps-linked-views, enterprise-connected-flow

#### P-39 · S2 · Движение: пауза и prefers-reduced-motion
- **Исправление.** Хуки `usePrefersReducedMotion` и `useAnimationPaused` (P-24); `AnimationToggle` — в `.scene__bar-tools`. При reduce или паузе `VehicleFleet` рисует машины стоящими в фиксированных фазах без работы в `useFrame`, а `SimulationLayer` не идёт сам (шаг — ползунком). В «Редактировании» анимация на паузе по умолчанию.
- **Файлы.** `src/features/plant-scene/FlowLinks.tsx`, `src/features/plant-scene/SimulationLayer.tsx`, `src/features/plant-scene/SceneModeBar.tsx`
- **Приёмка.** При эмуляции reduce два скриншота с интервалом 3 с в покое совпадают.
- **Правила.** a11y-ai-06, a11y-ai-07, decision-calm-normal-color

#### P-40 · S2 · Акцент и ультрамарин — только для выбора
- **Исправление.**
  - **Маршруты мира.** `--chart-8` / `--text-muted`, 2,5 px, с подложкой `--ink` (`basemap.ts`).
  - **Акцент.** `--accent` только на выбранном пине, фокусе и primary.
  - **Текст.** Eyebrow — `--text-muted`, тип станка — `--text-secondary`.
  - **Декор.** Убрать радиальные заливки (шапка карточки карты, `simulation.css`), врезную ультрамариновую полосу и тонированную рамку героя.
  - **Кнопки симуляции.** `.sim__play` — вторичная контурная IconButton без свечения. Единственная заливная кнопка в регионе симуляции — следующий шаг: «Результаты» → «Записать в справочники».
- **Файлы.** `src/features/plant-scene/worldmap2d/basemap.ts`, `src/features/plant-scene/worldmap2d/worldmap2d.css`, `src/features/plant-scene/editor-panel.css`, `src/features/plant-scene/simulation.css`, `src/features/plant-scene/SimulationRuns.tsx`
- **Приёмка.** Вне данных на мировом уровне и площадке не больше 3 насыщенных оттенков. В каждом регионе одна заливная кнопка.
- **Правила.** enterprise-color-one-meaning, aps-accent-budget, dataviz-color-jobs-disjoint, enterprise-one-primary-per-region

#### P-41 · S3 · Primary не блокируются заранее; пояснения — в «i»
- **Исправление.** «Добавить цех» и «Добавить станок» всегда включены. По нажатию без данных — ошибка под полем: «Введите название цеха» / «Выберите тип оборудования». Выключать кнопку можно только на время запроса («Добавляем…»). Калибровка без строк: текст «Отклонений > 10 % нет — записывать нечего», кнопки нет. Пояснительные абзацы — в InfoTip у подписи раздела. В режиме просмотра — только название модели здания.
- **Файлы.** `src/features/plant-scene/EditorAdd.tsx`, `src/features/plant-scene/SimulationCalib.tsx`, `src/features/plant-scene/EditorPanel.tsx`
- **Приёмка.** `disabled={…}` у primary в plant-scene ссылается только на флаги выполняющегося запроса.
- **Правила.** enterprise-form-validation, aps-progressive-disclosure, enterprise-contextual-help-pull

### 3.3 nsi — Справочники и конструктор техкарты (`src/features/nsi/**`)

#### P-42 · S1 · Сохранение техкарты ничего не теряет и не переключает версию молча
- **Исправление.**
  1. **Поля.** `RoutingOp` получает `tOpt`, `tPess`, `setupMin`, `laborRate`, `riskCoef`, `wcTypeIds`. `opsFromApi` берёт их из `Operation`, `payloadFromState` отправляет без изменений. В `routingModel.test.ts` — тест туда-обратно, что ни одно поле не теряется.
  2. **Входы (зависимость от бэкенда, в этой волне бэкенд не трогаем).** GET `/api/routings/:id` не отдаёт `operation_inputs` — сообщить владельцу. До исправления столбец I показывает «входы заданы в Справочниках — здесь не редактируются», а «Сохранить» блокируется с этим объяснением для операций, чьи входы не загружены.
  3. **Без изменений.** Если `!dirty`, «Сохранить» показывает «Изменений нет» и не шлёт запрос.
  4. **Версия.** Подтверждение: «Сохранить как версию vN+1 — станет действующей для ГП-0002 (сейчас действует vN)». Для альтернативной техкарты есть вариант «сохранить как альтернативу».
  5. **Адрес.** После сохранения — переход на новый id через replace.
  6. **Время.** Вид «33 мин · 25–63 (PERT)» и «наладка 25 мин»; `useLeaveGuard` (P-11).
- **Файлы.** `src/features/nsi/routing/routingModel.ts`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/features/nsi/routing/RoutingInspector.tsx`, `src/features/nsi/routing/RoutingTable.tsx`, `src/features/nsi/routing/routingModel.test.ts`
- **Приёмка.** Тест туда-обратно зелёный. Сохранение неизменённой карты не шлёт запросов. После сохранения «Назад» не ведёт на 404.
- **Правила.** decision-sandboxed-what-if, enterprise-save-and-undo, aps-safe-exploration, aps-routing-fields, decision-never-lone-point

#### P-43 · S1 · Правка операции не стирает связи; кнопки называют действие
- **Исправление.**
  - **OperationForm.** Заполняет строки входов и `wc_type_ids` из записи. Отправляет только изменённые поля (сравнение с `edit.row`). При правке никогда не шлёт пустые `controls`/`mechanisms`/`outputs`. `input_products` и `wc_type_ids` — только если пользователь их трогал.
  - **Подписи кнопок.** Правка — «Сохранить изменения», создание — «Создать <что>» (MachineForm, WorkCenterTypeForm, OperationForm, ProductForm).
  - **WorkCenterTypeForm.** Вместо пустого чек-листа шаблонов — список операций, связанных с типом (уникальные имена и их число), только для чтения.
- **Файлы.** `src/features/nsi/forms/OperationForm.tsx`, `src/features/nsi/forms/WorkCenterTypeForm.tsx`, `src/features/nsi/forms/MachineForm.tsx`, `src/features/nsi/forms/ProductForm.tsx`
- **Приёмка.** После переименования операции alt-* у неё остаются оба типа станков и все входы (сверка GET до и после). Ни в одном диалоге правки нет «Создать».
- **Правила.** enterprise-save-and-undo, aps-safe-exploration, decision-one-primary-next-step, enterprise-form-validation

#### P-44 · S1 · «Техкарты» показывают действующую версию; 404 — не пустой редактор
- **Исправление.**
  - **Тип.** `Routing` получает `version` и `is_default`.
  - **Столбцы.**
    - «Изделие» — код и имя, закреплённый столбец;
    - «Версия» — Chip «v1 · действует ●» или «альтернатива ○»;
    - «Операций»;
    - «Σ норм. время, мин»;
    - «Самая длинная операция»;
    - «Обновлено».
  - **Группировка.** По изделию с липким подзаголовком «ГП-0001 … · 2 варианта». Альтернатива называется «Альтернатива: взаимозаменяемые станки». Сортировка по умолчанию — по коду изделия.
  - **404.** EmptyState «Техкарта не найдена — возможно, её пересохранили как новую версию» с кнопкой «К списку техкарт» и, если изделие известно, «Открыть действующую для ГП-…». Редактора и primary нет.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/lib/api.ts`
- **Приёмка.** Альтернативы стоят под своим изделием, а не сверху списка. `#/nsi/routing/bogus` показывает EmptyState без «Сохранить».
- **Правила.** aps-connected-pipeline, decision-connected-lineage, enterprise-designed-empty-states, enterprise-errors-plain-and-local, dataviz-tables-for-lookup

#### P-45 · S1 · Справочники показывают, на что влияет запись
- **Исправление.**
  - **Столбцы «Типов оборудования».**
    - «Наименование»;
    - «Станков»;
    - «Операторов с допуском» — с ▲ «меньше станков», если операторов меньше станков (через `labor.ts`);
    - «Ставка, ₽/ч»;
    - «MTBF / ремонт, ч»;
    - «ТО каждые / длит., ч»;
    - «Операций».

    «3D-вид» остаётся только в форме. «Взаимозам.» убрать.
  - **Предупреждение.** `<LaborWarning compact/>` над таблицами «Рабочие» и «Типы».
  - **Меню строки ⋯.** «Показать на схеме» (`schemeHref`, P-38), «Загрузка в последнем плане» (`#/plan/run/<id>/load?wc=`), «Техкарты с этим типом».
  - **«Оборудование».** Строчное ▲ «ни одна операция не использует» у станков, чей тип не встречается ни в одном действующем маршруте.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/LaborWarning.tsx`, `src/features/nsi/labor.ts`
- **Приёмка.** В «Типах» видны ставка и MTBF для всех 39 типов. Пункты меню ⋯ открывают свои цели.
- **Правила.** aps-routing-fields, aps-linked-views, enterprise-connected-flow, aps-bottleneck-protagonist

#### P-46 · S2 · «Операции»: человекочитаемо и сгруппировано
- **Исправление.**
  - **Столбцы.** Первый — «Наименование». Добавить «Техкарта» (имя маршрута) с группировкой по техкарте и подзаголовком «ТК … · 8 оп · Σ 407 мин»; альтернатива — вид уникальных операций «используется в N техкартах». Ключ столбца — `code`, не `id`.
  - **Подписи типов.** Общий `OP_TYPE_LABELS` в `registries.ts` для `cellText` и формы («Механообработка»).
  - **Время.** «Время, мин» в виде «33 · 25–63», отдельно «Наладка, мин».
  - **Выбор операции.** В `AddOperation` убрать дубли по имени и типу; `<optgroup>` по типу станка, у пунктов — время.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/forms/OperationForm.tsx`, `src/features/nsi/routing/RoutingInspector.tsx`
- **Приёмка.** Нигде не видно хешей и «machining». В выборе конструктора не больше ≈ 60 сгруппированных пунктов.
- **Правила.** decision-tables-not-card-walls, enterprise-table-baseline, enterprise-one-name-per-destination, aps-routing-fields

#### P-47 · S2 · «Изделия»: цена по роли, без нулей там, где поле не применимо
- **Исправление.**
  - **Группы.** По роли с липкими заголовками «Сырьё (12)», «Полуфабрикаты», «Товары».
  - **Цена.** Столбец зависит от роли: для сырья и полуфабрикатов «Цена закупки, ₽» (`base_cost`), для товаров «Цена продажи, ₽» (`base_price`).
  - **Спрос и ёмкость.** Только у товаров; где поле не применимо — приглушённое «—».
  - **Лишние столбцы.** «Покупное» убрать. «Остаток» показывать с единицей, столбец «Ед.» убрать.
  - **Имя.** Часть до « — » в одну строку; остаток — приглушённая вторая строка, обрезанная до одной, с `title`.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/nsi.css`
- **Приёмка.** У сырья нет «0 ₽». При 1440×900 видно не меньше 15 строк.
- **Правила.** decision-precision-matches-evidence, enterprise-numbers-first-class, dataviz-tables-for-lookup, enterprise-progressive-disclosure

#### P-48 · S2 · «Оборудование»: плотно и без повторов
- **Исправление.**
  - Группировать по цеху, как в «Типах»; столбец «Подразделение» убрать.
  - «Тип» показывать, только если имя не начинается с типа.
  - Пустое расписание — приглушённое «по графику цеха».
  - Статус — Chip, только если он не «active».
  - Включить `tight` и `clip` для текстовых столбцов.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/nsi.css`
- **Приёмка.** Над сгибом не меньше 20 строк. В столбце расписания нет «—».
- **Правила.** enterprise-table-baseline, enterprise-progressive-disclosure, decision-calm-normal-color

#### P-49 · S2 · «Рабочие»: видны допуски, мусор помечен, есть валидация
- **Исправление.**
  - **Допуски.** Новый столбец: до 3 чипов и «+N», либо приглушённое «универсал».
  - **Без подразделения.** Chip setup «▲ нет подразделения».
  - **Валидация `WorkerForm`.** В фамилии и имени должны быть буквы. Подразделение обязательно (или явное «вне цеха»). Табельный номер уникален и соответствует шаблону T0000. Ошибки — под полями, с `aria-invalid` и `aria-describedby`.
  - **Сортировка.** Естественная, по табельному номеру.
  - **Данные (после подтверждения владельца).** Три тестовые записи («222 234 222», «12 12 12», «228 Бураков Никита») убрать через «Уволить» — действие попадает в журнал. Жёстко из базы не удалять.
- **Файлы.** `src/features/nsi/registries.ts`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/forms/WorkerForm.tsx`
- **Приёмка.** Фамилия из цифр отклоняется с сообщением. Три мусорные записи помечены ▲, пока их не убрали.
- **Правила.** aps-routing-fields, enterprise-form-validation, aps-status-not-color-alone, decision-tables-not-card-walls

#### P-50 · S2 · Правка записей в боковой панели, а не в модале
- **Исправление.**
  - **Панель.** Модальный `CreateDialog` при правке заменить на kit `SidePanel` (P-22) шириной ≈ 400 px. Таблица остаётся видимой, строка подсвечена.
  - **Подвал.** Липкий: «Отмена» и «Сохранить изменения». «Уволить» — слева за разделителем или в ⋯.
  - **Допуски.** Одна сворачиваемая строка на цех: «Цех №1 · 3 из 13 ▸»; раскрыт только свой цех.
  - **Уход с правками.** `useLeaveGuard` при несохранённых изменениях.
- **Файлы.** `src/features/nsi/CreateDialog.tsx`, `src/features/nsi/forms/WorkerForm.tsx`, `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/nsi.css`
- **Приёмка.** Подвал правки рабочего виден без прокрутки, таблица видна рядом. Esc при наличии изменений спрашивает подтверждение.
- **Правила.** aps-master-data-list-detail, enterprise-table-filter-actions-edit, enterprise-one-primary-per-region, decision-two-level-disclosure, enterprise-save-and-undo

#### P-51 · S2 · Конструктор техкарты: читаемый масштаб, компактная лента
- **Исправление.**
  - **Раскладка.** `layoutFor` учитывает ширину канваса и выбирает `perRow` так, чтобы зум вписывания был не меньше 1 (≈ 3 в ряд при 1040 px, по высоте занимаем место). Либо `GraphCanvas` с `minFitZoom = 1` и вертикальной прокруткой.
  - **RouteStrip.** Чипы только с номерами «1 ▸ 2 ▸ … 8»; имя — по наведению или фокусу; Σ справа. На вкладке «Таблица» лента скрыта.
  - **Подсказка.** Строку подсказок заменить поповером «?» с ⌘ или Ctrl по платформе. У «Сохранить» и «Вписать» — `aria-keyshortcuts`.
  - **Стиль узлов.** `.gc-node` (P-21).
- **Файлы.** `src/features/nsi/routing/RoutingCanvas.tsx`, `src/features/nsi/routing/RoutingTable.tsx`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/features/nsi/routing/routing.css`
- **Приёмка.** При вписывании по умолчанию заголовки узлов не меньше 12 px. Имена в чипах не обрезаны.
- **Правила.** dataviz-labels-selective-text-tokens, enterprise-spacing-type-rhythm, enterprise-keyboard-and-focus, enterprise-progressive-disclosure

#### P-52 · S2 · Конструктор: глифы и цвета из общего словаря
- **Исправление.**
  - **Бейдж справочника.** Только на исключении: Chip setup «▲ тип не найден в Справочниках».
  - **Маркер самой долгой операции.** Либо переименовать в «самая длинная операция» (нейтральное кольцо и слово), либо считать узкое место по мощности как t_norm, делённое на число активных станков типа: «узкое место по мощности · 81 мин / 1 станок».
  - **Несохранённые изменения.** Chip idle «не сохранено».
  - **Охра.** Убрать `--ochre` из `routing.css`.
- **Файлы.** `src/features/nsi/routing/routing.css`, `src/features/nsi/routing/RoutingCanvas.tsx`, `src/features/nsi/routing/RoutingTable.tsx`, `src/features/nsi/routing/RoutingInspector.tsx`, `src/features/nsi/routing/routingModel.ts`
- **Приёмка.** В `routing.css` нет `--ochre`. У нормальных узлов нет бейджа.
- **Правила.** decision-one-state-vocabulary, dataviz-color-jobs-disjoint, enterprise-color-one-meaning, decision-calm-normal-color, aps-bottleneck-protagonist

#### P-53 · S2 · Ошибка загрузки не выдаётся за пустой справочник
- **Исправление.**
  - **Состояние ошибки.** `NsiScreen` его хранит; при ошибке под шапкой ErrorBanner (`errorText`, «Повторить»), тела таблицы нет.
  - **Пустые состояния.** EmptyState трёх видов: первый раз; ничего не найдено («Ничего не найдено» и «Сбросить поиск»); недоступно.
  - **Справочные загрузки.** Ошибки `wcTypes` и `products` показываются, а не тихо превращаются в сырые id.
  - **Формы и `RoutingScreen`.** Ошибки через `errorText` с «Подробнее».
- **Файлы.** `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/features/nsi/forms/WorkerForm.tsx`, `src/features/nsi/forms/OperationForm.tsx`
- **Приёмка.** При выключенном бэкенде виден баннер, а не «Записей нет — нажмите «Создать»». В nsi нет `.catch(() => {})`.
- **Правила.** enterprise-errors-plain-and-local, enterprise-designed-empty-states

#### P-54 · S2 · Инспектор операции: ничего не обрезано, IDEF0 по запросу
- **Исправление.**
  - **Имя.** Textarea на 2 строки с автовысотой.
  - **Ширина.** Инспектор 360 px через локальное `.rt-inspector { --inspector-w: 360px }` (глобальный токен не менять) или переносящийся listbox.
  - **IDEF0.** I/O/C/M — за раскрытием «Связи IDEF0 (0) ▸», которое открывается само, если есть значения. В таблице 4 столбца IDEF0 скрыты, пока все пустые (переключатель «Показать IDEF0»).
  - **Кнопки.** «+ Операция» — в панели инструментов `rt-tools`. «Удалить операцию» — в подвале инспектора за разделителем.
- **Файлы.** `src/features/nsi/routing/RoutingInspector.tsx`, `src/features/nsi/routing/RoutingTable.tsx`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/features/nsi/routing/routing.css`
- **Приёмка.** При 1440 px имя и тип не обрезаны. «+ Операция» видна без прокрутки.
- **Правила.** aps-master-data-list-detail, enterprise-progressive-disclosure, decision-two-level-disclosure

#### P-55 · S2 · Навигация Справочников: заголовок, реестры-ссылки, счётчики, URL
- **Исправление.**
  - **Заголовок.** `screenTitle('nsi')` = «Справочники»; реестр — в Breadcrumbs: «Справочники › Техкарты › ТК …» (kit, ссылки).
  - **Список реестров.** Пункты — `<a href="#/nsi/<id>" aria-current="page">` с приглушённым числом («Рабочие 86») и ▲, если есть неполные записи.
  - **Поиск и сортировка.** В параметрах hash. Поиск идёт по результату `cellText`.
  - **Счётчик.** «12 из 82 записей» через `plural`.
  - **Подзаголовки.** В одну строку, до 90 знаков:
    - Техкарты — «Как производится каждое изделие: операции, станки, нормы времени»;
    - Изделия — «Сырьё, полуфабрикаты и товары: состав, запасы, цены»;
    - Операции — «Шаги техкарт: тип станка, время, наладка».
  - **Пояснения.** Формула λ и обоснование допусков — в InfoTip со ссылкой на Методику.
  - **Крошки.** Локальную крошку в `RoutingScreen` удалить.
- **Файлы.** `src/features/nsi/NsiScreen.tsx`, `src/features/nsi/registries.ts`, `src/features/nsi/routing/RoutingScreen.tsx`, `src/features/nsi/forms/WorkerForm.tsx`, `src/features/nsi/forms/WorkCenterTypeForm.tsx`
- **Приёмка.** Cmd+клик по реестру открывает новую вкладку. После F5 поиск сохраняется. Надписи «82 записей» нигде нет.
- **Правила.** enterprise-url-is-state, enterprise-breadcrumbs-for-depth, enterprise-table-baseline, enterprise-one-name-per-destination, enterprise-screen-header-contract

### 3.4 scenarios — Сценарии и Мониторинг (`src/features/scenarios/**`, `src/features/forecast/**`)

#### P-56 · S1 · Значения на экране совпадают со значениями в расчёте, бейджи не лгут
- **Исправление.** `scenarioDefaults.ts` (alpha 0,1; max_share 0,6; corr 0,5; vol 0,05; months 6; fx 1; demand 1) импортируют ScenarioHeader, ConditionsTab, payloadOf и scenarioTemplates. `numOr(x, d)` заменяет `Number(x) || d` и сохраняет 0. Вызывающие передают `status` только когда значение равно умолчанию, иначе provenance `manual` (P-07: manual побеждает). Тесты: `payloadOf({market_corr:'0'}).market_corr === 0`; умолчание в шапке равно умолчанию в payload; ParamField с неумолчательным значением рендерит `data-key="manual"`.
- **Файлы.** `src/features/scenarios/scenarioDefaults.ts` (новый), `src/features/scenarios/scenarioPayload.ts`, `src/features/scenarios/ScenarioHeader.tsx`, `src/features/scenarios/ConditionsTab.tsx`, `src/features/scenarios/scenarioTemplates.ts`
- **Приёмка.** Без заданной доли шапка показывает «≤ 60 %», как движок. ρ = 0 сохраняется после перезагрузки. «Корреляция цен ρ 0,25» показывает «■ вручную».
- **Правила.** enterprise-defaults-with-provenance, decision-why-one-click, enterprise-save-and-undo, decision-connected-lineage

#### P-57 · S1 · Просмотр сценария не меняет рабочий сценарий; состояние в URL
- **Исправление.** Маршруты `#/scenarios/<id>/<tab>` и `#/scenarios/compare/<id>,<id>`. Начальный сценарий берётся из маршрута, затем из контекста решения, затем первый. Просмотр никогда не вызывает `setDecisionContext`. В списке рабочий сценарий помечен «● рабочий»; явная кнопка «Сделать рабочим» есть в шапке и в столбцах сравнения. Смена вкладки возвращает прокрутку к полосе вкладок. Segmented вкладок липкий (`top: 0`) внутри `.scn__main` и складывается с липкой шапкой DataTable.
- **Файлы.** `src/features/scenarios/ScenarioCompareScreen.tsx`, `src/features/scenarios/ScenarioTabs.tsx`, `src/features/scenarios/scenarios-v2.css`
- **Приёмка.** Заход в Сценарии не меняет сценарий Портфеля и Плана. F5 восстанавливает открытый сценарий, вкладку и выбор для сравнения. При смене вкладки видна её шапка.
- **Правила.** aps-state-persistence, enterprise-url-is-state, decision-connected-lineage, aps-connected-pipeline

#### P-58 · S1 · Следующий шаг из сценария; удалить мёртвый код
- **Исправление.**
  - **Шапка сценария.** Единственный primary «Найти робастный портфель →» (задаёт контекст и открывает Портфель) и ghost «Построить план →».
  - **Список.** «+» — ghost IconButton «Новый».
  - **Сравнение.** «Рассчитать портфели» всегда включена; если выбрано меньше двух, по нажатию InlineError.
  - **Заметка критерия.** «Портфель» и «План» — ссылки.
  - **Мёртвый код.** Удалить `ScenariosScreen.tsx` и `scenarios.css`. В `scenario-compare.css` оставить только живые правила: `.scn`, `.scn__side*`, `.scn__list`, `.scn__item*`, `.scn__check*`, `.scn__main`, `.scn__placeholder`, `.scn__h`, `.scn__hint`.
  - **ScenariosHub.** Экспорт остаётся тонкой обёрткой для `screens.tsx`.
- **Файлы.** `src/features/scenarios/ScenarioHeader.tsx`, `src/features/scenarios/ScenarioCompareScreen.tsx`, `src/features/scenarios/ScenarioCompare.tsx`, `src/features/scenarios/ScenariosScreen.tsx` (удалить), `src/features/scenarios/scenarios.css` (удалить), `src/features/scenarios/scenario-compare.css`
- **Приёмка.** На «Условиях» и в сравнении ровно одна заливная кнопка. Поиск `ScenariosScreen` пуст.
- **Правила.** decision-one-primary-next-step, aps-connected-pipeline, enterprise-connected-flow, enterprise-one-primary-per-region, enterprise-form-validation

#### P-59 · S1 · Честное сравнение: эффективные значения, база, Δ
- **Исправление.**
  - **Значения.** `effectiveScenario(sc)` подставляет `scenarioDefaults`, `CONDITION_ROWS` берут эффективные значения. Умолчание показывается приглушённо «○ по умолчанию», а не «—».
  - **Подписи.** `objectiveLabel` (P-06) вместо локальной карты `OBJECTIVES`.
  - **База и Δ.** Рабочий или первый сценарий закреплён первым столбцом «Базовый · база». В остальных ячейках значение и `DeltaChip` (P-09) с направлением «что лучше».
  - **Только отличия.** «только отличающиеся» распространяется и на `RESULT_ROWS` с подписями KPI Портфеля.
  - **Столбцы.** Не больше 5; в шапке каждого «Сделать рабочим».
  - **Вход в режим.** Сразу выбраны рабочий и открытый сценарии. Иначе EmptyState «Отметьте 2–5 сценариев — появятся отличия условий и портфели».
- **Файлы.** `src/features/scenarios/ScenarioCompare.tsx`, `src/features/scenarios/ScenarioCompareScreen.tsx`
- **Приёмка.** α 10 % против умолчания не показывается как отличие. «meanvariance» нигде нет. В ячейках есть Δ-чипы.
- **Правила.** aps-scenario-compare, decision-explicit-delta-vs-baseline, aps-status-not-color-alone, enterprise-designed-empty-states, aps-kpi-vocabulary

#### P-60 · S1 · Редактор распределения открывается рядом со строкой
- **Исправление.** Редактор — в kit `SidePanel` (P-22). Пока он открыт, `.sc2-tab` — сетка `1fr minmax(320px, 360px)`; панель липкая под вкладками. Esc закрывает её, фокус возвращается на строку. DensityMini и поля ввода остаются как есть.
- **Файлы.** `src/features/scenarios/DistributionsTab.tsx`, `src/features/scenarios/scenarios-v2.css`
- **Приёмка.** Клик по строке 40 не сдвигает вид, панель видна справа, макет не прыгает.
- **Правила.** decision-tables-not-card-walls, enterprise-table-filter-actions-edit, aps-master-data-list-detail, decision-temporal-feedback

#### P-61 · S1 · Δ на веере считается от «сейчас» и подписан
- **Исправление.** `forecastDelta(p)` в `forecast/forecastModel.ts` считает Δ к последней точке истории (или к `p50[0]`). Подпись «к горизонту +25 % от текущей»; при |Δ| ≥ 10 % — `signed()` без десятичных. База НСИ — по желанию пунктирная `refLine` «база НСИ 108 тыс. ₽» (P-18), в легенде и таблице-двойнике. Функцию используют ForecastTab и ForecastScreen.
- **Файлы.** `src/features/forecast/forecastModel.ts` (новый), `src/features/scenarios/ForecastTab.tsx`, `src/features/forecast/ForecastScreen.tsx`
- **Приёмка.** На карточке 05 знак чипа совпадает с видимым трендом медианы. Есть unit-тест `forecastDelta`.
- **Правила.** dataviz-kpi-needs-comparator, decision-explicit-delta-vs-baseline, decision-fan-chart-grammar, dataviz-annotate-events-sparingly

#### P-62 · S1 · Список сценариев и диалог создания готовы к защите
- **Исправление.**
  - **Данные (владелец, без кода).** Переименовать или удалить нецензурный и шаблонные сценарии. Задать «Базовому» `macro_mode` base, «Ценовому кризису» — режим 1.
  - **Имя в диалоге.** По умолчанию `uniqueName(t.name, existing)` → «Базовый 2». Дубль имени — строчная ошибка с `aria-invalid`.
  - **Тексты диалога.** Убрать фразу разработчика про `GET /api/scenarios/templates`.
  - **Столбец «Источник».** Простыми словами: «калибровка по ставке ЦБ РФ 2013–2026», «экспертная оценка», «норматив предприятия»; коды — в `title`.
  - **Режим и шаблоны.** Режим через `regimeLabel`. «Пустой» → «С нуля · значения по умолчанию».
- **Файлы.** `src/features/scenarios/ScenarioCreateDialog.tsx`, `src/features/scenarios/scenarioTemplates.ts`, `src/features/scenarios/ScenarioCompareScreen.tsx`
- **Приёмка.** В диалоге нет «/api», «r1.40», «§». Дубль имени блокируется с сообщением.
- **Правила.** aps-connected-pipeline, enterprise-form-validation, decision-one-state-vocabulary, enterprise-errors-plain-and-local

#### P-63 · S1 · «Мониторинг» становится монитором
- **Исправление.** `ForecastScreen.tsx` переписать как раскладку монитора; экспорт сохраняется, `screens.tsx` не трогать. Общие части — из `forecastModel` и `ForecastGrid`.
  - **Шапка.** Заголовок `screenTitle('monitoring')` = «Мониторинг». Подзаголовок в одну строку: «Внешние условия и цены: что изменилось к плану и насколько надёжен прогноз». Метод — в «i» со ссылкой на Методику.
  - **Порядок блоков.**
    1. Вердикт: «Цены сбыта за 6 мес: медиана +4 %, 7 из 76 рядов вне P10–P90 бэктеста; ставка ЦБ 13,5 % [11,4; 18,1]».
    2. Полоса KPI, не больше 5: OTD и просроченные последнего плана; загрузка узкого места; P(разрыв кассы) «в N из 100»; ставка через 6 мес; рядов хуже наивного.
    3. Исключения по степени тяжести: провален бэктест, ценовой шок выше порога, план на устаревшем прогнозе. Каждое ведёт в ForecastZoom или `#/plan`.
    4. Ряд во всю ширину: веер ключевой ставки (8 колонок) и плитка инфляции со Sparkline (4 колонки) — вместо текстовой цепочки.
    5. DataTable top-10 по |Δ медианы к базе| со Sparkline. Строка открывает ForecastZoom в выдвижной панели; ссылка «Все 76 рядов → Сценарии › Прогноз».
  - **Без сетки 76 вееров.**
  - **Состояния.** Ошибки — ErrorBanner простыми словами. Загрузка — скелеты ChartFrame итогового размера. Подпись группы без «(ТОТ ЖЕ ДВИЖОК)».
- **Файлы.** `src/features/forecast/ForecastScreen.tsx`, `src/features/forecast/ForecastGrid.tsx` (новый), `src/features/forecast/forecastModel.ts`, `src/features/forecast/forecast.css`, `src/features/forecast/ForecastZoom.tsx`
- **Приёмка.** Высота страницы не больше ≈ 2 экранов (было 10 047 px). Первая цифра не ниже 220 px. Сетки вееров нет.
- **Правила.** aps-display-hierarchy, decision-answer-first, aps-exceptions-inbox, dataviz-density-budget, decision-tables-not-card-walls, enterprise-screen-header-contract

#### P-64 · S1 · Мониторинг подключён к конвейеру
- **Исправление.**
  - **Сценарий по умолчанию.** Сценарий последнего плана (`planStore` / `api.simulation.plans()[0]`), иначе рабочий. В шапке чип происхождения «Сценарий «Базовый» · план №28 · 3 000 прогонов · 24.10 14:38».
  - **Выбранный сценарий.** Сводка только для чтения: «инфляция 1,5 %/мес · курс ×1 · …» и ссылка «изменить в Сценариях →».
  - **Ручной what-if.** За раскрытием «Ручные параметры (6) ▸»; при открытии переключает выбор на «ручные». Поля — ParamField с единицами и рамкой `--border-control`.
  - **Хранилище.** Новый `forecastStore.ts` по образцу `analytics/investStore`: `publishForecast` и `useForecastResult`. Вызывается из `ForecastScreen.run` и `scenarios/ForecastTab`.
  - **Связь с картой** — в P-121.
- **Файлы.** `src/features/forecast/forecastStore.ts` (новый), `src/features/forecast/ForecastScreen.tsx`, `src/features/scenarios/ForecastTab.tsx`
- **Приёмка.** Ручные поля никогда молча не игнорируются. После P-121 блок [7] полосы отражает прогноз.
- **Правила.** decision-connected-lineage, aps-connected-pipeline, enterprise-connected-flow, decision-sandboxed-what-if, enterprise-defaults-with-provenance

#### P-65 · S1 · Веера не завышают уверенность
- **Исправление.**
  - **Пороги `qualityOf` в `forecastModel`.** «bad» — skill < −0,5 или coverage80 < 0,5. «warn» — skill < 0 или coverage80 < 0,7. Иначе «ok». Значение передаётся в FanChart как `quality` (штриховка, P-18).
  - **Подзаголовок простыми словами, с частотой.**
    - Плохо: «▲ веер не откалиброван: в бэктесте внутри полосы 0 из 6 мес (ожидалось ≈ 5 из 6); хуже прогноза «как вчера» в 3 раза».
    - Хорошо: «● попадание 5 из 6 мес · лучше «как вчера» на 39 %».
  - **Прочее.** CRPS — в «i». Распределение через `fitLabel` (labels.ts). Δ ставки — в п. п. Дубли `qualityOf` и `fitLabel` в ForecastTab и ForecastScreen удалить.
- **Файлы.** `src/features/forecast/forecastModel.ts`, `src/features/forecast/ForecastScreen.tsx`, `src/features/scenarios/ForecastTab.tsx`
- **Приёмка.** Карточка с покрытием 50 % больше не получает зелёный ●. В коде одна функция `qualityOf`.
- **Правила.** decision-report-model-quality, decision-frequency-framing, dataviz-statement-titles, aps-status-not-color-alone, decision-name-the-interval

#### P-66 · S2 · Шапка сценария: строка заголовка и метастрока
- **Исправление.**
  - **Строка заголовка.** Поле имени, чип режима, «Сохранено», действия.
  - **Метастрока.** «Горизонт [дата] · 13 мес» и сводный чип критерия «E − λ·σ · α 10 % · ≤ 60 % ✎»; по клику открывается существующая строка из трёх полей.
  - **Крошки.** Eyebrow заменить на Breadcrumbs «Сценарии › Базовый › Условия».
  - **Предупреждения и пояснения.** «Без даты» — только короткая подсказка ▲ под пустой датой, цвет `--text-secondary`. Заметка критерия — в InfoTip. Абзацы `.sc2-tabhint` убрать; легенда — «i» рядом с вкладками.
  - **Вкладки.** Без [n]: «Распределения · 2 из 76 вручную»; липкие.
  - **Узкий экран.** При ширине меньше 1200 px `.scn__side` = 220 px и кнопка сворачивания.
- **Файлы.** `src/features/scenarios/ScenarioHeader.tsx`, `src/features/scenarios/ScenarioTabs.tsx`, `src/features/scenarios/scenarios-v2.css`, `src/features/scenarios/scenario-compare.css`
- **Приёмка.** При 1440×900 первая цифра не ниже 240 px. Вкладки не читаются как «1-2-7».
- **Правила.** aps-display-hierarchy, enterprise-quiet-chrome, dataviz-answer-first-hierarchy, enterprise-screen-header-contract, enterprise-breadcrumbs-for-depth

#### P-67 · S2 · «Условия»: важное первым, без внутренностей движка
- **Исправление.**
  - **Режим генератора.** Первым — видимый Segmented «Прогноз · Режим · Квантиль · Эпизод» со сводкой.
  - **Поля.** Редактируемые поля — одной текучей сеткой; подписи групп растянуты на всю ширину (`grid-column: 1 / -1`).
  - **Значения генератора.** Свёрнуты в одну строку: «Ставка ЦБ 14 %/год (сент. 2026) → линия ≈ 17 % · опора — последнее наблюдение».
  - **ParamField.** Скрыть владельца «этот сценарий»; передать `changed`/`onRevert` к `scenarioDefaults`. В шапке «изменено 6 полей · вернуть все».
  - **Горизонт.** Карточку «Горизонт» убрать: в шапке старт и месяцы, конец показан. Эпизод: «эпизод 2022-02 на первые 6 из 13 мес».
  - **Наследие.** Убрать legacy `<details>`.
  - **Значения паспорта.** `passportValueLabel()`: flat → «последнее наблюдение», 14.0 → «14 %».
- **Файлы.** `src/features/scenarios/ConditionsTab.tsx`, `src/features/scenarios/ScenarioHeader.tsx`, `src/features/scenarios/regimeMenu.ts`, `src/features/scenarios/scenarios-v2.css`
- **Приёмка.** Высота «Условий» не больше ≈ 1,3 экрана. Нет «macro.ref_key» и «(14.0)». Не больше одного абзаца длиннее двух строк.
- **Правила.** enterprise-progressive-disclosure, decision-two-level-disclosure, decision-sandboxed-what-if, dataviz-density-budget, enterprise-defaults-with-provenance

#### P-68 · S2 · Цвета на «Сценариях» — по своим работам
- **Исправление.**
  - **Тип режима.** Нейтральный Chip с глифом («◆ стресс», «● прогноз»), без тонов good/warn.
  - **Тексты.** σ > 20 % — ▲ и `--text` (без `--ochre`). `.sc2-warn` — `--text-secondary` и ▲.
  - **Корреляции.** `ui/charts` Heatmap с последовательной шкалой `--chart-1`.
  - **Плитки качества.** Нейтральная рамка и Chip с глифом и словом. Skill Meter — нейтральная заливка или `--chart-1`.
  - **Проверка.** `var(--status-|--verdigris|--cinnabar|--ochre|--ultramarine)` в `scenarios-v2.css` остаются только на бейджах и глифах.
- **Файлы.** `src/features/scenarios/scenarios-v2.css`, `src/features/scenarios/ScenarioHeader.tsx`, `src/features/scenarios/ConditionsTab.tsx`, `src/features/scenarios/RegimeMenuPanel.tsx`, `src/features/scenarios/ForecastTab.tsx`
- **Приёмка.** Поиск по CSS находит эти токены только на селекторах глифов и бейджей. Серый скриншот сохраняет смысл.
- **Правила.** enterprise-color-one-meaning, dataviz-color-jobs-disjoint, decision-calm-normal-color, aps-status-not-color-alone, a11y-ai-11

#### P-69 · S2 · «Прогноз и проверка»: внимание первым, таблица вместо стены
- **Исправление.**
  - **«Требуют внимания» (по умолчанию).** 6 вееров с худшим skill или самой широкой полосой P10–P90. Индекс 100 в точке «сейчас», общая шкала `yDomain` («−20 % · 0 · +20 %»).
  - **Таблица.** Ниже — DataTable всех 76: Sparkline, P50, P10–P90 на горизонте, качество, «открыть веер» → ForecastZoom в выдвижной панели.
  - **Общий код.** `ForecastGrid`, `qualityOf`, `fitLabel` вынести в `forecastModel.ts`, общий с P-63.
  - **Кэш.** Модульное хранилище по ключу `${sc.id}|${macro_mode}|${months}`.
  - **Перезапрос.** Прежнее содержимое остаётся с `.is-refetching`, запрос обёрнут в RunProgress.
- **Файлы.** `src/features/scenarios/ForecastTab.tsx`, `src/features/forecast/ForecastGrid.tsx`, `src/features/forecast/forecastModel.ts`, `src/features/scenarios/scenarios-v2.css`
- **Приёмка.** Высота вкладки не больше ≈ 3 экранов (было 15 054 px). Повторный заход не перезапрашивает. «Обновить» не схлопывает макет.
- **Правила.** decision-tables-not-card-walls, dataviz-same-data-same-form, decision-temporal-feedback, enterprise-loading-and-progress, dataviz-single-axis-honest-scales

#### P-70 · S2 · Блок качества прогноза начинается с вердикта
- **Исправление.**
  - **Вердикт.** Один InlineAlert warn: «Модель точнее «как вчера» лишь для 30 из 76 изделий; история синтетическая — веера ориентировочные».
  - **Плитки (2).** «Хуже наивного · 46 из 76» и «Покрытие 80 %-интервала · 80 % при ожидаемых 80 % · разброс 33–100 %».
  - **Метаданные.** Бэктест и MASE — в подзаголовке.
  - **Чипы.** Объединить в «▲ демо-данные (синтетика)» и чип ставки; «устаревшие поля» убрать.
  - **Лишний текст.** Абзац-предупреждение удалить.
  - **Столбец skill.** «ошибка к наивной ×4,5» на log2-Meter, целые числа. «Распределение» — через `fitLabel`.
- **Файлы.** `src/features/scenarios/ForecastTab.tsx`, `src/features/scenarios/scenarios-v2.css`
- **Приёмка.** Нет «−328,8 %». Не больше двух плиток. Нет дублирующих чипов синтетики.
- **Правила.** decision-report-model-quality, decision-answer-first, dataviz-kpi-needs-comparator, decision-precision-matches-evidence

#### P-71 · S2 · Таблица «Распределения» — плотная и спокойная
- **Исправление.**
  - **Панель массовых действий.** Только при `sel.size > 0`, не больше трёх действий.
  - **Оценка по истории.** Выключенную «Оценить все по истории» заменить одной приглушённой строкой и InfoTip, без кодов разработчика (`ts_data.synthetic`, R7, R20, AIC).
  - **Ячейка имени.** Первая часть в одну строку, приглушённый код, полное имя в `title`.
  - **Группы.** Липкие группы DataTable: «Изделия (сбыт) · N», «Сырьё · M».
  - **Фильтры и столбцы.** Чип-фильтр «только заданные вручную (2)». Если всё по умолчанию — столбец происхождения скрыт, в подписи «74 по умолчанию».
  - **Корреляции.** Блок — только если β различается. Иначе строка «ρ ≈ 0,49 для всех пар (β = 0,7)». Если показан — Heatmap из `ui/charts` с таблицей-двойником.
- **Файлы.** `src/features/scenarios/DistributionsTab.tsx`, `src/features/scenarios/scenarios-v2.css`, `src/features/scenarios/distModel.ts`
- **Приёмка.** Страница не больше ≈ 2 экранов (было 5 573 px). Строки 40 px. «ДЛЯ UI» не повторяется.
- **Правила.** enterprise-table-filter-actions-edit, enterprise-table-baseline, enterprise-errors-plain-and-local, dataviz-form-by-job, dataviz-same-data-same-form

### 3.5 optimization — Портфель (`src/features/optimization/**`; только полировка, логика и числа не меняются)

#### P-72 · S1 · «σ прибыли» не превращается в «Σ»
- **Исправление.** `Kpi` в `PortfolioCards` рендерит `<CapsLabel text={label}/>`. То же для `opt-eyebrow` и eyebrow карточки ExactCard, где есть греческие буквы. В тесты `labelParts` добавить «σ прибыли».
- **Файлы.** `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/OptimizationScreen.tsx`
- **Приёмка.** На плитке «σ ПРИБЫЛИ».
- **Правила.** aps-kpi-vocabulary, dataviz-kpi-needs-comparator, decision-why-one-click

#### P-73 · S1 · Вне выборки: вердикт учитывает направление
- **Исправление.** Только отображение.
  - **Вердикт.** `overfit = gap_expected > 0,05 || gap_cvar > 0,05` (вне выборки хуже). Иначе Chip running «● вне выборки не хуже» с `title` «порог: хуже на 5 %». Порог в тексте метрики — 5 %.
  - **Строки.** «49,7 млн ₽ · на 8,8 % выше, чем в выборке»; «−52,8 млн ₽ · на 1,6 % лучше».
  - **«i».** Получает `{e_in, e_out, gap_e, cvar_in, cvar_out, gap_cvar}`.
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/explain/metrics.opt.ts`
- **Приёмка.** На текущем демо нет «переобучения». В формуле «i» нет «—».
- **Правила.** decision-report-model-quality, decision-why-one-click, aps-status-not-color-alone, decision-explicit-delta-vs-baseline

#### P-74 · S1 · «Состав портфеля» — таблица с подписанными столбцами
- **Исправление.** Шапка «Изделие · Объём, шт · Вклад в прибыль, ₽ · Доля в риске, %». Деньги и доля риска — отдельные ячейки, справа, `tabular-nums`. В ячейке не больше одной полосы (вклад в прибыль, Meter tone accent → `--chart-1`) или ни одной; тон warn не используется. Чипы: «6 изделий», «HHI 0,38» с InfoTip `opt.hhi`, «макс. доля 57 % из ≤ 60 %» относительно `result.max_share`; ▲ — только когда доля ≥ `max_share`.
- **Файлы.** `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/optimization.css`
- **Приёмка.** В составе нет янтарной полосы. У каждого числа есть шапка или единица.
- **Правила.** dataviz-color-jobs-disjoint, decision-calm-normal-color, dataviz-tables-for-lookup, enterprise-table-baseline, enterprise-contextual-help-pull

#### P-75 · S1 · Один цвет — один портфель
- **Исправление.**
  - **Роли цвета.**
    - Устойчивый портфель — охра ▲ (`--chart-2`), только на маркере Парето и глифе «выбрано» в герое.
    - «Макс. E» — `--chart-other`/`--text-secondary`, пунктирный контур и ■.
    - Хвост и CVaR — `--chart-4` со штриховкой.
    - E — `--chart-1`.
    - «Худший» — квадрат `--chart-4` (не `--status-down`).
  - **Реализация.** Локальные переопределения в `opt-screen.css`: `.pd .ch-hist__outline`, `.pf .ch-dot--alt .ch-marker`. Обновить оба массива `LEGEND`. `.opt-dot--u` → `--chart-1`, `.opt-dot--r` → `--chart-4`.
- **Файлы.** `src/features/optimization/ProfitDistribution.tsx`, `src/features/optimization/ParetoFrontier.tsx`, `src/features/optimization/opt-screen.css`
- **Приёмка.** Охра на странице обозначает только выбранный портфель. Легенды гистограммы и Парето согласованы.
- **Правила.** dataviz-categorical-fixed-order-cap, dataviz-color-jobs-disjoint, enterprise-color-one-meaning, dataviz-emphasis-over-rainbow, decision-one-state-vocabulary

#### P-76 · S1 · Передача в «План» — один блок под вердиктом
- **Исправление.**
  - **Блок передачи.** Наверху RobustHero: поле с `aria-label` «Название производственной программы» и primary «Передать в «План» →». Кнопку прокрутки в шапке и дубль внизу убрать.
  - **Кнопка запуска.** Пока результат свежий и форма не менялась — вторичная «Пересчитать». Primary снова, когда результат устарел или его нет.
  - **Успех.** Chip «● Сохранено · чч:мм» и ссылка «Открыть в мастере плана →» (`#/plan/new/program`), вызов `setDecisionContext({portfolioRunId, planId})`.
  - **Ошибка.** InlineError, не зелёный текст.
  - **Доступность.** `role=status` / `role=alert`.
  - **Пустое состояние.** Без дублирующей кнопки, ссылка «↑ к параметрам».
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/opt-screen.css`
- **Приёмка.** На результате ровно один видимый primary. Текст ошибки не зелёный.
- **Правила.** decision-one-primary-next-step, enterprise-one-primary-per-region, enterprise-connected-flow, aps-connected-pipeline, a11y-ai-09, enterprise-save-and-undo

#### P-77 · S1 · Результат Портфеля переживает F5 и знает своё происхождение
- **Исправление.**
  - **Восстановление.** При монтировании, если `!result && getDecisionContext().portfolioRunId`: `api.optimize.run_get(id)` → `finishOptRun(res)` с пометкой «из истории».
  - **Происхождение в шапке.** «#a1b2c3 · «Базовый» · E − λ·σ · N = 3 000 · 24.10.2026, 14:32».
  - **Устаревание.** Форма сравнивается с результатом (`scenario_id`, `objective`, `alpha`, `samples`, `max_share`, горизонт). При расхождении — «устарело ▲ — параметры изменены после расчёта» и «Пересчитать».
  - **Во время пересчёта.** Результат приглушён до 0,6 с пометкой «пересчитывается».
  - **Оптимизатор не трогать.**
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/optStore.ts`
- **Приёмка.** После F5 виден последний результат. Правка α показывает метку «устарело».
- **Правила.** decision-connected-lineage, aps-state-persistence, enterprise-url-is-state, decision-temporal-feedback

#### P-78 · S2 · Ответ — выше сгиба
- **Исправление.**
  - **Подзаголовок.** Одна строка до 140 знаков: «Какие изделия выпускать, чтобы неблагоприятные цены не привели к большому убытку». Метод — в «i» или Методику.
  - **Параметры после расчёта.** Карточка сворачивается в строку «Базовый · E − λ·σ · α 10 % · 3 000 сценариев · доля ≤ 60 % · 13 мес ▸ Изменить параметры». Раскрыта по умолчанию только при пустом или устаревшем результате.
  - **Состав.** Первые 3 и «все 6 изделий».
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/opt-screen.css`, `src/features/optimization/PortfolioCards.tsx`
- **Приёмка.** Первое число решения не ниже 220 px. Над сгибом не больше 14 чисел.
- **Правила.** decision-answer-first, dataviz-answer-first-hierarchy, enterprise-screen-header-contract, dataviz-density-budget, enterprise-progressive-disclosure

#### P-79 · S2 · Вердикт и критерий — словами
- **Исправление.**
  - **Вердикт под заголовком (из имеющихся чисел).** «Выпускать 6 изделий: в среднем +45,7 млн ₽, убыток — в 35 из 100 сценариев; в худших 10 % в среднем −53,7 млн ₽ против −497 млн ₽ у «макс. E»».
  - **Чип критерия по цели.** CVaR — «CVaR · α = 10 %»; meanvariance — «E − λ·σ · λ = {lambda}»; также worstcase и minregret.
  - **Метрики.** Плитка оптимизируемой метрики отмечена охрой ▲. Под P(убыток) — «в 35 из 100 сценариев» (то же в карточке сравнения). В «Для сравнения» — строка, при каком условии выбор поменяется.
  - **Цена робастности.** Одна строка, остальное в «i».
  - **Пустое состояние.** Использует `objHint`, без «~120».
- **Файлы.** `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/OptimizationScreen.tsx`
- **Приёмка.** «из 100» встречается в optimization не меньше двух раз. Для meanvariance α не показывается.
- **Правила.** decision-answer-first, decision-frequency-framing, decision-evidence-for-and-against, aps-explain-solution, aps-uncertainty-honest

#### P-80 · S2 · Спокойные числа и бюджет акцента
- **Исправление.**
  - **Числа.** Значения в `--text`; состояние — подстрока «глиф + слово». Порог good 0,02 убрать или подписать.
  - **Цена робастности.** `.dk-kpi__value--md` в `--text`.
  - **Фоны.** Удалить фоны `.opt-por` и заливки страницы `.opt2`.
  - **Шапка героя.** Eyebrow — `--text-muted`.
  - **Чипы.** «Выбрано» — нейтральный Chip с охрой ▲, не tone setup. Чип критерия нейтральный, без ◆.
  - **Мёртвый CSS.** Удалить мёртвые блоки `optimization.css`, оставить `.pf-div*`, `.pf-items`, `.pf-item*`.
- **Файлы.** `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/opt-screen.css`, `src/features/optimization/optimization.css`
- **Приёмка.** На первом экране вне графиков не больше 3 насыщенных оттенков. Нет красного или зелёного текста чисел.
- **Правила.** decision-calm-normal-color, aps-status-not-color-alone, aps-accent-budget, dataviz-one-hero-figure, a11y-ai-11

#### P-81 · S2 · Гистограмма прибыли: свои интервалы, до трёх подписей, вывод в заголовке
- **Исправление.** Нужно согласие владельца на смену биннинга отображения; метрики не меняются.
  - **Данные.** Брать `histogram_robust`, если он есть, иначе `histogram`.
  - **Робастные интервалы.** Контур «макс. E» убрать. Сравнение — один раз в подзаголовке: «у «макс. E» разброс от −792 млн до 2,25 млрд ₽».
  - **Подписи и легенда.** Не больше трёх подписей: линия VaR, скобка, «худший». Из легенды убрать E и CVaR — они подписаны прямо.
  - **Заголовок.** «В 1 из 10 сценариев прибыль ниже −47 млн ₽».
  - **Подсказка.** Диапазоны вида «от −150 до −50 млн ₽» (P-19).
- **Файлы.** `src/features/optimization/ProfitDistribution.tsx`, `src/features/optimization/PortfolioCards.tsx`
- **Приёмка.** У робастного распределения больше 5 столбцов. Не больше трёх подписей.
- **Правила.** dataviz-annotate-events-sparingly, dataviz-statement-titles, decision-chart-anatomy, dataviz-labels-selective-text-tokens, dataviz-uncertainty-graded-and-framed

#### P-82 · S2 · Каждое «i» показывает формулу с числами
- **Исправление.** Передать значения в InfoTip:
  - `opt.pareto` — `{n_pareto, n_cand}`;
  - `opt.resource_load` — `{load, cap, util}` для верхней строки;
  - карточка LP — добавить `opt.exact_gap` в `metrics.opt.ts`: 100·(LP − эвр.)/|эвр.|, 4 значения; либо убрать подсказку CVaR;
  - чип концентрации — `opt.max_share` `{share, limit}`;
  - столбец риска — `opt.risk_contribution` `{rc}`.

  Тест в `metrics.test` проверяет, что каждый InfoTip экрана получает все ключи своих плейсхолдеров.
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/PortfolioCards.tsx`, `src/explain/metrics.opt.ts`, `src/explain/metrics.test.ts`
- **Приёмка.** После расчёта ни в одном «i» Портфеля нет «—». Тест зелёный.
- **Правила.** decision-why-one-click, enterprise-contextual-help-pull, aps-explain-solution

#### P-83 · S2 · Параметры: честное происхождение, проценты, LP по месту
- **Исправление.**
  - **Бейджи.** У селекта сценария бейджа нет. Если ничего не переопределено — одна строка группы «Все параметры — из сценария «Базовый» ○ · легенда». Бейдж у поля — только при переопределении: «■ этот прогон · вернуть».
  - **Переопределение.** Для прогонов и горизонта — `changed` и `onRevert` (сравнение с «3000» и с месяцами сценария).
  - **Единицы.** α и максимальная доля показываются в процентах (×100); хранилище не меняется.
  - **Переключатель LP.** Выключен с причиной «LP — только для CVaR и худшего случая», если цель не cvar и не worstcase.
  - **Подсказка цели.** `objHint` — под Segmented критерия.
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`
- **Приёмка.** Нигде нет единицы «доля». Нет пяти «○ ПО УМОЛЧ.» подряд.
- **Правила.** enterprise-defaults-with-provenance, decision-one-state-vocabulary, aps-progressive-disclosure, dataviz-precision-and-units

#### P-84 · S2 · Карточка точной LP: знак различим, таблица из кита
- **Исправление.**
  - **Разрывы.** `.dk-kpi__value--md`, sans, `--text`, плюс ▲/▼ и слово: «LP лучше на 2,1 %» / «эвристика лучше на 0,4 %». Тон по знаку — только на глифе.
  - **Теневые цены.** Kit DataTable: человеческое имя первым, «Теневая цена, ₽/ч», «Загрузка, %», по желанию Meter `--chart-1`; сортировка по убыванию.
  - **Мёртвый CSS.** Удалить `.opt2-bar`, `.opt2-table` и display-шрифт у `.opt2-gain`.
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/opt-screen.css`
- **Приёмка.** Нет чисел display-шрифтом. Отрицательный разрыв не зелёный.
- **Правила.** dataviz-one-hero-figure, decision-calm-normal-color, enterprise-table-baseline, dataviz-recessive-solid-chrome

#### P-85 · S2 · Парето и загрузка: выводы в заголовках, порог на графике
- **Исправление.**
  - **Заголовки-выводы.** «Устойчивый портфель — на границе: меньше риска ценой доходности · 28 недоминируемых из 90». «Мощности не ограничивают портфель: максимум 18 % — Резьбонарезной станок».
  - **BarList загрузки.** Метка `mark` 0,8 «80 % — близко к пределу» (P-19). Первые 8 и «Все 14 типов». Подписи шире.
  - **Карточки.** Высоты выровнены.
  - **Ось Парето.** Подпись y: «ожидаемая прибыль E, ₽ ↑».
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/ParetoFrontier.tsx`
- **Приёмка.** Нет заголовков-кодов в капсе. Опорная линия видна.
- **Правила.** dataviz-statement-titles, aps-load-capacity-chart, decision-length-position-sorted, decision-chart-anatomy

#### P-86 · S2 · Имена на Портфеле: экран, критерий, показатели
- **Исправление.**
  - **Шапка.** Заголовок `screenTitle('optimization')` = «Портфель». Eyebrow «Решения · Стадия 2 — что выпускать». «Робастный» — в подзаголовок.
  - **Критерий.** `OBJECTIVES` в `optTypes` реэкспортирует `objectiveLabel` из `labels.ts`. Текст LP — «E − λ·σ».
  - **Показатели.** Одна карта подписей: «Ожидаемая прибыль E», «CVaR (худшие 10 %)», «Худший сценарий», «P(убыток)», «σ прибыли». Её используют ExpectedCard, OosCard и подсказка Парето.
- **Файлы.** `src/features/optimization/OptimizationScreen.tsx`, `src/features/optimization/optTypes.ts`, `src/features/optimization/PortfolioCards.tsx`, `src/features/optimization/ParetoFrontier.tsx`
- **Приёмка.** В рельсе, TopBar и шапке — «Портфель». Подписи KPI в карточках совпадают.
- **Правила.** enterprise-one-name-per-destination, aps-kpi-vocabulary, aps-connected-pipeline, decision-consistent-screen-anatomy

### 3.6 plan — План (`src/features/plan/**`)

#### P-87 · S1 · У результата плана один адрес и одна шапка
- **Исправление.** Маршрут `#/plan/run/<plan_id>[/<section>]` рендерит только PlanScreen.
  - **Запуск.** `LaunchStep.launch()` переходит на `run/<id>`.
  - **Мастер.** Убрать из него `ResultStep`: шаг 7 становится ссылкой на последний прогон, либо в мастере остаётся 6 шагов.
  - **Открытие прогона.** `run/<id>` вызывает `planActions.openCached(id)`; если кэша нет — вид только с KPI из `kpi_series`.
  - **«Новый план».** Всегда открывает `new/program`, заполненный параметрами последнего прогона.
  - **Шапка.** Компактная, заголовок `runLabel` («План №28 · CR + ГА · 24.10 17:38») и ссылка на сценарий-источник. Убрать `blocks`: блоки и так показывает полоса.
  - **Оглавление.** `ResultToc` пишет раздел в hash через `replaceState`.
- **Файлы.** `src/features/plan/PlanScreen.tsx`, `src/features/plan/wizard/PlanWizard.tsx`, `src/features/plan/wizard/steps/ResultStep.tsx`, `src/features/plan/wizard/steps/LaunchStep.tsx`, `src/features/plan/ResultToc.tsx`, `src/features/plan/planStore.ts`
- **Приёмка.** Скопированный URL воспроизводит результат и раздел. «Новый план» никогда не открывает старый результат. Первый KPI не ниже 220 px.
- **Правила.** aps-state-persistence, enterprise-url-is-state, decision-connected-lineage, aps-display-hierarchy, enterprise-screen-header-contract

#### P-88 · S1 · Касса: сбой решателя не выглядит идеальным результатом
- **Исправление.**
  - **Один исход на два компонента.** Селектор `cashOutcome(cash, running, error)` → `'none'|'running'|'ok'|'failed'`, его используют и PlanKpis, и CashTiles.
  - **Если `status !== optimal`.** Плиток нет. InlineError warn «Касса не рассчитана: решатель остановился по лимиту времени. Уменьшите число сценариев или L_min», кнопки «Повторить» и «Подробнее» (reason, solve_ms). Плитка KPI — ▲ «не рассчитано».
  - **Ход расчёта.** RunProgress внутри раздела «Касса», min-height сохраняется. Видны прошедшее время, этап и «Отменить» (AbortController в `cashStore`). ETA считается от `n_scenarios`.
  - **Подзаголовок раздела.** Либо нарисовать недельный веер кассы (p05/p50/p95 на LineChart), либо изменить подзаголовок на то, что действительно нарисовано.
- **Файлы.** `src/features/plan/CashTiles.tsx`, `src/features/plan/PlanKpis.tsx`, `src/features/plan/PlanResult.tsx`, `src/features/finance/cashStore.ts`
- **Приёмка.** Прогон с `time_limit` не показывает нулевых плиток. Плитка KPI и раздел согласованы. «Отменить» прерывает запрос.
- **Правила.** enterprise-errors-plain-and-local, decision-temporal-feedback, enterprise-loading-and-progress, aps-uncertainty-honest, aps-exceptions-inbox

#### P-89 · S1 · История планов без противоречий и с быстрым путём
- **Исправление.**
  - **Пустая история.** Герой «первого раза» — только при `rows.length === 0`. Иначе одна строка «Последний прогон №28 · CR · 24.10 17:38 — Открыть · Повторить»; пояснения — в «i» или Методику.
  - **Столбцы RunsTable.** Прогон (№) · Когда · Правило · Источник/сценарий · E[Cmax] · CVaR · OTD · Узкое место.
  - **Действия строк.** У кэшированных — «открыть». У остальных — чип «только KPI» и «сравнить с текущим». У каждой строки — «повторить»: параметры мастера хранятся вместе с CachedPlan и пакетом KPI.
  - **Скелетон.** С задержкой (P-16).
- **Файлы.** `src/features/plan/PlanScreen.tsx`, `src/features/plan/RunsTable.tsx`, `src/features/plan/planStore.ts`, `src/features/plan/wizard/wizardStore.ts`
- **Приёмка.** При 28 прогонах `#/plan` не пишет «План ещё не построен». У каждой строки есть «повторить».
- **Правила.** aps-wizard-and-fast-path, enterprise-designed-empty-states, aps-state-persistence, enterprise-loading-and-progress

#### P-90 · S1 · Один прогон — один номер и одно время везде
- **Исправление.** Внедрить `runLabel` и разбор UTC (P-05) в шапке PlanScreen, RunsTable и мастере. Даты в тексте ProgramStep и мастера — через `date`/`dateTime`; `toIsoDate` — только в payload. MENTAT и полоса используют ту же подпись (P-03).
- **Файлы.** `src/features/plan/PlanScreen.tsx`, `src/features/plan/RunsTable.tsx`, `src/features/plan/wizard/steps/ProgramStep.tsx`
- **Приёмка.** В шапке и RunsTable одинаково «№28 · 14:38». В тексте мастера нет «2027-11-18».
- **Правила.** aps-connected-pipeline, enterprise-one-name-per-destination, decision-connected-lineage, enterprise-numbers-first-class

#### P-91 · S1 · Иллюстративные ходы не выдаются за результат
- **Исправление.**
  - **Нет ходов.** При `movesSource` 'demo' или 'none' раздел — одна строка EmptyState «Ходов агента нет: политика RL не опубликована (гейт не пройден) · Почему → Агенты».
  - **Пример.** Под свёрнутым «Показать пример (иллюстративные деньги) ▸», в пунктирной рамке, с «пример» в строке итогов.
  - **Оглавление.** Пункт «Ходы» — только при `kind === 'agent'`.
  - **PlanDiffView.** Диф / До / После / Маршрут / Таблица скрыты, если ходы не агентские и нет ни одного решённого хода. Пустые диф и маршрут — без шапки дат и подсказок клавиш.
  - **Настоящие ходы.** «Принять» в строке, «Отклонить с причиной…» и «Заморозить» — в ⋯. Заголовки переносятся до двух строк. Чип режима — tone idle.
- **Файлы.** `src/features/plan/PlanResult.tsx`, `src/features/plan/moves/MovesPanel.tsx`, `src/features/plan/moves/MoveRow.tsx`, `src/features/plan/moves/movesSource.ts`, `src/features/plan/diff/PlanDiffView.tsx`, `src/features/plan/diff/GanttDiff.tsx`, `src/features/plan/moves/moves.css`
- **Приёмка.** В демо-прогоне нет зелёных денежных итогов. В оглавлении нет «Ходы агента».
- **Правила.** decision-evidence-for-and-against, aps-safe-exploration, enterprise-designed-empty-states, decision-two-level-disclosure, a11y-ai-22

#### P-92 · S2 · Узкое место — главный герой, виды связаны общим выбором
- **Исправление.**
  - **Определение и порог.** Одно определение — загрузка фонда. ▲ «перегрузка» — только от 85 %, иначе нейтрально: ○ «загрузка 63 % · запас 37 %». Рамка `--pl-line`, не охра.
  - **Очередь.** Если пик очереди у другой машины — второй факт: «очередь копится у Фрезерного ЦЧПУ (пик 102)».
  - **Общий выбор.** Хук `usePlanSelection {wc, machine, order}`.
  - **Ссылки баннера.** «на Ганте ↓», «в загрузке ↓», «на схеме →» (`schemeHref`, P-38).
  - **Реакция видов.** Гант раскрывает, закрепляет и обводит группу. LoadBars подсвечивает строку. QueueFilter по умолчанию на узком месте.
  - **«Что определило».** Слить в раздел узкого места как таблицу причин (−1 пункт оглавления).
- **Файлы.** `src/features/plan/BottleneckBanner.tsx`, `src/features/plan/WhatDrove.tsx`, `src/features/plan/QueueChart.tsx`, `src/features/plan/Gantt.tsx`, `src/features/plan/LoadBars.tsx`, `src/features/plan/usePlanSelection.ts` (новый), `src/features/plan/plan-screen.css`
- **Приёмка.** Баннер при 63 % без ▲. Клик по строке LoadBars прокручивает Гант к строке.
- **Правила.** aps-bottleneck-protagonist, aps-linked-views, aps-status-not-color-alone, decision-calm-normal-color, decision-answer-first

#### P-93 · S2 · Оглавление результата подсвечивает то, что видно
- **Исправление.** Видимость разделов хранится в `Map<id, isVisible>` между вызовами observer; активный — первый видимый в порядке документа. По клику — сразу активный, наблюдатель игнорируется до `scrollend`. Root — скроллер `.plan`, `rootMargin: -${tocHeight + 8}px 0px -55% 0px`. Шесть пунктов: KPI · Узкое место · Гант · Очереди и загрузка · Таблицы · Касса; регистр предложения, `--fs-12`. `scroll-padding-top` у `.plan` равен высоте оглавления.
- **Файлы.** `src/features/plan/ResultToc.tsx`, `src/features/plan/PlanResult.tsx`, `src/features/plan/plan-screen.css`
- **Приёмка.** Клик «Узкое место» подсвечивает его. Оглавление не прыгает на ссылки.
- **Правила.** enterprise-keyboard-and-focus, a11y-ai-04, aps-display-hierarchy, decision-consistent-screen-anatomy

#### P-94 · S2 · Гант по канону APS
- **Исправление.**
  - **Подписи дорожек.** Различающая часть («№1 · 8544-01»), многоточие в середине. Ширина `LANE_W` 240 px с ручкой перетаскивания.
  - **Ось.** Двухуровневая: даты над сменами или часами от `startDate`.
  - **Линии.** Подписанные «старт плана» и «горизонт Стадии 2».
  - **Режим вида.** Segmented «по станкам / по заказам». В режиме заказов — ◆ срока, остальные заказы приглушены до 30 %.
  - **Легенда.** Чипы-переключатели в строке инструментов `.pl-gtb`.
  - **«Вписать».** Весь горизонт, строки 18 px, `max-height: 70vh`; в полноэкранном режиме без вложенной прокрутки.
- **Файлы.** `src/features/plan/Gantt.tsx`, `src/features/plan/GanttParts.tsx`, `src/features/plan/ganttModel.ts`, `src/features/plan/charts.css`
- **Приёмка.** Нет двух одинаковых видимых подписей дорожек. Ось двухуровневая. Легенда в строке инструментов.
- **Правила.** aps-gantt-anatomy, aps-gantt-overview-detail, aps-gantt-reference-shapes, dataviz-labels-selective-text-tokens, aps-order-risk-triad

#### P-95 · S2 · Цвета на Ганте и в KPI плана — по своим работам
- **Исправление.**
  - **Наладка.** Тёмно-нейтральная штриховка `color-mix(ink 55 %)`, в легенде ▲.
  - **ТО и ремонт.** Серая штриховка `--chart-8` и ■.
  - **Просрочка.** Контур и глиф ■ `--status-down`.
  - **Заливка баров.** Статусные оттенки никогда не заливают бары; цвет — через `slotForEntity` (P-20).
  - **KPI.** `kpi.css .pl-tail__key::before` → `--chart-1` или `--text`. OTD ≥ 99 % — нейтральный Meter, состояние в чипе «● все в срок».
  - **Мёртвый CSS.** Удалить правила `.pl-ubar`.
- **Файлы.** `src/features/plan/charts.css`, `src/features/plan/GanttParts.tsx`, `src/features/plan/Gantt.tsx`, `src/features/plan/kpi.css`, `src/features/plan/PlanKpis.tsx`
- **Приёмка.** На сером Ганте различимы наладка, ТО и просрочка. `var(--status-` в `plan/charts.css` встречается только на глифах и контурах.
- **Правила.** aps-gantt-reference-shapes, aps-gantt-color-budget, dataviz-color-jobs-disjoint, decision-calm-normal-color, aps-accent-budget

#### P-96 · S2 · Рамка мастера плана
- **Исправление.**
  - **Подвал.** `.wz-foot` — сплошной `--bg-app`, верхняя волосяная линия и `--shadow-1`. У `.wz-main` padding-bottom или scroll-padding-bottom равен высоте подвала.
  - **Незавершённые шаги.** 'result' и 'launch' не считаются незавершёнными.
  - **Кнопки навигации.** Названы по `STEP_META`: «← Условия», «Распределения →». «к запуску →» убрать.
  - **Добавление заказа.** «+ Добавить заказ» — secondary.
  - **Черновик.** `wizardStore` сохраняется в localStorage (try/catch): источник, runId, переопределения, шаг.
  - **Подсветка шагов.** Перепроверить в активной вкладке.
- **Файлы.** `src/features/plan/wizard/PlanWizard.tsx`, `src/features/plan/wizard/wizard.css`, `src/features/plan/wizard/wizardStore.ts`, `src/features/plan/wizard/steps/ProgramStep.tsx`
- **Приёмка.** Подвал никогда не закрывает содержимое. Перезагрузка посреди мастера восстанавливает шаг и значения. Primary есть только на шаге запуска.
- **Правила.** enterprise-wizard-steps, aps-wizard-and-fast-path, decision-one-primary-next-step, enterprise-one-primary-per-region, a11y-ai-04

#### P-97 · S2 · Мастер говорит словами, а не идентификаторами
- **Исправление.**
  - **Подписи.** `labels.ts` во всех шагах: ProgramStep (локальную `OBJ` удалить), ConditionsStep («недопокрытие: ключевая ставка»), ObjectiveStep, LaunchStep (`fmtField`), FinancialCard.
  - **Имя сценария.** `scName = name || 'сценарий без имени'`.
  - **Коды.** Буквенные [НОРМ], [К] → ProvenanceBadge. Эндпоинты и имена файлов (`l0_policy.onnx`, `GET /api/macro/summary`) — за «Подробнее».
  - **Формула.** В «i». Видна одна фраза: «Минимизируем срок; хвост риска штрафуем вдвое слабее».
  - **`moveKinds.ts`.** what/mask простыми словами: «альтернативная техкарта изделия», «срок запуска заказа», «цех операции», «выборка транша не больше свободного лимита», «число партий».
- **Файлы.** `src/features/plan/wizard/steps/ConditionsStep.tsx`, `src/features/plan/wizard/steps/ObjectiveStep.tsx`, `src/features/plan/wizard/steps/ConstraintsStep.tsx`, `src/features/plan/wizard/steps/FinancialCard.tsx`, `src/features/plan/wizard/steps/LaunchStep.tsx`, `src/features/plan/wizard/steps/ProgramStep.tsx`, `src/features/plan/moves/moveKinds.ts`
- **Приёмка.** В видимом тексте мастера нет `meanvariance`, `key_pp`, `fin_params`, `onnx`, `[НОРМ]`.
- **Правила.** enterprise-one-name-per-destination, decision-one-state-vocabulary, enterprise-defaults-with-provenance, aps-progressive-disclosure, enterprise-errors-plain-and-local

#### P-98 · S2 · Каждый шаг мастера помещается на экран
- **Исправление.**
  - **«Программа».** Портфели Стадии 2 — компактная DataTable (Когда · Сценарий · Критерий · E[Π] · CVaR · Изделий). Последний выбран; видны 3 строки и «все 12»; без вложенной прокрутки.
  - **«Распределения».** Одна колонка строк ParamField md; заметки — в «i», видимого текста не больше строки.
  - **«Цель».** Segmented пресета и одна фраза. α, N и веса — за раскрытием «Экспертно (α 10 % · N 500) ▸».
  - **Касса.** «Критерий кассы» и «Финансирование» переезжают в раздел «Касса» к кнопке «Рассчитать кассу» (CashTiles / FinancialCard).
- **Файлы.** `src/features/plan/wizard/steps/ProgramStep.tsx`, `src/features/plan/wizard/steps/DistributionsStep.tsx`, `src/features/plan/wizard/steps/ObjectiveStep.tsx`, `src/features/plan/wizard/steps/FinancialCard.tsx`, `src/features/plan/wizard/wizard.css`, `src/features/plan/CashTiles.tsx`
- **Приёмка.** При 1440×900 ни один шаг не прокручивается. На шаге не больше 14 чисел.
- **Правила.** decision-tables-not-card-walls, enterprise-wizard-steps, dataviz-density-budget, enterprise-progressive-disclosure

#### P-99 · S2 · KPI плана: вердикт и названный интервал
- **Исправление.**
  - **Вердикт.** Над ярусом A, из KPI: «План 418,6 ч (≈ 17 сут); в 10 % худших сценариев — до 507 ч, в горизонте Стадии 2; все 6 заказов в срок; узкое место — Резьбонарезной (63 %)».
  - **Плитки.** Kit `KpiTile` (P-09).
  - **Подпись героя.** «дет. 397 · E 418,6 · CVaR₉₀ 507 · худший 684 ч · N = 500 прогонов»; пояснение «CVaR₉₀ — среднее 10 % худших».
  - **OTD.** Подстрока «в хвосте (CVaR₉₀) просрочка 0 ч · 6 из 6 заказов».
  - **Типографика.** `.pl-ga__big` → Onest 44/300, `--text`.
- **Файлы.** `src/features/plan/PlanKpis.tsx`, `src/features/plan/kpiParts.tsx`, `src/features/plan/kpi.css`
- **Приёмка.** Одна строка вердикта. У каждой MC-плитки есть интервал и N. Ровно одно число размером 44 px.
- **Правила.** decision-answer-first, decision-never-lone-point, decision-name-the-interval, aps-uncertainty-honest, dataviz-one-hero-figure

#### P-100 · S3 · Таблицы правил и рабочих, вторичные графики
- **Исправление.**
  - **RulesTable и WorkersTable.** Компактная DataTable. Столбец «Δ к выбранному». F — «27,8 тыс.». Один десятичный знак в столбцах часов. Заметка о равенстве: «CR, MWKR, MS дают одинаковый порядок — выбрано первое по F». Имя рабочего из одних цифр — ▲ «проверьте имя — Справочники › Рабочие».
  - **QueueChart.** Даты по помощникам оси Ганта; y-домен округлён вверх.
  - **LoadBars.** Метка порога 85 % (P-19). Заметка об инфраструктуре в одну строку: «5 типов РЦ без операций — простой 100 % не от плана · список ▸».
  - **LoadTimeline.** Бины — календарные дни.
- **Файлы.** `src/features/plan/ResultTables.tsx`, `src/features/plan/QueueChart.tsx`, `src/features/plan/LoadBars.tsx`, `src/features/plan/LoadTimeline.tsx`, `src/features/plan/ganttModel.ts`, `src/features/plan/plan-screen.css`
- **Приёмка.** В plan нет «сырых» `<table>`. На оси очереди — даты.
- **Правила.** enterprise-table-baseline, decision-explicit-delta-vs-baseline, decision-precision-matches-evidence, aps-load-capacity-chart, dataviz-single-axis-honest-scales

### 3.7 agents — Агенты (`src/features/agents/**`)

#### P-101 · S1 · Агенты рассказывают текущую историю: правила, найденные RL
- **Исправление.**
  - **Реестр «Правила, найденные RL».** Сразу под вердиктом, DataTable со столбцами:
    - Правило;
    - Откуда — волна, «3 сида сошлись»;
    - Эффект — 95 %-ДИ и «лучше в N из M»;
    - Проверка — чип «выведено RL · G1 ✓ · строгий контроль ≈ 0»;
    - Статус в продукте — «поведение по умолчанию · fin.auto_repay [НОРМ]» со ссылкой на `#/map/<узел кассы>`.

    Вторая строка — кандидат «сверхурочные вместо покупки станка в неделю 0 — 6 из 30 экземпляров, не проверено» с чипом «кандидат».
  - **Гейт.** `gate_a3` читается из `useRlStatus` в RlStatusCard — то же поле, что у MENTAT.
  - **Данные.** Добавить `data/v4_a2.json` и `data/a4_summary.json` из готовых `rl/results` (только снимки, RL не запускать). В V4 — столбец «ГА · тёплый старт CP-SAT».
  - **Устаревание снимка.** Если снимок старше последней волны — чип «снимок 22.10 · устарело ▲ — есть A2–A4». Для A4 — «holdout не завершён — числа гейта не заявляются».
- **Файлы.** `src/features/agents/RlStatusCard.tsx`, `src/features/agents/AgentsScreen.tsx`, `src/features/agents/RlRulesLedger.tsx` (новый), `src/features/agents/benchData.ts`, `src/features/agents/data/v4_a2.json` (новый), `src/features/agents/data/a4_summary.json` (новый)
- **Приёмка.** На экране есть «C* лучше в 49 из 60», «CP-SAT = BKS 18 из 20» и правило auto_repay. Вердикт гейта совпадает у героя и MENTAT.
- **Правила.** decision-connected-lineage, decision-evidence-for-and-against, a11y-ai-14, a11y-ai-22, decision-report-model-quality

#### P-102 · S1 · Вердикт читается за 5 секунд; ДИ — на «лесном» графике
- **Исправление.**
  - **Вердикт.** Одна фраза и 3 плитки:
    - «Чемпион: C* — эвристика + казначейское правило · лучше в 49 из 60»;
    - «Лучший RL против правила: ≈ 0 [−0,4; +0,1] б. п. · лучше в 5 из 12 · 0 ходов — совпал с EDD»;
    - «Опубликовано политик: 0 из 6 · критерий: нижняя граница ДИ > 0 и p < 0,05».
  - **Лесной график.** Ниже Forest (P-19) с заголовком «Ни один претендент не выигрывает у правила с уверенностью»: строка на претендента, полоса ДИ, точка IQM `--chart-1`, линия нуля, порог гейта, общая шкала, таблица-двойник.
  - **Вырожденный RangeStrip.** Убрать.
- **Файлы.** `src/features/agents/RlStatusCard.tsx`, `src/features/agents/benchData.ts`
- **Приёмка.** ДИ не заштрихован. Претендент с 0 ходов подписан «совпал с EDD».
- **Правила.** decision-answer-first, decision-pairwise-win-share, dataviz-uncertainty-graded-and-framed, decision-name-the-interval, decision-frequency-framing

#### P-103 · S1 · Полномочия агента: видно, что действует; α только для чтения
- **Исправление.**
  - **Строка статуса под заголовком.** «Действует сейчас: α сценария и фильтр видов ходов в панели «Ходы». Критерий и лимиты сохраняются в проекте и вступят в силу, когда сервер начнёт принимать полномочия».
  - **α.** Только для чтения: значение, происхождение и «изменить в Сценарии →» (`#/scenarios/<id>/conditions`). Сохранение через AlphaSlider здесь не делается.
  - **Критерий и лимиты.** Под одним раскрытием «Лимиты пакета · 12 ходов · 30 % заказов · 10 дн · 15 % ▸».
  - **Лишний абзац.** Удалить абзац, повторяющий значения.
- **Файлы.** `src/features/agents/GuardrailsCard.tsx`
- **Приёмка.** Ни один элемент на Агентах не пишет в сценарий. Строка статуса видна.
- **Правила.** aps-safe-exploration, decision-sandboxed-what-if, a11y-ai-22, aps-progressive-disclosure, enterprise-save-and-undo

#### P-104 · S2 · Вкладки Агентов, состояние в URL
- **Исправление.** PillTabs в ScreenHeader с маршрутом `#/agents/verdict|evidence|guardrails|how`.
  - **«Вердикт».** Вердикт, плитки, Forest, реестр.
  - **«Доказательства».** Segmented «RL против правил (V5/A3/A4) · Расписание против BKS (V4/A2)».
  - **«Полномочия».** GuardrailsCard.
  - **«Как устроен».** Объяснение L0/L2 в свёрнутом виде, ссылка на Методику, строка про игры (P-108).
- **Файлы.** `src/features/agents/AgentsScreen.tsx`, `src/features/agents/agents.css`
- **Приёмка.** Каждая вкладка не длиннее 1,5 экрана. F5 сохраняет вкладку. Первое число не ниже 200 px.
- **Правила.** dataviz-answer-first-hierarchy, decision-two-level-disclosure, enterprise-url-is-state, aps-display-hierarchy, dataviz-density-budget

#### P-105 · S2 · Одна таблица видов ходов, спокойные состояния
- **Исправление.**
  - **Таблица.** Одна DataTable «Виды ходов агента» в «Полномочиях»:
    - Ход (rowHeader);
    - Уровень;
    - Что меняется;
    - Жёсткая маска;
    - Разрешить — Switch, выключенный с причиной, если ход в плане или нет данных справочников;
    - Доступность — «доступно» простым текстом, «▲ нужны данные Справочников →» или «○ запланировано».
  - **Дубль.** Таблицу ходов в LevelsCard удалить.
  - **Состояния.** Одна карта `{состояние → тон, глиф}` в `guardrails.ts`. Для разрешённых ходов чипа нет; «реализовано» — простым текстом.
- **Файлы.** `src/features/agents/GuardrailsCard.tsx`, `src/features/agents/LevelsCard.tsx`, `src/features/agents/guardrails.ts`, `src/features/agents/agents.css`
- **Приёмка.** Виды ходов перечислены один раз. В покое нет зелёных чипов.
- **Правила.** enterprise-one-name-per-destination, decision-one-state-vocabulary, decision-calm-normal-color, enterprise-table-baseline, decision-tables-not-card-walls

#### P-106 · S2 · Таблица V5: без мёртвых столбцов, в б. п., с долей побед и «i»
- **Исправление.**
  - **Столбцы.**
    - Претендент;
    - «ΔCVaR прибыли, б. п. [95 %-ДИ]» — полоса ДИ в ячейке, общая шкала, отметка нуля;
    - «лучше в N из 12»;
    - p;
    - ΔCVaR кассы;
    - ΔE[Cmax], ч;
    - Вердикт — «○ ДИ ∋ 0 — не опубликовано».
  - **Мёртвые столбцы.** ΔP(разрыв) — в сноску. «Гейт» слить с «Вердиктом».
  - **Единицы и подсказки.** `bp()` из `format.ts`. `metrics.agent.ts`: id `agent.gate_delta`, `agent.gate_ci`, `bench.gap_bks`. InfoTip — на плитках героя и всех заголовках V5/V4. α записывается как «CVaR при α = 0,1».
  - **Перепись ходов L2.** Абзац заменить BarList «Какие ходы делал L2» с «сид 3 — 0 ходов» и таблицей-двойником.
- **Файлы.** `src/features/agents/BenchTables.tsx`, `src/features/agents/benchData.ts`, `src/explain/metrics.agent.ts`
- **Приёмка.** Не больше 8 столбцов. Нет доли побед «8 %». У каждого заголовка есть «i».
- **Правила.** dataviz-density-budget, decision-precision-matches-evidence, decision-frequency-framing, decision-pairwise-win-share, decision-why-one-click

#### P-107 · S2 · V4: сначала график-вывод, таблица по запросу
- **Исправление.**
  - **График.** ChartFrame «Точный солвер — эталон, правила отстают на 40–60 %»: малые множества по семействам на общей шкале x; медианный разрыв по методу, по убыванию; CP-SAT — `--chart-1`, остальные серые; таблица-двойник.
  - **Таблица.** DataTable — за «Все экземпляры (32)». По умолчанию только разрывы: Правило · ГА · ГА от CP-SAT · CP-SAT, %; переключатель «Показать Cmax».
  - **Столбцы.** «Правило» разделить на текст и число. Статус CP-SAT — маленький чип с глифом, отдельно от секунд. «Событийно» → «Правило, событийный режим» с «i».
- **Файлы.** `src/features/agents/BenchTables.tsx`, `src/features/agents/benchData.ts`
- **Приёмка.** График выше таблицы. Таблица по умолчанию свёрнута.
- **Правила.** dataviz-answer-first-hierarchy, dataviz-tables-for-lookup, enterprise-progressive-disclosure, dataviz-emphasis-over-rainbow, dataviz-statement-titles

#### P-108 · S2 · Без внутренних заметок; «Игры» — одна строка
- **Исправление.**
  - **Тексты.** Мета игр — «Запланировано». Eyebrow — «Строгая проверка на отложенных сценариях». «Волна 2» → «запланировано». Фразу про PID удалить.
  - **Сервер.** Одна строка «Политика в продукте: не опубликована» с «Подробнее» (onnxruntime, SHA, путь, текст сервера).
  - **Игры.** Вместо секции — одна строка в «Как устроен»: «Игры цехов и банка — запланированы. Цена анархии и Штакельберг: формулы в Методике →» и ссылка на карту. CSS `ag-game` удалить.
- **Файлы.** `src/features/agents/AgentsScreen.tsx`, `src/features/agents/RlStatusCard.tsx`, `src/features/agents/rlStatusStore.ts`, `src/features/agents/PriceOfAnarchy.tsx`, `src/features/agents/agents.css`
- **Приёмка.** В видимом тексте агентов нет «METHODOLOGY-V2», «§7», «MAOS_RL_POLICY_DIR», «волна V6».
- **Правила.** enterprise-errors-plain-and-local, aps-progressive-disclosure, enterprise-designed-empty-states, decision-two-level-disclosure

#### P-109 · S2 · Следующий шаг с Агентов
- **Исправление.**
  - **Primary в герое.** «Строить план с чемпионом C* →» (`#/plan/new/objective`, чемпион выбран). После публикации политики — «Выбрать «RL» в мастере плана →».
  - **Тупиковая кнопка.** Убрать.
  - **Шапка.** StatusChip заменить чипом происхождения «стенд rl/ · 12 + 60 экземпляров · снимок 24.10».
  - **Повтор вердикта.** Строку «Почему» убрать.
  - **Карта.** «[6] на карте ↗» — ghost.
- **Файлы.** `src/features/agents/RlStatusCard.tsx`, `src/features/agents/AgentsScreen.tsx`
- **Приёмка.** Ровно одна заливная кнопка. Вердикт сказан один раз.
- **Правила.** decision-one-primary-next-step, enterprise-one-primary-per-region, aps-connected-pipeline, enterprise-screen-header-contract

#### P-110 · S2 · Акцент, шапка и типографика Агентов
- **Исправление.**
  - **Акцент.** `.ag-status__accent` → `--text`, вес 500.
  - **Блок-чипы.** Один раз, строкой в мета секции; строку инструментов с чипами удалить.
  - **Карточки L0/L2.** Нейтральная верхняя обводка `--border-strong` (или одна `--block-6` на обе).
  - **Шапка.** Подзаголовок в одну строку: «Агент предлагает — человек утверждает. Выигрыш засчитывается только с ДИ на отложенных сценариях.». Eyebrow «Решения · блок [6]».
  - **Типографика.** Заголовки карточек — размер `dk-card__title`, без `--font-display`; не больше 4 кеглей. Отступы — токенами.
  - **Прочее.** `.pl-note` → локальный `.ag-note`. Глиф заморозки → иконка замка.
- **Файлы.** `src/features/agents/agents.css`, `src/features/agents/AgentsScreen.tsx`, `src/features/agents/RlStatusCard.tsx`, `src/features/agents/GuardrailsCard.tsx`, `src/features/agents/LevelsCard.tsx`
- **Приёмка.** `--accent-text` нет на не-ссылках. Не больше 4 кеглей.
- **Правила.** aps-accent-budget, dataviz-color-jobs-disjoint, enterprise-screen-header-contract, enterprise-spacing-type-rhythm, decision-consistent-screen-anatomy

### 3.8 observe — Аналитика (`src/features/analytics/**`)

#### P-111 · S1 · Инвестпроект: вердикт движка с ДИ, по узкому месту
- **Исправление.**
  - **Умолчания.** Тип оборудования — `preselect || loads[0]?.typeId` (узкое место). Ставка дисконтирования — из ключевой ставки сценария плюс спред, с происхождением «из сценария ●».
  - **InvestResult строится вокруг `crn`.**
    - Чип вердикта по `candidate.apply` — «применять / не применять» и первая строка `reasons[]`.
    - Герой: «ЧДД E 3,1 млн ₽ [0,4; 5,9] · 95 %-ДИ, N = n», RangeStrip с нулём.
    - Вероятности: «P(ЧДД < 0): в 7 из 100 сценариев», «P(разрыв кассы) 3 → 5 из 100 к базе».
    - Таблица всех `crn.candidates` и строка «ничего не делать» с теми же метриками; выбранная — ▲; строка «проиграет, если…».
  - **Детерминированная оценка.** NPV, IRR и срок — под свёрнутым «Детерминированная оценка».
  - **Особые случаи.** Если `crn.status ≠ ok` — причина простыми словами. Ничего не применяется автоматически.
- **Файлы.** `src/features/analytics/InvestPanel.tsx`, `src/features/analytics/analytics.css`
- **Приёмка.** Нет чипа «окупается», выведенного только из `payback_months`. Тип по умолчанию — узкое место.
- **Правила.** decision-evidence-for-and-against, decision-never-lone-point, aps-uncertainty-honest, decision-frequency-framing, enterprise-defaults-with-provenance

#### P-112 · S2 · Аналитика: ответ первым, загрузка без ложной пустоты
- **Исправление.**
  - **Шапка.** Подзаголовок в одну строку: «Показатели выбранного построения плана: сроки, загрузка, узкие места, окупаемость». Выбор плана — в действия ScreenHeader; в ряду фильтров на вкладке KPI остаются только «Ось» и «Период».
  - **Вердикт.** Из `buildRecommendations` и узкого места: «План №28 · 618 оп.: все заказы в срок; узкое место — резьбонарезной 63 %; 73 % времени потока — ожидание → [Инвестпроект]».
  - **Мета секции.** В «i».
  - **Пустота и загрузка.** «Постройте план» — только при `!loading && plans.length === 0`. KpiPins резервирует строку спарклайна скелетом.
- **Файлы.** `src/features/analytics/AnalyticsScreen.tsx`, `src/features/analytics/KpiDashboard.tsx`, `src/features/analytics/KpiRegistry.tsx`, `src/features/analytics/KpiCharts.tsx`, `src/features/analytics/KpiPins.tsx`, `src/features/analytics/analytics.css`
- **Приёмка.** Первый KPI не ниже 220 px. Во время загрузки нет «Нет данных».
- **Правила.** decision-answer-first, aps-display-hierarchy, dataviz-answer-first-hierarchy, enterprise-loading-and-progress, enterprise-designed-empty-states

#### P-113 · S2 · KPI-плитки Аналитики — такие же, как в Плане
- **Исправление.**
  - **Плитки.** KpiPins использует kit `KpiTile`. Короткие подписи `KPI_CATALOG` общие с Планом: «Заказы в срок · OTD», «Загрузка оборудования (ср.)».
  - **Герой MAKESPAN.** С TailStrip «дет. · E · CVaR · худший».
  - **Δ.** К предыдущему построению того же сценария, «−18 ч к №27», через DeltaChip с `kpiCatalog.dir`.
  - **Выбор плана.** Пункт «№28 · E 419 ч · 618 оп · 24.10 14:38» (`runLabel`).
  - **Спарклайн.** Через `sliceByPeriod`.
- **Файлы.** `src/features/analytics/KpiPins.tsx`, `src/features/analytics/kpiCatalog.ts`, `src/features/analytics/AnalyticsScreen.tsx`
- **Приёмка.** Подписи на Плане и в Аналитике совпадают. Нет одинокого героя.
- **Правила.** aps-kpi-vocabulary, decision-never-lone-point, dataviz-kpi-needs-comparator, aps-uncertainty-honest, dataviz-filters-one-row-linked

#### P-114 · S2 · Статусный цвет — только для отклонений
- **Исправление.**
  - **Норма.** Статус 'good' ничего не рисует.
  - **UTIL.** Без статуса, называется «Загрузка оборудования (средняя)». В `DEFAULT_DASHBOARD` заменить её на N_LATE или P_BREACH.
  - **Пороги.** Одна константа `LOAD_THRESHOLDS {warn 0,8, bad 0,95}` в `analyticsModel`; её используют BN_UTIL, Bottlenecks и REC_THRESHOLDS.
  - **Bottlenecks.** Строка 1 — нейтральный чип «узкое место»; ▲ или ■ со словом — только от порогов. Ранги — `--text-muted`. Meter: `mark = warn`, тон `--chart-1`.
- **Файлы.** `src/features/analytics/kpiCatalog.ts`, `src/features/analytics/Bottlenecks.tsx`, `src/features/analytics/analyticsModel.ts`, `src/features/analytics/analytics.css`, `src/features/analytics/dashboardConfig.ts`
- **Приёмка.** В покое в плитках нет зелёных или красных полос. Порог объявлен один раз (поиск по коду).
- **Правила.** decision-calm-normal-color, aps-status-not-color-alone, enterprise-color-one-meaning, dataviz-bullet-not-gauge, aps-bottleneck-protagonist

#### P-115 · S2 · KPI-графики несут информацию
- **Исправление.**
  - **Одинаковые значения.** Если все значения в окне равны, вместо графика строка «OTD 100 % во всех 10 построениях» и предложение другой метрики.
  - **Второй график по умолчанию.** TARD или N_LATE; при наличии кассы — P_BREACH.
  - **База и хвост.** Пара «метрика + хвост» — одна серия `--chart-1` с усом до CVaR; в легенде «E · хвост CVaR₉₅».
  - **Ось x.** Подписи «№19»; сценарий и дата — в подсказке.
  - **Фильтр.** Чип «только сценарий «Базовый»» в ряду фильтров.
  - **Форма.** Хронология — линия с точками.
  - **Заголовок-вывод.** «Длина расписания по построениям: последние 5 — в пределах 380–420 ч».
- **Файлы.** `src/features/analytics/KpiCharts.tsx`, `src/features/analytics/chartData.ts`, `src/features/analytics/dashboardConfig.ts`, `src/features/analytics/useDashboard.ts`
- **Приёмка.** Нет графика из одинаковых столбцов. Хвост не рисуется вторым цветом.
- **Правила.** dataviz-form-by-job, aps-chart-palette-discipline, dataviz-emphasis-over-rainbow, dataviz-statement-titles, dataviz-color-jobs-disjoint

#### P-116 · S2 · «Потоки»: форма по задаче
- **Исправление.**
  - **Вид по умолчанию — «Главные переходы».** BarList top-10 переходов «откуда → куда» по числу партий и Heatmap «откуда × куда» с последовательной шкалой. Таблица «все N» остаётся.
  - **Sankey.** Отдельный вид с выделением связей узкого места (P-19).
  - **Заголовок.** «Через узкое место «Резьбонарезной» идут 34 % партий»; число повторено в `aria-label`.
- **Файлы.** `src/features/analytics/FlowsSection.tsx`, `src/features/analytics/flowModel.ts`
- **Приёмка.** В виде по умолчанию нет «клубка». Нет подписей с многоточием.
- **Правила.** dataviz-form-by-job, dataviz-emphasis-over-rainbow, dataviz-labels-selective-text-tokens, dataviz-table-twin-and-alt, enterprise-chart-system-discipline

#### P-117 · S2 · Аналитика в URL; узкие места ведут к объекту
- **Исправление.**
  - **Маршрут.** `#/analytics/<kpi|bottleneck|invest|flow>[/<planId>]` (P-11). `goInvest` делает переход, поэтому «Назад» работает.
  - **Меню строки Bottlenecks ⋯.** «На Ганте» (`#/plan/run/<id>/gantt?wc=`), «В Схеме» (`schemeHref`), «Ходы для узкого места». «Инвестпроект» остаётся видимым действием.
  - **Сравнение.** PlanCompare по умолчанию сравнивает с предыдущим построением того же сценария — «vs №27 (базовое)»; эта же база используется для Δ в плитках.
- **Файлы.** `src/features/analytics/AnalyticsScreen.tsx`, `src/features/analytics/Bottlenecks.tsx`, `src/features/analytics/KpiRegistry.tsx`
- **Приёмка.** F5 сохраняет вкладку и план. Сравнение никогда не пустое.
- **Правила.** enterprise-url-is-state, aps-state-persistence, aps-linked-views, aps-bottleneck-protagonist, decision-explicit-delta-vs-baseline

#### P-118 · S3 · Полировка формы инвестпроекта, дат и фонов
- **Исправление.**
  - **Форма.**
    - Цена станка — в «млн ₽» или форматируется при потере фокуса.
    - Тип оборудования — отдельной строкой: «Резьбонарезной · загрузка 63 %».
    - Повторяющиеся «○ ПО УМОЛЧ.» заменить одной строкой группы «Все значения — по умолчанию ○».
  - **Пустой результат.** Вместо EmptyState с фоном — «призрачная» карточка (или EmptyState `quiet`, P-16).
  - **Расчёт.** RunProgress «Прогон 1 из 2 · Отменить».
  - **Даты.** `shortDate` → `dateTimeShort` (P-05).
  - **Фоны.** `.an-recs` — обычная карточка, иконка `--text-muted`. `.an-pin--hero` — без брендовой заливки.
  - **Блок-чипы.** Только те блоки, из которых вкладка действительно берёт данные, либо без чипов.
- **Файлы.** `src/features/analytics/InvestPanel.tsx`, `src/features/analytics/chartData.ts`, `src/features/analytics/AnalyticsScreen.tsx`, `src/features/analytics/KpiRegistry.tsx`, `src/features/analytics/analytics.css`
- **Приёмка.** Нет «250000(». Нет ISO-обрезков «10-24 14:38». В `analytics.css` нет радиальных заливок.
- **Правила.** dataviz-precision-and-units, enterprise-numbers-first-class, enterprise-defaults-with-provenance, enterprise-loading-and-progress, aps-accent-budget

### 3.9 explain — Карта методологии, Методика, MENTAT (`src/features/method-map/**`, `src/features/methodology/**`, `src/features/explain/**`)

#### P-119 · S1 · Сборщик контекста MENTAT никогда не падает
- **Исправление.**
  - **`facts.ts`.** `(cash?.duals?.capacity ?? [])`; в `cashDuals` — `if (!cash?.duals) return null`. Локальный `MOVE_KIND` заменить на `moveLabel()` из `plan/moves/moveKinds`. `rlGate` читает тот же `gate_a3`, что и Агенты.
  - **`buildContext`.** Каждый построитель фактов в обёртке: при сбое `null` и одно `console.warn`.
  - **`lib/api.ts`.** В `CashLpResult` поле `duals?:` опциональное, чтобы tsc показал оставшиеся небезопасные чтения.
  - **Тест.** Случай `cash = {status: 'time_limit'}` без `duals` в `context.test.ts`.
- **Файлы.** `src/features/explain/context/facts.ts`, `src/features/explain/context/buildContext.ts`, `src/features/explain/context/context.test.ts`, `src/lib/api.ts`
- **Приёмка.** Тест зелёный. После `time_limit` Cmd+J на Плане открывает панель как обычно.
- **Правила.** enterprise-errors-plain-and-local, a11y-ai-18, decision-assistant-scope-and-grounding

#### P-120 · S1 · Лимит времени LP — «не решено», а не две ошибки
- **Исправление.** Помощник `method-map/lpStatus.ts`, функция `lpStatusLive(status, reason, timeLimitS)`:
  - `time_limit` → 'stale' ▲ «касса: не решено за 30 с», причина «решатель остановлен по лимиту времени — повторите с большим лимитом»;
  - `infeasible` → 'error' «ограничение ликвидности неразрешимо — снизьте L_min»;
  - `unbounded`/`error` → 'error' «расчёт кассы не выполнен».

  Сырой текст решателя — только в «Подробнее» панели.
  - **Одна причина — один блок.** Если упала `dec.cash`, то `crit.cash` → 'unconfigured' «ждёт решения кассы [4]».
  - **Деталь блока.** `blockLive` пишет `${worstNode.title}: ${worstLive.badge}`; первая строка панели блока — ссылка на упавший подблок.
  - **Экран `dec.cash`.** Ведёт на раздел кассы результата плана.
  - **Подсказка ошибки.** `STATE_META.error.hint` — «Расчёт не выполнен — причина ниже».
  - **Подпись цели.** Через `objectiveLabel`.
- **Файлы.** `src/features/method-map/lpStatus.ts` (новый), `src/features/method-map/deriveNodes.ts`, `src/features/method-map/deriveState.ts`, `src/features/method-map/stateMeta.ts`, `src/features/method-map/NodePanel.tsx`, `src/features/method-map/nodes.flow.ts`, `src/features/method-map/deriveState.test.ts`
- **Приёмка.** При `time_limit` один ▲ на [4], а [5] нейтрально «ждёт». «Time limit reached» по-английски видно только в «Подробнее».
- **Правила.** enterprise-errors-plain-and-local, aps-exceptions-inbox, aps-status-not-color-alone, decision-why-one-click, decision-calm-normal-color

#### P-121 · S1 · Блок [7] видит опубликованный прогноз
- **Исправление.** `useMethodMapState` вместо `forecast: null` читает `useForecastResult()` (хранилище из P-64). Бейдж `mon.forecast` в `deriveNodes`: «покрытие 67 % · хуже наивного у 5 из 76». Прогноз попадает в контекст MENTAT. Зависит от P-64.
- **Файлы.** `src/features/method-map/useMethodMapState.ts`, `src/features/method-map/deriveNodes.ts`
- **Приёмка.** После открытия Мониторинга блок [7] полосы больше не пишет «прогноз не запрошен».
- **Правила.** decision-connected-lineage, aps-connected-pipeline, enterprise-connected-flow

#### P-122 · S1 · Единый реестр стадий; Методика и карта говорят о v0.74
- **Исправление.**
  - **Реестр.** `src/explain/stages.ts`: `featureId → {stage, version, evidence}`. Его читают поле `stage` узлов карты (обогащение реестра) и StageChip Методики (`blocks.tsx` принимает `feature`). Vitest: узел с `learnMore = X` и чип раздела X совпадают.
  - **Методика, введение.** Легенда — v0.74. Пересортировать done/w1/w2/w3: ExactCvar/HiGHS, CP-SAT с Taillard/Brandimarte, ДИ и волны RL A1–A4 — уже сделаны.
  - **Методика, раздел RL.** Блок «Что получилось (A1–A4)»: гейт не пройден; C* лучше в 49 из 60; протокол «RL → дистилляция VIPER → проверка → правило»; ссылка на `#/agents`. Дорожная карта — свёрнута.
  - **Карта.**
    - `llm.mentat` — 'done', живое состояние из `/api/mentat/status` («не подключена» → unconfigured), экран — действие «Открыть MENTAT», а не `#/aiflow`.
    - `crit.ci` — 'done'.
    - Число формул — из `METRIC_LIST.length`.
    - Под `dec.cash` добавить параметры `fin.auto_repay` и `fin.tax_cumulative` с паспортом НОРМ и пометкой «выведено RL · прошло проверку A3» (`params.ts`).
- **Файлы.** `src/explain/stages.ts` (новый), `src/features/methodology/sections/Intro.tsx`, `src/features/methodology/sections/Agents.tsx`, `src/features/methodology/sections/StageTwo.tsx`, `src/features/methodology/sections/StageOne.tsx`, `src/features/methodology/sections/FlowInvest.tsx`, `src/features/methodology/blocks.tsx`, `src/features/method-map/nodes.loops.ts`, `src/features/method-map/nodes.flow.ts`, `src/features/method-map/params.ts`, `src/features/method-map/deriveNodes.ts`, `src/features/method-map/registry.ts`
- **Приёмка.** Нет «0.58» и «Ф0 ~4 дня». На карточке [8] нет «1 в плане». `auto_repay` виден на карте.
- **Правила.** aps-connected-pipeline, decision-evidence-for-and-against, decision-report-model-quality, a11y-ai-14, decision-pairwise-win-share

#### P-123 · S1 · Методика и Карта ссылаются друг на друга
- **Исправление.** `Section` Методики получает `blocks?: BlockId[]` и рисует BlockChips в `.mth-sec__meta`. В `registry.ts` — `nodesForSection(id)`. В разделе тихая ссылка «На карте: 3 узла →» ведёт на `#/map/<первый>`, остальные узлы перечислены в `title`. Шаги конвейера в «Обзоре» получают BlockChip и канонические имена `BLOCKS`: 8 блоков вместо 6 шагов.
- **Файлы.** `src/features/methodology/blocks.tsx`, `src/features/methodology/sections/Intro.tsx`, `src/features/methodology/sections/*.tsx`, `src/features/method-map/registry.ts`
- **Приёмка.** У каждого раздела Методики, у которого есть узлы карты, есть ссылка «На карте». Поиск `#/map` в methodology находит совпадения.
- **Правила.** enterprise-connected-flow, aps-connected-pipeline, decision-why-one-click, enterprise-one-name-per-destination

#### P-124 · S2 · Карта на общем словаре состояний
- **Исправление.**
  - **`stateMeta.ts`.** Выводится из `stateVocabulary` (P-07). Ошибка — ✕. ◌ — только «не задано». «В плане» — пунктирная карточка и чип «в плане · волна N».
  - **Стадии.** Один `STAGE_META` для чипов стадий карты и StageChip Методики: done — ● нейтрально-хороший; w1/w2/w3 — ○ пунктир, приглушённо, никогда не янтарный ▲.
  - **PassportTable.** Локальные `ProvenanceBadge` и `PassportCard` удалить, использовать `ui/ProvenanceBadge` и `ui/PassportCard`.
  - **Бейджи.** Синтетика — ▲. `leafLive` больше не выводит бейдж `паспорт ${status}`.
- **Файлы.** `src/features/method-map/stateMeta.ts`, `src/features/method-map/PassportTable.tsx`, `src/features/method-map/deriveState.ts`, `src/features/method-map/StateGlyph.tsx`, `src/features/methodology/blocks.tsx`
- **Приёмка.** Слова легенды совпадают со словами бейджей. На карте ■ не несёт двух смыслов. Нет «паспорт НОРМ».
- **Правила.** decision-one-state-vocabulary, enterprise-color-one-meaning, enterprise-defaults-with-provenance, aps-status-not-color-alone, a11y-ai-11

#### P-125 · S2 · Рёбра: подписи по запросу, без наложений, смысл в узоре
- **Исправление.**
  - **Какие подписи видны.** По умолчанию подписаны только 5 рёбер основного хода [1] → … → [5]. Остальные — при `is-lit`. На затемнённых рёбрах подписи скрыты.
  - **Размещение.** `placeLabels` возвращает `null`, если нет свободного места (проверяет подписи, блоки и точки вдоль рёбер). У пары [4]↔[5] противоположные порты.
  - **Цвет и узор.** Подписи — `--text-secondary`. Обратная связь — пунктир `--text-secondary`; управление — штрих-пунктир `--text-muted`; без охры и ультрамарина.
  - **Легенда.** Только присутствующие состояния; «все состояния» — в InfoTip. Образцы — inline SVG с экспортируемым `EDGE_DASH`. Переключатель «Подписи рёбер: основные / все» (sessionStorage). Легенда переезжает в оверлей слева вверху или в шапку; строка контекста — в шапку.
- **Файлы.** `src/features/method-map/MapEdges.tsx`, `src/features/method-map/mapLayout.ts`, `src/features/method-map/edges.ts`, `src/features/method-map/map.css`, `src/features/method-map/MapScreen.tsx`
- **Приёмка.** На обзоре подписи не накладываются. В легенде не больше ≈ 8 пунктов.
- **Правила.** dataviz-labels-selective-text-tokens, aps-progressive-disclosure, dataviz-annotate-events-sparingly, dataviz-color-jobs-disjoint, decision-chart-anatomy

#### P-126 · S2 · Панель узла не сжимает карту до нечитаемости
- **Исправление.**
  - **Вписывание.** MapCanvas: `fitOnMount`, `refitOnResize = false` (P-21).
  - **При открытии панели.** Выбранный блок сдвигается в видимую область, зум `k` не ниже 0,8.
  - **Действия.** `.mm-panel__actions` липкие внизу, фон `--bg-panel`. Подпись называет цель: «Открыть «Справочники» →».
  - **Стиль узлов.** Перейти на `.gc-node`.
- **Файлы.** `src/features/method-map/MapCanvas.tsx`, `src/features/method-map/NodePanel.tsx`, `src/features/method-map/map.css`
- **Приёмка.** При открытой панели зум не ниже 80 %. Primary виден без прокрутки.
- **Правила.** aps-display-hierarchy, decision-one-primary-next-step, a11y-ai-04, enterprise-one-primary-per-region

#### P-127 · S2 · Карточки блоков без многоточий и цветного текста
- **Исправление.**
  - **Анатомия карточки.** Номер и заголовок (до 2 строк, или ширина `W` 30) → строка бейджа (`-webkit-line-clamp: 2`) → StateChip.
  - **Деталь и причина.** Уходят в панель и `aria-describedby`. Если причина остаётся на карточке — `--text-secondary` с глифом.
  - **Деталь [6].** «политика не опубликована: не прошла гейт V5 → Агенты», без «onnxruntime».
- **Файлы.** `src/features/method-map/MapNodeView.tsx`, `src/features/method-map/map.css`, `src/features/method-map/blocks.ts`, `src/features/method-map/deriveNodes.ts`
- **Приёмка.** На обзоре ни одного «…». Нет янтарного или красного основного текста.
- **Правила.** dataviz-labels-selective-text-tokens, aps-status-not-color-alone, decision-calm-normal-color, dataviz-precision-and-units

#### P-128 · S2 · Панель блока: от обзора к деталям
- **Исправление.**
  - **Порядок.** Однострочная сводка состояния с упавшим подблоком → Подблоки → Входы и выходы → «Параметры (N)», свёрнуто и сгруппировано по подблокам.
  - **Шапка.** Крошку скрыть, если путь из одного уровня. Для блоков убрать дублирующий eyebrow.
  - **NodeRow.** Живое значение вместо общего бейджа; заголовок переносится до двух строк.
  - **Подписи.** `EDGE_KIND_LABEL`: данные / параметр / обратная связь / управление / объяснение. `KIND_LABEL` — в результатах поиска.
- **Файлы.** `src/features/method-map/NodePanel.tsx`, `src/features/method-map/MapScreen.tsx`, `src/features/method-map/deriveState.ts`, `src/features/method-map/map.css`
- **Приёмка.** Нет английских «data / feedback / subblock». Нет «Загрузка обо…».
- **Правила.** decision-two-level-disclosure, aps-progressive-disclosure, enterprise-progressive-disclosure, enterprise-one-name-per-destination

#### P-129 · S2 · Числа и имена на карте — такие же, как на экранах
- **Исправление.**
  - **Подписи.** `objectiveLabel` и `ruleLabel` в `deriveNodes` (decisions, criteria) и в `valueText` PassportTable. Контекст портфеля — «портфель от 24.10, 17:38», id — в `title`.
  - **Выдуманное число.** Удалить константу P(спокойный).
  - **Неопределённость.**
    - CVaR: «CVaR₁₀ % −53,7 млн ₽ · E +45,7 млн ₽», α из паспорта.
    - P(разрыв): «3 % — в 3 из 100 сценариев».
  - **Точность.** Одна на меру через `fmtValue`: «фонд 188 ч» и в карточке, и в панели.
  - **Склонения.** `plural()` для операций, режимов, станков.
  - **α.** Как `pct(α, 0)` — так же, как в шапке сценария.
- **Файлы.** `src/features/method-map/deriveNodes.ts`, `src/features/method-map/PassportTable.tsx`, `src/features/method-map/MapScreen.tsx`
- **Приёмка.** Нет «meanvariance», «542 операций», «P(спокойный) 1».
- **Правила.** decision-never-lone-point, decision-frequency-framing, decision-precision-matches-evidence, enterprise-one-name-per-destination, aps-kpi-vocabulary

#### P-130 · S2 · MENTAT «Вопрос»: видны охват и статус модели, запрос можно остановить
- **Исправление.**
  - **Шаблоны.** Только шаблоны экрана (до 5) и «Ещё вопросы (N) ▸».
  - **Охват.** Строка из `context.truncated`: «Видит: 23 узла графа этого экрана · ≈3,1 из 8 тыс. токенов · не вошло 4 ▲ · локальная модель · ничего не меняет в данных»; часть с ▲ ведёт на вкладку «Промпт». В пустом состоянии — строка «что умеет / чего не умеет».
  - **Модель не подключена (`!status.configured`).** Сначала EmptyState с primary «Подключить модель» (вкладка настроек) и secondary «Показать промпт». «Спросить» — secondary.
  - **Ожидание ответа.**
    - Кнопка «Остановить»: сигнал AbortController передаётся в fetch в `mentatApi.ts`; в истории запись «остановлено».
    - Счётчик секунд.
    - `aria-disabled` у кнопки.
    - Область ответа: `role=log`, `aria-busy`.
  - **Метка ИИ.** На ответах и в истории постоянная метка «MENTAT · ИИ · <модель> · локально».
  - **Цвет.** В `mentat.css` `--cinnabar` → `--status-down` с ✕ и словом.
  - **Esc.** MentatPanel вместо слушателя Esc на `window` использует `useEscapeLayer` (P-13).
- **Файлы.** `src/features/explain/AskTab.tsx`, `src/features/explain/prompts/templates.ts`, `src/features/explain/MentatPanel.tsx`, `src/features/explain/llm/mentatApi.ts`, `src/features/explain/mentat.css`, `src/features/explain/HistoryTab.tsx`, `src/features/explain/AnswerView.tsx`
- **Приёмка.** После «Остановить» запрос в Network отменён. В `mentat.css` нет `--cinnabar`. На Плане не больше 5 чипов шаблонов.
- **Правила.** decision-assistant-scope-and-grounding, a11y-ai-15, a11y-ai-19, a11y-ai-23, a11y-ai-14, a11y-ai-09

#### P-131 · S3 · Шапка карты и петля агента
- **Исправление.**
  - **Шапка.**
    - StatusChip в панели инструментов убрать; в строку контекста — «состояние по последним расчётам · 17:38».
    - Иконка `refresh` с `aria-label` «Обновить данные карты».
    - Eyebrow — `--text-muted`.
    - Подзаголовок: «Как число получается из данных: 8 блоков слева направо, петли снизу · Как читать →» (`#/methodology/overview`).
  - **Петля агента.** В покое AgentLoop — статичный пунктир без точек и свечения, подпись «петля не активна: политика не опубликована». В активном режиме — AnimationToggle (P-24).
- **Файлы.** `src/features/method-map/MapScreen.tsx`, `src/features/method-map/AgentLoop.tsx`, `src/features/method-map/MapCanvas.tsx`, `src/features/method-map/map.css`
- **Приёмка.** В подсказках нет «G3». Петля в покое статична.
- **Правила.** enterprise-screen-header-contract, enterprise-contextual-help-pull, a11y-ai-07, decision-calm-normal-color

#### P-132 · S3 · Оглавление Методики — настоящие ссылки
- **Исправление.** Пункты оглавления — `<a href="#/methodology/<id>" aria-current>`. `useAnchorNav.scrollTo` использует `behavior: 'auto'`, если вкладка скрыта или включено reduced motion. `.mth-toc__num` — `--text-muted`. У разделов — `scroll-margin-top`. Прокрутку проверить в активной вкладке.
- **Файлы.** `src/features/methodology/MethodologyScreen.tsx`, `src/features/methodology/useAnchorNav.ts`, `src/features/methodology/methodology.css`
- **Приёмка.** Cmd+клик открывает новую вкладку. «Назад» возвращает к предыдущему разделу.
- **Правила.** enterprise-url-is-state, a11y-ai-01, enterprise-keyboard-and-focus

### 3.10 admin — AI-воркфлоу и Администрирование (`src/features/admin/**`, `src/features/workflow-builder/**`)

#### P-133 · S1 · Журнал отвечает на вопрос «кто что изменил»
- **Исправление.** Новый `admin/auditVocabulary.ts`.
  - **`ENTITY_META`.**

    | Код | Подпись | Ссылка |
    |---|---|---|
    | scenario | «Сценарий» | `#/scenarios` |
    | routing | «Техкарта» | `#/nsi/routing/<id>` |
    | optimization | «Портфель» | — |
    | schedule | «План» | — |
    | mentat | «MENTAT · ИИ» (+ подпись шаблона) | — |
    | auth | «Вход» | — |
    | passport | «Паспорт параметра» | `#/map/<id>` |
    | nsi | «Справочники · калибровка» | — |

    Также operation, production_plan, macro, user, calendar, fin_params.
  - **`ACTION_LABEL` для всех 14 кодов.** CLONE «копия», CALIBRATE «калибровка», SAMPLE «выборка сценариев», ASK «вопрос», ASK_FAILED «вопрос · ошибка», LOGIN_FAILED «неудачный вход», LOGIN_LOCKED «блокировка», REJECTED «отказ в доступе» и т. д.
  - **Столбцы.** Когда · Кто · Действие · Объект (подпись и ссылка на имя или короткий id) · Подробности — однострочная сводка payload: «цель: CVaR», «правило: EDD», «нет права RUN_OPTIMIZE на /api/optimize».
  - **Детали.** Клик по строке открывает SidePanel с payload в виде «ключ — значение», не JSON.
  - **Тест.** У каждого кода бэкенда есть подпись.
- **Файлы.** `src/features/admin/auditVocabulary.ts` (новый), `src/features/admin/AdminScreen.tsx`, `src/features/admin/admin.css`, `src/features/admin/auditVocabulary.test.ts` (новый)
- **Приёмка.** В журнале нет английских строчных сущностей и действий. Строка сценария ведёт на сценарий.
- **Правила.** decision-connected-lineage, aps-connected-pipeline, enterprise-one-name-per-destination, a11y-ai-22, dataviz-tables-for-lookup

#### P-134 · S1 · Администрирование не выдаёт ошибку за пустоту
- **Исправление.**
  - **Состояние панелей.** У каждой своё: загрузка / готово / ошибка. DataTable получает `loading`.
  - **Ошибка.** ErrorBanner (`errorText`, «Повторить», «Подробнее»). Ошибки patch и create — через `errorText`. Четыре `.catch(() => {})` удалить.
  - **Пусто.** EmptyState «Журнал пуст — записи появятся после первого изменения справочников или прогона».
  - **Ничего не найдено.** EmptyState и «Сбросить фильтры».
- **Файлы.** `src/features/admin/AdminScreen.tsx`
- **Приёмка.** При выключенном бэкенде виден баннер, а не «Нет пользователей.».
- **Правила.** enterprise-errors-plain-and-local, enterprise-designed-empty-states, enterprise-loading-and-progress

#### P-135 · S1 · «Очистить» воркфлоу — с подтверждением и отменой
- **Исправление.**
  - **Кнопки удаления.** «Удалить выбранное» в панели инструментов убрать — она есть в инспекторе. Delete/Backspace на канвасе удаляют выбранное (в полях ввода — ранний выход).
  - **Очистка.** «Очистить канвас…» — в меню ⋯ как danger. Подтверждение называет объект: «Удалить 7 шагов и 7 связей? Черновик в браузере будет перезаписан».
  - **Отмена.** Ограниченный стек снимков (Cmd/Ctrl+Z, Shift+Z) и UndoToast после очистки или удаления.
  - **CSS.** Сузить правило ширины до `.wfb__inspector-actions .btn { width: 100% }`.
- **Файлы.** `src/features/workflow-builder/WorkflowBuilder.tsx`, `src/features/workflow-builder/workflow-builder.css`
- **Приёмка.** Cmd+Z возвращает очищенный граф. В шапке нет широкой пунктирной выключенной кнопки.
- **Правила.** enterprise-save-and-undo, decision-one-primary-next-step, enterprise-one-primary-per-region, aps-safe-exploration

#### P-136 · S1 · AI-воркфлоу — схема MENTAT, а не сирота
- **Исправление.**
  - **Шапка.** Анатомия верхней полосы канваса, как у карты и техкарты. Eyebrow «Система · [8] LLM» с BlockChips llm. h1 — `screenTitle('aiflow')` «AI-воркфлоу». Мета: «Схема диалога MENTAT · черновик хранится в этом браузере».
  - **Действия.** «Открыть MENTAT ⌘J» (`overlayActions.openMentat`), «Экспорт .json» (скачивание Blob) и ⋯.
  - **Стартовый граф — реальный конвейер MENTAT.** Вопрос/шаблон → Сборка контекста графа (`context/buildContext`) → Промпт v1.0 (`prompts/system.ts`) → Локальная LLM → Проверка чисел ✓/⚠/✕ → Ответ со ссылками ⟦node⟧ / «в контексте нет данных». Заметки узлов ссылаются на эти модули.
  - **Версия хранилища.** Повысить; старый стартовый граф заменяется, только если его не трогали.
- **Файлы.** `src/features/workflow-builder/WorkflowBuilder.tsx`, `src/features/workflow-builder/types.ts`, `src/features/workflow-builder/storage.ts`
- **Приёмка.** Нет «мини-ChatGPT». Экспорт скачивает JSON.
- **Правила.** aps-connected-pipeline, enterprise-connected-flow, enterprise-one-name-per-destination, enterprise-screen-header-contract, decision-assistant-scope-and-grounding, a11y-ai-23

#### P-137 · S2 · Узлы воркфлоу на общем языке графов
- **Исправление.**
  - **Тип узла.** `NodeTypeMeta.color` → `{glyph, tone: 'neutral'|'llm'}`. 9 hex в `types.ts` удалить.
  - **Карточка.** Общий класс `.gc-node` (P-21). Полоса `--block-8` — у aiReply и context, `--text-muted` — у остальных.
  - **Шапка узла.** Цветная полоса заменяется одной строкой: глиф (● старт, ■ конец, ◆ условие, ▲ инструмент, ○ сообщение, ? уточнение, ↳ под-воркфлоу) и тип `fs-11`, `--text-muted`, без заливки. Заголовок переносится.
  - **Палитра и инспектор.** Образцы в палитре — те же глифы. Чип типа в инспекторе нейтральный.
  - **Тени.** rgba-тени → `--shadow-1/2`.
- **Файлы.** `src/features/workflow-builder/types.ts`, `src/features/workflow-builder/WorkflowBuilder.tsx`, `src/features/workflow-builder/workflow-builder.css`
- **Приёмка.** В workflow-builder нет hex. На канвасе не больше двух насыщенных оттенков.
- **Правила.** aps-accent-budget, enterprise-color-one-meaning, dataviz-color-jobs-disjoint, decision-calm-normal-color, a11y-ai-01

#### P-138 · S2 · Холст воркфлоу вписывается и добавляет узлы в центр
- **Исправление.** `fitOnMount` (P-21). Нижний `pad` — не меньше 56 px, или органы управления справа вверху. `addNode` берёт центр из `canvasRef.getViewportCenterWorld()`. Магические 400/300 удалить.
- **Файлы.** `src/features/workflow-builder/WorkflowBuilder.tsx`
- **Приёмка.** При 1440×900 при первом открытии видны все стартовые узлы. Пилюля зума их не закрывает.
- **Правила.** aps-display-hierarchy, decision-two-level-disclosure, dataviz-labels-selective-text-tokens

#### P-139 · S2 · Администрирование: раскладка и шапка
- **Исправление.**
  - **Боковая колонка.** Пользователи и роли — в `.adm__side` (flex-колонка); `grid-row: span 2` удалить.
  - **Шапка.** Eyebrow «Система». Заголовок `screenTitle('admin')` «Администрирование». Подзаголовок: «Кто, что и когда менял; пользователи и их права».
  - **Одна прокрутка.** `.adm` — flex-колонка высотой 100 %; `.adm__grid { flex: 1; min-height: 0 }`. Секция журнала — flex-колонка; framed DataTable заполняет высоту (без 64vh).
- **Файлы.** `src/features/admin/AdminScreen.tsx`, `src/features/admin/admin.css`
- **Приёмка.** Между «Пользователями» и «Ролями» нет разрыва. Первая строка журнала не ниже 220 px. Одна полоса прокрутки.
- **Правила.** enterprise-screen-header-contract, aps-display-hierarchy, enterprise-quiet-chrome, enterprise-spacing-type-rhythm, enterprise-one-name-per-destination

#### P-140 · S2 · Колонки журнала
- **Исправление.**
  - **«Когда».** Первый столбец, выравнивание влево, только время (`time()`), `tabular-nums`.
  - **Группы.** Подпись «Сегодня · 24 записи» / «23 октября · 31 запись» (`groupLabel`, P-23).
  - **Сортировка.** `defaultSort` по времени, по убыванию; видна только стрелка «Когда ↓».
  - **«Действие».** Простой текст `--text-secondary`. Chip — только для исключений: ■ (down) — удаление, отказ в доступе, блокировка, ошибка MENTAT; ▲ (setup) — неудачный вход.
- **Файлы.** `src/features/admin/AdminScreen.tsx`, `src/features/admin/admin.css`
- **Приёмка.** Нет чипов «○ прогон». Нет «24.10.2026 24».
- **Правила.** enterprise-table-baseline, dataviz-tables-for-lookup, decision-one-state-vocabulary, aps-status-not-color-alone, decision-calm-normal-color

#### P-141 · S2 · События безопасности и отказы видны
- **Исправление.**
  - **Заголовок.** «Журнал действий · последние 200» и «Загрузить ещё» (лимит += 200).
  - **Фильтр.** Segmented со счётчиками: «Все 200 · Изменения N · Прогоны N · Входы N · Отказы и ошибки N». «Отказы и ошибки» = LOGIN_FAILED, LOGIN_LOCKED, REJECTED, ASK_FAILED, DELETE; ▲, если больше нуля. «Входы» охватывают все три LOGIN_*.
  - **Активные фильтр и поиск.** Чипом со «Сбросить».
  - **Пользователи.** Столбец «Неудачных входов» (число) и чип «заблокирован ■», если статус не active.
- **Файлы.** `src/features/admin/AdminScreen.tsx`
- **Приёмка.** Строки REJECTED доступны одним кликом фильтра.
- **Правила.** aps-exceptions-inbox, aps-status-not-color-alone, enterprise-table-filter-actions-edit, dataviz-filters-one-row-linked

#### P-142 · S2 · Права ролей — матрица по-русски
- **Исправление.**
  - **Подписи `PERM_LABEL`.**

    | Код | Подпись |
    |---|---|
    | READ | «Просмотр» |
    | EDIT_NSI | «Правка справочников» |
    | WRITE_PLAN | «Создание и утверждение планов» |
    | RUN_OPTIMIZE | «Запуск оптимизации» |
    | MANAGE_USERS | «Пользователи и роли» |
    | HIRE_WORKERS | «Найм в своём цехе» |
  - **Матрица.** Плотная DataTable из 6 строк: право (rowHeader) × роли; в заголовке роли — короткое имя и «N польз.». В ячейках ✓ (`--text`) или — (`--text-muted`).
  - **Коды и сокращения.** Сырой код — в «i» строки. `PERMS_SHOWN` с «+N» убрать.
- **Файлы.** `src/features/admin/AdminScreen.tsx`, `src/features/admin/admin.css`
- **Приёмка.** MANAGE_USERS видно без наведения. Нет моно-кодов.
- **Правила.** aps-progressive-disclosure, enterprise-one-name-per-destination, dataviz-tables-for-lookup, decision-tables-not-card-walls, a11y-ai-08

#### P-143 · S2 · Правка пользователя безопасна
- **Исправление.**
  - **Таблица.** Пользователей — только для чтения.
  - **Панель.** Клик по строке открывает SidePanel «Пользователь <login>»: Роль, Цех, primary «Сохранить» и «Отмена». Опасная зона: «Заблокировать/Разблокировать», «Сбросить пароль…» (`UserPatch` status/password).
  - **Смена роли.** Подтверждение с именами: «Назначить petrov.ceh1 роль «Администратор»?».
  - **Обратная связь.** «Сохранено · 14:42» с `role=status`.
  - **Строка admin.** Простой текст «Администратор» с замком и «нельзя изменить».
  - **Статус.** Нейтральный «активен»; Chip down «заблокирован».
- **Файлы.** `src/features/admin/AdminScreen.tsx`, `src/features/admin/UserPanel.tsx` (новый), `src/features/admin/admin.css`
- **Приёмка.** Смена значения в селекте не отправляет PUT. Нет зелёного «активен».
- **Правила.** enterprise-save-and-undo, a11y-ai-09, a11y-ai-22, decision-calm-normal-color, enterprise-table-filter-actions-edit

#### P-144 · S2 · Связи воркфлоу с подписями; клавиатура
- **Исправление.**
  - **Подписи связей.** `WorkflowEdge.label`. Инспектор связи: «Откуда → Куда», поле подписи и быстрые чипы «да» / «нет». Подпись — пилюля посередине ребра, `--text-secondary` на `--bg-app`.
  - **Обратные связи.** (to.y < from.y) идут боковой дорожкой, пунктиром, с подписью «возврат»; строка о них — в легенде.
  - **Клавиатура.** Узлы: `role=button`, `tabIndex=0`; Enter выбирает, Delete удаляет.
  - **Связь без перетаскивания.** В инспекторе узла «Следующий шаг: [select]» создаёт связь.
  - **Порты.** Шире зона попадания: `.wfb__port::before { inset: -6px }`.
- **Файлы.** `src/features/workflow-builder/types.ts`, `src/features/workflow-builder/WorkflowBuilder.tsx`, `src/features/workflow-builder/workflow-builder.css`
- **Приёмка.** Ветви условия подписаны. Узел выбирается с клавиатуры.
- **Правила.** enterprise-keyboard-and-focus, a11y-ai-05, dataviz-annotate-events-sparingly, dataviz-recessive-solid-chrome

#### P-145 · S3 · Полировка: тексты воркфлоу, формы, валидация пользователя, поиск журнала в URL
- **Исправление.**
  - **Подсказки жестов.** Одна приглушённая строка инструментов: «Клик по типу — добавить · тяните от нижнего порта — связать · Del — удалить · F — вписать · ⌘Z — отменить». Подсказку палитры и абзац-описание удалить.
  - **Пустой инспектор.** EmptyState sm «Выберите шаг».
  - **Поля.** `form__input`/`form__textarea`/`form__label`; `.wfb__input`, `.wfb__textarea` удалить.
  - **UserDialog.** «Создать» всегда включена. Проверка при blur и отправке, сообщения под полями, `aria-invalid`/`describedby`, фокус на первое ошибочное поле. Выключена только во время запроса: «Создаём…». «Новый пользователь» — обычная `.btn`.
  - **Поиск журнала.** По русской подписи, объекту и сводке payload. `min-width: 200px`, плейсхолдер «Поиск: объект, пользователь…». Тип и запрос — в параметрах hash (P-11).
- **Файлы.** `src/features/workflow-builder/WorkflowBuilder.tsx`, `src/features/workflow-builder/workflow-builder.css`, `src/features/admin/UserDialog.tsx`, `src/features/admin/AdminScreen.tsx`, `src/features/admin/admin.css`
- **Приёмка.** На AI-воркфлоу не больше одного абзаца длиннее двух строк. Перезагрузка сохраняет фильтр журнала.
- **Правила.** aps-progressive-disclosure, enterprise-designed-empty-states, enterprise-form-validation, enterprise-url-is-state, a11y-ai-02

---

## 4. Сводка

| Группа | Пункты | S1 | S2 | S3 |
|---|---|---|---|---|
| system | P-01…P-26 | 5 | 20 | 1 |
| scheme | P-27…P-41 | 5 | 9 | 1 |
| nsi | P-42…P-55 | 4 | 10 | 0 |
| scenarios | P-56…P-71 | 10 | 6 | 0 |
| optimization | P-72…P-86 | 6 | 9 | 0 |
| plan | P-87…P-100 | 5 | 8 | 1 |
| agents | P-101…P-110 | 3 | 7 | 0 |
| observe | P-111…P-118 | 1 | 6 | 1 |
| explain | P-119…P-132 | 5 | 7 | 2 |
| admin | P-133…P-145 | 4 | 8 | 1 |
| **Итого** | **145** | **48** | **90** | **7** |

Без потерь: каждая находка аудитов S1 и S2 вошла в пункт плана. Дешёвые S3 вошли целиком или слиты со смежными пунктами (P-14, P-17, P-25, P-41, P-55, P-100, P-118, P-131, P-132, P-145). Дорогие части S3 отложены: источник «Методика» в палитре и глаголы палитры, требующие кнопок на экранах.
