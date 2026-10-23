#include "RlRule.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <memory>
#include <mutex>
#include <numeric>
#include <sstream>
#include <sys/stat.h>

#ifdef MAOS_WITH_ONNX
#include <onnxruntime_cxx_api.h>
#endif

namespace maos::rl {
namespace {

struct Policy {
  std::string path, sha; json meta; int obsSize = 0, actSize = 0;
  bool ruleSelect = false;   // A2: L0 «выбор правила» — действие = индекс правила (rule_for_action)
#ifdef MAOS_WITH_ONNX
  std::unique_ptr<Ort::Session> session;
#endif
  bool ok = false;
};

struct State {
  std::mutex mu; bool loaded = false; std::string error, dir;
  Policy l0, l2;
#ifdef MAOS_WITH_ONNX
  std::unique_ptr<Ort::Env> env;
#endif
};
State& g() { static State s; return s; }

bool file_exists(const std::string& p) { struct stat st{}; return ::stat(p.c_str(), &st) == 0; }

std::string find_dir() {
  if (const char* e = std::getenv("MAOS_RL_POLICY_DIR"); e && *e) return e;
  for (const char* d : { "rl/results", "../rl/results", "../../rl/results", "backend/data", "data" })
    if (file_exists(std::string(d) + "/l0_policy.onnx")) return d;
  return "";
}

void load_policy(Policy& p, const std::string& path) {
  p = Policy{}; p.path = path;
  if (!file_exists(path)) return;
  const std::string metaPath = path.substr(0, path.size() - 5) + ".json";
  if (file_exists(metaPath)) { try { std::ifstream f(metaPath); p.meta = json::parse(f); } catch (...) {} }
  p.sha = p.meta.value("sha256", std::string()); p.obsSize = p.meta.value("obs_size", 0); p.actSize = p.meta.value("act_size", 0);
#ifdef MAOS_WITH_ONNX
  try {
    Ort::SessionOptions so; so.SetIntraOpNumThreads(1); so.SetInterOpNumThreads(1);
    so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    p.session = std::make_unique<Ort::Session>(*g().env, path.c_str(), so);
    Ort::AllocatorWithDefaultOptions alloc;
    const auto shape = p.session->GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
    const auto oshape = p.session->GetOutputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
    if (shape.size() == 2 && shape[1] > 0) p.obsSize = (int)shape[1];
    if (oshape.size() == 2 && oshape[1] > 0) p.actSize = (int)oshape[1];
    p.ok = p.obsSize > 0 && p.actSize > 0;
    p.ruleSelect = p.meta.value("action_space", std::string()) == "rule";
  } catch (std::exception& e) { g().error += std::string("onnx: ") + e.what() + "; "; }
#else
  g().error += "сборка без onnxruntime (MAOS_WITH_ONNX=OFF); ";
#endif
}

std::vector<float> logits(Policy& p, const std::vector<float>& obs) {
#ifdef MAOS_WITH_ONNX
  if (!p.ok) return {};
  Ort::MemoryInfo mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  const int64_t shape[2] = { 1, (int64_t)obs.size() };
  std::vector<float> in(obs);
  Ort::Value t = Ort::Value::CreateTensor<float>(mem, in.data(), in.size(), shape, 2);
  const char* inames[] = { "obs" }; const char* onames[] = { "logits" };
  auto out = p.session->Run(Ort::RunOptions{ nullptr }, inames, &t, 1, onames, 1);
  const float* d = out[0].GetTensorData<float>();
  const size_t n = out[0].GetTensorTypeAndShapeInfo().GetElementCount();
  return std::vector<float>(d, d + n);
#else
  (void)p; (void)obs; return {};
#endif
}

int masked_argmax(const std::vector<float>& lg, const std::vector<uint8_t>& mask) {
  int best = -1; float bv = -INFINITY;
  for (size_t i = 0; i < lg.size() && i < mask.size(); ++i) if (mask[i] && lg[i] > bv) { bv = lg[i]; best = (int)i; }
  if (best < 0) for (size_t i = 0; i < mask.size(); ++i) if (mask[i]) return (int)i;
  return best;
}

// Эпизод политикой RL (L0 из ONNX; L2 — если загружена и l2Enabled). L0 «выбор правила» (A2):
// действие = индекс правила, операцию ставит правило из маскированной очереди (как L0RuleEnv).
// Действие политики выбора правила (A2): 0..6 — правило, 7 — ключ CP-SAT (в продукте ключа нет → чемпион),
// 8 — статический чемпион (лучшее правило по F детерминированно), 9 — срочный заказ первым, иначе чемпион.
int rule_select_job(env::SimEnv& e, int a, const std::string& dflt) {
  if (a >= 0 && a < kNumRules) return e.rule_choice(rule_for_action(a));
  if (a == kActExpedite) return e.expedite_choice(dflt, {});
  return e.rule_choice(dflt);
}

json run_policy(env::SimEnv& e, uint64_t seed, const env::Scenario& sc, bool useL2, const std::string& dflt = "EDD") {
  e.reset(seed, sc);
  const bool ruleSel = g().l0.ruleSelect;
  std::vector<uint8_t> mask(std::max(kNumRules, g().l0.actSize), 1);
  if ((int)mask.size() > kActCpSat) mask[kActCpSat] = 0;            // ключа CP-SAT в правиле RL нет
  int guard = 0;
  while (!e.done() && ++guard < 10'000'000) {
    if (e.level() == 2) { e.step(useL2 && l2_available() ? act(2, e.obs_l2(), e.mask_l2()) : 0); continue; }
    if (ruleSel) { e.step_job(rule_select_job(e, act(0, e.obs_l0(), mask), dflt)); continue; }
    e.step(act(0, e.obs_l0(), e.mask_l0()));
  }
  return e.summary();
}

// Статический чемпион для действия «по умолчанию»: лучшее из 7 правил по Cmax + 0.5·просрочка (по средним).
std::string best_static_rule(const env::Instance& inst) {
  env::EnvConfig c; c.mode = env::EpochMode::Event; c.deterministic = true; c.breakdowns = false; c.denseReward = false;
  env::SimEnv e(inst, c);
  std::string best = "EDD"; double bf = 1e300;
  for (int a = 0; a < kNumRules; ++a) {
    const json s = env::evaluate_rule(e, rule_for_action(a), 1, {});
    const double f = s.value("makespan_h", 0.0) + 0.5 * s.value("tardiness_h", 0.0);
    if (f < bf) { bf = f; best = rule_for_action(a); }
  }
  return best;
}

// Итог гейта V5 (rl/results/champion_a2.json рядом с политикой): чемпион, ДИ, прошёл ли гейт.
json gate_info() {
  for (const std::string& d : { g().dir, std::string("rl/results"), std::string("../rl/results"), std::string("../../rl/results") }) {
    if (d.empty() || !file_exists(d + "/champion_a2.json")) continue;
    try { std::ifstream f(d + "/champion_a2.json"); json c = json::parse(f);
      const bool pass = c.value("policy", std::string("best_rule")) != "best_rule";
      return { {"gate_pass", pass}, {"champion", c.value("policy", std::string("best_rule"))}, {"ci95", c.value("ci95", json(nullptr))},
               {"score", c.value("score", 0.0)}, {"wilcoxon_p", c.value("wilcoxon_p", json(nullptr))}, {"holdout_seed", c.value("holdout_seed", json(nullptr))},
               {"n", c.value("n", json(nullptr))}, {"source", d + "/champion_a2.json"} };
    } catch (...) {}
  }
  return { {"gate_pass", false}, {"champion", "best_rule"}, {"ci95", nullptr}, {"source", ""} };
}

// Волна A3: гейт структурного RL (rl/results/a3/champion_a3.json, rl/eval/v5_a3.py): G2 — замена чемпиона §7.4,
// G1 — к лучшему правилу §10.2а; ДИ IQM ΔCVaR₀.₁(Π) в % стоимости портфеля, стресс base.
json gate_a3_info() {
  for (const std::string& d : { g().dir, std::string("rl/results"), std::string("../rl/results"), std::string("../../rl/results") }) {
    const std::string f = d + "/a3/champion_a3.json";
    if (d.empty() || !file_exists(f)) continue;
    try { std::ifstream in(f); json c = json::parse(in);
      json ci = nullptr, ciChamp = nullptr, ciPlus = nullptr;
      if (c.contains("base") && c["base"].is_object()) {
        ci = c["base"]["vs_best_rule"]["d_cvar_profit"]["ci95"]; ciChamp = c["base"]["vs_champion"]["d_cvar_profit"]["ci95"];
        if (c["base"].contains("vs_champion+")) ciPlus = c["base"]["vs_champion+"]["d_cvar_profit"]["ci95"];
      }
      return { {"gate_pass", c.value("gate_pass", false)}, {"gate_g1", c.value("gate_g1", false)},
               {"champion", c.value("gate_pass", false) ? "rl_l3" : "non_rl_champion"}, {"candidate_seed", c.value("candidate_seed", json(nullptr))},
               {"ci95_vs_best_rule", ci}, {"ci95_vs_champion", ciChamp}, {"ci95_vs_champion_plus", ciPlus},
               {"gate_g2_prereg", c.value("gate_g2_prereg", false)}, {"variant", c.value("variant", json(nullptr))},
               {"units", "% стоимости портфеля, IQM по экземплярам"},
               {"source", f} };
    } catch (...) {}
  }
  return { {"gate_pass", false}, {"gate_g1", false}, {"champion", "non_rl_champion"}, {"source", ""} };
}

double mean_of(const std::vector<double>& v) { return v.empty() ? 0 : std::accumulate(v.begin(), v.end(), 0.0) / v.size(); }
double cvar_lo(std::vector<double> v, double a) { if (v.empty()) return 0; std::sort(v.begin(), v.end()); size_t k = std::max<size_t>(1, (size_t)std::floor(a * v.size())); return std::accumulate(v.begin(), v.begin() + k, 0.0) / k; }
double cvar_hi(std::vector<double> v, double a) { if (v.empty()) return 0; std::sort(v.begin(), v.end()); size_t k = std::max<size_t>(1, (size_t)std::floor(a * v.size())); return std::accumulate(v.end() - k, v.end(), 0.0) / k; }

}  // namespace

const char* rule_for_action(int a) {
  static const char* const kRules[kNumRules] = { "EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO" };   // = rl/env/l0_env.py:RULES
  return (a >= 0 && a < kNumRules) ? kRules[a] : "EDD";
}

void load_default() {
  State& s = g(); std::lock_guard<std::mutex> lk(s.mu);
  if (s.loaded) return;
  s.loaded = true; s.error.clear();
#ifdef MAOS_WITH_ONNX
  try { s.env = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "maos"); } catch (std::exception& e) { s.error = e.what(); return; }
#endif
  s.dir = find_dir();
  if (s.dir.empty()) { s.error += "файл политики l0_policy.onnx не найден ($MAOS_RL_POLICY_DIR | rl/results); "; return; }
  load_policy(s.l0, s.dir + "/l0_policy.onnx");
  if (file_exists(s.dir + "/l2_policy.onnx")) load_policy(s.l2, s.dir + "/l2_policy.onnx");
}

