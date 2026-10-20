/** Разделы «Внешние условия»: прогноз цен и корреляция → диверсификация. */
import { Callout, Figure, Formula, Notes, Refs, Section } from '../blocks'

export function ForecastSection() {
  return (
    <Section
      id="forecast-decomposition"
      stages={[
        ['done', 'тренд EMD, ≤ 3 гармоники, остаток по AIC, веер P10/P50/P90, backtest против наивного'],
        ['w2', 'rolling-origin оценка, исправление B11–B13, траектории прогноза в Стадию 2'],
      ]}
      lead={<>История цены раскладывается на медленный тренд, периодические колебания и случайный остаток;
        остаток описывается распределением, и методом Монте-Карло строится веер будущих значений.</>}
    >
      <Formula note={<>Тренд — остаточная мода эмпирической модовой декомпозиции (EMD, Huang et al., 1998);
        гармоники отбираются по амплитуде; семейство F̂ остатка — по AIC. P10/P50/P90 — квантили по N траекториям.</>}>
        y<sub>t</sub> = T<sub>t</sub> + S<sub>t</sub> + ε<sub>t</sub>,{'  '}
        S<sub>t</sub> = Σ<sub>k≤3</sub> A<sub>k</sub>·sin(2πt/P<sub>k</sub> + φ<sub>k</sub>)
        <br />
        ŷ<sub>T+h</sub> = T<sub>T+h</sub> + S<sub>T+h</sub> + Σ<sub>i=1..h</sub> ε<sub>T+i</sub>,{'  '}ε ~ F̂
      </Formula>
      <p>Качество проверяется ретроспективным прогнозом (backtest) с одной точки отсечения: MAPE, выигрыш против
        наивного прогноза и доля фактов внутри веера.</p>
      <Figure id="forecast-decomposition" caption="Ряд = тренд + гармоники + остаток; справа — веер P10/P50/P90 на 12 месяцев, точки на краю — концы смоделированных траекторий." />
      <Callout tone="fix" title="Известные ошибки (Волна 2)">
        <b>B11:</b> распределение подбирается к остаткам <i>уровня</i>, а используется как приращения случайного
        блуждания — ширина веера неверна на всех горизонтах. <b>B12:</b> наклон тренда по номинальной истории
        складывается с инфляцией сценария — инфляция учитывается дважды. <b>B13:</b> вариант «t» — не многомерное
        t-распределение (независимые χ² по изделиям), «stable» теряет общий фактор.
      </Callout>
      <Notes items={[
        'EMD с линейными огибающими на 24–36 месячных точках имеет краевые эффекты; гармоники выбираются без теста значимости (g-критерий Фишера) — риск переобучения.',
        'Коэффициенты макрофакторов (санкции, ставка, энергия, логистика) подобраны «для заметного эффекта ползунков», а не оценены: их оценят по данным (VAR/ARDL) или явно пометят как экспертные допущения с источниками.',
        'Оптимизатор пока использует статическое распределение цены за период, а не траектории веера: «единый движок» верен только для экрана прогноза.',
        'План оценки: ≥ 12 точек отсечения, MASE, CRPS, покрытие 80/95 %, тест Диболда–Мариано против наивного, ETS и ARIMA.',
      ]} />
      <Refs items={[
        'Huang N. et al. (1998) The empirical mode decomposition and the Hilbert spectrum. Proc. R. Soc. A 454:903–995.',
        'Colominas M., Schlotthauer G., Torres M. (2014) Improved complete ensemble EMD (CEEMDAN). Biomed. Signal Process. Control 14:19–29.',
        'Hyndman R., Athanasopoulos G. (2021) Forecasting: Principles and Practice, 3rd ed. OTexts.',
        'Hyndman R., Koehler A. (2006) Another look at measures of forecast accuracy. Int. J. Forecasting 22(4):679–688.',
        'Gneiting T., Raftery A. (2007) Strictly proper scoring rules, prediction, and estimation. JASA 102(477):359–378.',
        'Diebold F., Mariano R. (1995) Comparing predictive accuracy. J. Business & Economic Statistics 13(3):253–263.',
      ]} />
    </Section>
  )
}

export function CorrelationSection() {
  return (
    <Section
      id="correlation-diversification"
      stages={[
        ['done', 'однофакторная гауссова копула, β = √ρ, вклад в риск, HHI, ограничение maxShare'],
        ['w2', 'полная матрица + разложение Холецкого, t-копула для хвостовой зависимости'],
      ]}
      lead={<>Цены изделий движутся вместе: общий рыночный шок M связывает их, поэтому выгода от
        диверсификации портфеля ограничена корреляцией — и исчезает в кризис, когда ρ → 1.</>}
    >
      <Formula note="Положительная полуопределённость гарантирована построением — разложение Холецкого не требуется.">
        z<sub>s</sub> = β<sub>s</sub>·M + √(1 − β<sub>s</sub>²)·ε<sub>s</sub>,{'  '}
        π<sub>s</sub> = F<sub>s</sub><sup>−1</sup>(Φ(z<sub>s</sub>)),{'  '}
        corr(z<sub>s</sub>, z<sub>t</sub>) = β<sub>s</sub>·β<sub>t</sub>
      </Formula>
      <p>Для n изделий с равными долями, равными σ и попарной корреляцией ρ относительный риск портфеля</p>
      <Formula note="Систематическая часть √ρ не диверсифицируется ни при каком n.">
        σ<sub>P</sub> / σ = √(ρ + (1 − ρ)/n){'  '}→{'  '}√ρ{'  '}при n → ∞
      </Formula>
      <p>Концентрация ограничивается долей одного изделия в выручке s<sub>p</sub> ≤ maxShare; диверсификация
        измеряется индексом Херфиндаля HHI = Σ s<sub>i</sub>² (эффективное число изделий 1/HHI), а вклад изделия в риск —
        RC<sub>s</sub> = Cov(x<sub>s</sub>m<sub>s</sub>, P) / Var(P), ΣRC<sub>s</sub> = 1.</p>
      <Figure id="correlation-diversification" caption="Кривые σ_P/σ для n = 1, 2, 5, 20 и предел √ρ; заливка — диверсифицируемая часть риска. Справа — пары латентных шоков при ρ = 0,1 и 0,9." />
      <Notes items={[
        'corr(π_s, π_t) ≈ β_s·β_t лишь приближённо: точное значение зависит от маргинальных распределений.',
        'Нет отрицательных и отраслевых корреляций; гауссова копула не имеет хвостовой зависимости — совместные экстремумы в кризис недооцениваются.',
        'Семейства «t» и «pareto» не нормированы к заданному σ (у Ломакса α = 2,3 СКО ≈ 2,26σ), жёсткое усечение [min, max] создаёт точечные массы, фиксирующие CVaR — исправление в Волне 2.',
      ]} />
      <Refs items={[
        'Markowitz H. (1952) Portfolio selection. J. Finance 7(1):77–91.',
        'McNeil A., Frey R., Embrechts P. (2015) Quantitative Risk Management, rev. ed. Princeton UP.',
        'Higham N. (2002) Computing the nearest correlation matrix. IMA J. Numer. Anal. 22(3):329–343.',
      ]} />
    </Section>
  )
}
