#include "InvestEval.h"
#include "CashWaterfall.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <numeric>
#include <random>
#include <thread>

namespace maos::invest {
namespace {

using env::Instance;
using env::InvestCand;
using env::Scenario;
using env::SimEnv;

constexpr double kCapexHours = 4000.0, kCapexMul = 1.5;     // CAPEX станка = mul × часы × ставка типа [К] rl.a3.invest.capex
constexpr double kLeadWeeks = 6.0, kOpexShare = 0.002;     // ввод, ТО/нед. в долях CAPEX [К]
constexpr double kModernShare = 0.15;                      // модернизация: доля CAPEX станка × станков типа [К]

// Итог одного эпизода, нужный для оценки проекта.
struct Ep { double profit = 0, minCash = 0, minLiq = 0, endNet = 0, endDebt = 0, interest = 0; bool breach = false; };

Ep run_episode(SimEnv& e, uint64_t seed, const Scenario& sc, const EvalCfg& ec) {
  e.reset(seed, sc);
  long guard = 0;
  while (!e.done() && ++guard < 50'000'000) {
    if (e.level() == 2) { e.step(0); continue; }
    e.step_job(ec.key.empty() ? e.rule_choice(ec.rule) : e.key_choice(ec.key));
  }
  const json s = e.summary();
  Ep r; r.profit = s.value("profit", 0.0); r.minCash = s.value("min_cash", 0.0); r.minLiq = s.value("min_liquidity", 0.0);
  r.endNet = s.value("end_cash", 0.0); r.endDebt = s.value("end_debt", 0.0); r.interest = s.value("interest", 0.0);
  r.breach = s.value("breach", false);
  return r;
}

double mean_of(const std::vector<double>& v) { return v.empty() ? 0.0 : std::accumulate(v.begin(), v.end(), 0.0) / v.size(); }

// Перцентильный бутстреп среднего по сценариям.
std::pair<double,double> boot_mean_ci(const std::vector<double>& v, int B, unsigned seed) {
  if (v.size() < 2 || B <= 0) { const double m = mean_of(v); return { m, m }; }
  std::mt19937 rng(seed); std::uniform_int_distribution<size_t> pick(0, v.size() - 1);
  std::vector<double> bs(B);
  for (int b = 0; b < B; ++b) { double s = 0; for (size_t i = 0; i < v.size(); ++i) s += v[pick(rng)]; bs[b] = s / v.size(); }
  return { cash::quantile(bs, 0.025), cash::quantile(bs, 0.975) };
}

double type_rate(const Instance& inst, const std::string& wct) {
  double s = 0; int n = 0;
  for (auto& [p, ops] : inst.model.opsOf) for (auto& o : ops)
    if (std::find(o.wcTypes.begin(), o.wcTypes.end(), wct) != o.wcTypes.end()) { s += o.hourRate + o.laborRate; ++n; }
  return n ? s / n : 0.0;
}

}  // namespace

double weekly(double annual) { return std::pow(1.0 + annual, 1.0 / 52.0) - 1.0; }

double annuity(double r, int n) {
  if (n <= 0) return 0.0;
  if (std::fabs(r) < 1e-15) return (double)n;
  return (1.0 - std::pow(1.0 + r, -(double)n)) / r;
}

double discounted_payback_weeks(double capex, double cf, int from, int n, double r) {
  if (!(capex > 0)) return 0.0;
  if (!(cf > 0)) return -1.0;
  double cum = 0;
  for (int k = 0; k < n; ++k) {
    const int t = from + k;
    const double d = cf * std::pow(1.0 + r, -(double)t);
    if (cum + d >= capex) return (t - 1) + (capex - cum) / d;
    cum += d;
  }
  return -1.0;
}

json evaluate(const Instance& inst, env::EnvConfig cfg, int c, const std::vector<Scenario>& scen,
              const std::vector<uint64_t>& seeds, const EvalCfg& ec) {
  if (c < 0 || c >= (int)inst.investCands.size()) throw std::invalid_argument("invest::evaluate: нет кандидата " + std::to_string(c));
  if (scen.size() != seeds.size() || scen.empty()) throw std::invalid_argument("invest::evaluate: сценарии и seed — одной длины > 0");
  const InvestCand& ic = inst.investCands[c];
  cfg.l2Enabled = false; cfg.structMode = false;
  const size_t N = scen.size();
  std::vector<Ep> base(N), inv(N);
  const int nThreads = std::max(1, std::min<int>((int)N, ec.threads > 0 ? ec.threads : (int)std::thread::hardware_concurrency()));
  std::atomic<size_t> next{ 0 };
  auto worker = [&]() {
    SimEnv e0(inst, cfg), e1(inst, cfg);
    e0.set_dispatch(ec.rule, ec.key); e1.set_dispatch(ec.rule, ec.key);
    e1.schedule_invest(c, ec.week);
    for (size_t i = next++; i < N; i = next++) { base[i] = run_episode(e0, seeds[i], scen[i], ec); inv[i] = run_episode(e1, seeds[i], scen[i], ec); }
  };
  std::vector<std::thread> pool; for (int t = 0; t < nThreads; ++t) pool.emplace_back(worker);
  for (auto& t : pool) t.join();
  // Горизонт водопада (как SimEnv::horizon_tt) и недели использования после ввода.
  const int taxP = std::max(1, inst.fin.taxPeriodWeeks);
  const int TT = ((cfg.horizonWeeks + taxP - 1) / taxP) * taxP;
  const int wd = ec.week + (int)std::floor(ic.leadWeeks + 1e-9);
  const int nPost = std::max(0, TT - wd);
  const double depW = ic.capex / std::max(1.0, ic.lifeWeeks), dDep = depW * nPost;
  const double rO = inst.fin.rateOwner, rw = weekly(rO), dfH = std::pow(1.0 + rO, -(double)TT / 52.0);
  const int nCont = ec.contWeeks > 0 ? std::max(0, std::min((int)ic.lifeWeeks - nPost, ec.contWeeks)) : 0;
  const double aCont = annuity(rw, nCont);
  std::vector<double> npv(N), dProfit(N), g(N), pB, pI, cB, cI, lB, lI;
  int nBreach = 0, nBreachBase = 0;
  for (size_t i = 0; i < N; ++i) {
    const Ep& b = base[i]; const Ep& v = inv[i];
    dProfit[i] = v.profit - b.profit;
    const double dInt = v.interest - b.interest;
    g[i] = nPost > 0 ? (dProfit[i] + (dDep + dInt) * (1.0 - inst.fin.tauP)) / nPost : 0.0;
    const double dEq = (v.endNet - v.endDebt) - (b.endNet - b.endDebt);
    // Продление: операционный поток g_i на n_cont недель + остаточная стоимость в конце расчётного периода (ВК 477).
    const double bvEnd = ec.salvage * std::max(0.0, ic.capex - depW * (nPost + nCont));
    const double tail = nCont > 0 ? g[i] * aCont + bvEnd * std::pow(1.0 + rw, -(double)nCont)
                                  : ec.salvage * std::max(0.0, ic.capex - dDep);
    npv[i] = dfH * (dEq + tail);
    pB.push_back(b.profit); pI.push_back(v.profit); cB.push_back(b.minCash); cI.push_back(v.minCash);
    lB.push_back(b.minLiq); lI.push_back(v.minLiq);
    nBreach += v.breach ? 1 : 0; nBreachBase += b.breach ? 1 : 0;
  }
  const double eNpv = mean_of(npv), eG = mean_of(g);
  const auto [npvLo, npvHi] = boot_mean_ci(npv, ec.bootB, ec.bootSeed);
  const auto [dpLo, dpHi] = boot_mean_ci(dProfit, ec.bootB, ec.bootSeed + 1);
  const double cvCashB = cash::cvar_lower(cB, ec.beta), cvCashI = cash::cvar_lower(cI, ec.beta);
  const double liqThr = std::min(ec.liqThreshold, cvCashB);
  double pLo = 0, pHi = 0; cash::wilson95(nBreach, (int)N, pLo, pHi);
  const double payback = discounted_payback_weeks(ic.capex, eG, std::max(1, wd - ec.week), std::max(0, nPost + nCont), rw);
  const bool okNpv = eNpv > 0, okLiq = cvCashI >= liqThr - 1e-9, okCi = npvLo > 0;
  json reasons = json::array();
  if (!okNpv) reasons.push_back("E[ЧДД] ≤ 0");
  if (!okLiq) reasons.push_back("CVaR(C_min) хуже порога ликвидности");
  if (!okCi) reasons.push_back("нижняя граница 95%-ДИ E[ЧДД] ≤ 0 (выигрыш не подтверждён)");
  return {
    {"cand", { {"id", ic.id}, {"kind", ic.kind}, {"wc_type", ic.wct}, {"capex", ic.capex}, {"lead_weeks", ic.leadWeeks},
               {"opex_weekly", ic.opexWeekly}, {"life_weeks", ic.lifeWeeks}, {"mtbf_mul", ic.mtbfMul}, {"repair_mul", ic.repairMul},
               {"prepay_share", ic.prepayShare}, {"source", ic.source} }},
    {"n", (int)N}, {"week", ec.week}, {"horizon_weeks", TT}, {"weeks_used", nPost}, {"cont_weeks", nCont},
    {"npv_mean", eNpv}, {"npv_ci95", { npvLo, npvHi }}, {"npv_cvar", cash::cvar_lower(npv, ec.alpha)},
    {"p_npv_neg", (double)std::count_if(npv.begin(), npv.end(), [](double x) { return x < 0; }) / N},
    {"d_profit_mean", mean_of(dProfit)}, {"d_profit_ci95", { dpLo, dpHi }},
    {"d_profit_cvar", cash::cvar_lower(pI, ec.alpha) - cash::cvar_lower(pB, ec.alpha)},
    {"profit_cvar_base", cash::cvar_lower(pB, ec.alpha)}, {"profit_cvar", cash::cvar_lower(pI, ec.alpha)},
    {"cash_min_cvar_base", cvCashB}, {"cash_min_cvar", cvCashI}, {"liquidity_cvar_base", cash::cvar_lower(lB, ec.beta)},
    {"liquidity_cvar", cash::cvar_lower(lI, ec.beta)}, {"liq_threshold", liqThr},
    {"p_cash_gap", (double)nBreach / N}, {"p_cash_gap_ci95", { pLo, pHi }}, {"p_cash_gap_base", (double)nBreachBase / N},
    {"cf_weekly_mean", eG}, {"payback_weeks", payback >= 0 ? json(payback) : json(nullptr)},
    {"payback_months", payback >= 0 ? json(payback * 12.0 / 52.0) : json(nullptr)},
    {"rate_owner", rO}, {"apply", okNpv && okLiq && okCi}, {"reasons", reasons},
  };
}

std::pair<std::string, json> choose_rule(const Instance& inst, env::EnvConfig cfg, const std::vector<Scenario>& scen,
                                         const std::vector<uint64_t>& seeds, double alpha, int threads) {
  static const char* kRules[] = { "EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO" };
  cfg.l2Enabled = false; cfg.structMode = false;
  const size_t N = std::min(scen.size(), seeds.size()), R = 7;
  std::vector<double> prof(R * N, 0.0);
  std::atomic<size_t> next{ 0 };
  const int nT = std::max(1, std::min<int>((int)(R * N), threads > 0 ? threads : (int)std::thread::hardware_concurrency()));
  auto worker = [&]() {
    SimEnv e(inst, cfg);
    for (size_t k = next++; k < R * N; k = next++) {
      EvalCfg ec; ec.rule = kRules[k / N];
      prof[k] = run_episode(e, seeds[k % N], scen[k % N], ec).profit;
    }
  };
  std::vector<std::thread> pool; for (int t = 0; t < nT; ++t) pool.emplace_back(worker);
  for (auto& t : pool) t.join();
  json tab = json::object(); std::string best; double bv = -1e300, bm = -1e300;
  for (size_t r = 0; r < R; ++r) {
    std::vector<double> v(prof.begin() + r * N, prof.begin() + (r + 1) * N);
    const double cv = cash::cvar_lower(v, alpha), m = mean_of(v);
    tab[kRules[r]] = { {"cvar", cv}, {"mean", m} };
    if (cv > bv || (cv == bv && m > bm)) { bv = cv; bm = m; best = kRules[r]; }
  }
  return { best, tab };
}

std::vector<InvestCand> candidates(const Instance& inst, const std::string& rule,
                                   const std::vector<std::string>& dualTypes, double capexPerMachine) {
  env::EnvConfig cfg; cfg.deterministic = true; cfg.breakdowns = false; cfg.denseReward = false;
  SimEnv e(inst, cfg);
  e.reset(1);
  const std::string toc = e.bottleneck_type();
  std::vector<InvestCand> out;
  if (toc.empty()) return out;
  // Второй тип: первый из двойственных ≠ TOC; иначе — второй по незавершённой работе на станок.
  std::string second;
  for (auto& t : dualTypes) if (t != toc && inst.model.machinesOf.count(t) && !inst.model.machinesOf.at(t).empty()) { second = t; break; }
  if (second.empty()) {
    std::unordered_map<std::string, double> load;
    for (auto& j : e.jobs()) if (!j.wcType.empty()) load[j.wcType] += j.durMean;
    double bv = -1;
    for (auto& [t, w] : load) {
      if (t == toc || !inst.model.machinesOf.count(t) || inst.model.machinesOf.at(t).empty()) continue;
      const double v = w / inst.model.machinesOf.at(t).size();
      if (v > bv || (v == bv && t < second)) { bv = v; second = t; }
    }
  }
  (void)rule;
  auto machine = [&](const std::string& t, const std::string& src) {
    InvestCand c; c.id = "m-" + t; c.kind = "machine"; c.wct = t; c.source = src;
    c.capex = capexPerMachine > 0 ? capexPerMachine : kCapexMul * kCapexHours * std::max(1.0, type_rate(inst, t));
    c.leadWeeks = kLeadWeeks; c.opexWeekly = kOpexShare * c.capex; c.lifeWeeks = 520; c.prepayShare = 0.3;
    return c;
  };
  out.push_back(machine(toc, "toc"));
  InvestCand mod; mod.id = "mod-" + toc; mod.kind = "modernize"; mod.wct = toc; mod.source = "toc";
  mod.capex = kModernShare * out[0].capex * std::max<size_t>(1, inst.model.machinesOf.at(toc).size());
  mod.leadWeeks = 2; mod.lifeWeeks = 520; mod.prepayShare = 0.3;
  const bool risk = inst.model.wctRisk.count(toc) && inst.model.wctRisk.at(toc).mtbf > 0;
  mod.mtbfMul = risk ? 2.0 : 1.0; mod.repairMul = risk ? 0.7 : 1.0;
  out.push_back(mod);
  if (!second.empty()) out.push_back(machine(second, dualTypes.empty() ? "load" : "dual"));
  return out;
}

}  // namespace maos::invest
