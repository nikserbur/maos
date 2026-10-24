/** Разделы «Введение»: обзор модели (8 блоков карты), грамматика схем, статусы v0.74; двухуровневая модель. */
import { BlockChip } from '../../../ui/BlockChip'
import { Callout, Figure, Formula, Notes, Refs, Section, StageChip } from '../blocks'

const a = (id: string) => `#/methodology/${id}`

function GrammarSwatch({ kind }: { kind: 'sys' | 'res' | 'goal' | 'evt' | 'mat' | 'info' }) {
  return (
    <svg className="mth-swatch" viewBox="0 0 28 16" aria-hidden="true">
      {kind === 'sys' && <circle cx="14" cy="8" r="6.5" fill="var(--ultramarine)" />}
      {kind === 'res' && <rect x="8" y="2" width="12" height="12" fill="var(--cinnabar)" />}
      {kind === 'goal' && <polygon points="14,1.5 20,14.5 8,14.5" fill="var(--ochre-fill)" />}
      {kind === 'evt' && <circle cx="14" cy="8" r="2" fill="var(--text)" />}
      {kind === 'mat' && <line x1="2" y1="8" x2="26" y2="8" stroke="var(--text)" strokeWidth="2" />}
      {kind === 'info' && <line x1="2" y1="8" x2="26" y2="8" stroke="var(--text)" strokeWidth="2" strokeDasharray="4 3" />}
    </svg>
  )
}

const GRAMMAR: ReadonlyArray<readonly [Parameters<typeof GrammarSwatch>[0]['kind'], string, string]> = [
  ['sys', '● система, целое', 'завод, симулятор, расписание; ультрамарин — модель'],
  ['res', '■ ресурс, сущность', 'станки, рабочие, механизмы IDEF0'],
  ['goal', '▲ цель, решение', 'портфель, точка окупаемости, запуск; охра — цель'],
  ['evt', '· событие, экземпляр', 'сценарий, прогон, исход; облака точек — стохастика'],
  ['mat', 'сплошная линия', 'материальный поток'],
  ['info', 'пунктир', 'информация и обратная связь; киноварь — риск, ярь-медянка — допустимое'],
]

