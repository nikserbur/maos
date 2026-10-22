#include "CashOptimize.h"
#include "CashLp.h"
#include "CashWaterfall.h"
#include "Passport.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <random>

namespace maos {
namespace {

using nlohmann::json;
using Profile = std::vector<double>;

double jget(const json& j, const char* k, double def) {
  return j.contains(k) && j[k].is_number() ? j[k].get<double>() : def;
}

/* Профиль отгрузок φ_{s,t} из опорного расписания (plans/plan_tasks): неделя завершения
   последней операции заказа изделия, взвешенная количеством. Нет данных → равномерно [К]. */
std::vector<Profile> shipment_profiles(Database& db, const std::string& planId,
                                       const std::vector<std::string>& sellables, int T, int& fromPlan) {
  std::vector<Profile> out(sellables.size(), cashlp::uniform_profile(T));
  fromPlan = 0;
  if (planId.empty()) return out;
  std::unordered_map<std::string, Profile> hist;
  try {
    for (auto& r : db.query_json(
           "SELECT rt.product_id AS pid, pt.order_idx AS oi, MAX(CAST(pt.end_min AS REAL)) AS end_min, "
           "       MAX(COALESCE(pt.qty, 1)) AS qty "
           "FROM plan_tasks pt JOIN operations o ON o.id = pt.operation_id "
           "JOIN routings rt ON rt.id = o.routing_id "
           "WHERE pt.plan_id = ? AND COALESCE(pt.machine_id,'') <> 'supply' "
           "GROUP BY rt.product_id, pt.order_idx", { planId })) {
      const std::string pid = r.value("pid", std::string());
      double endMin = 0, qty = 1;
      try { endMin = std::stod(r.value("end_min", std::string("0"))); qty = std::stod(r.value("qty", std::string("1"))); } catch (...) {}
      Profile& h = hist[pid]; if (h.empty()) h.assign(T, 0.0);
      const int w = std::min(T - 1, std::max(0, (int)std::floor(endMin / 60.0 / 168.0)));
      h[w] += std::max(1.0, qty);
    }
  } catch (...) { return out; }
  for (size_t s = 0; s < sellables.size(); ++s) {
    auto it = hist.find(sellables[s]);
    if (it == hist.end()) continue;
    double tot = 0; for (double v : it->second) tot += v;
    if (tot <= 0) continue;
    for (int t = 0; t < T; ++t) out[s][t] = it->second[t] / tot;
    ++fromPlan;
  }
  return out;
}

/* Парный percentile-bootstrap для разности средних (CRN: пары (a_i, b_i)). */
void paired_bootstrap(const std::vector<double>& a, const std::vector<double>& b, int B, unsigned seed,
                      double& lo, double& hi) {
  const size_t n = std::min(a.size(), b.size());
  if (n < 2 || B <= 0) { lo = hi = 0; return; }
  std::mt19937 rng(seed);
  std::uniform_int_distribution<size_t> pick(0, n - 1);
  std::vector<double> boot(B);
  for (int k = 0; k < B; ++k) {
    double s = 0; for (size_t i = 0; i < n; ++i) { const size_t j = pick(rng); s += a[j] - b[j]; }
    boot[k] = s / n;
  }
  lo = cash::quantile(boot, 0.025); hi = cash::quantile(boot, 0.975);
}

json quantiles_by_period(const std::vector<std::vector<double>>& m) {
  json out = { {"p05", json::array()}, {"p50", json::array()}, {"p95", json::array()} };
  if (m.empty()) return out;
  std::vector<double> col(m.size());
  for (size_t t = 0; t < m.front().size(); ++t) {
    for (size_t i = 0; i < m.size(); ++i) col[i] = m[i][t];
    out["p05"].push_back(cash::quantile(col, 0.05));
    out["p50"].push_back(cash::quantile(col, 0.5));
    out["p95"].push_back(cash::quantile(col, 0.95));
  }
  return out;
}

json lp_summary(const cashlp::Result& r) {
  return { {"status", r.status}, {"objective", r.objective}, {"lp_objective", r.lpObjective},
           {"expected", r.metrics.expected}, {"cvar", r.metrics.cvar}, {"worst", r.metrics.worst},
           {"cfar", r.cfar}, {"p_negative_cash", r.pNegativeCash}, {"eta", r.eta}, {"zeta", r.zeta},
           {"solve_ms", r.solveMs}, {"n_vars", r.nCols}, {"n_rows", r.nRows}, {"n_nonzeros", r.nNz} };
}

/* Прогон решения LP через водопад §4.3 (нелинейности: NOL, разрыв, приоритеты) по каждому сценарию. */
json waterfall_eval(const cashlp::Problem& P, const cashlp::Result& r, const cash::FinParams& fp,
                    const json& fin, const std::vector<double>& matShare, double alpha, bool useLpSchedule,
                    unsigned seed, const std::vector<std::vector<double>>& keyRate,
                    const std::vector<double>& logIdx, json* perScenario = nullptr) {
  const size_t N = P.base.price.size(), S = P.base.market.size();
  const int T = P.T, TT = T + P.cp.runoffWeeks;
  const double payroll = jget(fin, "payroll_fixed_weekly", 0), repair = jget(fin, "repair_budget_weekly", 0);
  const double other = jget(fin, "other_fixed_weekly", 0), pd = jget(fin, "pd", 0), lgd = jget(fin, "lgd", 0);
  std::mt19937 rng(seed + 911u);                       // поток «платежи/дефолты» (§6.1 CRN по потокам)
  std::uniform_real_distribution<double> u01(0, 1);
  std::vector<cash::ScenarioResult> rs; rs.reserve(N);
  for (size_t i = 0; i < N; ++i) {
    cash::ScenarioInput in;
    in.periods.resize(TT);
    const bool def = u01(rng) < pd;
    if (def) { in.defaultWeek = 1 + (int)(u01(rng) * T); in.lgd = lgd; }
    for (int t = 0; t < TT; ++t) {
      cash::PeriodInput& q = in.periods[t];
      if (t < T) {
        for (size_t s = 0; s < S; ++s) {
          const double phi = P.ship[s][t], x = r.x[s];
          if (phi <= 0 || x <= 0) continue;
          q.revenue += P.base.price[i][s] * phi * exact::revenue_volume(P.base.market[s], x);
          const double c = P.base.cost[i][s] * x * phi;
          q.cogs += c * matShare[s]; q.rawConsumed += c * matShare[s];
          q.conversion += c * (1.0 - matShare[s]);
          in.periods[std::max(0, t - fp.leadWeeks)].orders += c * matShare[s];   // заказ за L до выпуска (как ψ в LP)
        }
        q.payrollGross = payroll; q.repairPlanned = repair; q.otherFixed = other;
        if (!logIdx.empty()) q.logistics *= logIdx[i];                       // ℓ_i (§2.4; в демо Pay^log = 0)
      }
      // Волна M: ключевая ставка периода из макро-пути сценария (ставка линии = ключевая + спред в водопаде).
      if (!keyRate.empty() && i < keyRate.size() && !keyRate[i].empty())
        q.keyRate = keyRate[i][std::min((size_t)t, keyRate[i].size() - 1)];
      if (useLpSchedule) { q.drawdown = r.draw[i][t]; q.repayment = r.repay[i][t]; }
    }
    rs.push_back(cash::run(fp, in));
  }
  const cash::Summary S1 = cash::summarize(rs, alpha, P.cp.beta, fp.creditLimit, seed, 1000);
  if (perScenario) {                                   // E1: пер-сценарные величины для парного бутстрепа
    json pr = json::array(), mc = json::array(), br = json::array(), it = json::array();
    for (const auto& r1 : rs) { pr.push_back(r1.profit); mc.push_back(r1.minCash); br.push_back(r1.breach ? 1 : 0); it.push_back(r1.totalInterest); }
    *perScenario = { {"profit", pr}, {"min_cash", mc}, {"breach", br}, {"interest", it} };
  }
  return {
    {"financing", useLpSchedule ? "lp_recourse" : "rule"},
    {"cash_min_p50", S1.cashMinP50}, {"cfar", S1.cfar}, {"cfar_ci", { S1.cfarLo, S1.cfarHi }},
    {"p_breach", S1.pBreach}, {"p_breach_ci", { S1.pBreachLo, S1.pBreachHi }},
    {"t_breach_p10", S1.tBreachP10}, {"dscr_min_p05", S1.dscrMinP05}, {"p_covenant", S1.pCovenant},
    {"debt_peak", S1.debtPeak}, {"debt_peak_share", S1.debtPeakShare}, {"int_cost", S1.intCost},
    {"wc_avg", S1.wcAvg}, {"tax_paid", S1.taxPaid},
    {"profit_mean", S1.profitMean}, {"profit_cvar", S1.profitCvar},
    {"npv_owner_mean", S1.npvOwnerMean}, {"npv_bank_mean", S1.npvBankMean}, {"p_npv_owner_neg", S1.pNpvOwnerNeg},
    {"identities_max_residual", S1.maxResidual},
    {"cash", { {"p05", S1.cashP05}, {"p50", S1.cashP50}, {"p95", S1.cashP95} }},
  };
}

}  // namespace

json cash_compare(Database& db, const CashInputs& in, const OptimizeParams& p) {
  const auto t0 = std::chrono::steady_clock::now();
  const cash::FinParams fp = passport::load_fin_params(db);
  const json fin = passport::fin_params_json(db);
  const size_t S = in.sellables.size(), Nall = in.price.size();
  const int nCash = p.cashSamples > 0 ? p.cashSamples : (int)jget(fin, "cash_samples", 300);
  const size_t N = std::min(Nall, (size_t)std::max(2, nCash));
  int T = p.horizonWeeks > 0 ? p.horizonWeeks : (int)jget(fin, "horizon_weeks", 0);
  if (T <= 0) T = std::max(1, (int)std::ceil(in.horizonHours / 168.0 - 1e-9));
  const double beta = p.beta > 0 ? p.beta : jget(fin, "beta", 0.05);
  const double lMin = p.lMinSet ? p.lMin : jget(fin, "l_min", 0);
  const int runoff = std::max((int)fp.dsoKernel.size() - 1, fp.leadWeeks + fp.dpoWeeks);
  const int TT = T + runoff;

  cashlp::Problem P;
  exact::Problem& b = P.base;
  b.price.assign(in.price.begin(), in.price.begin() + N);     // префикс CRN-выборки
  b.cost.assign(in.cost.begin(), in.cost.begin() + N);
  b.market = in.market; b.upper = in.upper; b.batch = in.batch;
  b.alpha = p.alpha;
  b.criterion = p.objective == "worstcase" ? exact::Criterion::Worst
              : (p.exactCriterion == "expected" ? exact::Criterion::Expected : exact::Criterion::Cvar);
  b.minSegments = std::max(1, std::min(256, p.exactSegments)); b.maxSegments = 4 * b.minSegments;
  b.enforceMaxShare = in.enforceShare; b.maxShare = in.maxShare; b.shareWeight = in.meanPrice;
  std::vector<std::string> wcIds; for (auto& [id, c] : in.cap) wcIds.push_back(id);
  std::sort(wcIds.begin(), wcIds.end());
  std::unordered_map<std::string, int> wcIdx; for (size_t w = 0; w < wcIds.size(); ++w) wcIdx[wcIds[w]] = (int)w;
  for (auto& id : wcIds) b.capacity.push_back(in.cap.at(id));
  b.usage.resize(S);
  for (size_t s = 0; s < S; ++s)
    for (auto& [w, h] : in.hpu[s]) if (auto it = wcIdx.find(w); it != wcIdx.end()) b.usage[s].push_back({ it->second, h });
  P.T = T;
  int fromPlan = 0;
  P.ship = shipment_profiles(db, p.scheduleRefId, in.sellables, T, fromPlan);
  for (size_t s = 0; s < S; ++s)
    P.pay.push_back(cashlp::payment_profile(P.ship[s], fp.prepayShare, fp.leadWeeks, fp.dpoWeeks, TT));
  P.vatCostShare = in.matShare;
  const double F = jget(fin, "payroll_fixed_weekly", 0) * (1.0 + fp.tauSoc) + jget(fin, "repair_budget_weekly", 0)
                 + fp.propertyTaxWeekly + jget(fin, "other_fixed_weekly", 0);
  const double rw = cash::weekly_rate(fp.keyRate + fp.spread);
  P.fixed.assign(N, std::vector<double>(TT, 0.0)); P.rate.assign(N, std::vector<double>(TT, rw));
  for (size_t i = 0; i < N; ++i) for (int t = 0; t < T; ++t) P.fixed[i][t] = F;
  // Волна M: ставка линии по сценарию и неделе r_{i,t} = i_{i,t} + spread (l_r = 0 [НОРМ], паспорт macro.rate_lag);
  // после горизонта (дорасчёт) — последняя неделя пути. CRN: макро-путь i общий для всех портфелей.
  const bool macroRate = !in.keyRate.empty();
  if (macroRate)
    for (size_t i = 0; i < N; ++i)
      for (int t = 0; t < TT; ++t)
        P.rate[i][t] = cash::weekly_rate(in.keyRate[i][std::min((size_t)t, in.keyRate[i].size() - 1)] + fp.spread);
  cashlp::CashParams& cp = P.cp;
  cp.c0 = fp.c0; cp.d0 = fp.d0; cp.creditLimit = fp.creditLimit; cp.tauV = fp.tauV; cp.tauP = fp.tauP;
  cp.vatPeriodWeeks = fp.vatPeriodWeeks; cp.vatInstalments = fp.vatInstalments; cp.vatInstalmentLagWeeks = fp.vatInstalmentLagWeeks;
  cp.dsoKernel = fp.dsoKernel; cp.taxPeriodWeeks = fp.taxPeriodWeeks; cp.beta = beta; cp.lMin = lMin;
  cp.liquidityConstraint = true; cp.runoffWeeks = runoff; cp.firstStage = p.financingStage == "first";

  // E1: заданный план → только водопад (правило выборки) и валовые метрики на тех же сценариях.
  if (p.evalPortfolio.is_object() && !p.evalPortfolio.empty()) {
    cashlp::Result fixed; fixed.x.assign(S, 0.0);
    json items = json::array();
    for (size_t s = 0; s < S; ++s)
      if (p.evalPortfolio.contains(in.sellables[s]) && p.evalPortfolio[in.sellables[s]].is_number()) {
        fixed.x[s] = std::max(0.0, p.evalPortfolio[in.sellables[s]].get<double>());
        if (fixed.x[s] > 0) items.push_back({ {"product_id", in.sellables[s]}, {"qty", fixed.x[s]} });
      }
    const exact::Metrics gross = exact::evaluate_on(b, b.price, b.cost, fixed.x);
    json per;
    json wf = waterfall_eval(P, fixed, fp, fin, in.matShare, p.alpha, false, p.seed, in.keyRate, in.logisticsIndex, &per);
    return { {"n_scenarios", (int)N}, {"horizon_weeks", T}, {"runoff_weeks", runoff}, {"beta", beta},
             {"key_rate", { {"source", macroRate ? "MacroSampler" : "fin_params"} }},
             {"fixed_portfolio", { {"items", items}, {"gross", { {"expected", gross.expected}, {"cvar", gross.cvar}, {"worst", gross.worst} }},
                                   {"waterfall_rule", wf}, {"per_scenario", per} }},
             {"total_ms", std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count()} };
  }
  // Основная постановка (рекурс по Р4), «график заранее» и LP без ограничения ликвидности.
  const cashlp::Result rec = cashlp::solve(P);
  json out = {
    {"solver", "HiGHS"}, {"solver_version", exact::solver_version()},
    {"n_scenarios", (int)N}, {"horizon_weeks", T}, {"runoff_weeks", runoff}, {"beta", beta}, {"l_min", lMin},
    {"financing_stage", cp.firstStage ? "first" : "recourse"},
    {"shipment_profile", { {"source", fromPlan > 0 ? "plan" : "uniform"}, {"plan_id", p.scheduleRefId}, {"products_from_plan", fromPlan} }},
    {"fixed_weekly", F}, {"weekly_rate", rw}, {"tail_k", rec.tailK}, {"tail_k_beta", rec.tailKBeta},
    {"key_rate", { {"source", macroRate ? "MacroSampler" : "fin_params"},
                   {"annual", macroRate ? quantiles_by_period(std::vector<std::vector<double>>(in.keyRate.begin(), in.keyRate.begin() + N))
                                        : json(nullptr)} }},
  };
  out.update(lp_summary(rec));
  if (!rec.reason.empty()) out["reason"] = rec.reason;
  if (rec.status != "optimal") return out;

  json items = json::array();
  for (size_t s = 0; s < S; ++s)
    if (rec.x[s] > 0) items.push_back({ {"product_id", in.sellables[s]}, {"qty", rec.x[s]}, {"qty_rounded", rec.xRounded[s]} });
  json duals = json::array();
  for (const exact::Dual& d : rec.duals)
    duals.push_back({ {"wc_type", wcIds[d.resource]}, {"shadow_price", d.shadowPrice}, {"utilization", d.utilization},
                      {"load_hours", d.load}, {"capacity_hours", d.capacity}, {"binding", d.binding} });
  out["portfolio"] = items;
  out["duals"] = { {"capacity", duals}, {"liquidity", rec.liquidityDual}, {"liquidity_binding", rec.liquidityBinding},
                   {"price_of_liquidity_local", -rec.liquidityDual}, {"credit_limit", rec.creditLimitDual} };
  out["tranches"] = { {"drawdown", quantiles_by_period(rec.draw)}, {"repayment", quantiles_by_period(rec.repay)},
                      {"debt", quantiles_by_period(rec.debt)}, {"cash", quantiles_by_period(rec.cash)} };
  // OOS: тот же портфель на независимой выборке (валовая часть; проценты/налог — in-sample среднее).
  {
    exact::Problem b2 = b;
    b2.price.assign(in.price2.begin(), in.price2.begin() + N); b2.cost.assign(in.cost2.begin(), in.cost2.begin() + N);
    const exact::Metrics gross = exact::evaluate_on(b, b.price, b.cost, rec.x);
    const exact::Metrics oos = exact::evaluate_on(b, b2.price, b2.cost, rec.x);
    double fin_ = 0; for (size_t i = 0; i < N; ++i) fin_ += (rec.interestTotal[i] + rec.taxTotal[i]) / N;
    out["oos"] = { {"gross_expected", oos.expected}, {"gross_cvar", oos.cvar},
                   {"expected", oos.expected - fin_}, {"cvar", oos.cvar - fin_},
                   {"gap_expected", gross.expected != 0 ? (gross.expected - oos.expected) / std::fabs(gross.expected) : 0},
                   {"gap_cvar", gross.cvar != 0 ? (gross.cvar - oos.cvar) / std::fabs(gross.cvar) : 0} };
  }
  // Чувствительность Р4: график траншей заранее → цена негибкого финансирования.
  {
    cashlp::Problem Pf = P; Pf.cp.firstStage = !cp.firstStage;
    const cashlp::Result alt = cashlp::solve(Pf);
    json a = lp_summary(alt);
    const cashlp::Result& first = cp.firstStage ? rec : alt;
    const cashlp::Result& recourse = cp.firstStage ? alt : rec;
    if (alt.status == "optimal") {
      double lo = 0, hi = 0;
      paired_bootstrap(recourse.profit, first.profit, 1000, p.seed, lo, hi);
      a["price_of_inflexible_financing"] = recourse.objective - first.objective;
      a["delta_expected"] = recourse.metrics.expected - first.metrics.expected;
      a["delta_expected_ci"] = { lo, hi };
      if (!cp.firstStage) {
        json sched = json::array();
        for (int t = 0; t < TT; ++t) sched.push_back({ {"t", t + 1}, {"drawdown", first.draw[0][t]}, {"repayment", first.repay[0][t]} });
        a["schedule"] = sched;
      }
    }
    out["fixed_schedule"] = a;
  }
  // Цена ликвидности: LP без ограничения и кривая по сетке L (парный ДИ на CRN).
  {
    cashlp::Problem Pu = P; Pu.cp.liquidityConstraint = false;
    const cashlp::Result free = cashlp::solve(Pu);
    json u = lp_summary(free);
    if (free.status == "optimal") {
      double lo = 0, hi = 0;
      paired_bootstrap(free.profit, rec.profit, 1000, p.seed, lo, hi);
      out["price_of_liquidity"] = { {"l_min", lMin}, {"value", free.metrics.expected - rec.metrics.expected},
                                    {"ci", { lo, hi }}, {"objective_delta", free.objective - rec.objective},
                                    {"definition", "E[Π|без огр.] − E[Π|CVaR_β(C_min) ≥ L_min]; objective_delta — по критерию"},
                                    {"local_dual", -rec.liquidityDual} };
      if (p.polCurve) {
        json curve = json::array();
        // Сетка L: от CFaR без ограничения до max(C0, L0 + 0.25·|E[Π]|) — кривая видна и когда
        // свободное решение не уходит в минус (тогда PoL растёт только при L > 0).
        const double L0 = free.cfar;
        const double L1 = std::max({ fp.c0, L0 + 0.25 * std::max(1.0, std::fabs(free.metrics.expected)) });
        std::vector<double> grid;
        for (int k = 0; k <= 5; ++k) grid.push_back(L0 + (L1 - L0) * k / 5.0);
        grid.push_back(lMin);
        std::sort(grid.begin(), grid.end());
        grid.erase(std::unique(grid.begin(), grid.end(), [&](double a, double c) { return std::fabs(a - c) <= 1e-9 * (1 + std::fabs(a)); }), grid.end());
        for (double L : grid) {
          cashlp::Problem Pl = P; Pl.cp.lMin = L;
          const cashlp::Result rl = cashlp::solve(Pl);
          json pt = { {"l_min", L}, {"status", rl.status} };
          if (rl.status == "optimal") {
            double clo = 0, chi = 0;
            paired_bootstrap(free.profit, rl.profit, 1000, p.seed, clo, chi);
            pt.update({ {"expected", rl.metrics.expected}, {"cvar", rl.metrics.cvar}, {"cfar", rl.cfar},
                        {"pol", free.metrics.expected - rl.metrics.expected}, {"pol_ci", { clo, chi }},
                        {"pol_objective", free.objective - rl.objective},   // по критерию (монотонна по L)
                        {"objective", rl.objective}, {"local_dual", -rl.liquidityDual}, {"solve_ms", rl.solveMs} });
          }
          curve.push_back(pt);
        }
        out["pol_curve"] = curve;
      }
    }
    out["unconstrained"] = u;
  }
  // Водопад §4.3 на решении LP: рекурс LP и правило выборки — P(разрыв), DSCR, тождества.
  out["waterfall"] = { {"lp_recourse", waterfall_eval(P, rec, fp, fin, in.matShare, p.alpha, true, p.seed, in.keyRate, in.logisticsIndex)},
                       {"rule", waterfall_eval(P, rec, fp, fin, in.matShare, p.alpha, false, p.seed, in.keyRate, in.logisticsIndex)} };
  out["total_ms"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return out;
}

}  // namespace maos
