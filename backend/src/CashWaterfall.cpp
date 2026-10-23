#include "CashWaterfall.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <random>

namespace maos::cash {
namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();

/* Ведомость «начислено, но не оплачено» по категориям — порядок = приоритет обрезки
   при кассовом разрыве (§4.3 п.10): режется первым capex, последними — налоги. */
enum Cat { kCapex, kSup, kLog, kEn, kRep, kOth, kPr, kInt, kLab, kTax, kCats };

struct Ledger {
  double due[kCats]  = {};   // к оплате в этом периоде (вкл. просрочку прошлых)
  double paid[kCats] = {};
  double arr[kCats]  = {};   // просрочка, переносимая в следующий период
  double totalDue() const { double s = 0; for (double v : due) s += v; return s; }
  double arrears() const { double s = 0; for (int c = 0; c < kCats; ++c) if (c != kPr) s += arr[c]; return s; }
};

/* Обрезка платежей по приоритету: возвращает покрытую часть нехватки. */
double cut_by_priority(Ledger& L, double shortage) {
  double covered = 0;
  for (int c = 0; c < kCats && shortage > 1e-12; ++c) {
    const double cut = std::min(L.paid[c], shortage);
    L.paid[c] -= cut; shortage -= cut; covered += cut;
    if (c != kPr) L.arr[c] += cut;             // непогашенный транш PR просто остаётся долгом
  }
  return covered;
}

double df_of(double annual, int t) { return std::pow(1.0 + annual, -(double)t / 52.0); }

}  // namespace

double Residuals::max() const {
  return std::max({ cash, reconciliation, receivables, debt, interest, npvDecomposition, material });
}

double weekly_rate(double annual) { return std::pow(1.0 + annual, 1.0 / 52.0) - 1.0; }

