/** Разделы «Стадия 2 · портфель»: CVaR, цена робастности, граница Парето. */
import { Callout, Figure, Formula, Notes, Refs, Section } from '../blocks'

export function CvarSection() {
  return (
    <Section
      id="cvar-tail"
      stages={[
        ['done', 'эмпирические VaR/CVaR; критерии cvar, worstcase, meanvariance, minregret'],
        ['w1', 'точная LP Рокафеллара–Урясева (HiGHS, B2), двойственные цены мощностей'],
        ['w2', 'bootstrap-ДИ, сходимость оценки по N'],
      ]}
      lead={<>CVaR<sub>α</sub> (условная стоимость под риском, Expected Shortfall) — средний результат в худших α·100 %
        сценариев. В отличие от VaR это когерентная мера риска: она субаддитивна и учитывает, <i>насколько</i> плохи
        худшие исходы, а не только их порог.</>}
    >
      <Formula note={<>Как metrics_of (Optimizer.cpp). Для длины расписания хвост верхний: среднее ⌊αN⌋ наибольших C<sub>max</sub>.</>}>
        P<sub>(1)</sub> ≤ … ≤ P<sub>(N)</sub>,{'  '}k = ⌊αN⌋:{'  '}VaR<sub>α</sub> = P<sub>(k)</sub>,{'  '}
        CVaR<sub>α</sub> = (1/k)·Σ<sub>i≤k</sub> P<sub>(i)</sub>
      </Formula>
      <p>Главное свойство для оптимизации — представление Рокафеллара–Урясева: CVaR выражается через минимум по
        вспомогательной переменной η, поэтому задача выбора портфеля с ограничениями мощности становится линейной
        программой и решается <b>точно</b>, а не перебором кандидатов.</p>
      <Formula note="При линейной P_i(x) — LP; с линейной обратной функцией спроса — вогнутая QP, также решаемая точно.">
        CVaR<sub>α</sub>(x) = max<sub>η</sub> {'{'} η − (1/(αN))·Σ<sub>i</sub> (η − P<sub>i</sub>(x))<sup>+</sup> {'}'}
        <br />
        ⇒{'  '}max η − (1/(αN))·Σ<sub>i</sub> u<sub>i</sub>,{'  '}u<sub>i</sub> ≥ η − P<sub>i</sub>(x),{'  '}u<sub>i</sub> ≥ 0,{'  '}
        Σ<sub>p</sub> x<sub>p</sub>h<sub>p,w</sub> ≤ Cap<sub>w</sub>
      </Formula>
      <p>Компромисс «среднее — риск» записывается одной строкой; при w = 1 получается чистый CVaR (критерий по
        умолчанию), при w = 0 — максимизация ожидания:</p>
      <Formula>(1 − w)·E + w·CVaR<sub>α</sub>{'  '}={'  '}E − w·(E − CVaR<sub>α</sub>)</Formula>
      <Figure id="cvar-tail" caption="200 прогонов прибыли; закрашен хвост худших 10 %, его среднее — ● CVaR, среднее всех — ● E; скобка — штраф за риск." />
      <Notes items={[
        'По умолчанию N = 2000, α = 0,10 — в хвосте 200 точек. В Стадии 1 для больших планов N ≤ 40, то есть 4 точки хвоста: оценка шумная, нужны доверительные интервалы (bootstrap).',
        'Эмпирическая оценка совпадает с оценкой Рокафеллара–Урясева, когда αN — целое.',
        'Min-regret считается относительно лучшего кандидата пула и поэтому зависит от посторонних альтернатив; с точной LP оптимум в каждом сценарии станет доступен.',
      ]} />
      <Refs items={[
        'Rockafellar R.T., Uryasev S. (2000) Optimization of conditional value-at-risk. J. of Risk 2(3):21–41.',
        'Rockafellar R.T., Uryasev S. (2002) Conditional value-at-risk for general loss distributions. J. Banking & Finance 26(7):1443–1471.',
        'Artzner P., Delbaen F., Eber J.-M., Heath D. (1999) Coherent measures of risk. Math. Finance 9(3):203–228.',
        'Acerbi C., Tasche D. (2002) On the coherence of expected shortfall. J. Banking & Finance 26(7):1487–1503.',
        'Krokhmal P., Palmquist J., Uryasev S. (2002) Portfolio optimization with conditional value-at-risk objective and constraints. J. of Risk 4(2):43–68.',
      ]} />
    </Section>
  )
}