bool available() { load_default(); return g().l0.ok; }
bool l2_available() { load_default(); return g().l2.ok; }

json status() {
  load_default(); State& s = g();
  auto pj = [](const Policy& p) { return json{ {"ok", p.ok}, {"path", p.path}, {"sha256", p.sha}, {"obs_size", p.obsSize}, {"act_size", p.actSize}, {"meta", p.meta} }; };
#ifdef MAOS_WITH_ONNX
  const bool built = true;
#else
  const bool built = false;
#endif
  return { {"available", s.l0.ok}, {"onnxruntime", built}, {"l0_rule_select", s.l0.ruleSelect}, {"gate", gate_info()}, {"gate_a3", gate_a3_info()}, {"dir", s.dir}, {"error", s.error}, {"l0", pj(s.l0)}, {"l2", pj(s.l2)},
           {"note", "правило RL: политика L0 → ключ приоритетов (ранг старта) → тот же конвейер Ганта/МК; L2 → moves[] (§4.7)"} };
}

int act(int level, const std::vector<float>& obs, const std::vector<uint8_t>& mask) {
  load_default(); Policy& p = level == 2 ? g().l2 : g().l0;
  if (!p.ok || (int)obs.size() != p.obsSize) return masked_argmax({}, mask);
  return masked_argmax(logits(p, obs), mask);
}

