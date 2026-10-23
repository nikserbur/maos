/**
 * nanobind-модуль `maos_env` — стенд rl/ (волна A): SimEnv, экземпляры, сценарии, правила, ГА.
 * Собирается отдельной целью (MAOS_BUILD_PYENV=ON) в rl/env/; сервер от него не зависит.
 */
#include "InvestEval.h"
#include "SimEnv.h"
#include <nanobind/nanobind.h>
#include <nanobind/ndarray.h>
#include <nanobind/stl/pair.h>
#include <nanobind/stl/string.h>
#include <nanobind/stl/tuple.h>
#include <nanobind/stl/vector.h>

namespace nb = nanobind;
using namespace maos::env;
using nlohmann::json;

namespace {
Scenario scenario_of(const std::string& js) { return js.empty() ? Scenario{} : Scenario::from_json(json::parse(js)); }
nb::ndarray<nb::numpy, float> to_np(const std::vector<float>& v) {
  float* data = new float[v.size()]; std::copy(v.begin(), v.end(), data);
  nb::capsule owner(data, [](void* p) noexcept { delete[] (float*)p; });
  return nb::ndarray<nb::numpy, float>(data, { v.size() }, owner);
}
nb::ndarray<nb::numpy, uint8_t> to_np_u8(const std::vector<uint8_t>& v) {
  uint8_t* data = new uint8_t[v.size()]; std::copy(v.begin(), v.end(), data);
  nb::capsule owner(data, [](void* p) noexcept { delete[] (uint8_t*)p; });
  return nb::ndarray<nb::numpy, uint8_t>(data, { v.size() }, owner);
}
}  // namespace

