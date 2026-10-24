/** Разделы «Наука и рынок»: верификация и валидация; конкуренты и позиционирование. */
import { Callout, Formula, Refs, Section } from '../blocks'

const V_AND_V: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['Верификация', 'правильно ли реализована модель', [
    'контрольные случаи: один станок ⇒ Cmax = Σ pⱼ; цепочка без конфликтов ⇒ Cmax = длина критического пути',
    'тождества: L = λW на сгенерированных планах; min ≤ CVaR ≤ E для прибыли',
    'регрессионные тесты на исправленные ошибки B1, B3–B6, B9, B10, B14, B16 (GoogleTest) и формулы «i» (vitest)',
    'воспроизводимость: переносимые генераторы, seed + версия кода + хэш данных в каждом прогоне',
  ]],
  ['Валидация', 'адекватна ли модель объекту', [
    'калибровка норм только по факту (план–факт, MLE или байесовское обновление), а не по смоделированному плану (B7)',
    'экспертная проверка правдоподобия с технологами; сверка очередей узкого места с формулой Кингмана',
    'раскрытие синтетических сроков в демо-данных: OTD на них — артефакт',
  ]],
  ['Бенчмарки', 'насколько хорош алгоритм', [
    'JSSP: FT06/10/20, LA01–40, Taillard; FJSP: Brandimarte MK01–10, Hurink edata/rdata/vdata',
    'эталон — OR-Tools CP-SAT с лимитом времени; разрыв к лучшим известным решениям и к нижней оценке LB',
  ]],
  ['Статистика', 'значимы ли различия', [
    'bootstrap-ДИ для E, CVaR, Cmax; сходимость стандартной ошибки CVaR по N',
    'парные тесты на общих случайных числах (Уилкоксон), ranking & selection; ДИ разрыва оптимальности SAA',
  ]],
  ['Чувствительность', 'от чего зависит ответ', [
    'торнадо (по одному фактору) и глобальные индексы Соболя по ~10 параметрам: α, λ, maxShare, β, эластичность, хвост, переделка, веса просрочки',
    'граница «робастное ↔ ожидаемое» по α ∈ [0,01; 0,5]; для прогноза — rolling-origin, MASE, CRPS, покрытие',
  ]],
]

export function ValidationSection() {
  return (
    <Section
      id="validation"
      blocks={['criteria']}
      stages={[
        ['ci'],
        ['done', 'бенчмарки Taillard и Brandimarte, регрессионные тесты ядра и формул «i»'],
        ['identify'],
        ['w2', 'анализ чувствительности, rolling-origin оценка прогноза'],
      ]}
      lead={<>Модели можно доверять, только если показано, что она правильно реализована (верификация) и адекватно
        описывает объект (валидация) — два разных вопроса в смысле ГОСТ Р 57700.37-2021.</>}
    >
      <div className="mth-vv">
        {V_AND_V.map(([title, q, items]) => (
          <div key={title} className="mth-vv__card">
            <div className="mth-vv__title">{title}</div>
            <div className="mth-vv__q">{q}</div>
            <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul>
          </div>
        ))}
      </div>
      <p>Нижняя оценка длины расписания даёт KPI «разрыв оптимальности» для любого плана, даже без точного решателя:</p>
      <Formula note="K_w — число станков типа w; работа — сумма средних длительностей операций, допустимых на типе.">
        LB = max( max<sub>цепочки</sub> Σ p̄<sub>j</sub>,{'  '}max<sub>w</sub> Σ<sub>j∈w</sub> p̄<sub>j</sub> / K<sub>w</sub> ),{'  '}
        gap = (C<sub>max</sub> − LB) / LB
      </Formula>
      <Refs items={[
        'ГОСТ Р 57700.37-2021. Компьютерные модели и моделирование. Цифровые двойники изделий. Общие положения.',
        'Fisher H., Thompson G. (1963) Probabilistic learning combinations of local job-shop scheduling rules. In: Muth J., Thompson G. (eds.) Industrial Scheduling. Prentice-Hall.',
        'Lawrence S. (1984) Resource constrained project scheduling: an experimental investigation of heuristic scheduling techniques (Supplement). GSIA, Carnegie Mellon University.',
        'Taillard E. (1993) Benchmarks for basic scheduling problems. EJOR 64(2):278–285.',
        'Brandimarte P. (1993) Routing and scheduling in a flexible job shop by tabu search. Annals of OR 41:157–183.',
        'Hurink J., Jurisch B., Thole M. (1994) Tabu search for the job-shop scheduling problem with multi-purpose machines. OR Spektrum 15:205–215.',
        'Naderi B., Ruiz R., Roshanaei V. (2023) Mixed-integer programming vs. constraint programming for shop scheduling problems. INFORMS J. Computing 35(4):817–843.',
        'Kim S.-H., Nelson B. (2006) Selecting the best system. Handbooks in OR & MS 13:501–534.',
        'Saltelli A. et al. (2008) Global Sensitivity Analysis: The Primer. Wiley.',
      ]} />
    </Section>
  )
}

