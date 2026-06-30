#include "Scheduler.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <random>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace maos {
namespace {

double num(const json& j, const char* k, double def);   // определены ниже
std::string str(const json& j, const char* k);

/* ── Рабочий календарь: операции «растягиваются» через нерабочие интервалы ──
   Время — минуты от начала горизонта; день 0 = Пн 00:00. */
struct Calendar {
  std::array<std::vector<std::pair<int,int>>, 7> day;   // dow(0=Пн..6=Вс) → [start,end] мин дня
  bool any = false;
  // Ближайшая рабочая абсолютная минута ≥ t.
  double nextWork(double t) const {
    if (!any) return t;
    for (int g = 0; g < 21; ++g) {
      long abs = (long)std::floor(t); int dow = (int)(((abs / 1440) % 7 + 7) % 7); int mod = (int)(abs % 1440);
      for (auto& [s, e] : day[dow]) { if (mod < s) return (double)((abs / 1440) * 1440 + s); if (mod < e) return t; }
      t = (double)(((abs / 1440) + 1) * 1440);          // следующий день
    }
    return t;
  }
  // Финиш после накопления `work` рабочих минут начиная с t (с учётом нерабочих окон).
  double advance(double t, double work) const {
    if (!any) return t + work;
    t = nextWork(t); double rem = work;
    for (int g = 0; g < 4000 && rem > 1e-9; ++g) {
      long abs = (long)std::floor(t); int dow = (int)(((abs / 1440) % 7 + 7) % 7); int mod = (int)(abs % 1440);
      int end = -1; for (auto& [s, e] : day[dow]) if (mod >= s && mod < e) { end = e; break; }
      if (end < 0) { t = nextWork(t); continue; }
      double avail = (double)((abs / 1440) * 1440 + end) - t;
      if (avail >= rem) return t + rem;
      rem -= avail; t = nextWork((double)((abs / 1440) * 1440 + end));
    }
    return t;
  }
};

// Рабочих минут в [0, makespan] (фонд времени для загрузки/простоя ресурса).
double working_span(const Calendar& cal, double makespan) {
  if (!cal.any || makespan <= 0) return makespan > 0 ? makespan : 1;
  double w = 0; long days = (long)(makespan / 1440) + 1;
  for (long d = 0; d <= days; ++d) {
    int dow = (int)((d % 7 + 7) % 7);
    for (auto& [s, e] : cal.day[dow]) {
      double lo = std::max(0.0, d * 1440.0 + s), hi = std::min(makespan, d * 1440.0 + e);
      if (hi > lo) w += hi - lo;
    }
  }
  return w > 0 ? w : makespan;
}

Calendar load_calendar(Database& db, bool enabled) {
  Calendar c;
  if (!enabled) return c;
  auto sched = db.query_json("SELECT id FROM schedules WHERE is_default=1 LIMIT 1");
  if (sched.empty()) sched = db.query_json("SELECT id FROM schedules LIMIT 1");
  if (sched.empty()) return c;
  std::string sid = str(sched[0], "id");
  for (auto& s : db.query_json("SELECT day_of_week,start_min,end_min FROM shifts WHERE schedule_id=?", { sid })) {
    int dow = (int)num(s, "day_of_week", 1) - 1;        // 1..7 → 0..6
    if (dow < 0 || dow > 6) continue;
    int a = (int)num(s, "start_min", 0), b = (int)num(s, "end_min", 1440);
    if (b > a) { c.day[dow].push_back({ a, b }); c.any = true; }
  }
  return c;
}

double num(const json& j, const char* k, double def = 0) {
  if (!j.contains(k) || j[k].is_null()) return def;
  if (j[k].is_number()) return j[k].get<double>();
  const std::string s = j[k].get<std::string>();
  if (s.empty()) return def;
  try { return std::stod(s); } catch (...) { return def; }
}
std::string str(const json& j, const char* k) {
  if (!j.contains(k) || j[k].is_null()) return "";
  if (j[k].is_string()) return j[k].get<std::string>();
  return j[k].dump();
}

/* ── Доменные структуры ──────────────────────────────────────────────────── */
struct Op {
  std::string id, name, wcType;
  double tExp = 0, sigma = 0, setupTime = 0, riskCoef = 0.05;
  double hourRate = 0, laborRate = 0, tailWeight = 0.08, tailIndex = 2.5;
  int orderNo = 10;
  std::vector<std::pair<std::string,double>> inputs;  // (productId, qty)
};
struct Prod { double batchSize = 1, stock = 0, leadHours = 0; bool purchased = false; };

struct Model {
  std::unordered_map<std::string, Prod> prods;
  std::unordered_map<std::string, std::vector<Op>> opsOf;                 // product → ops
  std::unordered_map<std::string, std::vector<std::string>> machinesOf;  // wcType → machineIds
  std::unordered_map<std::string, std::string> machineName, machineWct, wcName, prodName;
  std::vector<std::pair<std::string,std::string>> workers;               // (id, name)
};

Model load_model(Database& db) {
  Model m;
  std::unordered_map<std::string,double> rate;
  for (auto& t : db.query_json("SELECT id,name,hour_rate FROM work_center_types")) {
    rate[str(t,"id")] = num(t,"hour_rate"); m.wcName[str(t,"id")] = str(t,"name");
  }
  for (auto& mc : db.query_json(
         "SELECT id,name,wc_type_id FROM machines WHERE status='active' "
         "AND wc_type_id IS NOT NULL AND wc_type_id<>''")) {
    m.machinesOf[str(mc,"wc_type_id")].push_back(str(mc,"id"));
    m.machineName[str(mc,"id")] = str(mc,"name"); m.machineWct[str(mc,"id")] = str(mc,"wc_type_id");
  }
  for (auto& p : db.query_json("SELECT id,name,batch_size,stock,purchased,lead_time_hours FROM products")) {
    Prod pr; pr.batchSize = std::max(1.0, num(p,"batch_size",1));
    pr.stock = num(p,"stock"); pr.purchased = num(p,"purchased") != 0; pr.leadHours = num(p,"lead_time_hours");
    m.prods[str(p,"id")] = pr;
    m.prodName[str(p,"id")] = str(p,"name");
  }
  for (auto& w : db.query_json("SELECT id,first_name,last_name FROM workers"))
    m.workers.push_back({ str(w,"id"), str(w,"last_name") + " " + str(w,"first_name") });

  auto opWct = [&](const std::string& opId) {
    auto r = db.query_json("SELECT wc_type_id FROM operation_wc_types WHERE operation_id=? LIMIT 1", { opId });
    return r.empty() ? std::string() : str(r[0], "wc_type_id");
  };
  for (auto& r : db.query_json("SELECT id,product_id FROM routings")) {
    std::string pid = str(r,"product_id"); if (pid.empty()) continue;
    for (auto& o : db.query_json(
           "SELECT * FROM operations WHERE routing_id=? ORDER BY order_no", { str(r,"id") })) {
      Op op; op.id = str(o,"id"); op.name = str(o,"name");
      double tOpt = num(o,"t_opt"), tNorm = num(o,"t_norm"), tPess = num(o,"t_pess");
      if (tOpt <= 0) tOpt = tNorm; if (tPess <= 0) tPess = tNorm;
      op.tExp = (tOpt + 4*tNorm + tPess) / 6.0; if (op.tExp <= 0) op.tExp = tNorm > 0 ? tNorm : 30;
      double s = (tPess - tOpt) / 6.0; op.sigma = s > 0 ? s : op.tExp * 0.15;
      op.setupTime = num(o,"setup_time"); op.riskCoef = num(o,"risk_coef",0.05);
      op.tailWeight = num(o,"tail_weight",0.08); op.tailIndex = std::max(1.2, num(o,"tail_index",2.5));
      op.orderNo = (int)num(o,"order_no",10); op.wcType = opWct(op.id);
      auto it = rate.find(op.wcType); op.hourRate = it != rate.end() ? it->second : 0;
      op.laborRate = num(o,"labor_rate");
      for (auto& in : db.query_json("SELECT product_id,qty FROM operation_inputs WHERE operation_id=?", { op.id }))
        op.inputs.push_back({ str(in,"product_id"), num(in,"qty",1) });
      m.opsOf[pid].push_back(op);
    }
  }
  return m;
}

/* ── Развёртка программы в граф операций (jobs) ───────────────────────────── */
struct Job {
  int orderIdx; std::string productId, opId, opName, wcType;
  double durMean, sigma, riskCoef, tailWeight, tailIndex, hourRate, laborRate, dueMin;
  std::vector<int> preds;
};

struct Expander {
  const Model& m; std::vector<Job>& jobs;
  std::unordered_map<std::string, std::vector<int>> lastJobs;   // key → batch-джобы последней операции
  std::unordered_set<std::string> visiting;

