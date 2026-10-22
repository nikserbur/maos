#include "Scheduler.h"
#include "GaImprover.h"
#include "PlanMath.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <queue>
#include <random>
#include <cctype>
#include <thread>
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
  std::string id, name, wcType;                        // wcType = ведущий (для отчётов)
  std::vector<std::string> wcTypes;                    // ВСЕ допустимые типы (FJSP)
  double tExp = 0, sigma = 0, setupTime = 0, riskCoef = 0.05;
  double hourRate = 0, laborRate = 0, tailWeight = 0.08, tailIndex = 2.5;
  int orderNo = 10;
  std::vector<std::pair<std::string,double>> inputs;  // (productId, qty)
};
struct Prod { double batchSize = 1, stock = 0, leadHours = 0; bool purchased = false; };

struct WorkerInfo {
  std::string id, name;
  std::vector<std::string> skills;   // токены компетенций (имена/ID типов РЦ), lowercase
  double costPerHour = 0;
};

struct Model {
  std::unordered_map<std::string, Prod> prods;
  std::unordered_map<std::string, std::vector<Op>> opsOf;                 // product → ops
  std::unordered_map<std::string, std::vector<std::string>> machinesOf;  // wcType → machineIds
  std::unordered_map<std::string, std::string> machineName, machineWct, wcName, prodName;
  std::unordered_map<std::string, std::string> machineSched;             // станок → график ('8x5'…)
  // Надёжность/обслуживание по ТИПУ: MTBF (ч, при полной загрузке), средний
  // ремонт (ч), интервал ТО по наработке (ч) и длительность ТО (ч).
  struct WctRisk { double mtbf = 0, repairH = 0, mtbm = 0, maintH = 0; };
  std::unordered_map<std::string, WctRisk> wctRisk;
  std::vector<WorkerInfo> workers;
  // Матрица компетенций: тип РЦ → индексы допущенных рабочих (пусто = любой).
  std::unordered_map<std::string, std::vector<int>> eligibleWorkers;
};

static std::string lower(std::string s) {
  for (char& c : s) c = (char)std::tolower((unsigned char)c);
  return s;
}

Model load_model(Database& db) {
  Model m;
  std::unordered_map<std::string,double> rate;
  for (auto& t : db.query_json(
         "SELECT id,name,hour_rate,mtbf_hours,repair_hours,mtbm_hours,maintenance_hours "
         "FROM work_center_types")) {
    rate[str(t,"id")] = num(t,"hour_rate"); m.wcName[str(t,"id")] = str(t,"name");
    Model::WctRisk rk;
    rk.mtbf = num(t,"mtbf_hours"); rk.repairH = num(t,"repair_hours");
    rk.mtbm = num(t,"mtbm_hours"); rk.maintH  = num(t,"maintenance_hours");
    if (rk.mtbf > 0 || rk.mtbm > 0) m.wctRisk[str(t,"id")] = rk;
  }
  for (auto& mc : db.query_json(
         "SELECT id,name,wc_type_id,schedule FROM machines WHERE status='active' "
         "AND wc_type_id IS NOT NULL AND wc_type_id<>''")) {
    m.machinesOf[str(mc,"wc_type_id")].push_back(str(mc,"id"));
    m.machineName[str(mc,"id")] = str(mc,"name"); m.machineWct[str(mc,"id")] = str(mc,"wc_type_id");
    const std::string sch = str(mc,"schedule");
    if (!sch.empty()) m.machineSched[str(mc,"id")] = sch;   // индивидуальный график
  }
  for (auto& p : db.query_json("SELECT id,name,batch_size,stock,purchased,lead_time_hours FROM products")) {
    Prod pr; pr.batchSize = std::max(1.0, num(p,"batch_size",1));
    pr.stock = num(p,"stock"); pr.purchased = num(p,"purchased") != 0; pr.leadHours = num(p,"lead_time_hours");
    m.prods[str(p,"id")] = pr;
    m.prodName[str(p,"id")] = str(p,"name");
  }
  for (auto& w : db.query_json("SELECT id,first_name,last_name,skills,cost_per_hour FROM workers")) {
    WorkerInfo wi; wi.id = str(w,"id");
    wi.name = str(w,"last_name") + " " + str(w,"first_name");
    wi.costPerHour = num(w,"cost_per_hour");
    // Компетенции — CSV токенов (имена/ID типов РЦ); пусто = универсал.
    std::string raw = str(w,"skills");
    size_t pos = 0;
    while (pos < raw.size()) {
      size_t c = raw.find(',', pos);
      std::string tok = raw.substr(pos, c == std::string::npos ? std::string::npos : c - pos);
      size_t a = tok.find_first_not_of(" \t"), b = tok.find_last_not_of(" \t");
      if (a != std::string::npos) wi.skills.push_back(lower(tok.substr(a, b - a + 1)));
      if (c == std::string::npos) break; pos = c + 1;
    }
    m.workers.push_back(std::move(wi));
  }

  // Связи операций — двумя запросами на всю модель (было 2 SQL на каждую операцию).
  // Загружаем ВСЕ допустимые типы (FJSP): операция может исполняться на любом из
  // них — раньше брался только первый, и альтернативная мощность простаивала.
  std::unordered_map<std::string, std::vector<std::string>> wctsOf;
  for (auto& r : db.query_json(
         "SELECT operation_id, wc_type_id FROM operation_wc_types ORDER BY rowid"))
    wctsOf[str(r,"operation_id")].push_back(str(r,"wc_type_id"));
  std::unordered_map<std::string, std::vector<std::pair<std::string,double>>> inputsOf;
  for (auto& r : db.query_json("SELECT operation_id, product_id, qty FROM operation_inputs"))
    inputsOf[str(r,"operation_id")].push_back({ str(r,"product_id"), num(r,"qty",1) });

  // Нормы «операция × тип» (time_norms): при наличии пары норма берётся из неё,
  // а не из плоских полей операции (ТЗ «Время выполнения операции» §2).
  struct PairNorm { double tOpt, tNorm, tPess, setup; };
  std::unordered_map<std::string, PairNorm> normOf;   // "opId|wctId" → норма пары
  for (auto& r : db.query_json("SELECT * FROM time_norms"))
    normOf[str(r,"operation_id") + "|" + str(r,"wc_type_id")] =
      { num(r,"t_opt"), num(r,"t_norm"), num(r,"t_pess"), num(r,"setup_time") };

  for (auto& o : db.query_json(
         "SELECT o.*, r.product_id AS product_of FROM routings r "
         "JOIN operations o ON o.routing_id = r.id "
         "WHERE r.product_id IS NOT NULL AND r.product_id <> '' "
         "AND COALESCE(r.is_default,1)=1 "               // действующая версия техкарты
         "ORDER BY r.product_id, o.order_no, o.id")) {
    std::string pid = str(o,"product_of");
    Op op; op.id = str(o,"id"); op.name = str(o,"name");
    double tOpt = num(o,"t_opt"), tNorm = num(o,"t_norm"), tPess = num(o,"t_pess");
    if (tOpt <= 0) tOpt = tNorm; if (tPess <= 0) tPess = tNorm;
    op.tExp = (tOpt + 4*tNorm + tPess) / 6.0; if (op.tExp <= 0) op.tExp = tNorm > 0 ? tNorm : 30;
    double s = (tPess - tOpt) / 6.0; op.sigma = s > 0 ? s : op.tExp * 0.15;
    op.setupTime = num(o,"setup_time"); op.riskCoef = num(o,"risk_coef",0.05);
    op.tailWeight = num(o,"tail_weight",0.08); op.tailIndex = std::max(1.2, num(o,"tail_index",2.5));
    op.orderNo = (int)num(o,"order_no",10);
    if (auto w = wctsOf.find(op.id); w != wctsOf.end()) op.wcTypes = w->second;
    op.wcType = op.wcTypes.empty() ? std::string() : op.wcTypes.front();
    // Норма пары для ведущего типа перекрывает плоскую норму операции.
    if (auto nit = normOf.find(op.id + "|" + op.wcType); nit != normOf.end()) {
      const PairNorm& pn = nit->second;
      double o2 = pn.tOpt > 0 ? pn.tOpt : pn.tNorm, p2 = pn.tPess > 0 ? pn.tPess : pn.tNorm;
      if (pn.tNorm > 0) {
        op.tExp = (o2 + 4*pn.tNorm + p2) / 6.0;
        double s2 = (p2 - o2) / 6.0; op.sigma = s2 > 0 ? s2 : op.tExp * 0.15;
      }
      if (pn.setup > 0) op.setupTime = pn.setup;
    }
    auto it = rate.find(op.wcType); op.hourRate = it != rate.end() ? it->second : 0;
    op.laborRate = num(o,"labor_rate");
    if (auto i2 = inputsOf.find(op.id); i2 != inputsOf.end()) op.inputs = i2->second;
    m.opsOf[pid].push_back(std::move(op));
  }

  // Матрица компетенций: рабочий допущен к типу РЦ, если его skills пусты
  // (универсал) или содержат имя/ID типа. Пустой список по типу → допущены все.
  for (auto& [wct, mids] : m.machinesOf) {
    const std::string nm = lower(m.wcName.count(wct) ? m.wcName.at(wct) : wct);
    const std::string idl = lower(wct);
    std::vector<int> elig;
    for (size_t w = 0; w < m.workers.size(); ++w) {
      const auto& sk = m.workers[w].skills;
      if (sk.empty()) { elig.push_back((int)w); continue; }
      for (const std::string& t : sk)
        if (t == nm || t == idl || (t.size() > 3 && nm.find(t) != std::string::npos)) {
          elig.push_back((int)w); break;
        }
    }
    if (!elig.empty() && elig.size() < m.workers.size())
      m.eligibleWorkers[wct] = std::move(elig);
  }
  return m;
}