ScenarioResult run(const FinParams& fp, const ScenarioInput& in) {
  ScenarioResult r;
  const int T = (int)in.periods.size();
  r.periods.resize(T);
  if (T == 0) return r;
  const int L = std::max(0, fp.leadWeeks), DPO = std::max(0, fp.dpoWeeks);
  const int K = (int)fp.dsoKernel.size();
  const int vatP = std::max(1, fp.vatPeriodWeeks), vatN = std::max(1, fp.vatInstalments);
  const int vatLag = std::max(0, fp.vatInstalmentLagWeeks), taxP = std::max(1, fp.taxPeriodWeeks);
  const double phi = std::min(1.0, std::max(0.0, fp.prepayShare));
  const double v1 = 1.0 + fp.tauV;

  // Ведомости по неделям (с запасом на хвост за горизонтом).
  const int ext = T + L + DPO + vatLag * vatN + 2;
  std::vector<double> arIssued(T, 0.0), apSched(ext, 0.0), arrive(ext, 0.0), vatDue(ext, 0.0);

  double C = fp.c0, D = std::max(0.0, fp.d0), OD = 0, NOL = 0, vatPos = 0, labAcc = 0, ebtAcc = 0;
  double cumEbt = 0, taxLiab = 0, taxPaidYtd = 0;       // A3: налог нарастающим итогом (taxCumulative)
  double arOut = 0, Itr = 0, Iraw = 0, Ifg = 0;
  Ledger L1;                       // просрочка переносится между периодами через L1.arr
  // Накопители для тождеств.
  double sumRevVat = 0, sumColl = 0, sumBad = 0, sumOrd = 0, sumArr = 0, sumCons = 0, sumCogs = 0;
  double sumProfit = 0, sumCfOp = 0, sumDep = 0, sumDraw = 0, sumRep = 0, sumInt = 0, sumIntChk = 0;
  double pvFlows = 0, holdTerm = 0, pvBank = 0, cfadsSum = 0, serviceSum = 0;
  double wcExt0 = 0;               // начальный расширенный оборотный капитал (запасов на старте нет)
  double prevDebt = D, prevOd = 0, prevCash = C;
  double maxResCash = 0;

  for (int t = 0; t < T; ++t) {
    const PeriodInput& p = in.periods[t];
    PeriodState& s = r.periods[t];
    const int week = t + 1;
    // 1. Макросостояние: ставка линии и штрафная ставка овердрафта.
    const double key = p.keyRate >= 0 ? p.keyRate : fp.keyRate;
    const double rw = weekly_rate(key + fp.spread), rod = weekly_rate(key + fp.spread + fp.overdraftSpread);
    // 2. Производственные события → запасы по себестоимости.
    arrive[t + L] += p.orders;
    const double arrivals = arrive[t];
    Itr += p.orders - arrivals;
    Iraw += arrivals - p.rawConsumed;
    Ifg  += p.rawConsumed - p.cogs;
    sumOrd += p.orders; sumArr += arrivals; sumCons += p.rawConsumed; sumCogs += p.cogs;
    // 3. Выручка и дебиторка: счёт с НДС, инкассация по ядру DSO, дефолт покупателя.
    arIssued[t] = p.revenue * v1;
    arOut += arIssued[t]; sumRevVat += arIssued[t];
    s.vatOut = fp.tauV * p.revenue;
    const bool defaulted = in.defaultWeek >= 0 && week >= in.defaultWeek;
    double coll = 0, bad = 0;
    for (int k = 0; k < K && t - k >= 0; ++k) {
      const double a = fp.dsoKernel[k] * arIssued[t - k];
      if (defaulted) { bad += a * in.lgd; coll += a * (1.0 - in.lgd); } else coll += a;
    }
    arOut -= coll + bad; sumColl += coll; sumBad += bad;
    // 4. Закупки и кредиторка: предоплата при заказе, остаток через L + DPO; входящий НДС.
    const double invoice = p.orders * v1;
    apSched[t + L + DPO] += (1.0 - phi) * invoice;
    s.vatIn = fp.tauV * p.orders;
    Ledger L2; for (int c = 0; c < kCats; ++c) L2.due[c] = L1.arr[c];
    L2.due[kSup] += phi * invoice + apSched[t];
    L2.due[kLog] += p.logistics;
    // 5. Персонал: начисление с взносами, выплата в недели payrollWeeks (пусто → еженедельно).
    const double labAccrued = p.payrollGross * (1.0 + fp.tauSoc);
    labAcc += labAccrued;
    const bool payday = fp.payrollWeeks.empty() ||
      std::find(fp.payrollWeeks.begin(), fp.payrollWeeks.end(), week % 4) != fp.payrollWeeks.end();
    if (payday) { L2.due[kLab] += labAcc; labAcc = 0; }
    // 6. Энергия. 7. Ремонты (план + отказы) и прочие постоянные (вкл. налог на имущество).
    L2.due[kEn]  += p.energy;
    L2.due[kRep] += p.repairPlanned + p.repairBreakdown;
    const double other = p.otherFixed + fp.propertyTaxWeekly + p.conversion;
    L2.due[kOth] += other;
    L2.due[kCapex] += p.capex;
    // 8. Проценты и плановое погашение.
    const double intr = rw * D + rod * OD;
    L2.due[kInt] += intr;
    const double pr = std::min(D, std::max(0.0, p.plannedRepayment));
    L2.due[kPr] += pr;
    // 9. Налоги: НДС по периодам долями; налог на прибыль по накопленной базе с NOL.
    vatPos += s.vatOut - s.vatIn;
    if (week % vatP == 0) {
      const double pay = std::max(0.0, vatPos);
      vatPos = std::min(0.0, vatPos);                       // переплата → зачёт вперёд
      if (vatLag == 0) vatDue[t] += pay;                   // уплата в конце периода
      else for (int j = 0; j < vatN; ++j) vatDue[t + (j + 1) * vatLag] += pay / vatN;
    }
    const double opex = labAccrued + p.energy + p.logistics + p.repairPlanned + p.repairBreakdown + other;
    s.ebitda = p.revenue - p.cogs - opex - bad;
    s.ebit   = s.ebitda - p.depreciation;
    s.ebt    = s.ebit - intr;
    double tax = 0, taxExp = 0;                            // уплата (касса) / расход по налогу (прибыль)
    if (fp.taxCumulative) {                                // A3: база нарастающим итогом с начала года
      cumEbt += s.ebt;
      if (week % taxP == 0) {
        const double liab = fp.tauP * std::max(0.0, cumEbt);
        taxExp = liab - taxLiab; taxLiab = liab;
        tax = std::max(0.0, liab - taxPaidYtd); taxPaidYtd += tax;
      }
      if (week % 52 == 0) { taxPaidYtd = std::max(0.0, taxPaidYtd - taxLiab); taxLiab = 0; cumEbt = 0; }   // новый год: переплата — зачёт
      NOL = std::max(0.0, -cumEbt);
    } else {
      ebtAcc += s.ebt;
      if (week % taxP == 0) {
        tax = fp.tauP * std::max(0.0, ebtAcc - NOL);
        NOL = std::max(0.0, NOL - ebtAcc);
        ebtAcc = 0;
      }
      taxExp = tax;
    }
    L2.due[kTax] += tax + vatDue[t];
    // 10. Закрытие кассы: правило выборки, овердрафт, разрыв с обрезкой по приоритету.
    for (int c = 0; c < kCats; ++c) L2.paid[c] = L2.due[c];
    const double cashHat = C + coll - L2.totalDue();
    double U = std::max(0.0, fp.creditLimit - D);
    double d = p.drawdown >= 0 ? std::min(U, p.drawdown)
                               : std::min(U, std::max({ 0.0, fp.cMin - cashHat, p.drawFloor }));   // A3: транш под CAPEX
    double cash = cashHat + d;
    double odDraw = 0;
    if (cash < 0 && fp.overdraftLimit > 0) {
      odDraw = std::min(std::max(0.0, fp.overdraftLimit - OD), -cash);
      cash += odDraw;
    }
    bool breach = false;
    const double eps = 1e-9 * std::max(1.0, std::fabs(C) + coll + L2.totalDue());   // округление ≠ разрыв
    if (cash < -eps) { breach = true; cash += cut_by_priority(L2, -cash); }
    // Досрочное погашение: извне (рекурс LP) или излишком кассы сверх cMin; овердрафт — первым.
    const double odRep = std::min(OD + odDraw, std::max(0.0, cash - fp.cMin));
    cash -= odRep;
    double extra = p.repayment >= 0 ? p.repayment : (fp.autoRepay ? std::max(0.0, cash - fp.cMin) : 0.0);
    extra = std::min({ extra, std::max(0.0, cash), std::max(0.0, D + d - L2.paid[kPr]) });
    cash -= extra;
    D  += d - L2.paid[kPr] - extra;
    OD += odDraw - odRep;
    C = cash;
    // Выходы периода.
    s.cash = C; s.debt = D + OD; s.overdraft = OD; s.undrawn = std::max(0.0, fp.creditLimit - D);
    s.drawdown = d + odDraw; s.repayment = L2.paid[kPr] + extra + odRep; s.interest = intr;
    s.collections = coll; s.badDebt = bad; s.revenue = p.revenue;
    s.payMat = L2.paid[kSup]; s.payLog = L2.paid[kLog]; s.payLab = L2.paid[kLab]; s.payEn = L2.paid[kEn];
    s.payRep = L2.paid[kRep]; s.payBrk = p.repairBreakdown; s.payOther = L2.paid[kOth];
    s.capex = L2.paid[kCapex];
    const double payIntr = L2.paid[kInt], payTax = L2.paid[kTax];
    s.vatPay = std::min(payTax, vatDue[t] + L1.arr[kTax]); s.tax = payTax - s.vatPay;
    s.nol = NOL; s.arrears = L2.arrears(); s.netCash = C - s.arrears; s.breach = breach;
    double apFuture = 0; for (int u = t + 1; u < ext; ++u) apFuture += apSched[u];
    s.ap = apFuture + L2.arr[kSup]; s.ar = arOut;
    s.invRaw = Iraw; s.invFg = Ifg; s.invTransit = Itr;
    s.wc = s.ar + Iraw + Ifg + Itr - s.ap;
    s.profitAcc = s.ebt - taxExp;
    s.cfOp = coll - s.payMat - s.payLog - s.payLab - s.payEn - s.payRep - s.payOther - payIntr - payTax;
    const double service = intr + pr;
    s.dscr = service > 1e-12 ? (s.cfOp + payIntr) / service : kInf;
    s.icr  = intr > 1e-12 ? s.ebit / intr : kInf;
    s.covenantBreach = service > 1e-12 && s.dscr < fp.dscrCovenant;
    cfadsSum += s.cfOp + payIntr; serviceSum += service;
    // 11. Тождества (накопление).
    const double flow = coll - s.payMat - s.payLog - s.payLab - s.payEn - s.payRep - s.payOther
                      - payIntr - s.repayment + s.drawdown - s.vatPay - s.tax - s.capex;
    maxResCash = std::max(maxResCash, std::fabs(C - (prevCash + flow)));
    sumProfit += s.profitAcc; sumCfOp += s.cfOp; sumDep += p.depreciation;
    sumDraw += s.drawdown; sumRep += s.repayment; sumInt += intr;
    sumIntChk += rw * prevDebt + rod * prevOd;
    const double dfO = df_of(fp.rateOwner, week), dfPrev = df_of(fp.rateOwner, t);
    pvFlows += dfO * flow;
    holdTerm += prevCash * (dfO - dfPrev);
    const double dfB = df_of(fp.rateBank, week);
    pvBank += dfB * (payIntr + s.repayment - s.drawdown);
    prevDebt = D; prevOd = OD; prevCash = C;
    L1 = L2;
    r.minCash = t == 0 ? s.netCash : std::min(r.minCash, s.netCash);
    r.maxDebt = std::max(r.maxDebt, s.debt);
    r.minDscr = t == 0 ? s.dscr : std::min(r.minDscr, s.dscr);
    r.wcAvg += s.wc / T;
    r.taxPaid += payTax;
    r.totalInterest += intr;
    if (breach && r.tBreach < 0) { r.tBreach = week; r.breach = true; }
  }
  // Сводка по сценарию.
  const PeriodState& last = r.periods.back();
  r.profit = sumProfit;
  // Ковенант проверяется по горизонту (Σ CFADS / Σ служба долга), как по отчётному периоду
  // договора; недельный DSCR остаётся в PeriodState для диагностики [НОРМ-упрощение].
  r.dscr = serviceSum > 1e-12 ? cfadsSum / serviceSum : kInf;
  r.covenantBreach = serviceSum > 1e-12 && r.dscr < fp.dscrCovenant;
  r.npvOwner = df_of(fp.rateOwner, T) * last.cash - fp.c0;
  r.npvBank = pvBank + df_of(fp.rateBank, T) * last.debt;
  // Невязки §4.6.
  Residuals& z = r.residuals;
  z.cash = maxResCash;
  double vatFuture = 0; for (int u = T; u < ext; ++u) vatFuture += vatDue[u];
  const double wcExtH = last.ar + Iraw + Ifg + Itr - last.ap - labAcc
                      - (L1.arrears() - L1.arr[kSup] - L1.arr[kCapex]) - (vatPos + vatFuture)
                      + (taxPaidYtd - taxLiab);              // A3: переплата налога — актив (0 без taxCumulative)
  z.reconciliation = std::fabs(sumProfit - (sumCfOp - sumDep + (wcExtH - wcExt0)));
  double arExpected = 0;
  for (int t = 0; t < T; ++t) {
    double applied = 0; for (int k = 0; k < K && t + k < T; ++k) applied += fp.dsoKernel[k];
    arExpected += arIssued[t] * (1.0 - applied);
  }
  z.receivables = std::max(std::fabs(arExpected - last.ar), std::fabs(last.ar + sumColl + sumBad - sumRevVat));
  z.debt = std::fabs(last.debt - (fp.d0 + sumDraw - sumRep));
  z.interest = std::fabs(sumInt - sumIntChk);
  z.npvDecomposition = std::fabs(r.npvOwner - (pvFlows + holdTerm));
  z.material = std::max({ std::fabs(Itr - (sumOrd - sumArr)), std::fabs(Iraw - (sumArr - sumCons)),
                          std::fabs(Ifg - (sumCons - sumCogs)) });
  return r;
}

