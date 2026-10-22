#pragma once
/**
 * Водопад денежных средств предприятия по периодам (неделям) — METHODOLOGY-V2 §4.
 *
 * Чистый модуль без БД и JSON: один сценарий i → последовательность периодов t
 * с порядком операций ровно как в §4.3 (макро → производство → выручка/дебиторка →
 * закупки/кредиторка → персонал → энергия → ремонты → проценты/долг → налоги →
 * закрытие кассы → ковенанты). Все деньги — тыс. ₽ за период, номинальные.
 * Ставки годовые → периодные: r_w = (1+r)^{1/52} − 1 (§4.1).
 *
 * Учётные упрощения (раскрыты, статус [НОРМ-упрощение]):
 *   - запасы оцениваются по МАТЕРИАЛЬНОЙ себестоимости; конверсионные затраты
 *     (зарплата, энергия, ремонты) относятся на расходы периода (OPEX);
 *   - входящий НДС принимается к вычету в периоде счёта-фактуры (= период заказа);
 *   - налог на прибыль начисляется и уплачивается в конце налогового периода
 *     (авансы по накопленной базе с переносом убытка NOL);
 *   - при кассовом разрыве (нехватка сверх лимита линии/овердрафта) платежи режутся
 *     по приоритету поставщики → проценты → зарплата → налоги и переносятся в
 *     просрочку (arrears) следующего периода; путь не удаляется из выборки.
 *
 * Тождества §4.6 возвращаются как невязки (Residuals) и проверяются тестами
 * (tests/test_cashwaterfall.cpp) на ручном примере §4.7 и на случайных входах.
 */
#include <vector>