NB_MODULE(maos_env, m) {
  m.doc() = "MAOS SimEnv (волна A): событийная среда Стадии 1 для L0/L2";
  nb::class_<Instance>(m, "Instance")
    .def_static("from_json", [](const std::string& js) { return instance_from_json(json::parse(js)); })
    .def("to_json", [](const Instance& i) { return instance_to_json(i).dump(); })
    .def_prop_ro("name", [](const Instance& i) { return i.name; })
    .def_prop_ro("n_orders", [](const Instance& i) { return (int)i.orders.size(); })
    .def_prop_ro("n_machines", [](const Instance& i) { return (int)i.model.machineWct.size(); })
    .def_rw("outsource_lead_hours", &Instance::outsourceLeadHours)
    .def_rw("tail_weight", &Instance::tailWeight);
  m.def("instance_from_db", [](const std::string& dbPath, const std::vector<std::pair<std::string,double>>& program,
                               const std::vector<double>& dueHours, bool useCalendar) {
    Database db(dbPath); return instance_from_db(db, program, dueHours, useCalendar); },
    nb::arg("db_path"), nb::arg("program") = std::vector<std::pair<std::string,double>>{}, nb::arg("due_hours") = std::vector<double>{},
    nb::arg("use_calendar") = true);

  nb::class_<EnvConfig>(m, "EnvConfig")
    .def(nb::init<>())
    .def_prop_rw("event_mode", [](const EnvConfig& c) { return c.mode == EpochMode::Event; }, [](EnvConfig& c, bool v) { c.mode = v ? EpochMode::Event : EpochMode::Serial; })
    .def_rw("k_max_cands", &EnvConfig::kMaxCands).def_rw("k_max_orders", &EnvConfig::kMaxOrders).def_rw("k_max_wct", &EnvConfig::kMaxWct)
    .def_rw("horizon_weeks", &EnvConfig::horizonWeeks).def_rw("l2_enabled", &EnvConfig::l2Enabled).def_rw("max_moves_per_week", &EnvConfig::maxMovesPerWeek)
    .def_rw("breakdowns", &EnvConfig::breakdowns).def_rw("deterministic", &EnvConfig::deterministic).def_rw("dense_reward", &EnvConfig::denseReward)
    .def_rw("c_tard", &EnvConfig::cTard).def_rw("c_setup", &EnvConfig::cSetup).def_rw("w_profit", &EnvConfig::wProfit).def_rw("w_cash", &EnvConfig::wCash)
    .def_rw("lambda_breach", &EnvConfig::lambdaBreach).def_rw("tard_penalty_per_week", &EnvConfig::tardPenaltyPerWeek).def_rw("tard_penalty_cap", &EnvConfig::tardPenaltyCap)
    .def_rw("repair_cost_mul", &EnvConfig::repairCostMul).def_rw("wait_window_min", &EnvConfig::waitWindowMin).def_rw("c_wait", &EnvConfig::cWait).def_rw("seed", &EnvConfig::seed)
    .def_rw("invest_enabled", &EnvConfig::investEnabled).def_rw("shock_window_min", &EnvConfig::shockWindowMin)
    .def_rw("recover_share", &EnvConfig::recoverShare).def_rw("rush_price_mul", &EnvConfig::rushPriceMul)
    .def_rw("rush_late_loss", &EnvConfig::rushLateLoss)
    .def_rw("struct_mode", &EnvConfig::structMode);   // A3: структурный режим L2/L3

  nb::class_<SimEnv>(m, "SimEnv")
    .def(nb::init<Instance, EnvConfig>(), nb::arg("instance"), nb::arg("config"))
    .def("reset", [](SimEnv& e, uint64_t seed, const std::string& sc) { e.reset(seed, scenario_of(sc)); }, nb::arg("seed"), nb::arg("scenario_json") = std::string())
    .def("step", [](SimEnv& e, int a) { const StepResult r = e.step(a); return std::make_tuple(r.reward, r.done, r.level); })
    .def("step_job", [](SimEnv& e, int j) { const StepResult r = e.step_job(j); return std::make_tuple(r.reward, r.done, r.level); })
    .def("obs_l0", [](const SimEnv& e) { return to_np(e.obs_l0()); })
    .def("mask_l0", [](const SimEnv& e) { return to_np_u8(e.mask_l0()); })
    .def("obs_l2", [](const SimEnv& e) { return to_np(e.obs_l2()); })
    .def("mask_l2", [](const SimEnv& e) { return to_np_u8(e.mask_l2()); })
    .def_prop_ro("done", &SimEnv::done).def_prop_ro("level", &SimEnv::level).def_prop_ro("now", &SimEnv::now)
    .def_prop_ro("epoch_machine", &SimEnv::epoch_machine).def_prop_ro("n_decisions", &SimEnv::n_decisions)
    .def_prop_ro("n_jobs", [](const SimEnv& e) { return (int)e.jobs().size(); })
    .def_prop_ro("obs_l0_size", &SimEnv::obs_l0_size).def_prop_ro("act_l0_size", &SimEnv::act_l0_size)
    .def_prop_ro("obs_l2_size", &SimEnv::obs_l2_size).def_prop_ro("act_l2_size", &SimEnv::act_l2_size)
    .def("candidates", [](const SimEnv& e) { return e.candidates(); })
    .def("rule_choice", &SimEnv::rule_choice).def("rule_slot", &SimEnv::rule_slot)
    .def("key_choice", [](const SimEnv& e, const std::vector<double>& k) { return e.key_choice(k); })
    .def("expedite_choice", [](const SimEnv& e, const std::string& r, const std::vector<double>& k) { return e.expedite_choice(r, k); },
         nb::arg("rule"), nb::arg("key") = std::vector<double>{})
    .def("describe_l2", &SimEnv::describe_l2)
    // A3: структурный режим — диспетчеризация чемпионом, прогон L0 до эпохи L3, статические инвестиции.
    .def("set_dispatch", [](SimEnv& e, const std::string& rule, const std::vector<double>& key) { e.set_dispatch(rule, key); },
         nb::arg("rule"), nb::arg("key") = std::vector<double>{})
    .def("run_l0", &SimEnv::run_l0)
    .def("dispatch_choice", &SimEnv::dispatch_choice)
    .def("schedule_invest", &SimEnv::schedule_invest, nb::arg("cand"), nb::arg("week") = 0)
    .def("bottleneck_type", &SimEnv::bottleneck_type)
    .def("struct_state", [](const SimEnv& e) { return e.struct_state().dump(); })
    .def("summary", [](const SimEnv& e) { return e.summary().dump(); })
    .def("gantt", [](const SimEnv& e) { return e.gantt().dump(); })
    .def("lower_bound", &SimEnv::lower_bound)
    .def("instance_to_json", [](const SimEnv& e) { return instance_to_json(e.instance()).dump(); })
    .def("job_info", [](const SimEnv& e) {   // статическая структура джоб (для CP-SAT/анализа)
      json a = json::array();
      for (auto& j : e.jobs()) a.push_back({ {"order", j.orderIdx}, {"op", j.opId}, {"product", j.productId}, {"wc_types", j.wcTypes},
        {"dur", j.durMean}, {"setup", j.setupTime}, {"preds", j.preds}, {"due", j.dueMin}, {"release", j.releaseMin}, {"needs_worker", j.needsWorker},
        {"dur_by_type", j.durByType} });
      return a.dump(); });
  m.def("evaluate_rule", [](SimEnv& e, const std::string& rule, uint64_t seed, const std::string& sc) { return evaluate_rule(e, rule, seed, scenario_of(sc)).dump(); },
        nb::arg("env"), nb::arg("rule"), nb::arg("seed"), nb::arg("scenario_json") = std::string());
  m.def("evaluate_key", [](SimEnv& e, const std::vector<double>& key, uint64_t seed, const std::string& sc) { return evaluate_key(e, key, seed, scenario_of(sc)).dump(); },
        nb::arg("env"), nb::arg("key"), nb::arg("seed"), nb::arg("scenario_json") = std::string());
  m.def("rule_key", [](const SimEnv& e, const std::string& rule) {   // ключ правила по развёртке среды (как run_schedule)
          std::vector<double> ow(e.instance().orders.size(), 0.0);
          for (auto& j : e.jobs()) ow[j.orderIdx] += j.durMean;
          return maos::sched::priorities(rule, e.jobs(), ow); },
        nb::arg("env"), nb::arg("rule"));
  m.def("simulate_plan", [](SimEnv& e, const std::vector<double>& key, const std::vector<double>& starts,
                             const std::vector<std::string>& machines, uint64_t seed) { return simulate_plan(e, key, starts, machines, seed).dump(); },
        nb::arg("env"), nb::arg("key"), nb::arg("starts") = std::vector<double>{}, nb::arg("machines") = std::vector<std::string>{},
        nb::arg("seed") = 0);
  m.def("ga_improve_keys", [](SimEnv& e, const std::vector<std::vector<double>>& seeds, const std::vector<std::string>& machines,
                               int generations, int nScen, uint64_t seed0, double timeSec, unsigned gaSeed, int stallGens) {
          return ga_improve_keys(e, seeds, machines, generations, nScen, seed0, timeSec, gaSeed, stallGens).dump(); },
        nb::arg("env"), nb::arg("seeds"), nb::arg("machines") = std::vector<std::string>{}, nb::arg("generations") = 30,
        nb::arg("n_scen") = 0, nb::arg("seed0") = 1000, nb::arg("time_sec") = 30.0, nb::arg("ga_seed") = 1991, nb::arg("stall_gens") = 8);
  // A3: оценка инвестпроекта L3 на CRN (ЧДД, CVaR, окупаемость, P(разрыва), правило применения) и кандидаты.
  m.def("invest_eval", [](const Instance& inst, const EnvConfig& cfg, int cand, const std::vector<std::string>& scen,
                          const std::vector<uint64_t>& seeds, const std::string& rule, const std::vector<double>& key, int week,
                          int contWeeks, double liq, int threads) {
          std::vector<Scenario> sc; for (auto& s : scen) sc.push_back(scenario_of(s));
          maos::invest::EvalCfg ec; ec.rule = rule; ec.key = key; ec.week = week; ec.contWeeks = contWeeks; ec.liqThreshold = liq; ec.threads = threads;
          nb::gil_scoped_release rel;
          return maos::invest::evaluate(inst, cfg, cand, sc, seeds, ec).dump(); },
        nb::arg("instance"), nb::arg("config"), nb::arg("cand"), nb::arg("scenarios"), nb::arg("seeds"), nb::arg("rule") = std::string("EDD"),
        nb::arg("key") = std::vector<double>{}, nb::arg("week") = 0, nb::arg("cont_weeks") = 260, nb::arg("liq") = 0.0, nb::arg("threads") = 1);
  m.def("invest_candidates", [](const Instance& inst, const std::string& rule, const std::vector<std::string>& duals, double capex) {
          json a = json::array();
          for (auto& c : maos::invest::candidates(inst, rule, duals, capex))
            a.push_back({ {"id", c.id}, {"kind", c.kind}, {"wct", c.wct}, {"capex", c.capex}, {"lead_weeks", c.leadWeeks},
                          {"opex_weekly", c.opexWeekly}, {"life_weeks", c.lifeWeeks}, {"mtbf_mul", c.mtbfMul}, {"repair_mul", c.repairMul},
                          {"prepay_share", c.prepayShare}, {"source", c.source} });
          return a.dump(); },
        nb::arg("instance"), nb::arg("rule") = std::string("EDD"), nb::arg("duals") = std::vector<std::string>{}, nb::arg("capex") = 0.0);
  m.def("ga_improve", [](const SimEnv& e, int generations, int nScen, uint64_t seed0, double timeSec, const std::vector<std::string>& rules) {
          return ga_improve(e, generations, nScen, seed0, timeSec, rules).dump(); },
        nb::arg("env"), nb::arg("generations") = 30, nb::arg("n_scen") = 8, nb::arg("seed0") = 1000, nb::arg("time_sec") = 30.0,
        nb::arg("seed_rules") = std::vector<std::string>{ "EDD", "SPT", "MWKR", "MS", "CR", "FIFO", "LPT" });
}