/* Индивидуальный график станка из строки machines.schedule: '8x5' (пн-пт 8ч),
   '12x2' (ежедневно 12ч), '24x7' (круглосуточно). Возвращает false, если график
   не распознан (пусто/прочее) → станок работает по общему календарю.
   B4: '24x7' распознаётся ЯВНО и даёт календарь без ограничений (any=false —
   работа круглосуточно); раньше он возвращал any=false как «не задан» и станок
   молча падал на общий сменный календарь. */
bool machine_calendar(std::string sched, Calendar& c) {
  c = Calendar{};
  sched.erase(0, sched.find_first_not_of(" \t"));
  sched.erase(sched.find_last_not_of(" \t") + 1);
  for (char& ch : sched) ch = (char)std::tolower((unsigned char)ch);
  if (sched == "8x5") {
    for (int d = 0; d < 5; ++d) c.day[d].push_back({ 480, 960 });     // 08:00–16:00
    c.any = true;
    return true;
  }
  if (sched == "12x2") {
    for (int d = 0; d < 7; ++d) c.day[d].push_back({ 480, 1200 });    // 08:00–20:00
    c.any = true;
    return true;
  }
  if (sched == "24x7" || sched == "24/7") return true;                // круглосуточно
  return false;
}

/* ── Развёртка программы в граф операций (jobs) ───────────────────────────── */
struct Job {
  int orderIdx; std::string productId, opId, opName, wcType;
  std::vector<std::string> wcTypes;                    // допустимые типы станков (FJSP)
  double durMean, sigma, riskCoef, tailWeight, tailIndex, hourRate, laborRate, dueMin;
  double setupTime = 0;                                // наладка при смене изделия на станке
  double batches = 1;                                  // партий (batch_size) в этой джобе
  int nInputs = 0;                                     // входных материалов у операции
  bool needsWorker = true;                             // B3: false у «поставки» (только lead time)
  std::vector<int> preds;
};

struct Expander {
  const Model& m; std::vector<Job>& jobs;
  std::unordered_set<std::string> visiting;                    // защита от циклов BOM

  // Число transfer-партий = ОБЪЁМ / РАЗМЕР ПАРТИИ изделия (sizeFactor = mult/batchSize):
  // каждая партия проходит операции и сразу «течёт» к следующей на свободном станке.
  // Ограничено 30 для трактуемости (при большем — одна джоба = несколько партий).
  static int nBatches(double sizeFactor) {
    int n = (int)std::lround(sizeFactor);
    return std::max(1, std::min(16, n));   // потолок для трактуемости/скорости планирования
  }

  // Возвращает batch-джобы ПОСЛЕДНЕЙ операции изделия (для побатчевой стыковки с потребителем).
  // B2: каждое потребление раскрывается СВОЕЙ партией ровно на свой объём `mult`.
  // Раньше результат запоминался по ключу «заказ#изделие», и второе потребление того же
  // полуфабриката в заказе (другая операция/ветка BOM) повторно использовало первую
  // развёртку — с ЕЁ объёмом: работа второго потребления терялась.
  std::vector<int> expand(int orderIdx, const std::string& pid, double mult, double dueMin, int depth = 0) {
    if (depth > 64) return {};
    std::string key = std::to_string(orderIdx) + "#" + pid;
    if (visiting.count(key)) return {};                       // цикл цепочки
    auto oit = m.opsOf.find(pid);
    if (oit == m.opsOf.end() || oit->second.empty()) return {};
    visiting.insert(key);
    double batch = m.prods.count(pid) ? m.prods.at(pid).batchSize : 1;
    double sizeFactor = std::max(1.0, mult / batch);
    int N = (jobs.size() > 4000) ? 1 : nBatches(sizeFactor);   // защита от взрыва числа джобов

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
        j.wcType = o.wcType; j.wcTypes = o.wcTypes;
        j.durMean = o.tExp * sizeFactor / N;          // работа делится по партиям
        j.batches = sizeFactor / N;                   // масштаб джобы (для калибровки НСИ)
        j.setupTime = o.setupTime;                    // наладка — в simulate при смене изделия
        j.sigma = o.sigma * std::sqrt(std::max(1.0, sizeFactor / N));
        j.riskCoef = o.riskCoef; j.tailWeight = o.tailWeight; j.tailIndex = o.tailIndex;
        j.nInputs = (int)o.inputs.size();
        j.hourRate = o.hourRate; j.laborRate = o.laborRate; j.dueMin = dueMin;
        if (!prevBatch.empty()) j.preds.push_back(prevBatch[k]);              // тот же batch пред. операции
        // B1: партия k ждёт ПОСЛЕДНЮЮ нужную ей входную партию ⌈(k+1)·L/N⌉−1
        // (раньше — первую, k·L/N: при L>N потребитель стартовал раньше входов).
        for (auto& v : ins) j.preds.push_back(v[planmath::lot_input_index(k, N, (int)v.size())]);
        curBatch[k] = (int)jobs.size(); jobs.push_back(j);
      }
      prevBatch = std::move(curBatch);
    }
    visiting.erase(key); return prevBatch;
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

using CustomRule = std::vector<std::pair<std::string,double>>;