  // Число transfer-партий (lot-streaming): большой объём дробим, чтобы операции
  // ПЕРЕКРЫВАЛИСЬ во времени и шли на РАЗНЫХ станках параллельно (≈8 ед-экв на партию).
  static int nBatches(double sizeFactor) {
    int n = (int)std::ceil(sizeFactor / 8.0);
    return std::max(1, std::min(20, n));
  }

  // Возвращает batch-джобы ПОСЛЕДНЕЙ операции изделия (для побатчевой стыковки с потребителем).
  std::vector<int> expand(int orderIdx, const std::string& pid, double mult, double dueMin, int depth = 0) {
    if (depth > 64) return {};
    std::string key = std::to_string(orderIdx) + "#" + pid;
    if (auto it = lastJobs.find(key); it != lastJobs.end()) return it->second;
    if (visiting.count(key)) return {};                       // цикл цепочки
    auto oit = m.opsOf.find(pid);
    if (oit == m.opsOf.end() || oit->second.empty()) { lastJobs[key] = {}; return {}; }
    visiting.insert(key);
    double batch = m.prods.count(pid) ? m.prods.at(pid).batchSize : 1;
    double sizeFactor = std::max(1.0, mult / batch);
    int N = (jobs.size() > 6000) ? 1 : nBatches(sizeFactor);   // защита от взрыва числа джобов

    std::vector<int> prevBatch;                               // batch-джобы предыдущей операции
    for (const Op& o : oit->second) {
      // Входы BOM — раскрыть один раз; стыкуем ПОБАТЧЕВО (партия k ← партия входа).
      std::vector<std::vector<int>> ins;
      for (auto& [q, qty] : o.inputs) {
        auto v = expand(orderIdx, q, mult * qty, dueMin, depth + 1);
        if (!v.empty()) ins.push_back(v);
      }
      std::vector<int> curBatch(N);
      for (int k = 0; k < N; ++k) {
        Job j; j.orderIdx = orderIdx; j.productId = pid; j.opId = o.id; j.opName = o.name;
        j.wcType = o.wcType;
        j.durMean = (k == 0 ? o.setupTime : 0.0) + o.tExp * sizeFactor / N;   // работа делится, наладка — раз
        j.sigma = o.sigma * std::sqrt(std::max(1.0, sizeFactor / N));
        j.riskCoef = o.riskCoef; j.tailWeight = o.tailWeight; j.tailIndex = o.tailIndex;
        j.hourRate = o.hourRate; j.laborRate = o.laborRate; j.dueMin = dueMin;
        if (!prevBatch.empty()) j.preds.push_back(prevBatch[k]);              // тот же batch пред. операции
        for (auto& v : ins) j.preds.push_back(v[std::min((int)v.size() - 1, k * (int)v.size() / N)]);
        curBatch[k] = (int)jobs.size(); jobs.push_back(j);
      }
      prevBatch = std::move(curBatch);
    }
    visiting.erase(key); lastJobs[key] = prevBatch; return prevBatch;
  }
};

double sample_dur(const Job& j, double twOverride, std::mt19937& rng) {
  double mean = std::max(0.5, j.durMean), cv = j.sigma / mean;
  double sl = std::sqrt(std::log(1.0 + cv * cv)), mu = std::log(mean) - 0.5 * sl * sl;
  std::normal_distribution<double> n(0, 1); std::uniform_real_distribution<double> u(0, 1);
  double d = std::exp(mu + std::max(1e-6, sl) * n(rng));
  double tw = twOverride >= 0 ? twOverride : j.tailWeight;
  if (u(rng) < tw) { double f = std::pow(std::max(1e-9, 1.0 - u(rng)), -1.0 / j.tailIndex);
                     d *= 1.0 + std::min(8.0, f - 1.0); }            // тяжёлый хвост (Парето)
  if (u(rng) < j.riskCoef) d += 0.5 * mean;                          // брак/переделка
  return std::max(0.1, d);
}

std::vector<double> priorities(const std::string& rule, const std::vector<Job>& jobs,
                               const std::vector<double>& orderWork) {
  size_t J = jobs.size(); std::vector<double> key(J, 0);
  for (size_t i = 0; i < J; ++i) {
    const Job& j = jobs[i]; double ow = orderWork[j.orderIdx] > 0 ? orderWork[j.orderIdx] : 1;
    if (rule == "SPT")       key[i] = j.durMean;
    else if (rule == "LPT")  key[i] = -j.durMean;
    else if (rule == "EDD")  key[i] = j.dueMin;
    else if (rule == "CR")   key[i] = j.dueMin / ow;
    else if (rule == "MWKR") key[i] = -ow;
    else if (rule == "MS")   key[i] = j.dueMin - ow;
    else                     key[i] = j.orderIdx * 1e6 + (double)i;   // FIFO
  }
  return key;
}

/* ── Симуляция (списочное планирование) ───────────────────────────────────── */
struct SimOut {
  std::vector<double> start, end; std::vector<std::string> machineId; std::vector<int> worker;
  double makespan = 0;
  std::unordered_map<std::string,double> busyByMachine; std::vector<double> busyByWorker;
};

SimOut simulate(const Model& m, const std::vector<Job>& jobs,
                const std::vector<double>& key, const std::vector<double>& dur,
                const Calendar& cal) {
  size_t J = jobs.size(); SimOut o;
  o.start.assign(J,0); o.end.assign(J,0); o.machineId.assign(J,""); o.worker.assign(J,-1);
  o.busyByWorker.assign(m.workers.size(), 0);
  std::unordered_map<std::string,double> mFree; std::vector<double> wFree(m.workers.size(), 0);
  std::vector<char> done(J,0); size_t sched = 0;
  while (sched < J) {
    int best = -1; double bk = 1e300;
    for (size_t i = 0; i < J; ++i) {
      if (done[i]) continue; bool ready = true;
      for (int p : jobs[i].preds) if (!done[p]) { ready = false; break; }
      if (ready && key[i] < bk) { bk = key[i]; best = (int)i; }
    }
    if (best < 0) for (size_t i = 0; i < J; ++i) if (!done[i]) { best = (int)i; break; }
    const Job& j = jobs[best];
    double readyT = 0; for (int p : j.preds) readyT = std::max(readyT, o.end[p]);
    std::string chosenM; double mfree = 0;
    if (auto it = m.machinesOf.find(j.wcType); it != m.machinesOf.end() && !it->second.empty()) {
      double bm = 1e300;
      for (auto& mid : it->second) { double f = mFree.count(mid)?mFree[mid]:0; if (f < bm) { bm = f; chosenM = mid; } }
      mfree = bm;
    }
    int wi = -1; double wfree = 0;
    if (!m.workers.empty()) { double bw = 1e300;
      for (size_t w = 0; w < wFree.size(); ++w) if (wFree[w] < bw) { bw = wFree[w]; wi = (int)w; }
      wfree = bw; }
    double st = cal.nextWork(std::max(readyT, std::max(mfree, wfree)));  // снап к рабочему времени
    double en = cal.advance(st, dur[best]);                              // финиш с учётом смен
    o.start[best] = st; o.end[best] = en; o.machineId[best] = chosenM; o.worker[best] = wi;
    if (!chosenM.empty()) mFree[chosenM] = en, o.busyByMachine[chosenM] += dur[best];
    if (wi >= 0) wFree[wi] = en, o.busyByWorker[wi] += dur[best];
    o.makespan = std::max(o.makespan, en); done[best] = 1; ++sched;
  }
  return o;
}

double order_tardiness(const std::vector<Job>& jobs, const SimOut& o, int nOrders,
                       const std::vector<double>& due, int& nLate) {
  std::vector<double> fin(nOrders, 0);
  for (size_t i = 0; i < jobs.size(); ++i) fin[jobs[i].orderIdx] = std::max(fin[jobs[i].orderIdx], o.end[i]);
  double t = 0; nLate = 0;
  for (int k = 0; k < nOrders; ++k) { double late = std::max(0.0, fin[k] - due[k]); t += late; if (late > 1e-6) ++nLate; }
  return t;
}

double cvar_upper(std::vector<double> v, double alpha) {  // среднее ХУДШИХ (больших) alpha
  if (v.empty()) return 0; std::sort(v.begin(), v.end());
  size_t k = std::max<size_t>(1, (size_t)std::floor(alpha * v.size())); double s = 0;
  for (size_t i = v.size() - k; i < v.size(); ++i) s += v[i]; return s / k;
}
double mean_of(const std::vector<double>& v) { double s = 0; for (double x : v) s += x; return v.empty()?0:s/v.size(); }

}  // namespace