export function RobustnessSection() {
  return (
    <Section
      id="price-of-robustness"
      stages={[
        ['done', 'обе точки x* и x_E, ΔE, проверка на свежих сценариях (out-of-sample)'],
        ['w1', 'показ out-of-sample разрывов на экране «Оптимизация»'],
        ['w2', 'сравнение на одном допустимом множестве, кривая по α'],
      ]}
      lead={<>Робастное решение сознательно отдаёт часть ожидаемой прибыли ради лучшего худшего случая.
        Эту плату и называют ценой робастности.</>}
    >
      <Formula note="x* = argmax CVaR_α, x_E = argmax E. Термин — Bertsimas & Sim (2004).">
        ΔE = E[P(x<sub>E</sub>)] − E[P(x*)] ≥ 0,{'  '}ΔCVaR = CVaR<sub>α</sub>(x*) − CVaR<sub>α</sub>(x<sub>E</sub>) ≥ 0
      </Formula>
      <p>Интерфейс всегда показывает обе точки, чтобы решение было прозрачным: «отдаём ΔE в среднем — получаем ΔCVaR
        в плохих сценариях». Портфель, выбранный на тех же N сценариях, по которым оценён, выглядит лучше, чем есть
        (смещение оптимизатора), поэтому робастный портфель переоценивается на <b>свежих</b> N сценариях
        (seed + 9973): разрывы gap_expected и gap_cvar показывают переобучение SAA.</p>
      <Figure id="price-of-robustness" caption="Плотности прибыли портфеля max E (пунктир) и робастного (сплошная); заливка — худшие α у x_E, которые срезает робастное решение." />
      <Callout tone="note" title="Оговорка о сравнении">
        Сейчас x<sub>E</sub> ищется без ограничения maxShare, поэтому ΔE смешивает цену несклонности к риску и цену
        диверсификации. Корректное сравнение — на одном допустимом множестве. Термин «устойчивость» в отечественном
        исследовании операций занят (радиус устойчивости), отсюда — «робастное решение».
      </Callout>
      <Refs items={[
        'Bertsimas D., Sim M. (2004) The price of robustness. Oper. Res. 52(1):35–53.',
        'Kleywegt A., Shapiro A., Homem-de-Mello T. (2002) The sample average approximation method for stochastic discrete optimization. SIAM J. Optim. 12(2):479–502.',
        'Mak W.K., Morton D., Wood R.K. (1999) Monte Carlo bounding techniques for determining solution quality in stochastic programs. Oper. Res. Lett. 24(1–2):47–56.',
      ]} />
    </Section>
  )
}

export function ParetoSection() {
  return (
    <Section
      id="pareto"
      stages={[
        ['done', 'недоминируемые кандидаты на экране «Оптимизация»'],
        ['w1', 'точная граница: развёртка веса w в mean–CVaR LP'],
        ['w2', 'граница «робастное ↔ ожидаемое» по α ∈ [0,01; 0,5]'],
      ]}
      lead={<>Ни один портфель не лучше сразу по ожидаемой прибыли и по риску. Разумные кандидаты лежат на границе
        Парето; выбор точки на ней — вопрос склонности к риску, а не вычислений.</>}
    >
      <Formula note="Для выпуклой задачи развёртка w ∈ [0, 1] даёт всю границу; альтернатива — ε-ограничения: max E при CVaR ≥ c.">
        x ≻ y ⇔ E(x) ≥ E(y), CVaR(x) ≥ CVaR(y), хотя бы одно строго;{'  '}граница = {'{'} x : ∄ y ≻ x {'}'}
      </Formula>
      <p>Сейчас граница строится из пула эвристических кандидатов и является <i>внутренней аппроксимацией</i> истинной.
        Точная LP даст настоящую границу и количественный разрыв «эвристика ↔ точное решение» — сильнейший
        отдельный результат для научной части работы.</p>
      <Figure id="pareto" caption="Кандидаты в плоскости (CVaR, E): ● — граница Парето, ▲ — робастное x*, ○ — x_E; заливка — портфели, доминирующие кандидата p." />
      <Refs items={[
        'Markowitz H. (1952) Portfolio selection. J. Finance 7(1):77–91.',
        'Miettinen K. (1999) Nonlinear Multiobjective Optimization. Kluwer.',
        'Krokhmal P., Palmquist J., Uryasev S. (2002) Portfolio optimization with CVaR objective and constraints. J. of Risk 4(2):43–68.',
      ]} />
    </Section>
  )
}