RlPlan plan(Database& db, const std::vector<std::pair<std::string,double>>& program,
            const std::vector<double>& dueHours, bool useCalendar, unsigned seed, int nScen, double alpha) {
  RlPlan r;
  if (!available()) { r.error = "Правило «RL» недоступно: " + status().value("error", std::string("политика не загружена")); return r; }
  env::Instance inst = env::instance_from_db(db, program, dueHours, useCalendar);
  env::EnvConfig cfg; cfg.mode = env::EpochMode::Event; cfg.deterministic = true; cfg.breakdowns = false; cfg.denseReward = false;
  env::SimEnv det(inst, cfg);
  const std::string dflt = best_static_rule(inst);
  const json detSum = run_policy(det, seed, {}, false, dflt);
  // Ключ = ранг старта операции в RL-расписании (та же развёртка джобов, что в run_schedule).
  const json gantt = det.gantt();
  std::vector<std::pair<double,int>> order; order.reserve(gantt.size());
  for (auto& x : gantt) order.push_back({ x.at("start").get<double>(), x.at("job_idx").get<int>() });
  std::sort(order.begin(), order.end());
  r.key.assign(gantt.size(), 0); for (size_t i = 0; i < order.size(); ++i) r.key[order[i].second] = (double)i;
  r.ok = true;
  r.rlEval = { {"makespan_h", detSum.value("makespan_h", 0.0)}, {"tardiness_h", detSum.value("tardiness_h", 0.0)},
               {"default_rule", dflt}, {"gate", gate_info()},
               {"n_decisions", detSum.value("n_decisions", 0)}, {"n_wait", detSum.value("n_wait", 0)}, {"policy_sha256", g().l0.sha} };
  if (!l2_available() || nScen <= 0) { r.moves = nullptr; return r; }
  // Структурные ходы L2: предложение — по средним; эффект «до/после» — на nScen сценариях CRN.
  env::EnvConfig c2 = cfg; c2.l2Enabled = true;
  env::SimEnv detL2(inst, c2);
  const json l2Sum = run_policy(detL2, seed, {}, true, dflt);
  env::EnvConfig cs; cs.mode = env::EpochMode::Event; cs.breakdowns = true; cs.denseReward = false;
  env::EnvConfig cs2 = cs; cs2.l2Enabled = true;
  env::SimEnv before(inst, cs), after(inst, cs2);
  std::vector<double> pB, pA, cB, cA, mkB, mkA, tdB, tdA, otdB, otdA; int brB = 0, brA = 0;
  for (int s = 0; s < nScen; ++s) {
    env::Scenario sc; sc.idx = s;
    const json a = run_policy(before, seed + 7919u * (unsigned)s, sc, false, dflt), b = run_policy(after, seed + 7919u * (unsigned)s, sc, true, dflt);
    pB.push_back(a.value("profit", 0.0)); pA.push_back(b.value("profit", 0.0));
    cB.push_back(a.value("min_cash", 0.0)); cA.push_back(b.value("min_cash", 0.0));
    mkB.push_back(a.value("makespan_h", 0.0)); mkA.push_back(b.value("makespan_h", 0.0));
    tdB.push_back(a.value("tardiness_h", 0.0)); tdA.push_back(b.value("tardiness_h", 0.0));
    otdB.push_back(a.value("otd", 0.0)); otdA.push_back(b.value("otd", 0.0));
    brB += a.value("breach", false) ? 1 : 0; brA += b.value("breach", false) ? 1 : 0;
  }
  // Парный бутстреп по сценариям выигрыша CVaR(Π) (B = 500).
  std::vector<double> gains(nScen); for (int s = 0; s < nScen; ++s) gains[s] = pA[s] - pB[s];
  std::mt19937 brng(seed + 4242u); std::vector<double> bs;
  for (int b = 0; b < 500; ++b) { std::vector<double> xa, xb; for (int s = 0; s < nScen; ++s) { const int i = (int)(brng() % (unsigned)nScen); xa.push_back(pA[i]); xb.push_back(pB[i]); } bs.push_back(cvar_lo(xa, alpha) - cvar_lo(xb, alpha)); }
  std::sort(bs.begin(), bs.end());
  const double winShare = nScen ? (double)std::count_if(gains.begin(), gains.end(), [](double x) { return x > 0; }) / nScen : 0;
  json impact = {
    {"profit", { {"e_before", mean_of(pB)}, {"e_after", mean_of(pA)}, {"cvar_before", cvar_lo(pB, alpha)}, {"cvar_after", cvar_lo(pA, alpha)} }},
    {"cash", { {"min_cash_cvar_before", cvar_lo(cB, 0.05)}, {"min_cash_cvar_after", cvar_lo(cA, 0.05)}, {"p_gap_before", nScen ? (double)brB / nScen : 0}, {"p_gap_after", nScen ? (double)brA / nScen : 0} }},
    {"schedule", { {"cmax_e_delta_h", mean_of(mkA) - mean_of(mkB)}, {"cmax_cvar_delta_h", cvar_hi(mkA, alpha) - cvar_hi(mkB, alpha)}, {"otd_delta", mean_of(otdA) - mean_of(otdB)}, {"tardiness_delta_h", mean_of(tdA) - mean_of(tdB)} }},
    {"win_share", winShare}, {"ci95", { bs[(size_t)(0.025 * bs.size())], bs[(size_t)(0.975 * bs.size())] }},
  };
  std::vector<int> idx(nScen); std::iota(idx.begin(), idx.end(), 0);
  std::sort(idx.begin(), idx.end(), [&](int a, int b) { return gains[a] > gains[b]; });
  json topSc = json::array(); for (int i = 0; i < std::min(5, nScen); ++i) topSc.push_back({ {"idx", idx[i]}, {"gain", gains[idx[i]]} });
  json moves = json::array(); int n = 0;
  for (auto& m : l2Sum.value("moves", json::array())) {
    json targets = json::object();
    if (m.value("order_idx", -1) >= 0) { targets["order_idx"] = json::array({ m["order_idx"] }); const int k = m["order_idx"].get<int>(); if (k < (int)inst.orders.size()) targets["product_ids"] = json::array({ inst.orders[k].productId }); }
    if (m.contains("after") && m["after"].contains("op_id")) targets["op_ids"] = json::array({ m["after"]["op_id"] });
    moves.push_back({ {"id", m.value("id", "mv-" + std::to_string(++n))}, {"kind", m.value("kind", "")}, {"status", "proposed"}, {"targets", targets},
      {"before", m.value("before", json::object())}, {"after", m.value("after", json::object())}, {"impact", impact},
      {"justification", { {"regime", { {"id", "base"}, {"label", "базовые условия (fin_params; макро-путь не подключён в правиле RL)"}, {"share", 1.0} }},
                          {"scenarios", topSc}, {"map_nodes", json::array({ "6", "4", "5" })},
                          {"text", "Эффект указан для пакета ходов политики L2 на " + std::to_string(nScen) + " сценариях (CRN), не для отдельного хода."} }},
      {"masks_checked", m.value("masks_checked", json::array())}, {"proposed_at", ""},
      {"agent", { {"level", "L2"}, {"policy_version", g().l2.sha}, {"seed", seed} }}, {"week", m.value("week", 0)} });
  }
  r.moves = { {"run_id", ""}, {"baseline_run_id", ""}, {"moves", moves}, {"totals", impact},
              {"guardrails", { {"alpha", alpha}, {"objective", "cvar_profit_cash"},
                               {"allowed", { {"reroute", !inst.altRoutings.empty()}, {"reassign", true}, {"reorder", true}, {"split", true}, {"merge", true}, {"transfer", false}, {"outsource", inst.outsourceLeadHours > 0}, {"shift", true}, {"drop", false}, {"finance", inst.fin.creditLimit > 0} }},
                               {"limits", { {"max_moves", c2.maxMovesPerWeek * c2.horizonWeeks}, {"max_orders_share", 1.0}, {"max_shift_days", 28}, {"max_outsource_share", 1.0} }},
                               {"frozen", json::array()}, {"rejected_masks", json::array()}, {"owner", "run"} }},
              {"n_scenarios", nScen}, {"l2_makespan_h", l2Sum.value("makespan_h", 0.0)} };
  return r;
}

}  // namespace maos::rl
