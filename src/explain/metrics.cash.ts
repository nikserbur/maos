/**
 * «i»-объяснения денежного слоя (METHODOLOGY-V2 §6.0, категория «Деньги» каталога KPI).
 * Код — backend/src/CashWaterfall.cpp (водопад §4.3), CashLp.cpp (CVaR-LP с кассой §5.2),
 * CashOptimize.cpp (кривая цены ликвидности, бутстреп-ДИ). Значения — ответ POST /api/optimize/cash.
 * Статусы по паспорту: β, L_min, C₀, лимит — [К] (данных предприятия нет); ставки налогов, ковенант — [НОРМ].
 */
import type { MetricExplain } from './types'

const CASH_METHOD =
  'Водопад денежных средств по неделям (§4.3): инкассация с ядром DSO и дефолтами → оплата поставщикам с DPO → зарплата и взносы → ' +
  'энергия, логистика, ремонты → НДС и налог на прибыль по сетке → проценты и погашение кредитной линии. Прогоняется по тем же N сценариям, ' +
  'что и портфель (общие случайные числа), поэтому хвост кассы сопоставим с хвостом прибыли.'

export const CASH_METRICS: readonly MetricExplain[] = [
  {
    id: 'cash.cash_min_p50',
    title: 'Минимум кассы (медиана)',
    short: 'Самый низкий остаток кассы за горизонт в типичном сценарии — медиана по N сценариям водопада.',
    formula: 'C_min,i = minₜ C_i,t\nCASH_MIN_P50 = med_i C_min,i = {cash_min}\nсценариев N = {n}, недель T = {weeks}',
    variables: [
      { key: 'cash_min', label: 'Медиана минимума кассы', unit: '₽' },
      { key: 'n', label: 'Сценариев в водопаде', unit: '—' },
      { key: 'weeks', label: 'Горизонт кассы', unit: 'нед' },
    ],
    unit: '₽',
    method: CASH_METHOD,
    caveats: ['Медиана не показывает хвост — для риска смотрите CFaR и вероятность разрыва.'],
    learnMore: 'overview',
  },
  {
    id: 'cash.cfar',
    title: 'CFaR — CVaR минимума кассы',
    short: 'Среднее худших β·100 % сценариев по минимальному остатку кассы: сколько денег не хватит в плохой год.',
    formula: 'CFaR_β = (1/k′)·Σ_(i ∈ худшие k′) minₜ C_i,t,  k′ = ⌈β·N⌉\nβ = {beta}, N = {n} → CFaR = {cfar}, ДИ 95 % [{ci_lo}; {ci_hi}]',
    variables: [
      { key: 'cfar', label: 'CFaR', unit: '₽' },
      { key: 'beta', label: 'Уровень хвоста β [К]', unit: '%' },
      { key: 'n', label: 'Сценариев', unit: '—' },
      { key: 'ci_lo', label: 'Нижняя граница бутстреп-ДИ', unit: '₽' },
      { key: 'ci_hi', label: 'Верхняя граница бутстреп-ДИ', unit: '₽' },
    ],
    unit: '₽',
    method:
      CASH_METHOD + ' ДИ — бутстреп по сценариям (B = 1000, паспорт fin.bootstrap_b). В CVaR-LP с кассой это же число линеаризовано: v_i ≥ ζ − C_i,t ∀t.',
    caveats: ['β — калибровка [К], не оценка: данных предприятия нет (решение Р8).', 'Отрицательный CFaR означает, что в худших сценариях касса уходит ниже нуля — нужен транш или ограничение ликвидности.'],
    diagram: 'cvar-tail',
    learnMore: 'cvar-tail',
  },
  {
    id: 'cash.p_breach',
    title: 'Вероятность кассового разрыва',
    short: 'Доля сценариев, в которых касса ушла ниже нуля при исчерпанной кредитной линии хотя бы в одну неделю.',
    formula: 'P(разрыв) = (1/N)·Σ_i 𝟙[∃t: C_i,t < 0 ∧ U_i,t = 0] = {p}\nинтервал Уилсона 95 % [{ci_lo}; {ci_hi}] · светофор {warn} / {bad} [К]',
    variables: [
      { key: 'p', label: 'Вероятность разрыва', unit: '%' },
      { key: 'ci_lo', label: 'Нижняя граница ДИ Уилсона', unit: '%' },
      { key: 'ci_hi', label: 'Верхняя граница ДИ Уилсона', unit: '%' },
      { key: 'warn', label: 'Порог «внимание»', unit: '%' },
      { key: 'bad', label: 'Порог «критично»', unit: '%' },
    ],
    unit: '%',
    method: CASH_METHOD + ' U_i,t — неиспользованный лимит линии; разрыв фиксируется, когда платежи режутся по приоритету (§4.3 п. 10).',
    caveats: ['Пороги светофора 5 % / 15 % хранятся в fin_params как калибровка [К], не в коде.'],
    learnMore: 'overview',
  },
  {
    id: 'cash.t_breach_p10',
    title: 'Момент разрыва (10 % квантиль)',
    short: 'Когда разрыв случается раньше всего: 10 % квантиль недели первого разрыва среди сценариев с разрывом.',
    formula: 't*_i = min(t: C_i,t < 0 ∧ U_i,t = 0)\nT_BREACH_P10 = q₀.₁₀(t*_i | разрыв) = {t}',
    variables: [{ key: 't', label: 'Неделя первого разрыва (квантиль 10 %)', unit: 'нед' }],
    unit: 'нед',
    method: CASH_METHOD + ' Условный показатель: считается только по сценариям, где разрыв был.',
    caveats: ['При нуле разрывов показатель не определён («—»).'],
    learnMore: 'overview',
  },
  {
    id: 'cash.dscr_min_p05',
    title: 'DSCR — 5 % квантиль минимума',
    short: 'Покрытие обслуживания долга денежным потоком в худшие 5 % сценариев; ковенант банка 1,2.',
    formula: 'DSCR_i,t = CFADS_i,t / (Int_i,t + PR_i,t)\nDSCR_MIN_P05 = q₀.₀₅(minₜ DSCR_i,t) = {dscr}\nковенант {covenant} [НОРМ], P(нарушение) = {p_cov}',
    variables: [
      { key: 'dscr', label: 'DSCR, 5 % квантиль минимума', unit: '—' },
      { key: 'covenant', label: 'Ковенант DSCR', unit: '—' },
      { key: 'p_cov', label: 'Вероятность нарушения ковенанта', unit: '%' },
    ],
    unit: '—',
    method: CASH_METHOD + ' Ковенант проверяется по горизонту (Σ CFADS / Σ (Int + PR)); недельный DSCR — диагностика.',
    caveats: ['При малой службе долга DSCR велик и малоинформативен — смотрите пик долга и проценты.'],
    learnMore: 'overview',
  },
  {
    id: 'cash.debt_peak',
    title: 'Пик выбранного кредита',
    short: 'Наибольший долг по кредитной линии за горизонт (медиана по сценариям) и его доля от лимита.',
    formula: 'DEBT_PEAK = med_i maxₜ D_i,t = {peak}\nдоля лимита = DEBT_PEAK / U = {share} · лимит U = {limit} [К]',
    variables: [
      { key: 'peak', label: 'Пик долга', unit: '₽' },
      { key: 'share', label: 'Доля лимита', unit: '%' },
      { key: 'limit', label: 'Лимит кредитной линии', unit: '₽' },
    ],
    unit: '₽',
    method: CASH_METHOD + ' Светофор 70 / 90 % лимита — калибровка [К] в fin_params.',
    caveats: ['Лимит в демо-БД задан масштабом инстанса (20 млн ₽), не данными банка.'],
    learnMore: 'overview',
  },
  {
    id: 'cash.int_cost',
    title: 'Проценты за горизонт',
    short: 'Ожидаемые процентные платежи по кредитной линии за все недели горизонта.',
    formula: 'INT_COST = E_i Σₜ r_i,t·D_i,t−1 = {int}\nr_t = ключевая_t + спред = {rate} в год',
    variables: [
      { key: 'int', label: 'Проценты за горизонт', unit: '₽' },
      { key: 'rate', label: 'Ставка линии (годовая)', unit: '%' },
    ],
    unit: '₽',
    method: CASH_METHOD + ' Ставка по сценарию и неделе — из обученного макро-генератора (волна M), иначе константа fin_params.key_rate + spread.',
    learnMore: 'overview',
  },
  {
    id: 'cash.wc_avg',
    title: 'Средний оборотный капитал',
    short: 'Деньги, связанные в дебиторке, запасах и товарах в пути за вычетом кредиторки — в среднем по неделям.',
    formula: 'WC_AVG = E_i (1/T)·Σₜ (AR_i,t + INV_i,t + TR_i,t − AP_i,t) = {wc}',
    variables: [{ key: 'wc', label: 'Средний оборотный капитал', unit: '₽' }],
    unit: '₽',
    method: CASH_METHOD + ' Запасы — по материальной себестоимости (упрощение [НОРМ]), конверсия — OPEX периода.',
    learnMore: 'overview',
  },
  {
    id: 'cash.pol',
    title: 'Цена ликвидности',
    short: 'Сколько ожидаемой прибыли стоит требование держать кассу не ниже L_min в каждую неделю худших β сценариев.',
    formula: 'PoL(L_min) = E[Π]_без − E[Π]_с L_min = {pol}\nпарный бутстреп-ДИ 95 % [{ci_lo}; {ci_hi}] · по критерию ΔCVaR = {pol_obj} · двойственная {dual}',
    variables: [
      { key: 'pol', label: 'Цена ликвидности по E[Π]', unit: '₽' },
      { key: 'ci_lo', label: 'Нижняя граница ДИ', unit: '₽' },
      { key: 'ci_hi', label: 'Верхняя граница ДИ', unit: '₽' },
      { key: 'pol_obj', label: 'Цена по критерию (ΔCVaR)', unit: '₽' },
      { key: 'dual', label: 'Двойственная цена ограничения ликвидности (₽ цели / ₽ L_min)', unit: '—' },
    ],
    unit: '₽',
    method:
      'Две CVaR-LP с кассой на одних сценариях (CRN): с ограничением ликвидности и без; разность E[Π] — цена ликвидности, парный бутстреп — ДИ. ' +
      'Кривая PoL(L) строится по сетке fin.pol_grid; двойственная — локальный наклон.',
    caveats: ['PoL по E[Π] не монотонна по L (цель LP — CVaR, а не E), поэтому рядом публикуется цена по критерию.', 'При L выше достижимого LP неразрешима — это раскрывается, а не прячется.'],
    diagram: 'price-of-robustness',
    learnMore: 'overview',
  },
  {
    id: 'cash.npv',
    title: 'ЧДД собственника и банка',
    short: 'Дисконтированный поток собственника (r_O) и банка (r_B) по сценариям водопада; банк участвует, если E[NPV_B] ≥ 0.',
    formula: 'NPV_O = Σₜ DFₜ(r_O)·CF^O_i,t = {npv_o}, P(NPV_O < 0) = {p_neg}\nNPV_B = Σₜ DFₜ(r_B)·(Int + PR − d)_i,t = {npv_b}',
    variables: [
      { key: 'npv_o', label: 'E[ЧДД собственника]', unit: '₽' },
      { key: 'p_neg', label: 'Вероятность отрицательного ЧДД собственника', unit: '%' },
      { key: 'npv_b', label: 'E[ЧДД банка]', unit: '₽' },
    ],
    unit: '₽',
    method: CASH_METHOD + ' Ставки r_O = 18 %, r_B = 16 % — норматив [НОРМ] (fin_params.rate_owner / rate_bank).',
    caveats: ['Горизонт 5–8 недель короток для ЧДД — используется как сопоставление финансирований, не как оценка проекта.'],
    diagram: 'npv',
    learnMore: 'npv',
  },
  {
    id: 'cash.tax_paid',
    title: 'Налоги за горизонт',
    short: 'Ожидаемые НДС к уплате и авансы по налогу на прибыль за горизонт по сетке платежей.',
    formula: 'TAX_PAID = E_i Σₜ (T_i,t + VAT^pay_i,t) = {tax}\nНДС {tau_v}, прибыль {tau_p} [НОРМ]',
    variables: [
      { key: 'tax', label: 'Налоги за горизонт', unit: '₽' },
      { key: 'tau_v', label: 'Ставка НДС', unit: '%' },
      { key: 'tau_p', label: 'Ставка налога на прибыль', unit: '%' },
    ],
    unit: '₽',
    method: CASH_METHOD + ' Налог на прибыль — с переносом убытка (NOL); НДС — тремя долями по сетке квартала.',
    learnMore: 'overview',
  },
]
