#include "CpSatRule.h"
#include <httplib.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <mutex>
#include <numeric>

namespace maos::cpsat {
namespace {

std::mutex& override_mu() { static std::mutex m; return m; }
SolverFn& override_fn() { static SolverFn f; return f; }

constexpr double kHttpSlackS = 30.0;      // техн.: запас таймаута HTTP сверх лимита солвера
constexpr double kConnectTimeoutS = 1.0;  // техн.: sidecar локальный — долгое соединение = недоступен

json calendar_json(const sched::Calendar& c) {
  json days = json::array();
  for (int d = 0; d < 7; ++d) {
    json dd = json::array();
    for (auto& [s, e] : c.day[d]) dd.push_back({ s, e });
    days.push_back(dd);
  }
  return { {"any", c.any}, {"days", days} };
}

json job_json(const sched::Job& j) {
  std::vector<std::string> types = j.wcTypes;
  if (types.empty() && !j.wcType.empty()) types.push_back(j.wcType);
  json dbt = json::array();
  for (auto& [t, mean] : j.durByType) dbt.push_back({ t, mean });
  return { {"order", j.orderIdx}, {"op", j.opId}, {"product", j.productId}, {"wc_types", types},
           {"dur", j.durMean}, {"dur_by_type", dbt}, {"setup", j.setupTime}, {"preds", j.preds},
           {"release", j.releaseMin}, {"needs_worker", j.needsWorker} };
}

Solution unavailable(const std::string& why) {
  Solution s; s.status = "UNAVAILABLE"; s.error = why; return s;
}

Solution solve_http(const json& payload, double timeLimitS) {
  const std::string url = sidecar_url();
  httplib::Client cli(url);
  cli.set_connection_timeout(std::chrono::milliseconds((int)(kConnectTimeoutS * 1000)));
  cli.set_read_timeout(std::chrono::milliseconds((int)((timeLimitS + kHttpSlackS) * 1000)));
  auto res = cli.Post("/solve", payload.dump(), "application/json");
  if (!res)
    return unavailable("Правило «CP-SAT» недоступно: sidecar " + url + " не отвечает (" +
                       httplib::to_string(res.error()) + "). Запуск: rl/.venv/bin/python -m rl.cpsat_service");
  json body;
  try { body = json::parse(res->body); }
  catch (...) { return unavailable("Правило «CP-SAT»: ответ sidecar — не JSON (HTTP " + std::to_string(res->status) + ")."); }
  if (res->status != 200 && !body.contains("status"))
    return unavailable("Правило «CP-SAT»: sidecar вернул HTTP " + std::to_string(res->status) + ".");
  return parse_solution(body, payload.at("jobs").size());
}

}  // namespace

void set_solver_override(SolverFn fn) {
  std::lock_guard<std::mutex> lk(override_mu());
  override_fn() = std::move(fn);
}

std::string sidecar_url() {
  if (const char* e = std::getenv("MAOS_CPSAT_URL"); e && *e) return e;
  return "http://127.0.0.1:8091";
}

json build_payload(const sched::Model& m, const std::vector<sched::Job>& jobs, const sched::Calendar& cal,
                   const std::unordered_map<std::string, sched::Calendar>& calByM, const std::vector<double>& due,
                   double timeLimitS, unsigned seed, double wTard, const sched::SimOut* hint) {
  json machines = json::array();
  for (auto& [wct, mids] : m.machinesOf) for (auto& mid : mids) machines.push_back({ {"id", mid}, {"wct", wct} });
  json mcal = json::object();
  for (auto& [mid, c] : calByM) mcal[mid] = calendar_json(c);
  json elig = json::object();
  for (auto& [w, v] : m.eligibleWorkers) elig[w] = v;
  json js = json::array();
  for (auto& j : jobs) js.push_back(job_json(j));
  json p = { {"name", "maos-schedule"}, {"time_limit_s", timeLimitS}, {"workers", 8}, {"seed", (int)(seed % 1000003u)},
             {"w_tard", wTard}, {"machines", machines}, {"calendar", calendar_json(cal)}, {"machine_calendars", mcal},
             {"n_workers", (int)m.workers.size()}, {"eligible", elig}, {"due_min", due}, {"jobs", js} };
  if (hint && hint->start.size() == jobs.size())
    p["hint"] = { {"starts", hint->start}, {"machines", hint->machineId}, {"makespan", hint->makespan} };
  return p;
}

Solution parse_solution(const json& r, size_t nJobs) {
  Solution s;
  s.status = r.value("status", std::string("ERROR"));
  s.error = r.value("error", std::string());
  auto numOr = [&](const char* k) { return r.contains(k) && r[k].is_number() ? r[k].get<double>() : 0.0; };
  s.objective = numOr("objective"); s.bound = numOr("bound"); s.timeS = numOr("time_s");
  s.makespan = numOr("makespan"); s.tardiness = numOr("tardiness");
  s.setupMode = r.value("setup_mode", std::string());
  s.calendarMode = r.value("calendar_mode", std::string());
  s.routing = r.value("routing", std::string());
  if (r.contains("starts") && r["starts"].is_array()) s.starts = r["starts"].get<std::vector<double>>();
  if (r.contains("machines") && r["machines"].is_array()) s.machines = r["machines"].get<std::vector<std::string>>();
  s.fromHint = s.status == "HINT";
  const bool solved = s.status == "OPTIMAL" || s.status == "FEASIBLE" || s.fromHint;
  if (!solved) {
    s.error = "Правило «CP-SAT»: решение не найдено (" + s.status + (s.error.empty() ? "" : ": " + s.error) + ").";
    return s;
  }
  if (s.starts.size() != nJobs || s.machines.size() != nJobs) {
    s.error = "Правило «CP-SAT»: размер решения не совпал с развёрткой джобов.";
    return s;
  }
  s.ok = true;
  return s;
}

Solution solve(const json& payload, double timeLimitS) {
  SolverFn fn;
  { std::lock_guard<std::mutex> lk(override_mu()); fn = override_fn(); }
  if (!fn) return solve_http(payload, timeLimitS);
  try { return parse_solution(fn(payload), payload.at("jobs").size()); }
  catch (std::exception& e) { return unavailable(std::string("Правило «CP-SAT»: ") + e.what()); }
}

sched::PinMap pins_from(const Solution& s, const sched::PinMap& userPins) {
  sched::PinMap pins;
  for (size_t i = 0; i < s.starts.size(); ++i) pins[(int)i] = { s.starts[i], s.machines[i] };
  for (auto& [i, pn] : userPins) pins[i] = pn;          // ручная правка важнее решения солвера
  return pins;
}

sched::PinMap machine_pins_from(const Solution& s, const sched::PinMap& userPins) {
  sched::PinMap pins;
  for (size_t i = 0; i < s.machines.size(); ++i)
    if (!s.machines[i].empty()) pins[(int)i] = { 0.0, s.machines[i] };
  for (auto& [i, pn] : userPins) pins[i] = pn;
  return pins;
}

std::vector<double> rank_key(const std::vector<double>& starts) {
  std::vector<int> idx(starts.size());
  std::iota(idx.begin(), idx.end(), 0);
  std::stable_sort(idx.begin(), idx.end(), [&](int a, int b) { return starts[a] < starts[b]; });
  std::vector<double> key(starts.size());
  for (size_t r = 0; r < idx.size(); ++r) key[idx[r]] = (double)r;
  return key;
}

std::vector<double> opkey_from_starts(const std::vector<double>& starts) {
  double mx = 0;
  for (double s : starts) mx = std::max(mx, s);
  std::vector<double> k(starts.size());
  for (size_t i = 0; i < starts.size(); ++i) k[i] = mx > 0 ? starts[i] / mx : 0.0;
  return k;
}

std::vector<double> opkey_from_key(const std::vector<double>& key) {
  const std::vector<double> r = rank_key(key);
  const double n = std::max<double>(1.0, (double)key.size() - 1.0);
  std::vector<double> k(r.size());
  for (size_t i = 0; i < r.size(); ++i) k[i] = r[i] / n;
  return k;
}

}  // namespace maos::cpsat