export function Overview() {
  return (
    <Section
      id="overview"
      blocks={['external', 'distributions', 'internal', 'decisions', 'criteria', 'agents', 'monitoring', 'llm']}
      lead={<>PESCADITO (ядро MAOS) — цифровая (имитационная) модель дискретного производства: от сценариев внешних условий
        к производственному портфелю, расписанию, KPI и инвестиционному решению. У каждого числа в интерфейсе есть
        формула, допущения и источник; здесь они собраны в одном месте.</>}
    >
      <p>Расчёт идёт по потоку данных — восемь блоков «Карты методологии», слева направо и петлями снизу:</p>
      <ol className="mth-steps mth-steps--blocks">
        <li><BlockChip block="external" /> Ставка, курс и инфляция — из обученного генератора по рядам Банка России;
          цены — прогноз по истории (<a href={a('forecast-decomposition')}>декомпозиция</a>); режимы и стрессы вместо ползунков.</li>
        <li><BlockChip block="distributions" /> Распределения цен с общим рыночным фактором
          (<a href={a('correlation-diversification')}>копула</a>), <a href={a('heavy-tail')}>тяжёлые хвосты</a> длительностей, поломки и ремонты.</li>
        <li><BlockChip block="internal" /> Мощности и календари, персонал, техкарты (<a href={a('idef0')}>IDEF0</a>),
          <a href={a('mrp')}> MRP</a>, касса и кредитная линия.</li>
        <li><BlockChip block="decisions" /> Стадия 2 — робастный портфель по <a href={a('cvar-tail')}>CVaR</a> (точная LP);
          Стадия 1 — расписание (<a href={a('dispatch-rules')}>правила, ГА, CP-SAT</a>,
          <a href={a('lot-streaming')}> транспортные партии</a>); транши кредитной линии; <a href={a('npv')}>инвестиции</a>.</li>
        <li><BlockChip block="criteria" /> CVaR прибыли и кассы, <a href={a('kpi-definitions')}>KPI по ГОСТ Р ИСО 22400</a>,
          <a href={a('price-of-robustness')}> цена робастности</a> и ликвидности, доверительные интервалы
          (<a href={a('validation')}>протокол</a>).</li>
        <li><BlockChip block="agents" /> RL исследован в волнах A1–A4: гейт не пройден, найденное им казначейское правило —
          в продукте (<a href={a('rl')}>раздел RL</a>); <a href={a('agent-layers')}>игры цехов</a> — <StageChip feature="games" />.</li>
        <li><BlockChip block="monitoring" /> Проверка прогноза против наивного, CRPS генератора, план-факт, узкое место по
          <a href={a('toc')}> теории ограничений</a> и <a href={a('little-law')}>закону Литтла</a>; раннее предупреждение — <StageChip feature="early-warning" />.</li>
        <li><BlockChip block="llm" /> MENTAT отвечает «почему так» только по графу расчёта и сверяет каждое число с узлом;
          модель локальная — <StageChip feature="mentat" />.</li>
      </ol>

      <Callout tone="note" title="Термин «цифровой двойник»">
        Без автоматического обмена данными с объектом это <i>цифровая модель</i>, а не двойник
        (Kritzinger et al., 2018). Корректно: «цифровая (имитационная) модель производства — прототип цифрового
        двойника»; требования к адекватности и V&amp;V — в разделе <a href={a('validation')}>«Верификация»</a>.
      </Callout>

      <h3 className="mth-h3">Как читать схемы</h3>
      <p>Все рисунки нарисованы одним геометрическим словарём («Конструктивный Кандинский»): форма несёт смысл,
        цвет — роль, толщина линии — величину. Стохастика всегда изображена облаком точек или «зерном».</p>
      <dl className="mth-grammar">
        {GRAMMAR.map(([k, term, def]) => (
          <div key={k} className="mth-grammar__row">
            <dt><GrammarSwatch kind={k} />{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mth-h3">Что реализовано, а что в плане</h3>
      <div className="mth-stage-legend">
        <div><StageChip stage="done" /><p>Есть в коде версии 0.74 и используется в расчётах: точная CVaR-LP (HiGHS)
          с двойственными ценами, CP-SAT с бенчмарками Taillard и Brandimarte, доверительные интервалы и протокол
          доказательности, касса и кредитная линия, обученный макро-генератор, RL (волны A1–A4: исследован, найденное
          правило — в продукте), инвестиционный агент, MENTAT (промпты и проверка верности).</p></div>
        <div><StageChip stage="w1" /><p>Калибровка по план-факту: идентификация норм и байесовское обновление паспорта
          параметров; оставшиеся поправки методики, отмеченные в разделах.</p></div>
        <div><StageChip stage="w2" /><p>Раннее предупреждение по кассе и срывам, rolling-origin оценка прогноза, анализ
          чувствительности, управляемые действия и форк сценариев.</p></div>
        <div><StageChip stage="w3" /><p>Игры цехов (цена анархии, Штакельберг), выученные цены планировщика L2,
          DRO-CVaR и настоящая двухэтапная SAA с рекурсом.</p></div>
      </div>
      <Refs items={[
        'Kritzinger W., Karner M., Traar G., Henjes J., Sihn W. (2018) Digital Twin in manufacturing: a categorical literature review and classification. IFAC-PapersOnLine 51(11):1016–1022.',
        'ГОСТ Р ИСО 22400-2-2019 (≡ ISO 22400-2:2014). Ключевые показатели эффективности для управления производственными операциями.',
      ]} />
    </Section>
  )
}

export function TwoStages() {
  return (
    <Section
      id="two-stages"
      blocks={['decisions', 'criteria']}
      stages={[
        ['done', 'Стадия 2 → Стадия 1, обратная связь stage1_feedback'],
        ['exact-cvar'],
        ['w3', 'двухэтапная SAA с рекурсом'],
      ]}
      lead={<>Стадия 2 решает, <i>что и сколько</i> выпускать; Стадия 1 — <i>как</i> выполнить это на ограниченных
        мощностях. Решение верхнего уровня — вход нижнего, нижний возвращает калибровку себестоимости.</>}
    >
      <p><b>Стадия 2.</b> Портфель x = (x<sub>p</sub>) по товарным изделиям выбирается по эмпирическому распределению
        прибыли на N сценариях (метод статистических испытаний с общими случайными числами). По умолчанию
        максимизируется CVaR<sub>α</sub> прибыли при ограничениях мощности, спроса и доли одного изделия в выручке:</p>
      <Formula note={<>Cap<sub>w</sub> = K<sub>w</sub>·H·η — фонд типа РЦ; P(x, ω) = Σ<sub>p</sub> x<sub>p</sub>·(π<sub>p</sub>(ω) − c<sub>p</sub>(ω)).
        Пул ≈120 эвристических кандидатов и точная LP Рокафеллара–Урясева (HiGHS) — обе в продукте.</>}>
        max<sub>x</sub> CVaR<sub>α</sub>[P(x, ω)]{'  '}при{'  '}Σ<sub>p</sub> x<sub>p</sub>·h<sub>p,w</sub> ≤ Cap<sub>w</sub>,{'  '}
        0 ≤ x<sub>p</sub> ≤ D<sub>p</sub>,{'  '}s<sub>p</sub>(x) ≤ maxShare
      </Formula>
      <p><b>Стадия 1.</b> Программа <code>portfolio_items</code> разворачивается в граф операций (маршруты + входы),
        который строится списочным планированием по диспетчерскому правилу; длительности разыгрываются методом
        Монте-Карло. Правило выбирается по целевой функции:</p>
      <Formula note="Scheduler.cpp; веса — параметры POST /api/schedule. Стоимостная часть — минуты переналадок, не рубли.">
        F = w<sub>t</sub>·E[C<sub>max</sub>] + w<sub>r</sub>·(CVaR<sub>α</sub>[C<sub>max</sub>] − E[C<sub>max</sub>])
        + w<sub>c</sub>·T<sub>нал</sub> + 0,5·E[ΣT<sub>j</sub>]
      </Formula>
      <p><b>Обратная связь.</b> По расписанию для каждого изделия считается множитель 1 + доля переналадок
        (<code>stage1_feedback</code>), который Стадия 2 применяет к нормо-часам. Это разомкнутая калибровка, а не
        совместная оптимизация.</p>
      <Figure id="two-stages" caption="Облако сценариев цен через Монте-Карло питает ▲ портфеля; программа выпуска (сплошная) уходит в ● расписания; пунктир — калибровка себестоимости и сроков." />
      <Callout tone="fix" title="Поправка: не «двухэтапная задача с рекурсом»">
        В стохастическом программировании двухэтапная задача подразумевает решения второго этапа y(ω), принимаемые
        отдельно в каждом сценарии и оптимизируемые совместно с x (Юдин, 1979; Birge &amp; Louveaux, 2011).
        В MAOS Стадия 1 считается один раз для выбранного x, поэтому корректный термин —
        <b> иерархическая двухуровневая модель планирования</b> (объёмное → календарное; Maravelias &amp; Sung, 2009).
        Настоящая SAA с рекурсом (сверхурочные, аутсорсинг, упущенные продажи) — Волна 3.
      </Callout>
      <Notes items={[
        'Мощность Стадии 2 учитывает первый допустимый тип РЦ и КПД 0,85, Стадия 1 — гибкий выбор станка без КПД (B17, в плане исправлений).',
        'Норма t_norm в Стадии 2 трактуется на единицу, в Стадии 1 — на партию (B15): одна конвенция будет зафиксирована в НСИ.',
        'Стадия 2 не учитывает ограничение по труду; оно появляется только в Стадии 1.',
      ]} />
      <Refs items={[
        'Maravelias C., Sung C. (2009) Integration of production planning and scheduling: overview, challenges and opportunities. Comput. Chem. Eng. 33(12):1919–1930.',
        'Birge J., Louveaux F. (2011) Introduction to Stochastic Programming, 2nd ed. Springer.',
        'Юдин Д.Б. (1979) Задачи и методы стохастического программирования. М.: Сов. радио.',
        'Shapiro A., Dentcheva D., Ruszczyński A. (2021) Lectures on Stochastic Programming, 3rd ed. SIAM.',
        'Amaran S., Sahinidis N., Sharda B., Bury S. (2016) Simulation optimization: a review of algorithms and applications. Annals of OR 240:351–380.',
      ]} />
    </Section>
  )
}