namespace maos::cash {

/** Финансовые параметры (таблица fin_params; статус каждого — в param_passport). */
struct FinParams {
  double c0 = 0;                   // касса на начало горизонта [Н]
  double cMin = 0;                 // порог кассы для правила выборки транша (§4.3 п.8) [К]
  double creditLimit = 0;          // лимит кредитной линии [НОРМ]
  double d0 = 0;                   // выбранный кредит на начало [Н]
  double keyRate = 0.16;           // ключевая ставка, годовая (до волны M — константа) [НОРМ]
  double spread = 0.03;            // спред линии над ключевой [НОРМ]
  double overdraftSpread = 0.10;   // штрафной спред овердрафта сверх лимита [НОРМ]
  double overdraftLimit = 0;       // лимит овердрафта; 0 → овердрафт невозможен [НОРМ]
  double tauV = 0.22;              // НДС, ст. 164 НК РФ с 01.01.2026 [НОРМ]
  double tauP = 0.25;              // налог на прибыль, ст. 284 НК РФ с 01.01.2025 [НОРМ]
  double tauSoc = 0.30;            // страховые взносы, гл. 34 НК РФ [НОРМ]
  double propertyTaxWeekly = 0;    // налог на имущество — константа в F_t [НОРМ]
  std::vector<double> dsoKernel{ 0.0, 0.5, 0.5 };  // w_k: доля счёта, инкассируемая через k недель [О]/[К]
  double prepayShare = 0;          // φ — предоплата при заказе [НОРМ]
  int    dpoWeeks = 1;             // отсрочка оплаты после прихода [НОРМ]
  int    leadWeeks = 0;            // срок поставки L, недель [О]/[К]
  int    vatPeriodWeeks = 13;      // налоговый период НДС — квартал [НОРМ]
  int    vatInstalments = 3;       // уплата равными долями [НОРМ, ст. 174 НК РФ]
  int    vatInstalmentLagWeeks = 4;// шаг долей после конца периода, недель [НОРМ]
  int    taxPeriodWeeks = 4;       // авансы по налогу на прибыль — ежемесячно [НОРМ]
  std::vector<int> payrollWeeks{ 2, 0 };  // недели месяца выплаты (t mod 4); пусто → еженедельно [НОРМ]
  double dscrCovenant = 1.2;       // ковенант DSCR [НОРМ]
  double rateOwner = 0.18;         // r_O для NPV собственника, годовая [НОРМ]
  double rateBank = 0.16;          // r_B для NPV банка, годовая [НОРМ]
  bool   autoRepay = false;        // гасить долг излишком кассы сверх cMin (правило)
};

/** События периода t (сценарий i) — из Стадии 1 и макро-генератора. */
struct PeriodInput {
  double revenue = 0;          // Rev_t без НДС
  double cogs = 0;             // материальная себестоимость отгруженного
  double orders = 0;           // закупка сырья Ord_t без НДС (по стоимости)
  double rawConsumed = 0;      // списание сырья в производство (по стоимости)
  double payrollGross = 0;     // начисленная зарплата без взносов: W^fix + часы·c^h
  double conversion = 0;       // конверсионные затраты по нормам (машино-часы + труд), без взносов
  double energy = 0;           // тариф × кВт·ч
  double logistics = 0;        // транспорт входящий + исходящий
  double repairPlanned = 0;    // бюджет B^rep_t
  double repairBreakdown = 0;  // стохастические ремонты Pay^brk_t
  double otherFixed = 0;       // прочие постоянные платежи периода
  double depreciation = 0;     // Dep_t (линейная по паспорту ЕО)
  double capex = 0;
  double plannedRepayment = 0; // PR_t по договору
  double drawdown = -1;        // ≥ 0 → транш задан извне (рекурс LP); < 0 → правило §4.3 п.8
  double repayment = -1;       // ≥ 0 → досрочное погашение извне; < 0 → PR_t (+autoRepay)
  double keyRate = -1;         // ≥ 0 → ключевая ставка периода из макро-пути; < 0 → FinParams
};

struct ScenarioInput {
  std::vector<PeriodInput> periods;
  int    defaultWeek = -1;     // с этой недели инкассация с потерей LGD (дефолт покупателя); −1 → нет
  double lgd = 0;              // доля потерь при дефолте [О]/[НОРМ]
};

/** Выходы периода (§4.5) — всё, что нужно KPI и тождествам. */
struct PeriodState {
  double cash = 0, netCash = 0;          // C_t; C_t − просрочка (отрицательна при разрыве)
  double debt = 0, undrawn = 0, overdraft = 0;
  double drawdown = 0, repayment = 0, interest = 0;
  double collections = 0, payMat = 0, payLog = 0, payLab = 0, payEn = 0;
  double payRep = 0, payBrk = 0, payOther = 0, vatPay = 0, tax = 0, capex = 0;
  double ar = 0, ap = 0, invRaw = 0, invFg = 0, invTransit = 0, wc = 0, arrears = 0;
  double revenue = 0, ebitda = 0, ebit = 0, ebt = 0, profitAcc = 0, cfOp = 0;
  double badDebt = 0, nol = 0, vatOut = 0, vatIn = 0;
  double dscr = 0, icr = 0;              // +∞ при нулевой службе долга / нулевых процентах
  bool   breach = false, covenantBreach = false;
};

/** Невязки тождеств §4.6 (абсолютные, в тыс. ₽; тест: ≤ 1e-9·масштаб). */
struct Residuals {
  double cash = 0;            // 1. кассовое тождество (максимум по t)
  double reconciliation = 0;  // 2. прибыль ↔ деньги
  double receivables = 0;     // 3. дебиторка
  double debt = 0;            // 4a. долг
  double interest = 0;        // 4b. проценты
  double npvDecomposition = 0;// 5. разложение NPV собственника
  double material = 0;        // 7. материальный баланс
  double max() const;
};

struct ScenarioResult {
  std::vector<PeriodState> periods;
  double minCash = 0;         // min_t netCash_t
  double maxDebt = 0;         // max_t D_t (с овердрафтом)
  double totalInterest = 0;
  double minDscr = 0;         // min_t DSCR_t (недельный, диагностика)
  double dscr = 0;            // DSCR по горизонту: Σ CFADS / Σ (Int + PR) — для ковенанта и KPI
  double profit = 0;          // Σ_t Π^acc_t
  double taxPaid = 0;         // Σ_t (Tax_t + VAT^pay_t)
  double wcAvg = 0;
  double npvOwner = 0;        // DF_H·C_H − C_0 (поток собственнику = 0 внутри горизонта)
  double npvBank = 0;         // PV(Int) + PV(PR) − PV(d) + PV(взыскание D_H)
  int    tBreach = -1;        // первая неделя разрыва (1-based), −1 → нет
  bool   breach = false, covenantBreach = false;
  Residuals residuals;
};

/** Периодная ставка из годовой: (1+r)^{1/52} − 1. */
double weekly_rate(double annual);

/** Прогон одного сценария по §4.3. Детерминирован (вся случайность — во входах). */
ScenarioResult run(const FinParams& fp, const ScenarioInput& in);

/** Сводка по сценариям — KPI денежного слоя §6.0. */
struct Summary {
  int    n = 0;
  double cashMinP50 = 0, cfar = 0, cfarLo = 0, cfarHi = 0;
  double pBreach = 0, pBreachLo = 0, pBreachHi = 0;   // Wilson 95 %
  double tBreachP10 = 0;                              // условно на разрыв; 0 → разрывов нет
  double dscrMinP05 = 0, pCovenant = 0;              // q_0.05 DSCR по горизонту; P(DSCR < ковенант)
  double debtPeak = 0, debtPeakShare = 0, intCost = 0, wcAvg = 0, taxPaid = 0;
  double profitMean = 0, profitCvar = 0;
  double npvOwnerMean = 0, npvBankMean = 0, pNpvOwnerNeg = 0;
  double maxResidual = 0;
  std::vector<double> cashP05, cashP50, cashP95;      // по периодам (netCash)
};
Summary summarize(const std::vector<ScenarioResult>& rs, double alpha, double beta,
                  double creditLimit, unsigned bootstrapSeed = 1, int bootstrapB = 1000);

/** Интервал Уилсона 95 % для доли k/n (при k = 0 верхняя граница ≠ 0). */
void wilson95(int k, int n, double& lo, double& hi);
/** Эмпирический CVaR_β: среднее худших k = max(1, ⌊βN⌋) значений (как metrics_of). */
double cvar_lower(std::vector<double> v, double beta);
double quantile(std::vector<double> v, double q);

}  // namespace maos::cash