std::vector<double> priorities(const std::string& rule, const std::vector<Job>& jobs,
                               const std::vector<double>& orderWork,
                               const CustomRule& custom = {}) {
  size_t J = jobs.size(); std::vector<double> key(J, 0);

  // Остаточная работа ПО ЦЕПОЧКЕ (критический путь вперёд): rem = dur + max(rem succ).
  // Раньше CR/MS считались от ПОЛНОЙ работы заказа — правила вырождались в EDD
  // («Требования эвристики» §2: CR/MS — от оставшейся работы).
  const bool customUsesRem = rule == "CUSTOM" &&
    std::any_of(custom.begin(), custom.end(), [](auto& c) { return c.first == "rem"; });
  std::vector<double> rem(J, 0);
  if (rule == "CR" || rule == "MS" || rule == "MWKR" || customUsesRem) {
    std::vector<std::vector<int>> succ(J);
    std::vector<int> succLeft(J, 0);
    for (size_t i = 0; i < J; ++i)
      for (int p : jobs[i].preds) if (p >= 0 && p < (int)J) succ[p].push_back((int)i);
    for (size_t i = 0; i < J; ++i) succLeft[i] = (int)succ[i].size();
    std::vector<int> stack; std::vector<double> best(J, 0);
    for (size_t i = 0; i < J; ++i) if (succLeft[i] == 0) stack.push_back((int)i);
    while (!stack.empty()) {
      int v = stack.back(); stack.pop_back();
      rem[v] = jobs[v].durMean + best[v];
      for (int p : jobs[v].preds) if (p >= 0 && p < (int)J) {
        best[p] = std::max(best[p], rem[v]);
        if (--succLeft[p] == 0) stack.push_back(p);
      }
    }
  }

  // ── КОНСТРУКТОР: key = Σ w_c · norm_c (минмакс-нормализация каждого критерия;
  // меньший key = раньше, отрицательный вес = «больше — раньше»). Позволяет
  // собирать эвристики из пресетов: «LPT, но из длинных раньше те, у кого
  // больше входных материалов» = duration:-1 + inputs:-0.2.
  if (rule == "CUSTOM" && !custom.empty()) {
    auto critOf = [&](const std::string& c, size_t i) -> double {
      const Job& j = jobs[i];
      if (c == "duration") return j.durMean;
      if (c == "due")      return j.dueMin;
      if (c == "rem")      return rem[i];
      if (c == "inputs")   return (double)j.nInputs;
      if (c == "setup")    return j.setupTime;
      return 0;
    };
    for (auto& [cname, w] : custom) {
      if (w == 0) continue;
      double lo = 1e300, hi = -1e300;
      for (size_t i = 0; i < J; ++i) {
        double v = critOf(cname, i);
        lo = std::min(lo, v); hi = std::max(hi, v);
      }
      const double span = hi > lo ? hi - lo : 1.0;
      for (size_t i = 0; i < J; ++i)
        key[i] += w * (critOf(cname, i) - lo) / span;
    }
    return key;
  }

  for (size_t i = 0; i < J; ++i) {
    const Job& j = jobs[i]; double ow = orderWork[j.orderIdx] > 0 ? orderWork[j.orderIdx] : 1;
    if (rule == "SPT")       key[i] = j.durMean;
    else if (rule == "LPT")  key[i] = -j.durMean;
    else if (rule == "EDD")  key[i] = j.dueMin;
    else if (rule == "CR")   key[i] = j.dueMin / std::max(1.0, rem[i]);
    else if (rule == "MWKR") key[i] = -std::max(rem[i], 1.0);
    else if (rule == "MS")   key[i] = j.dueMin - rem[i];
    else { (void)ow;         key[i] = j.orderIdx * 1e6 + (double)i; }  // FIFO
  }
  return key;
}

/* ── Симуляция (списочное планирование) ───────────────────────────────────── */
struct SimOut {
  std::vector<double> start, end; std::vector<std::string> machineId; std::vector<int> worker;
  double makespan = 0;
  int nSetups = 0; double setupMinutes = 0, setupCost = 0;   // переналадки при смене изделия
  int nBreakdowns = 0; double breakdownMinutes = 0, maintMinutes = 0;   // поломки и плановое ТО
  std::unordered_map<std::string,double> busyByMachine; std::vector<double> busyByWorker;
  // По джобам: наладка и простой (ТО + ремонт), мин — для единой загрузки (B9):
  // продуктивное время = обработка, а наладка и простой учитываются отдельно.
  std::vector<double> setupJ, downJ;
};

using PinMap = std::unordered_map<int, std::pair<double, std::string>>;  // jobIdx → (startMin, machineId)