/* ── Главная процедура ───────────────────────────────────────────────────── */
json run_schedule(Database& db, const ScheduleParams& p) {
  Model m = load_model(db);
  Calendar cal = load_calendar(db, p.useCalendar);   // рабочий календарь (смены/выходные)
  json warnings = json::array();

  // ── Программа: из запроса / из портфеля прогона / демо ──
  std::vector<OrderLine> program = p.program;
  if (program.empty() && !p.runId.empty()) {   // программа из портфеля Стадии 2
    auto rows = db.query_json(
      "SELECT pi.product_id AS pid, pi.qty AS qty FROM portfolios pf "
      "JOIN portfolio_items pi ON pi.portfolio_id=pf.id "
      "WHERE pf.run_id=? AND pf.kind='robust'", { p.runId });
    for (auto& r : rows) program.push_back({ str(r,"pid"), num(r,"qty"), 0 });
  }
  if (program.empty()) {                       // программа из реестра заказов
    for (auto& r : db.query_json(
           "SELECT product_id,quantity,due_hours FROM demand_orders "
           "WHERE status<>'done' ORDER BY priority, due_hours"))
      program.push_back({ str(r,"product_id"), num(r,"quantity",1), num(r,"due_hours") });
  }
  if (program.empty()) {                       // демо-программа из готовых SKU
    const std::vector<std::pair<std::string,double>> demo = {
      {"fin-reb",180},{"fin-galv",120},{"fin-cold",150},{"fin-s235",160},
      {"fin-pnt",90},{"prod-hrc",100},
    };
    for (size_t i = 0; i < demo.size(); ++i)
      if (m.opsOf.count(demo[i].first)) program.push_back({ demo[i].first, demo[i].second, 0 });
  }
  if (program.empty()) return { {"error_soft", true},
    {"warnings", json::array({"Нет изделий с техкартами для планирования."})} };

  // Сроки заказов (если не заданы) — равномерно по «ожидаемому» горизонту.
  int nOrders = (int)program.size();
  std::vector<double> due(nOrders);

  // ── Развёртка в граф операций ──
  std::vector<Job> jobs;
  Expander ex{ m, jobs };
  for (int k = 0; k < nOrders; ++k)
    ex.expand(k, program[k].productId, std::max(1.0, program[k].qty), 1e12);  // due проставим ниже
  if (jobs.empty()) return { {"error_soft", true},
    {"warnings", json::array({"Программа не развернулась в операции (нет техкарт)."})} };

  // ── Дефицит сырья → операция «Поставка/подготовка» как предшественник заказа ──
  // Считаем потребность в покупном сырье по всей программе; для дефицитных
  // (потребность > остаток) добавляем срок поставки как отдельную подготовительную
  // операцию перед началом заказа (см. «Требования к запасам»).
  {
    std::unordered_map<std::string, double> matNeed;
    std::function<void(const std::string&, double, std::unordered_set<std::string>&, int)> reqf =
      [&](const std::string& pid, double mult, std::unordered_set<std::string>& vis, int depth) {
        if (depth > 64 || vis.count(pid)) return;             // защита от глубокой/циклической вложенности
        vis.insert(pid);
        if (auto it = m.opsOf.find(pid); it != m.opsOf.end())
          for (auto& o : it->second) for (auto& in : o.inputs) {
            matNeed[in.first] += mult * in.second; reqf(in.first, mult * in.second, vis, depth + 1);
          }
        vis.erase(pid);
      };
    for (auto& ol : program) { std::unordered_set<std::string> vis; reqf(ol.productId, std::max(1.0, ol.qty), vis, 0); }
    double supplyLead = 0; json shortJson = json::array();
    for (auto& [mid, need] : matNeed) {
      auto pit = m.prods.find(mid);
      if (pit != m.prods.end() && pit->second.purchased && need > pit->second.stock) {
        supplyLead = std::max(supplyLead, pit->second.leadHours);
        shortJson.push_back(m.prodName.count(mid) ? m.prodName[mid] : mid);
      }
    }
    if (supplyLead > 0) {
      for (int k = 0; k < nOrders; ++k) {
        Job sj; sj.orderIdx = k; sj.productId = "supply"; sj.opId = "supply";
        sj.opName = "Поставка/подготовка сырья"; sj.wcType = "";
        sj.durMean = supplyLead * 60.0; sj.sigma = supplyLead * 60.0 * 0.2;
        sj.riskCoef = 0.05; sj.tailWeight = 0.12; sj.tailIndex = 2.0;
        sj.hourRate = 0; sj.laborRate = 0; sj.dueMin = 1e12;
        int sjIdx = (int)jobs.size(); jobs.push_back(sj);
        for (size_t j = 0; j < jobs.size(); ++j)
          if (jobs[j].orderIdx == k && (int)j != sjIdx && jobs[j].preds.empty())
            jobs[j].preds.push_back(sjIdx);
      }
    }
  }

  // Работа по заказам + грубая оценка горизонта для дедлайнов.
  std::vector<double> orderWork(nOrders, 0);
  for (auto& j : jobs) orderWork[j.orderIdx] += j.durMean;
  double totalWork = 0; for (double w : orderWork) totalWork += w;
  double horizon = totalWork;  // груб. верхняя граница (мин)
  for (int k = 0; k < nOrders; ++k) {
    due[k] = program[k].dueHours > 0 ? program[k].dueHours * 60.0
                                     : horizon * (0.45 + 0.55 * (k + 1.0) / nOrders);
  }
  for (auto& j : jobs) j.dueMin = due[j.orderIdx];

  // ── Перебор диспетч-правил (старт), оценка симуляцией + Монте-Карло (хвост) ──
  std::vector<std::string> rules = { "EDD", "SPT", "CR", "MWKR", "MS", "FIFO", "LPT" };
  if (p.rule != "auto") rules = { p.rule };
  const int N = std::max(100, p.samples);
  std::mt19937 rng(p.seed);

  // Заранее сэмплируем длительности по прогонам (общие для всех правил — честно).
  std::vector<std::vector<double>> durMC(N, std::vector<double>(jobs.size()));
  for (int s = 0; s < N; ++s)
    for (size_t i = 0; i < jobs.size(); ++i) durMC[s][i] = sample_dur(jobs[i], p.tailWeight, rng);
  std::vector<double> durMean(jobs.size());
  for (size_t i = 0; i < jobs.size(); ++i) durMean[i] = jobs[i].durMean;

  struct RuleEval { std::string rule; double mkDet, mkMean, mkCVaR, mkWorst, tardMean, tardCVaR, score; };
  std::vector<RuleEval> evals;
  for (auto& rule : rules) {
    auto key = priorities(rule, jobs, orderWork);
    SimOut det = simulate(m, jobs, key, durMean, cal);
    int nl; double tardDet = order_tardiness(jobs, det, nOrders, due, nl);
    std::vector<double> mks(N), tards(N);
    for (int s = 0; s < N; ++s) {
      SimOut so = simulate(m, jobs, key, durMC[s], cal);
      mks[s] = so.makespan; int nl2; tards[s] = order_tardiness(jobs, so, nOrders, due, nl2);
    }
    RuleEval e; e.rule = rule; e.mkDet = det.makespan;
    e.mkMean = mean_of(mks); e.mkCVaR = cvar_upper(mks, p.alpha);
    e.mkWorst = *std::max_element(mks.begin(), mks.end());
    e.tardMean = mean_of(tards); e.tardCVaR = cvar_upper(tards, p.alpha);
    // Целевая F: время (с риском по хвосту) + просрочка.
    e.score = p.wTime * e.mkMean + p.wRisk * (e.mkCVaR - e.mkMean) + 0.5 * e.tardMean
              + 0.001 * tardDet;
    evals.push_back(e);
  }
  size_t bestR = 0; for (size_t i = 1; i < evals.size(); ++i) if (evals[i].score < evals[bestR].score) bestR = i;
  const std::string chosenRule = evals[bestR].rule;

  // ── Детальное расписание выбранного правила (по средним — для Ганта) ──
  auto key = priorities(chosenRule, jobs, orderWork);
  SimOut sched = simulate(m, jobs, key, durMean, cal);
  double makespan = sched.makespan;
  int nLate = 0; double tardiness = order_tardiness(jobs, sched, nOrders, due, nLate);

  auto H = [](double minutes) { return minutes / 60.0; };  // мин → часы

  // Гантт.
  json gantt = json::array();
  for (size_t i = 0; i < jobs.size(); ++i) {
    const Job& j = jobs[i];
    bool late = sched.end[i] > j.dueMin + 1e-6;
    bool isSupply = j.productId == "supply";
    std::string mid = isSupply ? "supply" : sched.machineId[i];
    std::string mname = isSupply ? "Снабжение/поставка"
      : (m.machineName.count(sched.machineId[i]) ? m.machineName[sched.machineId[i]] : "");
    gantt.push_back({
      {"order_idx", j.orderIdx}, {"product_id", j.productId},
      {"product_name", isSupply ? "—" : (m.prodName.count(j.productId)?m.prodName[j.productId]:j.productId)},
      {"op_id", j.opId}, {"op_name", j.opName},
      {"wc_type_id", j.wcType}, {"wc_name", m.wcName.count(j.wcType)?m.wcName[j.wcType]:j.wcType},
      {"machine_id", mid}, {"machine_name", mname},
      {"worker", sched.worker[i]},
      {"start", H(sched.start[i])}, {"end", H(sched.end[i])},
      {"due", H(j.dueMin)}, {"late", late},
    });
  }

  // Загрузка станков + простои. Фонд = рабочее время в [0, makespan] (без выходных/смен).
  double fond = working_span(cal, makespan);
  json machineLoad = json::array(); double totalBusy = 0, totalCap = 0;
  std::unordered_map<std::string,double> wcBusy, wcCap;
  for (auto& [wct, mids] : m.machinesOf) for (auto& mid : mids) {
    double busy = sched.busyByMachine.count(mid)?sched.busyByMachine[mid]:0;
    double util = fond > 0 ? busy / fond : 0;
    machineLoad.push_back({ {"machine_id", mid}, {"machine_name", m.machineName[mid]},
      {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(busy)}, {"idle_hours", H(std::max(0.0, fond - busy))}, {"utilization", util} });
    totalBusy += busy; totalCap += fond; wcBusy[wct] += busy; wcCap[wct] += fond;
  }
  json wcLoad = json::array(); std::string bottleneck; double bnUtil = -1;
  for (auto& [wct, cap] : wcCap) {
    double util = cap > 0 ? wcBusy[wct] / cap : 0;
    wcLoad.push_back({ {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(wcBusy[wct])}, {"idle_hours", H(cap - wcBusy[wct])}, {"utilization", util} });
    if (util > bnUtil) { bnUtil = util; bottleneck = wct; }
  }

  // Планы рабочих + простои людей.
  json workerPlan = json::array();
  for (size_t w = 0; w < m.workers.size(); ++w) {
    json js = json::array(); int cnt = 0;
    for (size_t i = 0; i < jobs.size(); ++i) if (sched.worker[i] == (int)w) {
      js.push_back({ {"op_name", jobs[i].opName}, {"product_id", jobs[i].productId},
        {"start", H(sched.start[i])}, {"end", H(sched.end[i])} }); ++cnt;
    }
    double busy = w < sched.busyByWorker.size() ? sched.busyByWorker[w] : 0;
    workerPlan.push_back({ {"worker_id", m.workers[w].first}, {"name", m.workers[w].second},
      {"jobs", js}, {"job_count", cnt}, {"busy_hours", H(busy)},
      {"idle_hours", H(makespan - busy)}, {"utilization", makespan>0?busy/makespan:0} });
  }

  json rulesJson = json::array();
  for (auto& e : evals) rulesJson.push_back({
    {"rule", e.rule}, {"makespan", H(e.mkMean)}, {"makespan_cvar", H(e.mkCVaR)},
    {"makespan_worst", H(e.mkWorst)}, {"tardiness", H(e.tardMean)}, {"score", e.score},
    {"chosen", e.rule == chosenRule} });

  const RuleEval& be = evals[bestR];
  double cost = 0; for (size_t i = 0; i < jobs.size(); ++i)
    cost += (durMean[i] / 60.0) * (jobs[i].hourRate + jobs[i].laborRate);

  json programJson = json::array();
  for (int k = 0; k < nOrders; ++k) programJson.push_back({
    {"product_id", program[k].productId},
    {"product_name", m.prodName.count(program[k].productId)?m.prodName[program[k].productId]:program[k].productId},
    {"qty", program[k].qty}, {"due_hours", H(due[k])} });

  json result = {
    {"rule", chosenRule}, {"samples", N}, {"alpha", p.alpha},
    {"weights", { {"time", p.wTime}, {"cost", p.wCost}, {"risk", p.wRisk} }},
    {"n_orders", nOrders}, {"n_jobs", (int)jobs.size()}, {"n_machines", (int)m.machineName.size()},
    {"n_workers", (int)m.workers.size()},
    {"program", programJson}, {"gantt", gantt},
    {"machine_load", machineLoad}, {"wc_load", wcLoad}, {"worker_plan", workerPlan},
    {"bottleneck", { {"wc_type_id", bottleneck}, {"wc_name", m.wcName.count(bottleneck)?m.wcName[bottleneck]:bottleneck},
                     {"utilization", bnUtil} }},
    {"idle", { {"machine_idle_hours", H(totalCap - totalBusy)},
               {"machine_utilization", totalCap>0?totalBusy/totalCap:0} }},
    {"calendar", { {"enabled", cal.any}, {"work_fond_hours", H(fond)} }},
    {"kpi", {
      {"makespan", H(makespan)}, {"makespan_mean", H(be.mkMean)}, {"makespan_cvar", H(be.mkCVaR)},
      {"makespan_worst", H(be.mkWorst)}, {"tardiness", H(tardiness)}, {"tardiness_cvar", H(be.tardCVaR)},
      {"n_late", nLate}, {"otd", nOrders>0 ? (double)(nOrders - nLate) / nOrders : 1.0},
      {"utilization", totalCap>0?totalBusy/totalCap:0}, {"cost", cost} }},
    {"rules", rulesJson}, {"warnings", warnings},
  };
  return result;
}

}  // namespace maos