/* ── Статистика по сценариям ─────────────────────────────────────────────── */

void wilson95(int k, int n, double& lo, double& hi) {
  if (n <= 0) { lo = hi = 0; return; }
  const double z = 1.959963984540054, p = (double)k / n, z2 = z * z / n;
  const double centre = (p + z2 / 2) / (1 + z2);
  const double half = z * std::sqrt(p * (1 - p) / n + z2 / (4.0 * n)) / (1 + z2);
  lo = std::max(0.0, centre - half); hi = std::min(1.0, centre + half);
}

double quantile(std::vector<double> v, double q) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  const double pos = std::min(1.0, std::max(0.0, q)) * (v.size() - 1);
  const size_t i = (size_t)std::floor(pos);
  const double f = pos - i;
  return i + 1 < v.size() ? v[i] * (1 - f) + v[i + 1] * f : v[i];
}

double cvar_lower(std::vector<double> v, double beta) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  const size_t k = std::max<size_t>(1, (size_t)std::floor(beta * v.size()));
  double s = 0; for (size_t i = 0; i < k; ++i) s += v[i];
  return s / k;
}

Summary summarize(const std::vector<ScenarioResult>& rs, double alpha, double beta,
                  double creditLimit, unsigned bootstrapSeed, int bootstrapB) {
  Summary S;
  S.n = (int)rs.size();
  if (rs.empty()) return S;
  const int T = (int)rs.front().periods.size();
  std::vector<double> minCash, maxDebt, dscr, profit, npvO, tBr;
  int nBreach = 0, nCov = 0, nNpvNeg = 0;
  for (const ScenarioResult& r : rs) {
    minCash.push_back(r.minCash); maxDebt.push_back(r.maxDebt); profit.push_back(r.profit);
    dscr.push_back(std::isfinite(r.dscr) ? r.dscr : 1e9);
    npvO.push_back(r.npvOwner);
    if (r.breach) { ++nBreach; tBr.push_back(r.tBreach); }
    if (r.covenantBreach) ++nCov;
    if (r.npvOwner < 0) ++nNpvNeg;
    S.intCost += r.totalInterest / rs.size(); S.wcAvg += r.wcAvg / rs.size();
    S.taxPaid += r.taxPaid / rs.size(); S.npvBankMean += r.npvBank / rs.size();
    S.profitMean += r.profit / rs.size(); S.npvOwnerMean += r.npvOwner / rs.size();
    S.maxResidual = std::max(S.maxResidual, r.residuals.max());
  }
  S.cashMinP50 = quantile(minCash, 0.5);
  S.cfar = cvar_lower(minCash, beta);
  S.profitCvar = cvar_lower(profit, alpha);
  S.pBreach = (double)nBreach / rs.size();
  wilson95(nBreach, (int)rs.size(), S.pBreachLo, S.pBreachHi);
  S.tBreachP10 = tBr.empty() ? 0 : quantile(tBr, 0.10);
  S.dscrMinP05 = quantile(dscr, 0.05);
  S.pCovenant = (double)nCov / rs.size();
  S.debtPeak = quantile(maxDebt, 0.5);
  S.debtPeakShare = creditLimit > 0 ? S.debtPeak / creditLimit : 0;
  S.pNpvOwnerNeg = (double)nNpvNeg / rs.size();
  // Percentile-bootstrap для CFaR (§6.1): B пересэмплирований по сценариям.
  if (bootstrapB > 0 && rs.size() > 1) {
    std::mt19937 rng(bootstrapSeed);
    std::uniform_int_distribution<size_t> pick(0, rs.size() - 1);
    std::vector<double> boot(bootstrapB), sample(rs.size());
    for (int b = 0; b < bootstrapB; ++b) {
      for (double& x : sample) x = minCash[pick(rng)];
      boot[b] = cvar_lower(sample, beta);
    }
    S.cfarLo = quantile(boot, 0.025); S.cfarHi = quantile(boot, 0.975);
  } else S.cfarLo = S.cfarHi = S.cfar;
  S.cashP05.resize(T); S.cashP50.resize(T); S.cashP95.resize(T);
  std::vector<double> col(rs.size());
  for (int t = 0; t < T; ++t) {
    for (size_t i = 0; i < rs.size(); ++i) col[i] = rs[i].periods[t].netCash;
    S.cashP05[t] = quantile(col, 0.05); S.cashP50[t] = quantile(col, 0.5); S.cashP95[t] = quantile(col, 0.95);
  }
  return S;
}

}  // namespace maos::cash