// rng: nullptr → детерминированный прогон (без случайных поломок; плановое ТО
// учитывается всегда). В МК-прогонах поломки сэмплируются.
SimOut simulate(const Model& m, const std::vector<Job>& jobs,
                const std::vector<double>& key, const std::vector<double>& dur,
                const Calendar& cal,
                const std::unordered_map<std::string, Calendar>& calByM,
                const PinMap& pins, std::mt19937* rng = nullptr) {
  size_t J = jobs.size(); SimOut o;
  o.start.assign(J,0); o.end.assign(J,0); o.machineId.assign(J,""); o.worker.assign(J,-1);
  o.busyByWorker.assign(m.workers.size(), 0);
  o.setupJ.assign(J, 0); o.downJ.assign(J, 0);
  std::unordered_map<std::string,double> mFree; std::vector<double> wFree(m.workers.size(), 0);
  std::unordered_map<std::string,std::string> lastProd;   // станок → последнее изделие (наладки)
  std::unordered_map<std::string,double> usage;            // станок → наработка, мин (ТО/поломки)
  // Готовность через ОЧЕРЕДЬ ПРИОРИТЕТА (по key): O(J·logJ) вместо O(J²) — иначе большой
  // план (тысячи операций × правила × сэмплы) подвисает.
  std::vector<int> predLeft(J, 0);
  std::vector<std::vector<int>> succ(J);
  for (size_t i = 0; i < J; ++i) {
    predLeft[i] = (int)jobs[i].preds.size();
    for (int p : jobs[i].preds) if (p >= 0 && p < (int)J) succ[p].push_back((int)i);
  }
  using PQItem = std::pair<double,int>;
  std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> ready;
  for (size_t i = 0; i < J; ++i) if (predLeft[i] == 0) ready.push({ key[i], (int)i });
  std::vector<char> done(J,0); size_t sched = 0, scan = 0;
  while (sched < J) {
    int best = -1;
    if (!ready.empty()) { best = ready.top().second; ready.pop(); }
    else { while (scan < J && done[scan]) ++scan; if (scan < J) best = (int)scan; else break; }
    if (best < 0 || done[best]) continue;
    const Job& j = jobs[best];
    double readyT = 0; for (int p : j.preds) readyT = std::max(readyT, o.end[p]);
    // Ручная правка (pin): фиксированный станок и «не раньше» время старта.
    const auto pinIt = pins.find(best);
    // FJSP: станок выбирается среди ВСЕХ допустимых типов операции (раньше — только
    // первый тип: альтернативная мощность простаивала, узкое место не разгружалось).
    std::string chosenM; double mfree = 0;
    if (pinIt != pins.end() && !pinIt->second.second.empty()) {
      chosenM = pinIt->second.second;
      mfree = mFree.count(chosenM) ? mFree[chosenM] : 0;
    } else {
      double bm = 1e300;
      auto consider = [&](const std::string& wct) {
        if (auto it = m.machinesOf.find(wct); it != m.machinesOf.end())
          for (auto& mid : it->second) {
            double f = mFree.count(mid) ? mFree[mid] : 0;
            if (f < bm) { bm = f; chosenM = mid; }
          }
      };
      if (!j.wcTypes.empty()) for (auto& w : j.wcTypes) consider(w);
      else if (!j.wcType.empty()) consider(j.wcType);
      if (!chosenM.empty()) mfree = bm;
    }
    // Рабочий — наименее занятый из ДОПУЩЕННЫХ к типу выбранного станка
    // (матрица компетенций); тип без матрицы → любой рабочий.
    // B3: «поставка» (только срок поставщика, без станка) рабочего НЕ занимает —
    // раньше рабочий блокировался на весь lead time поставщика.
    int wi = -1; double wfree = 0;
    if (!m.workers.empty() && j.needsWorker) {
      double bw = 1e300;
      auto scan = [&](int w) { if (wFree[w] < bw) { bw = wFree[w]; wi = w; } };
      const std::string mwct = !chosenM.empty() && m.machineWct.count(chosenM)
                             ? m.machineWct.at(chosenM) : j.wcType;
      auto el = m.eligibleWorkers.find(mwct);
      if (el != m.eligibleWorkers.end()) for (int w : el->second) scan(w);
      else for (size_t w = 0; w < wFree.size(); ++w) scan((int)w);
      wfree = bw;
    }
    // Наладка при СМЕНЕ ИЗДЕЛИЯ на станке (sequence-dependent, упрощённо: константа
    // операции). Раньше наладка входила только в первую transfer-партию независимо
    // от того, что стоял на станке до этого.
    double setup = 0;
    if (!chosenM.empty() && j.setupTime > 0) {
      auto lp = lastProd.find(chosenM);
      if (lp == lastProd.end() || lp->second != j.productId) setup = j.setupTime;
    }
    // ── Надёжность: плановое ТО по наработке + случайные поломки ──────────
    // ТО: при пересечении наработкой границы k·mtbm станок останавливается на
    // maintH часов. Поломка: интенсивность растёт с ЗАГРУЗКОЙ станка (чем выше
    // утилизация — тем чаще отказ: λ = (1/MTBF)·(0.5+1.5·util)); время ремонта —
    // логнормальное (CV 0.6) со своим распределением.
    double downtime = 0;
    if (!chosenM.empty() && m.machineWct.count(chosenM)) {
      auto rkIt = m.wctRisk.find(m.machineWct.at(chosenM));
      if (rkIt != m.wctRisk.end()) {
        const auto& rk = rkIt->second;
        const double u = usage.count(chosenM) ? usage.at(chosenM) : 0;
        if (rk.mtbm > 0 && rk.maintH > 0) {
          const double step = rk.mtbm * 60.0;
          if (std::floor((u + dur[best]) / step) > std::floor(u / step)) {
            downtime += rk.maintH * 60.0;
            o.maintMinutes += rk.maintH * 60.0;
          }
        }
        if (rng && rk.mtbf > 0 && rk.repairH > 0) {
          const double t0m = std::max(mfree, 1.0);
          const double util = std::min(1.0, u / t0m);            // загрузка станка к моменту
          const double lam = (1.0 / (rk.mtbf * 60.0)) * (0.5 + 1.5 * util);
          std::uniform_real_distribution<double> u01(0, 1);
          if (u01(*rng) < 1.0 - std::exp(-lam * dur[best])) {
            std::normal_distribution<double> nz(0, 1);
            const double cv = 0.6, sl = std::sqrt(std::log(1.0 + cv * cv));
            const double rep = rk.repairH * 60.0 * std::exp(sl * nz(*rng) - 0.5 * sl * sl);
            downtime += rep; o.nBreakdowns++; o.breakdownMinutes += rep;
          }
        }
      }
    }
    const double work = dur[best] + setup + downtime;
    // Календарь: индивидуальный график станка (если задан) вместо общего.
    const Calendar& mcal = (!chosenM.empty() && calByM.count(chosenM)) ? calByM.at(chosenM) : cal;
    double t0 = std::max(readyT, std::max(mfree, wfree));
    if (pinIt != pins.end()) t0 = std::max(t0, pinIt->second.first);     // «не раньше» из пина
    double st = mcal.nextWork(t0);                                       // снап к рабочему времени
    double en = mcal.advance(st, work);                                  // финиш с учётом смен
    o.start[best] = st; o.end[best] = en; o.machineId[best] = chosenM; o.worker[best] = wi;
    o.setupJ[best] = setup; o.downJ[best] = downtime;
    if (!chosenM.empty()) {
      mFree[chosenM] = en; o.busyByMachine[chosenM] += work; lastProd[chosenM] = j.productId;
      usage[chosenM] += work;
      if (setup > 0) {
        o.nSetups++; o.setupMinutes += setup;
        o.setupCost += (setup / 60.0) * (j.hourRate + j.laborRate);
      }
    }
    if (wi >= 0) wFree[wi] = en, o.busyByWorker[wi] += work;
    o.makespan = std::max(o.makespan, en); done[best] = 1; ++sched;
    for (int s : succ[best]) if (--predLeft[s] == 0) ready.push({ key[s], s });
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
  double portfolioHorizon = 0;                 // горизонт прогона Стадии 2, ч
  if (program.empty() && !p.runId.empty()) {   // программа из портфеля Стадии 2
    auto rows = db.query_json(
      "SELECT pi.product_id AS pid, pi.qty AS qty FROM portfolios pf "
      "JOIN portfolio_items pi ON pi.portfolio_id=pf.id "
      "WHERE pf.run_id=? AND pf.kind='robust'", { p.runId });
    for (auto& r : rows) program.push_back({ str(r,"pid"), num(r,"qty"), 0 });
    // Сроки заказов = горизонт прогона оптимизации: раньше due=0 → сроки
    // выдумывались формулой, и связка стадий теряла горизонт (двухстадийная
    // модель требует общий горизонт плана и программы).
    try {
      auto rr = db.query_one("SELECT result_json FROM optimization_runs WHERE id=?", { p.runId });
      json rj = json::parse(str(rr, "result_json"));
      portfolioHorizon = rj.value("horizon_hours", 0.0);
    } catch (...) {}
    if (portfolioHorizon > 0)
      for (auto& ol : program) ol.dueHours = portfolioHorizon;
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
        sj.needsWorker = false;                                  // B3: срок поставщика — не работа цеха
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

  // Индивидуальные календари станков ('8x5'/'12x2'/'24x7' из паспорта ЕО).
  // B4: распознанный график (в т.ч. '24x7' = без ограничений) кладётся ВСЕГДА;
  // нераспознанный/пустой → станок работает по общему календарю.
  std::unordered_map<std::string, Calendar> calByM;
  if (p.useCalendar)
    for (auto& [mid, sch] : m.machineSched) {
      Calendar mc;
      if (machine_calendar(sch, mc)) calByM.emplace(mid, std::move(mc));
    }
  // Ручные правки Ганта (drag&drop): jobIdx → (не раньше, станок).
  PinMap pinMap;
  for (const SchedPin& pn : p.pins)
    if (pn.jobIdx >= 0 && pn.jobIdx < (int)jobs.size())
      pinMap[pn.jobIdx] = { pn.startHours * 60.0, pn.machineId };

  // ── Перебор диспетч-правил (старт), оценка симуляцией + Монте-Карло (хвост) ──
  std::vector<std::string> rules = { "EDD", "SPT", "CR", "MWKR", "MS", "FIFO", "LPT" };
  if (!p.customRule.empty()) rules = { "CUSTOM" };       // конструктор эвристики
  else if (p.rule != "auto") rules = { p.rule };
  int N = std::max(60, p.samples);
  if (jobs.size() > 1500) N = std::min(N, 40);   // крупный план — меньше сэмплов (скорость)
  std::mt19937 rng(p.seed);

  // Заранее сэмплируем длительности по прогонам (общие для всех правил — честно).
  std::vector<std::vector<double>> durMC(N, std::vector<double>(jobs.size()));
  for (int s = 0; s < N; ++s)
    for (size_t i = 0; i < jobs.size(); ++i) durMC[s][i] = sample_dur(jobs[i], p.tailWeight, rng);
  std::vector<double> durMean(jobs.size());
  for (size_t i = 0; i < jobs.size(); ++i) durMean[i] = jobs[i].durMean;

  struct RuleEval { std::string rule; double mkDet, mkMean, mkCVaR, mkWorst, tardMean, tardCVaR, setupMin, bdMin = 0, score; };
  std::vector<RuleEval> evals(rules.size());
  // Монте-Карло-оценка ПРИОРИТЕТНОГО КЛЮЧА на всех N сценариях (общие случайные
  // числа: одинаковые durMC и seed поломок для любого ключа). Используется и для
  // сравнения правил, и (B5) для итогового ключа после локального поиска.
  struct McEval { double mkMean = 0, mkCVaR = 0, mkWorst = 0, tardMean = 0, tardCVaR = 0, bdMin = 0; };
  auto mcEval = [&](const std::vector<double>& key) {
    std::vector<double> mks(N), tards(N);
    double bdSum = 0;
    for (int s = 0; s < N; ++s) {
      std::mt19937 brng(p.seed + 7919u * (unsigned)s);   // одинаково для всех ключей
      SimOut so = simulate(m, jobs, key, durMC[s], cal, calByM, pinMap, &brng);
      mks[s] = so.makespan; int nl2; tards[s] = order_tardiness(jobs, so, nOrders, due, nl2);
      bdSum += so.breakdownMinutes;
    }
    McEval r;
    r.mkMean = mean_of(mks); r.mkCVaR = cvar_upper(mks, p.alpha);
    r.mkWorst = *std::max_element(mks.begin(), mks.end());
    r.tardMean = mean_of(tards); r.tardCVaR = cvar_upper(tards, p.alpha);
    r.bdMin = bdSum / N;
    return r;
  };
  // Правила НЕЗАВИСИМЫ (общие durMC read-only) — оцениваем параллельно по потокам:
  // 7 правил × (1+N) симуляций раньше шли строго последовательно.
  {
    auto evalRule = [&](size_t ri) {
      const std::string& rule = rules[ri];
      auto key = priorities(rule, jobs, orderWork, p.customRule);
      SimOut det = simulate(m, jobs, key, durMean, cal, calByM, pinMap);
      int nl; double tardDet = order_tardiness(jobs, det, nOrders, due, nl);
      const McEval mc = mcEval(key);
      RuleEval e; e.rule = rule; e.mkDet = det.makespan; e.bdMin = mc.bdMin;
      e.mkMean = mc.mkMean; e.mkCVaR = mc.mkCVaR; e.mkWorst = mc.mkWorst;
      e.tardMean = mc.tardMean; e.tardCVaR = mc.tardCVaR;
      e.setupMin = det.setupMinutes;
      // Целевая F = w_time·ВРЕМЯ + w_cost·СТОИМОСТЬ + w_risk·РИСК + просрочка
      // («Требования к оптимизации» §3). Стоимостная компонента — минуты
      // переналадок (единственная составляющая, зависящая от ПОРЯДКА; в одних
      // единицах с makespan). Раньше w_cost игнорировался вовсе.
      e.score = p.wTime * e.mkMean + p.wRisk * (e.mkCVaR - e.mkMean)
              + p.wCost * e.setupMin + 0.5 * e.tardMean + 0.001 * tardDet;
      evals[ri] = e;
    };
    std::vector<std::thread> pool;
    pool.reserve(rules.size());
    for (size_t ri = 0; ri < rules.size(); ++ri) pool.emplace_back(evalRule, ri);
    for (auto& t : pool) t.join();
  }
  size_t bestR = 0; for (size_t i = 1; i < evals.size(); ++i) if (evals[i].score < evals[bestR].score) bestR = i;
  const std::string chosenRule = evals[bestR].rule;

  // ── Детальное расписание выбранного правила (по средним — для Ганта) ──
  auto key = priorities(chosenRule, jobs, orderWork, p.customRule);

  // ── Улучшение ПОВЕРХ правил («Требования эвристики» §4: диспетч-правило —
  // только стартовая точка). Генетический алгоритм по ключам приоритетов
  // (GaImprover.h). Хромосома сжатая: веса составного правила по 5 нормированным
  // критериям + сдвиг приоритета каждого заказа,
  //   key_i = Σ_c w_c·norm_c(i) + δ_заказ(i),
  // — десятки генов вместо тысяч операций (иначе мутация лишь перемешивает очередь),
  // и любое правило — точка этого пространства (EDD: w_срок=1; FIFO: δ_k=k/K).
  // Пригодность — та же F на ОБУЧАЮЩИХ сценариях [0, NS). Результат принимается,
  // только если F лучше и на ОТЛОЖЕННЫХ сценариях [NS, NS+NV): иначе выигрыш мог
  // быть подгонкой под конкретные сэмплы (оптимистичный сдвиг).
  json improverJson = nullptr;
  bool keyImproved = false;                              // ключ изменён ГА
  {
    const int G = ((int)jobs.size() > 3000) ? 0 : std::max(0, p.improveIters);
    if (G > 0) {
      const int NS = std::min(30, N / 2);                // обучающие сценарии
      const int NV = std::min(N - NS, 120);              // отложенные — проверка вне выборки
      auto scoreOn = [&](const std::vector<double>& k2, int s0, int s1) {
        SimOut det2 = simulate(m, jobs, k2, durMean, cal, calByM, pinMap);
        int nl2; double tardDet2 = order_tardiness(jobs, det2, nOrders, due, nl2);
        std::vector<double> mks(s1 - s0), tards(s1 - s0);
        for (int s = s0; s < s1; ++s) {
          std::mt19937 brng(p.seed + 7919u * (unsigned)s);
          SimOut so = simulate(m, jobs, k2, durMC[s], cal, calByM, pinMap, &brng);
          mks[s - s0] = so.makespan; int n3; tards[s - s0] = order_tardiness(jobs, so, nOrders, due, n3);
        }
        double mkMean = mean_of(mks), mkCv = cvar_upper(mks, p.alpha);
        return p.wTime * mkMean + p.wRisk * (mkCv - mkMean)
             + p.wCost * det2.setupMinutes + 0.5 * mean_of(tards) + 0.001 * tardDet2;
      };
      const std::array<const char*, 5> kCrit = { "due", "rem", "duration", "inputs", "setup" };
      const int C = (int)kCrit.size();
      std::vector<std::vector<double>> norm(C);
      for (int c = 0; c < C; ++c) norm[c] = priorities("CUSTOM", jobs, orderWork, { { kCrit[c], 1.0 } });
      auto decode = [&](const std::vector<double>& g) {
        std::vector<double> k2(jobs.size());
        for (size_t i = 0; i < jobs.size(); ++i) {
          double v = g[C + jobs[i].orderIdx];
          for (int c = 0; c < C; ++c) v += g[c] * norm[c][i];
          k2[i] = v;
        }
        return k2;
      };
      // Затравки — правила в этом пространстве (CR и MS — линейные приближения).
      auto genome = [&](std::initializer_list<double> w) {
        std::vector<double> g(C + nOrders, 0.0);
        std::copy(w.begin(), w.end(), g.begin());
        return g;
      };
      auto ruleGenome = [&](const std::string& r) {
        if (r == "CUSTOM") {
          std::vector<double> g(C + nOrders, 0.0);
          for (auto& [cn, w] : p.customRule)
            for (int c = 0; c < C; ++c) if (cn == kCrit[c]) g[c] += w;
          return g;
        }
        if (r == "SPT")  return genome({ 0, 0, 1 });
        if (r == "LPT")  return genome({ 0, 0, -1 });
        if (r == "MWKR") return genome({ 0, -1 });
        if (r == "MS")   return genome({ 1, -1 });
        if (r == "CR")   return genome({ 1, -0.5 });
        if (r == "FIFO") {
          std::vector<double> g(C + nOrders, 0.0);
          for (int k = 0; k < nOrders; ++k) g[C + k] = (k + 1.0) / nOrders;
          return g;
        }
        return genome({ 1 });                            // EDD
      };
      std::vector<std::vector<double>> seeds = { ruleGenome(chosenRule) };
      for (size_t ri = 0; ri < rules.size(); ++ri)
        if (ri != bestR) seeds.push_back(ruleGenome(rules[ri]));
      GaConfig gc;
      gc.generations = G;
      gc.seed = p.seed + 777;
      gc.sigma0 = 0.1;                                   // ≈ 10 % шкалы нормированного критерия
      gc.mutationRate = 0.15;
      gc.swapBegin = C;                                  // обмен — только приоритетами заказов
      gc.stallGens = 8;
      const GaResult ga = run_key_ga(seeds, [&](const std::vector<double>& g) { return scoreOn(decode(g), 0, NS); }, gc);
      // Базовая линия — НАСТОЯЩИЙ ключ выбранного правила (затравка CR/MS приближённая).
      const double trainRule = scoreOn(key, 0, NS);
      const std::vector<double> gaKey = decode(ga.bestKey);
      const double valRule = NV > 0 ? scoreOn(key, NS, NS + NV) : trainRule;
      const double valGa   = NV > 0 ? scoreOn(gaKey, NS, NS + NV) : ga.bestScore;
      const bool adopted = ga.bestScore < trainRule && valGa < valRule;
      if (adopted) { key = gaKey; keyImproved = true; }
      auto gainPct = [](double before, double after) { return before > 0 ? (before - after) / before * 100.0 : 0.0; };
      json hist = json::array();
      for (const GaGeneration& h : ga.history) hist.push_back({ {"gen", h.gen}, {"best", h.best}, {"mean", h.mean} });
      improverJson = {
        {"method", "ga"},
        {"iterations", (int)ga.history.size() - 1},       // выполнено поколений
        {"population", gc.popSize}, {"evaluations", ga.evaluations}, {"seeds", (int)seeds.size()},
        {"accepted", adopted ? ga.improvements : 0},      // улучшений рекорда (0 — не принят)
        {"adopted", adopted},
        {"stopped", ga.stoppedByTime ? "time" : ga.stoppedByStall ? "stall" : "generations"},
        {"score_before", trainRule},
        {"score_after", adopted ? ga.bestScore : trainRule},
        {"improvement_pct", adopted ? gainPct(trainRule, ga.bestScore) : 0.0},
        {"genes", (int)ga.bestKey.size()},
        {"weights", { {"due", ga.bestKey[0]}, {"rem", ga.bestKey[1]}, {"duration", ga.bestKey[2]},
                      {"inputs", ga.bestKey[3]}, {"setup", ga.bestKey[4]} }},
        {"train_scenarios", NS},
        {"validation", { {"scenarios", NV}, {"score_rule", valRule}, {"score_ga", valGa},
                         {"improvement_pct", gainPct(valRule, valGa)} }},
        {"history", hist},
      };
    }
  }

  // B5: риск-KPI (E/CVaR/худший makespan, CVaR просрочки, поломки) — Монте-Карло
  // ИТОГОВОГО ключа (того же, что даёт Ганта), на всех N сценариях. Раньше они
  // брались у правила ДО локального поиска и не относились к показанному плану.
  // Если ключ не менялся — оценка правила и есть оценка итогового ключа (те же CRN).
  const McEval finalMc = keyImproved ? mcEval(key) : McEval{
    evals[bestR].mkMean, evals[bestR].mkCVaR, evals[bestR].mkWorst,
    evals[bestR].tardMean, evals[bestR].tardCVaR, evals[bestR].bdMin };

  SimOut sched = simulate(m, jobs, key, durMean, cal, calByM, pinMap);
  double makespan = sched.makespan;
  int nLate = 0; double tardiness = order_tardiness(jobs, sched, nOrders, due, nLate);

  auto H = [](double minutes) { return minutes / 60.0; };  // мин → часы
  if (!improverJson.is_null()) {                       // эффект локального поиска на E[Cmax]
    improverJson["makespan_mean_rule"]  = H(evals[bestR].mkMean);
    improverJson["makespan_mean_final"] = H(finalMc.mkMean);
  }

  // Гантт.
  json gantt = json::array();
  for (size_t i = 0; i < jobs.size(); ++i) {
    const Job& j = jobs[i];
    bool late = sched.end[i] > j.dueMin + 1e-6;
    bool isSupply = j.productId == "supply";
    std::string mid = isSupply ? "supply" : sched.machineId[i];
    std::string mname = isSupply ? "Снабжение/поставка"
      : (m.machineName.count(sched.machineId[i]) ? m.machineName[sched.machineId[i]] : "");
    // FJSP: тип в Ганте — ФАКТИЧЕСКИЙ тип выбранного станка (может отличаться от ведущего).
    std::string wct = (!isSupply && !mid.empty() && m.machineWct.count(mid)) ? m.machineWct[mid] : j.wcType;
    gantt.push_back({
      {"job_idx", (int)i},                       // для ручных правок (drag&drop → пин)
      {"batches", j.batches},                    // партий в джобе (нормировка калибровки)
      {"order_idx", j.orderIdx}, {"product_id", j.productId},
      {"product_name", isSupply ? "—" : (m.prodName.count(j.productId)?m.prodName[j.productId]:j.productId)},
      {"op_id", j.opId}, {"op_name", j.opName},
      {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"machine_id", mid}, {"machine_name", mname},
      {"worker", sched.worker[i]},
      {"worker_id", (sched.worker[i] >= 0 && sched.worker[i] < (int)m.workers.size())
                      ? m.workers[sched.worker[i]].id : std::string()},
      {"worker_name", (sched.worker[i] >= 0 && sched.worker[i] < (int)m.workers.size())
                      ? m.workers[sched.worker[i]].name : std::string()},
      {"start", H(sched.start[i])}, {"end", H(sched.end[i])},
      {"due", H(j.dueMin)}, {"late", late},
      // B9: разложение занятости джобы — обработка (продуктивное время), наладка, простой (ТО/ремонт).
      {"proc_hours", isSupply ? 0.0 : H(durMean[i])},
      {"setup_hours", H(sched.setupJ[i])}, {"downtime_hours", H(sched.downJ[i])},
    });
  }

  // ── ОЧЕРЕДИ: сколько операций «ждут» (готовы по предшественникам, но станок занят) в
  //    каждый момент времени и на каком оборудовании — видно, где копятся узкие места.
  json queueTimeline = json::array();
  json queueByWc = json::array();
  {
    const int BK = 48;
    const double bw = std::max(1e-9, makespan / std::max(1, BK));
    std::vector<std::unordered_map<std::string, int>> qByWc(BK + 1);
    std::vector<int> qTot(BK + 1, 0);
    for (size_t i = 0; i < jobs.size(); ++i) {
      if (jobs[i].productId == "supply") continue;
      double a = 0; for (int p : jobs[i].preds) a = std::max(a, sched.end[p]);  // готовность
      double b = sched.start[i];                                                // старт (конец ожидания)
      if (b <= a + 1e-6) continue;
      int b0 = std::max(0, (int)std::floor(a / bw));
      int b1 = std::min(BK, (int)std::floor((b - 1e-6) / bw));
      for (int k = b0; k <= b1; ++k) { qTot[k]++; qByWc[k][jobs[i].wcType]++; }
    }
    for (int k = 0; k <= BK; ++k) {
      std::string topWc; int topN = 0;
      for (auto& [wc, n] : qByWc[k]) if (n > topN) { topN = n; topWc = wc; }
      queueTimeline.push_back({ {"t", H(k * bw)}, {"queued", qTot[k]},
        {"top_wc", m.wcName.count(topWc) ? m.wcName[topWc] : topWc}, {"top_wc_n", topN} });
    }
    // Разбивка очереди по типам РЦ: своя серия на каждый рабочий центр — чтобы в UI
    // можно было выбрать конкретный участок и видеть его очередь во времени.
    std::unordered_map<std::string, std::vector<int>> series;   // wc → queued по бинам
    for (int k = 0; k <= BK; ++k)
      for (auto& [wc, n] : qByWc[k]) {
        auto& v = series[wc];
        if (v.empty()) v.assign(BK + 1, 0);
        v[k] = n;
      }
    for (auto& [wc, v] : series) {
      int peak = 0; for (int n : v) peak = std::max(peak, n);
      if (peak == 0) continue;
      json pts = json::array();
      for (int k = 0; k <= BK; ++k) pts.push_back({ {"t", H(k * bw)}, {"queued", v[k]} });
      queueByWc.push_back({ {"wc_type_id", wc}, {"wc_name", m.wcName.count(wc) ? m.wcName[wc] : wc},
                            {"peak", peak}, {"points", pts} });
    }
  }

  // ── Загрузка (B9, AUDIT §4.2, ISO 22400 APT/фонд): ЕДИНОЕ определение
  //    utilization = Σ продуктивного времени ресурса / Σ его КАЛЕНДАРНОГО фонда за
  //    горизонт [0, makespan]. Продуктивное время станка = обработка; наладка и
  //    простой (плановое ТО + ремонт) НЕ входят в занятость и даются отдельно, так что
  //    фонд = обработка + наладка + простой + свободное время. Фонд станка — по ЕГО
  //    календарю (индивидуальный график, иначе общий; без календаря — 24×7).
  double fond = working_span(cal, makespan);           // фонд общего календаря (рабочие)
  std::unordered_map<std::string,double> procM, setupM, downM;   // станок → мин
  std::vector<double> prodW(m.workers.size(), 0);                 // рабочий → мин
  for (size_t i = 0; i < jobs.size(); ++i) {
    const std::string& mid = sched.machineId[i];
    if (!mid.empty()) { procM[mid] += durMean[i]; setupM[mid] += sched.setupJ[i]; downM[mid] += sched.downJ[i]; }
    // Рабочий выполняет обработку и наладку; ТО/ремонт — простой станка, не работа рабочего.
    const int w = sched.worker[i];
    if (w >= 0 && w < (int)prodW.size()) prodW[w] += durMean[i] + sched.setupJ[i];
  }
  auto getm = [](const std::unordered_map<std::string,double>& mp, const std::string& k) {
    auto it = mp.find(k); return it != mp.end() ? it->second : 0.0; };
  json machineLoad = json::array();
  double totalBusy = 0, totalCap = 0, totalSetup = 0, totalDown = 0, totalIdle = 0;
  std::unordered_map<std::string,double> wcBusy, wcCap, wcSetup, wcDown, wcIdle;
  for (auto& [wct, mids] : m.machinesOf) for (auto& mid : mids) {
    const double busy = getm(procM, mid), su = getm(setupM, mid), dn = getm(downM, mid);
    const Calendar& mcal = calByM.count(mid) ? calByM.at(mid) : cal;
    const double fund = working_span(mcal, makespan);
    const double idle = std::max(0.0, fund - busy - su - dn);
    machineLoad.push_back({ {"machine_id", mid}, {"machine_name", m.machineName[mid]},
      {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(busy)}, {"idle_hours", H(idle)}, {"utilization", fund > 0 ? busy / fund : 0},
      {"setup_hours", H(su)}, {"downtime_hours", H(dn)}, {"fund_hours", H(fund)} });
    totalBusy += busy; totalCap += fund; totalSetup += su; totalDown += dn; totalIdle += idle;
    wcBusy[wct] += busy; wcCap[wct] += fund; wcSetup[wct] += su; wcDown[wct] += dn; wcIdle[wct] += idle;
  }
  json wcLoad = json::array(); std::string bottleneck; double bnUtil = -1;
  for (auto& [wct, cap] : wcCap) {
    double util = cap > 0 ? wcBusy[wct] / cap : 0;
    wcLoad.push_back({ {"wc_type_id", wct}, {"wc_name", m.wcName.count(wct)?m.wcName[wct]:wct},
      {"busy_hours", H(wcBusy[wct])}, {"idle_hours", H(wcIdle[wct])}, {"utilization", util},
      {"setup_hours", H(wcSetup[wct])}, {"downtime_hours", H(wcDown[wct])}, {"fund_hours", H(cap)} });
    if (util > bnUtil) { bnUtil = util; bottleneck = wct; }
  }

  // Планы рабочих + простои людей. Фонд рабочего — общий сменный календарь (своих
  // графиков у рабочих в модели нет); при работе на станке 24×7 вне смен загрузка
  // может превысить 1 — это сверхурочные относительно графика, а не ошибка формулы.
  json workerPlan = json::array();
  for (size_t w = 0; w < m.workers.size(); ++w) {
    json js = json::array(); int cnt = 0;
    for (size_t i = 0; i < jobs.size(); ++i) if (sched.worker[i] == (int)w) {
      js.push_back({ {"op_name", jobs[i].opName}, {"product_id", jobs[i].productId},
        {"start", H(sched.start[i])}, {"end", H(sched.end[i])} }); ++cnt;
    }
    const double busy = prodW[w];
    workerPlan.push_back({ {"worker_id", m.workers[w].id}, {"name", m.workers[w].name},
      {"jobs", js}, {"job_count", cnt}, {"busy_hours", H(busy)},
      {"idle_hours", H(std::max(0.0, fond - busy))}, {"utilization", fond > 0 ? busy / fond : 0},
      {"fund_hours", H(fond)} });
  }

  // ── Дополнительные KPI (стандарт APS: flow time, ожидание, НЗП, проходка) ──
  double flowSum = 0, wipArea = 0, waitSum = 0, procSum = 0, qtySum = 0;
  {
    std::vector<double> ordStart(nOrders, 1e300), ordFin(nOrders, 0);
    for (size_t i = 0; i < jobs.size(); ++i) {
      ordStart[jobs[i].orderIdx] = std::min(ordStart[jobs[i].orderIdx], sched.start[i]);
      ordFin[jobs[i].orderIdx]   = std::max(ordFin[jobs[i].orderIdx],   sched.end[i]);
      double readyT = 0; for (int pr2 : jobs[i].preds) readyT = std::max(readyT, sched.end[pr2]);
      waitSum += std::max(0.0, sched.start[i] - readyT);   // ожидание станка/рабочего
      procSum += std::max(0.0, sched.end[i] - sched.start[i]);
    }
    for (int k2 = 0; k2 < nOrders; ++k2) {
      if (ordFin[k2] <= 0) continue;
      flowSum += ordFin[k2] - std::min(ordStart[k2], ordFin[k2]);
      wipArea += ordFin[k2] - std::min(ordStart[k2], ordFin[k2]);
      qtySum  += std::max(1.0, program[k2].qty);
    }
  }
  // B10, единицы (AUDIT §4.2): throughput — ЕДИНИЦ ПРОДУКЦИИ в сутки; wip_avg —
  // среднее число ЗАКАЗОВ в системе = Σ времени потока / Cmax; orders_per_day —
  // интенсивность λ (заказов в сутки). Закон Литтла: wip_avg = λ · W, W = flow_time_mean.
  const double flowMeanH = nOrders > 0 ? flowSum / nOrders / 60.0 : 0;
  const double waitShare = (waitSum + procSum) > 0 ? waitSum / (waitSum + procSum) : 0;
  const double wipAvg    = makespan > 0 ? wipArea / makespan : 0;
  const double thruDay   = makespan > 0 ? qtySum / (makespan / 60.0 / 24.0) : 0;
  const double ordersDay = makespan > 0 ? nOrders / (makespan / 60.0 / 24.0) : 0;

  json rulesJson = json::array();
  for (auto& e : evals) rulesJson.push_back({
    {"rule", e.rule}, {"makespan", H(e.mkMean)}, {"makespan_cvar", H(e.mkCVaR)},
    {"makespan_worst", H(e.mkWorst)}, {"tardiness", H(e.tardMean)}, {"score", e.score},
    {"chosen", e.rule == chosenRule} });

  double cost = 0; for (size_t i = 0; i < jobs.size(); ++i)
    cost += (durMean[i] / 60.0) * (jobs[i].hourRate + jobs[i].laborRate);
  cost += sched.setupCost;                              // переналадки — тоже деньги
  // Стоимость труда по фактическим назначениям (тарифная ставка рабочего × занятость).
  double laborCost = 0;
  for (size_t w = 0; w < m.workers.size() && w < sched.busyByWorker.size(); ++w)
    laborCost += (sched.busyByWorker[w] / 60.0) * m.workers[w].costPerHour;

  // ── Recourse: обратная связь Стадия 1 → Стадия 2. Фактические часы на единицу
  // (нормо-часы + доля переналадок) пишутся в stage1_feedback — следующий прогон
  // оптимизатора калибрует потребление мощности реализованным расписанием.
  try {
    std::unordered_map<std::string, std::pair<double,double>> agg;   // product → (мин, шт)
    for (int k = 0; k < nOrders; ++k) agg[program[k].productId].second += std::max(1.0, program[k].qty);
    for (const Job& j : jobs)
      if (j.productId != "supply") agg[program[j.orderIdx].productId].first += j.durMean;
    const double setupShare = totalWork > 0 ? sched.setupMinutes / totalWork : 0;
    for (auto& [pid, pq] : agg) {
      if (pq.first <= 0 || pq.second <= 0) continue;
      const double naiveH  = pq.first / 60.0 / pq.second;
      const double actualH = naiveH * (1.0 + setupShare);
      db.exec("INSERT INTO stage1_feedback(product_id,hours_per_unit,naive_hours,factor,updated_at) "
              "VALUES(?,?,?,?,datetime('now')) "
              "ON CONFLICT(product_id) DO UPDATE SET hours_per_unit=excluded.hours_per_unit, "
              "naive_hours=excluded.naive_hours, factor=excluded.factor, updated_at=excluded.updated_at",
              { pid, std::to_string(actualH), std::to_string(naiveH),
                std::to_string(std::max(1.0, actualH / std::max(1e-9, naiveH))) });
    }
  } catch (...) {}                                       // фидбэк не должен ронять план

  // Осуществимость связки стадий: вписывается ли программа портфеля в горизонт,
  // под который Стадия 2 резервировала мощность.
  if (portfolioHorizon > 0) {
    if (H(finalMc.mkCVaR) > portfolioHorizon)
      warnings.push_back("Портфель НЕ вписывается в горизонт прогона с учётом риска: CVaR makespan "
                         + std::to_string((int)std::lround(H(finalMc.mkCVaR))) + " ч > "
                         + std::to_string((int)std::lround(portfolioHorizon)) + " ч.");
    else if (H(makespan) > portfolioHorizon)
      warnings.push_back("Детерминированный план превышает горизонт прогона ("
                         + std::to_string((int)std::lround(H(makespan))) + " ч > "
                         + std::to_string((int)std::lround(portfolioHorizon)) + " ч).");
  }

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
    {"program", programJson}, {"gantt", gantt}, {"queue_timeline", queueTimeline}, {"queue_by_wc", queueByWc},
    {"machine_load", machineLoad}, {"wc_load", wcLoad}, {"worker_plan", workerPlan},
    {"bottleneck", { {"wc_type_id", bottleneck}, {"wc_name", m.wcName.count(bottleneck)?m.wcName[bottleneck]:bottleneck},
                     {"utilization", bnUtil} }},
    {"idle", { {"machine_idle_hours", H(totalIdle)},
               {"machine_utilization", totalCap>0?totalBusy/totalCap:0} }},
    {"calendar", { {"enabled", cal.any}, {"work_fond_hours", H(fond)},
                   {"machine_fund_hours", H(totalCap)} }},
    {"kpi", {
      {"makespan", H(makespan)}, {"makespan_mean", H(finalMc.mkMean)}, {"makespan_cvar", H(finalMc.mkCVaR)},
      {"makespan_worst", H(finalMc.mkWorst)}, {"tardiness", H(tardiness)}, {"tardiness_cvar", H(finalMc.tardCVaR)},
      {"n_late", nLate}, {"otd", nOrders>0 ? (double)(nOrders - nLate) / nOrders : 1.0},
      {"utilization", totalCap>0?totalBusy/totalCap:0}, {"cost", cost},
      {"labor_cost", laborCost},
      {"n_setups", sched.nSetups}, {"setup_hours", H(sched.setupMinutes)},
      {"maintenance_hours", H(sched.maintMinutes)},
      {"breakdown_hours_mean", H(finalMc.bdMin)},
      {"flow_time_mean_h", flowMeanH}, {"wait_share", waitShare},
      {"wip_avg", wipAvg}, {"throughput_per_day", thruDay},
      // Новые поля (AUDIT §4.2): знаменатель — Σ календарного фонда станков.
      {"machine_fund_hours", H(totalCap)},
      {"setup_share", totalCap > 0 ? totalSetup / totalCap : 0.0},
      // Коэффициент готовности (оценка): 1 − (плановое ТО детерм. плана + E[ремонт] МК) / Σ фонда.
      {"availability", totalCap > 0
          ? std::max(0.0, 1.0 - (sched.maintMinutes + finalMc.bdMin) / totalCap) : 1.0},
      {"orders_per_day", ordersDay} }},
    {"portfolio_horizon_hours", portfolioHorizon},
    {"n_pins", (int)pinMap.size()},
    {"improver", improverJson},
    {"rules", rulesJson}, {"warnings", warnings},
  };
  return result;
}

}  // namespace maos