type Mark = '●' | '◐' | '○' | '?'
const VENDORS = ['Palantir', 'Siemens', 'DELMIA', 'Kinaxis', 'o9', 'Seeq', 'РФ', 'MAOS'] as const
const MATRIX: ReadonlyArray<readonly [string, string]> = [
  ['Модель завода (оборудование, маршруты, BOM)', '◐●●◐◐◐◐●'],
  ['Расписание с конечной мощностью', '◐●●◐◐○◐◐'],
  ['Стохастическая и робастная оптимизация', '○◐?◐◐○◐●'],
  ['Сценарии «что если»', '●●●●●◐◐◐'],
  ['Объяснимость KPI (формулы)', '◐◐?◐◐●○●'],
  ['ИИ-агенты, копилоты', '●●◐●●●○◐'],
  ['Обучение с подкреплением', '○◐◐◐◐◐○○'],
  ['3D / визуальный двойник', '◐●●○○○○●'],
  ['Интеграция данных', '●●●●●◐◐◐'],
  ['Качество UX (по отзывам)', '●◐◐◐◐●○◐'],
]
const MARK_CLASS: Record<Mark, string> = { '●': 'is-strong', '◐': 'is-part', '○': 'is-none', '?': 'is-unknown' }
const MARK_LABEL: Record<Mark, string> = { '●': 'сильная сторона', '◐': 'частично', '○': 'нет', '?': 'неизвестно' }

export function CompetitorsSection() {
  return (
    <Section
      id="competitors"
      stages={[['w2', 'слой управляемых действий и аудит, форк/merge сценариев, drill-down KPI до строк']]}
      lead={<>Позиционирование MAOS — <b>прозрачный (glass-box) стохастический APS-двойник</b>: APS-контур к 1С:ERP
        для среднего дискретного производства России, где неопределённость — первоклассная сущность, а каждое число
        раскрывается до формулы.</>}
    >
      <div className="mth-table-wrap">
        <table className="mth-table mth-matrix">
          <thead>
            <tr><th>Возможность</th>{VENDORS.map((v) => <th key={v} className={v === 'MAOS' ? 'is-maos' : undefined}>{v}</th>)}</tr>
          </thead>
          <tbody>
            {MATRIX.map(([cap, marks]) => (
              <tr key={cap}>
                <td>{cap}</td>
                {[...marks].map((m, i) => (
                  <td key={i} className={`mth-matrix__mark ${MARK_CLASS[m as Mark]}${VENDORS[i] === 'MAOS' ? ' is-maos' : ''}`}
                    aria-label={`${VENDORS[i]}: ${MARK_LABEL[m as Mark]}`}>{m}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mth-after-table">● сильная сторона · ◐ частично или заявлено · ○ нет или не найдено · ? неизвестно.
        Siemens = Opcenter APS + Plant Simulation + Insights Hub; РФ = 1С / Adeptik / БИА / Zyfra.</p>
      <h3 className="mth-h3">Чем MAOS отличается</h3>
      <p>Стохастическая и робастная оптимизация портфеля (CVaR, тяжёлые хвосты, коррелированные цены) <i>совмещена</i> с
        расписанием; у лидеров рынка «вероятностное» планирование во многом маркетинг, а Simio RPS лишь
        <i> оценивает</i> риск уже построенного плана. Плюс реестр формул KPI, инвестиции через теорию ограничений,
        3D-схема как система записи и автономная суверенная поставка (SQLite на проект).</p>
      <h3 className="mth-h3">Пробелы — по приоритету</h3>
      <ol className="mth-steps">
        <li>Слой управляемых действий (Actions: параметры, валидация, права) и журнал аудита — как Ontology Actions у Palantir.</li>
        <li>Сценарии как форк из дельт с сравнением и merge через действие.</li>
        <li>Drill-down KPI до исходных строк (эталон прозрачности — Seeq).</li>
        <li>Контракт Ганта: подсказка → поиск → валидация → обзор → фиксация.</li>
        <li>Входящие предложения ИИ-агентов с журналом решений и evals: агент только предлагает действия, человек подтверждает.</li>
        <li>Импорт и сопоставление данных 1С/Excel; затем — RL как научное расширение.</li>
      </ol>
      <Callout tone="note" title="Контекст рынка и оговорка">
        Рынок APS в России — ₽591 млн (2025) против ₽12,85 млрд у MES, явных лидеров нет, планирование часто в Excel,
        западные вендоры ушли, а для КИИ действует срок перехода на отечественное ПО до 2030 г. Оценки в матрице — по
        публичным материалам вендоров (октябрь 2026), то есть заявления; оценки MAOS — по списку функций без сверки с кодом.
      </Callout>
      <Refs items={[
        'Palantir Foundry documentation: Ontology, Ontology Scenarios, Dynamic Scheduling, AIP Logic/Automate/Evals (2025–2026).',
        'Siemens Digital Industries Software (2025). IDC MarketScape: Worldwide APS — Opcenter APS as a Leader.',
        'Lokad (2025) The state of probabilistic forecasting in supply chain.',
        'ITWeek (дек. 2025). Рынок APS и MES в России.',
      ]} />
    </Section>
  )
}
