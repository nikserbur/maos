#include "InvestApi.h"
#include "CounterpartyRisk.h"
#include "InvestEval.h"
#include "Passport.h"
#include "SimEnv.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>

namespace maos::invest {
namespace {

using nlohmann::json;

double jnum(const json& b, const char* k, double d) {
  if (!b.contains(k) || b[k].is_null()) return d;
  if (b[k].is_number()) return b[k].get<double>();
  if (b[k].is_string()) { try { const std::string s = b[k].get<std::string>(); return s.empty() ? d : std::stod(s); } catch (...) { return d; } }
  return d;
}
std::string jstr(const json& b, const char* k) {
  if (!b.contains(k) || b[k].is_null()) return "";
  return b[k].is_string() ? b[k].get<std::string>() : b[k].dump();
}

/* CPR: события контрагентов сценариев набора — те же координаты [seed, 915, i, kind, entity], что Стадия 2 (сценарий
   i), Стадия 1 и стенд RL (эпизод idx = i); режимы — пути генератора набора, F̃ — общий фактор пути (λ_F > 0). */
void attach_cp(std::vector<env::Scenario>& sc, const cpr::CpParams& cp, const macro::MacroSampler* ms,
               const macro::SampleResult* r, uint64_t seed, int weeks, const std::vector<uint32_t>& ent) {
  std::vector<std::vector<int>> months;
  std::vector<double> fT;
  if (ms && r) {
    months = cpr::resolve_regimes(r->paths.regime, r->paths.blockId, ms->params(), cp.crisisIndex);
    if (cp.lambdaF > 0) {
      const double sgn = ms->params()["svd_vectors"][0][2].get<double>() > 0 ? -1.0 : 1.0;
      for (double f : ms->common_factor(r->paths)) fT.push_back(sgn * f);
    }
  }
  const int nb = (int)cp.buyer_weights().size(), T = std::max(52, weeks);
  for (size_t i = 0; i < sc.size(); ++i) {
    env::Scenario& s = sc[i];
    s.hasCp = true; s.cpParams = cp;
    s.cpEvents = cpr::draw(cp, seed, i, i < months.size() ? months[i] : std::vector<int>{},
                           i < fT.size() ? fT[i] : std::numeric_limits<double>::quiet_NaN(), T, nb, ent);
  }
}

}  // namespace

// Сценарии водопада из обученного макро-генератора: ключевая ставка/курс/инфляция по неделям, режим HMM
// (месяц → неделя); без генератора — постоянные параметры fin_params (CRN по seed эпизода сохраняется).
// cp (CPR включён) — события контрагентов сценария i на том же seed набора.
std::vector<env::Scenario> macro_scenarios(const macro::MacroSampler* ms, int n, uint64_t seed, int weeks,
                                           const cpr::CpParams* cp, const std::vector<uint32_t>& ent) {
  std::vector<env::Scenario> out(n);
  for (int i = 0; i < n; ++i) out[i].idx = i;
  if (!ms) { if (cp) attach_cp(out, *cp, nullptr, nullptr, seed, weeks, ent); return out; }
  const auto r = ms->sample(n, seed, weeks);
  for (int i = 0; i < n; ++i) {
    env::Scenario& s = out[i];
    for (double k : r.weekly.key[i]) s.keyRate.push_back(k / 100.0);
    s.fx = r.weekly.fx[i]; s.cpi = r.weekly.cpi[i];
    const auto& rg = r.paths.regime[i];
    for (int w = 0; w < weeks && !rg.empty(); ++w) s.regime.push_back(rg[std::min((int)rg.size() - 1, (int)std::floor(w * 12.0 / 52.0))]);
  }
  if (cp) attach_cp(out, *cp, ms, &r, seed, weeks, ent);
  return out;
}

namespace {

/* CPR экземпляра: fin.cp.* из БД (выкл. или нет таблицы → false), поставщики — покупные позиции НСИ (entity поставщика позиции). */
bool cp_of_instance(Database& db, const env::Instance& inst, const macro::MacroSampler* ms, cpr::CpParams& cp,
                    std::vector<uint32_t>& ent) {
  json fin = json::object();
  try { fin = passport::fin_params_json(db); } catch (const std::exception&) { return false; }
  cp = passport::counterparty_params(fin, json::object());
  if (!cp.enabled) return false;
  if (ms) cp.apply_generator(ms->params());
  std::vector<std::string> ids;
  for (const auto& [id, pr] : inst.model.prods) if (pr.purchased) ids.push_back(id);
  std::sort(ids.begin(), ids.end());
  for (const auto& id : ids) ent.push_back(cp.supplier_entity(id));
  return true;
}

std::vector<std::string> dual_types(const json& r0) {
  std::vector<std::string> out;
  if (r0.contains("exact") && r0["exact"].contains("duals") && r0["exact"]["duals"].is_array())
    for (auto& d : r0["exact"]["duals"]) if (d.value("shadow_price", 0.0) > 0) out.push_back(d.value("wc_type", std::string()));
  return out;
}

}  // namespace

json analytics_crn(Database& db, const json& body, const json& r0, const macro::MacroSampler* sampler) {
  const auto t0 = std::chrono::steady_clock::now();
  env::Instance inst = env::instance_from_db(db, {}, {}, true);
  if (inst.orders.empty()) return { {"status", "no_orders"}, {"reason", "нет открытых заказов (demand_orders)"} };
  inst.fin.taxCumulative = true;                                // налог нарастающим итогом (ст. 285–287 НК РФ), A3 П1
  const int n = std::max(8, std::min(256, (int)jnum(body, "n_scenarios", 48)));
  const uint64_t seed = (uint64_t)std::max(0.0, jnum(body, "seed", 20261023));
  env::EnvConfig cfg; cfg.denseReward = false; cfg.horizonWeeks = std::max(4, std::min(104, (int)jnum(body, "horizon_weeks", 26)));
  const double capex = std::max(0.0, jnum(body, "machine_capex", 0));
  const std::vector<std::string> duals = dual_types(r0);
  std::vector<env::InvestCand> cands = candidates(inst, "EDD", duals, capex);
  const std::string want = jstr(body, "wc_type_id");
  if (!want.empty() && inst.model.machinesOf.count(want) &&
      std::none_of(cands.begin(), cands.end(), [&](const env::InvestCand& c) { return c.kind == "machine" && c.wct == want; })) {
    env::InvestCand c = cands.empty() ? env::InvestCand{} : cands.front();
    c.id = "m-" + want; c.kind = "machine"; c.wct = want; c.source = "user"; c.mtbfMul = c.repairMul = 1;
    if (capex > 0) { c.capex = capex; c.opexWeekly = 0.002 * capex; }
    cands.push_back(c);
  }
  inst.investCands = cands;
  // Набор A (отбор, правило диспетчеризации) и ОТЛОЖЕННЫЙ набор B (вердикт) — разные потоки генератора и seed эпизодов.
  // CPR (fin.cp.enabled): события контрагентов — на seed своего набора; база и проект идут на одних событиях.
  cpr::CpParams cp; std::vector<uint32_t> ent;
  const bool cpOn = cp_of_instance(db, inst, sampler, cp, ent);
  const auto scA = macro_scenarios(sampler, n, seed, cfg.horizonWeeks, cpOn ? &cp : nullptr, ent);
  const auto scB = macro_scenarios(sampler, n, seed + 1, cfg.horizonWeeks, cpOn ? &cp : nullptr, ent);
  std::vector<uint64_t> sdA(n), sdB(n);
  for (int i = 0; i < n; ++i) { sdA[i] = 1000 + i; sdB[i] = 50000 + i; }
  std::string rule = jstr(body, "rule"); json rules = nullptr;
  if (rule.empty()) { auto [r, tab] = choose_rule(inst, cfg, scA, sdA, 0.1, 0); rule = r; rules = tab; }
  EvalCfg ec; ec.rule = rule; ec.contWeeks = std::max(0, (int)jnum(body, "cont_weeks", 260));
  ec.liqThreshold = jnum(body, "liq_threshold", 0.0);
  json out = json::array();
  for (size_t c = 0; c < cands.size(); ++c) {
    json a = evaluate(inst, cfg, (int)c, scA, sdA, ec);
    json b = evaluate(inst, cfg, (int)c, scB, sdB, ec);
    const bool apply = b.value("apply", false) && a.value("npv_mean", 0.0) > 0;
    json reasons = b.value("reasons", json::array());
    if (a.value("npv_mean", 0.0) <= 0) reasons.push_back("на отбирающем наборе E[ЧДД] ≤ 0");
    b["apply"] = apply; b["reasons"] = reasons;
    b["selection"] = { {"npv_mean", a["npv_mean"]}, {"npv_ci95", a["npv_ci95"]}, {"d_profit_mean", a["d_profit_mean"]},
                       {"cash_min_cvar", a["cash_min_cvar"]}, {"p_cash_gap", a["p_cash_gap"]}, {"apply", a["apply"]} };
    out.push_back(b);
  }
  return {
    {"status", "ok"}, {"rule", rule}, {"rules", rules}, {"n_scenarios", n}, {"seed", (int64_t)seed},
    {"holdout_seed", (int64_t)(seed + 1)}, {"macro", sampler != nullptr}, {"duals_used", duals},
    {"counterparty", cpOn ? json{ {"enabled", true}, {"stream", { (int64_t)seed, cpr::kCpStream }}, {"suppliers", (int)ent.size()},
                                  {"status", "К/НОРМ (паспорт fin.cp.*): эффект при калибровке, не оценка"} }
                          : json(nullptr)},
    {"params", { {"cont_weeks", ec.contWeeks}, {"liq_threshold", ec.liqThreshold}, {"rate_owner", inst.fin.rateOwner},
                 {"horizon_weeks", cfg.horizonWeeks}, {"alpha", ec.alpha}, {"beta", ec.beta}, {"salvage", ec.salvage},
                 {"tax_cumulative", true} }},
    {"rule_of_apply", "E[ЧДД] > 0 и нижняя граница 95%-ДИ E[ЧДД] > 0 на отложенных сценариях; CVaR₀.₀₅(C_min) не хуже "
                      "min(порог, база); E[ЧДД] > 0 и на отбирающем наборе"},
    {"assumptions", json::array({ "операционный эффект после горизонта продлевается на cont_weeks недель (портфель повторяется) [К]",
                                  "CAPEX — транши кредитной линии: 30 % при заказе, 70 % при вводе; проценты по ключевой ставке пути + спред",
                                  "диспетчеризация обоих прогонов — одно правило (CRN)" })},
    {"candidates", out},
    {"ms", std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count()},
  };
}

}  // namespace maos::invest
