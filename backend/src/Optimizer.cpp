#include "Optimizer.h"
#include <algorithm>
#include <cmath>
#include <random>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace maos {
namespace {

/* ── Утилиты разбора строк из БД (значения приходят как TEXT) ─────────────── */
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
struct Prod {
  std::string id;
  std::string parentId;          // «входит в» (BOM): компоненты p = { q : q.parentId==p }
  double qtyInParent = 1;
  double batchSize   = 1;
  bool   purchased   = false;
  bool   sellable    = false;
  double baseCost    = 0;         // цена закупки (для purchased)
  double basePrice   = 0;         // ориентир цены реализации
  double demandMax   = 0;
};

struct OpInput { std::string productId; double qty = 1; };

struct Op {
  std::string id;
  double tOpt = 0, tNorm = 0, tPess = 0;
  double cost = 0, riskCoef = 0.05;
  bool   setupRequired = false;
  double setupCost = 0, laborRate = 0;
  std::string primaryWct;        // ведущий тип оборудования (для мощности/ставки)
  double hourRate = 0;           // ставка машино-часа ведущего типа
  std::vector<OpInput> inputs;
};

struct Wct { double hourRate = 0; double efficiency = 0.85; int machineCount = 0; };

/* β-PERT среднее. Если t_opt==t_norm==t_pess — детерминированная норма. */
double pertMean(const Op& o) {
  return (o.tOpt + 4.0 * o.tNorm + o.tPess) / 6.0;
}

/* ── Загрузка модели из связанных реестров ───────────────────────────────── */
struct Model {
  std::unordered_map<std::string, Prod> prods;
  std::unordered_map<std::string, std::vector<std::string>> componentsOf;  // p → дочерние BOM
  std::unordered_map<std::string, std::vector<Op>> opsOf;                   // product → операции техкарт
  std::unordered_map<std::string, Wct> wcts;
  std::vector<std::string> sellables;
};

Model load_model(Database& db) {
  Model m;

  // Типы оборудования + число активных машин (фонд мощности).
  for (auto& t : db.query_json("SELECT * FROM work_center_types")) {
    Wct w; w.hourRate = num(t, "hour_rate"); w.efficiency = num(t, "efficiency", 0.85);
    if (w.efficiency <= 0) w.efficiency = 0.85;
    m.wcts[str(t, "id")] = w;
  }
  for (auto& mc : db.query_json(
         "SELECT wc_type_id, COUNT(*) AS n FROM machines "
         "WHERE status='active' AND wc_type_id IS NOT NULL AND wc_type_id<>'' "
         "GROUP BY wc_type_id")) {
    auto it = m.wcts.find(str(mc, "wc_type_id"));
    if (it != m.wcts.end()) it->second.machineCount = (int)num(mc, "n");
  }

  // Изделия + BOM-связи.
  for (auto& p : db.query_json("SELECT * FROM products")) {
    Prod pr;
    pr.id        = str(p, "id");
    pr.parentId  = str(p, "parent_id");
    pr.qtyInParent = num(p, "qty_in_parent", 1);
    pr.batchSize = std::max(1.0, num(p, "batch_size", 1));
    pr.purchased = num(p, "purchased") != 0;
    pr.sellable  = num(p, "sellable") != 0;
    pr.baseCost  = num(p, "base_cost");
    pr.basePrice = num(p, "base_price");
    pr.demandMax = num(p, "demand_max");
    m.prods[pr.id] = pr;
    if (pr.sellable) m.sellables.push_back(pr.id);
  }
  for (auto& [id, pr] : m.prods)
    if (!pr.parentId.empty() && m.prods.count(pr.parentId))
      m.componentsOf[pr.parentId].push_back(id);

  // Операции техкарт по изделию (routings.product_id → operations.routing_id).
  // Ведущий тип оборудования и его ставка — из operation_wc_types (связь по ID).
  auto opWct = [&](const std::string& opId) -> std::string {
    auto rows = db.query_json(
      "SELECT wc_type_id FROM operation_wc_types WHERE operation_id=? LIMIT 1", { opId });
    return rows.empty() ? std::string() : str(rows[0], "wc_type_id");
  };
  auto opInputs = [&](const std::string& opId) -> std::vector<OpInput> {
    std::vector<OpInput> v;
    for (auto& r : db.query_json(
           "SELECT product_id, qty FROM operation_inputs WHERE operation_id=?", { opId }))
      v.push_back({ str(r, "product_id"), num(r, "qty", 1) });
    return v;
  };

  for (auto& r : db.query_json("SELECT id, product_id FROM routings")) {
    const std::string productId = str(r, "product_id");
    if (productId.empty()) continue;
    for (auto& o : db.query_json(
           "SELECT * FROM operations WHERE routing_id=? ORDER BY order_no", { str(r, "id") })) {
      Op op;
      op.id    = str(o, "id");
      op.tOpt  = num(o, "t_opt");  op.tNorm = num(o, "t_norm"); op.tPess = num(o, "t_pess");
      if (op.tOpt  <= 0) op.tOpt  = op.tNorm;
      if (op.tPess <= 0) op.tPess = op.tNorm;
      op.cost  = num(o, "cost");
      op.riskCoef = num(o, "risk_coef", 0.05);
      op.setupRequired = num(o, "setup_required") != 0;
      op.setupCost = num(o, "setup_cost");
      op.laborRate = num(o, "labor_rate");
      op.primaryWct = opWct(op.id);
      auto wit = m.wcts.find(op.primaryWct);
      op.hourRate = (wit != m.wcts.end()) ? wit->second.hourRate : 0;
      op.inputs = opInputs(op.id);
      m.opsOf[productId].push_back(op);
    }
  }
  return m;
}

/* ── Часы на единицу изделия по типам оборудования (детерминир., для мощности) */
void hours_per_unit(const Model& m, const std::string& pid,
                    std::unordered_map<std::string, double>& out,
                    std::unordered_set<std::string>& visiting, int depth = 0) {
  if (depth > 32 || visiting.count(pid)) return;     // защита от циклов BOM
  visiting.insert(pid);
  auto opsIt = m.opsOf.find(pid);
  if (opsIt != m.opsOf.end())
    for (const Op& o : opsIt->second)
      if (!o.primaryWct.empty()) out[o.primaryWct] += pertMean(o) / 60.0;
  auto cit = m.componentsOf.find(pid);
  if (cit != m.componentsOf.end())
    for (const std::string& q : cit->second) {
      const Prod& qp = m.prods.at(q);
      std::unordered_map<std::string, double> sub;
      hours_per_unit(m, q, sub, visiting, depth + 1);
      for (auto& [w, h] : sub) out[w] += h * qp.qtyInParent;
    }
  visiting.erase(pid);
}

/* ── Себестоимость единицы изделия при конкретном прогоне (sampled) ───────── */
// timeFactor[opId] — реализованное время (мин); riskInfl[opId] — множитель риска.
double unit_cost(const Model& m, const std::string& pid,
                 const std::unordered_map<std::string, double>& realizedTime,
                 const std::unordered_map<std::string, double>& riskInfl,
                 std::unordered_map<std::string, double>& memo,
                 std::unordered_set<std::string>& visiting, int depth = 0) {
  if (auto it = memo.find(pid); it != memo.end()) return it->second;
  if (depth > 32 || visiting.count(pid)) return 0;   // защита от циклов
  visiting.insert(pid);
  const Prod& p = m.prods.at(pid);
  double c = p.purchased ? p.baseCost : 0.0;

  // Композиция (BOM-компоненты).
  if (auto cit = m.componentsOf.find(pid); cit != m.componentsOf.end())
    for (const std::string& q : cit->second)
      c += m.prods.at(q).qtyInParent *
           unit_cost(m, q, realizedTime, riskInfl, memo, visiting, depth + 1);

  // Операции техкарты: обработка (машина+труд+наладка+прочее) с инфляцией риска;
  // материалы операций — только покупное сырьё (полуфабрикаты уже в BOM).
  if (auto oit = m.opsOf.find(pid); oit != m.opsOf.end())
    for (const Op& o : oit->second) {
      double t   = realizedTime.count(o.id) ? realizedTime.at(o.id) : pertMean(o);
      double inf = riskInfl.count(o.id)     ? riskInfl.at(o.id)     : 1.0;
      double proc = (t / 60.0) * (o.hourRate + o.laborRate)
                  + (o.setupRequired ? o.setupCost : 0.0) + o.cost;
      c += proc * inf;
      for (const OpInput& in : o.inputs) {
        auto pit = m.prods.find(in.productId);
        if (pit != m.prods.end() && pit->second.purchased)
          c += in.qty * pit->second.baseCost;
      }
    }
  visiting.erase(pid);
  memo[pid] = c;
  return c;
}

/* ── Распределения цены из сценария ───────────────────────────────────────── */
struct PriceDist {
  std::string type = "normal";
  double mean = 0, stddev = 0, minV = 0, maxV = 0, mode = 0;
  bool hasMin = false, hasMax = false, hasMode = false;
};

double sample_dist(const PriceDist& d, std::mt19937& rng) {
  if (d.type == "uniform" && d.hasMin && d.hasMax) {
    std::uniform_real_distribution<double> u(d.minV, d.maxV);
    return u(rng);
  }
  if (d.type == "triangular" && d.hasMin && d.hasMax) {
    double mode = d.hasMode ? d.mode : d.mean;
    std::uniform_real_distribution<double> u(0, 1);
    double r = u(rng), c = (mode - d.minV) / std::max(1e-9, d.maxV - d.minV);
    double v = (r < c) ? d.minV + std::sqrt(r * (d.maxV - d.minV) * (mode - d.minV))
                       : d.maxV - std::sqrt((1 - r) * (d.maxV - d.minV) * (d.maxV - mode));
    return v;
  }
  if (d.type == "lognormal" && d.mean > 0) {
    double cv = (d.mean > 0) ? d.stddev / d.mean : 0;
    double sigma = std::sqrt(std::log(1.0 + cv * cv));
    double mu = std::log(d.mean) - 0.5 * sigma * sigma;
    std::lognormal_distribution<double> ln(mu, std::max(1e-9, sigma));
    return ln(rng);
  }
  std::normal_distribution<double> n(d.mean, std::max(0.0, d.stddev));
  return std::max(0.0, n(rng));
}

/* ── Метрики риска по эмпирическому распределению прибыли ─────────────────── */
struct Metrics {
  double mean = 0, std = 0, worst = 0, varA = 0, cvar = 0, pLoss = 0, downside = 0, best = 0;
};

Metrics metrics_of(std::vector<double> v, double alpha) {
  Metrics mt;
  if (v.empty()) return mt;
  size_t n = v.size();
  double s = 0; for (double x : v) s += x; mt.mean = s / n;
  double ss = 0, ds = 0; int loss = 0;
  for (double x : v) {
    ss += (x - mt.mean) * (x - mt.mean);
    if (x < 0) loss++;
    if (x < mt.mean) ds += (x - mt.mean) * (x - mt.mean);
  }
  mt.std = std::sqrt(ss / n);
  mt.downside = std::sqrt(ds / n);
  mt.pLoss = (double)loss / n;
  std::sort(v.begin(), v.end());
  mt.worst = v.front(); mt.best = v.back();
  size_t k = std::max<size_t>(1, (size_t)std::floor(alpha * n));
  mt.varA = v[k - 1];
  double tail = 0; for (size_t i = 0; i < k; ++i) tail += v[i];
  mt.cvar = tail / k;
  return mt;
}

double robust_score(const std::string& obj, const Metrics& mt, double regret, double lambda) {
  if (obj == "worstcase")    return mt.worst;
  if (obj == "meanvariance") return mt.mean - lambda * mt.std;
  if (obj == "minregret")    return -regret;
  return mt.cvar;  // по умолчанию
}

/* ── Генерация портфелей-кандидатов под ограничение мощности ─────────────── */
using Portfolio = std::vector<double>;  // выровнен по m.sellables

Portfolio greedy_fill(const Model& m, const std::vector<std::vector<std::pair<std::string,double>>>& hpu,
                      const std::unordered_map<std::string, double>& cap,
                      const std::vector<double>& score) {
  size_t S = m.sellables.size();
  Portfolio x(S, 0.0);
  std::unordered_map<std::string, double> rem = cap;
  std::vector<size_t> order(S);
  for (size_t i = 0; i < S; ++i) order[i] = i;
  std::stable_sort(order.begin(), order.end(),
                   [&](size_t a, size_t b) { return score[a] > score[b]; });
  for (size_t idx : order) {
    if (score[idx] <= 0) continue;
    const Prod& p = m.prods.at(m.sellables[idx]);
    double q = p.demandMax > 0 ? p.demandMax : 1e9;
    for (auto& [w, h] : hpu[idx]) if (h > 0 && rem.count(w))
      q = std::min(q, rem.at(w) / h);
    q = std::floor(q / p.batchSize) * p.batchSize;
    if (q <= 0) continue;
    x[idx] = q;
    for (auto& [w, h] : hpu[idx]) if (rem.count(w)) rem[w] -= q * h;
  }
  return x;
}

double hours_total(const std::vector<std::pair<std::string,double>>& hp) {
  double t = 0; for (auto& [w, h] : hp) t += h; return t;
}

}  // namespace

/* ── Главная процедура ───────────────────────────────────────────────────── */
json run_optimization(Database& db, const OptimizeParams& p) {
  Model m = load_model(db);
  size_t S = m.sellables.size();
  json warnings = json::array();
  if (S == 0) {
    warnings.push_back("Нет товарных изделий (products.sellable=1) — оптимизировать нечего.");
    return { {"error_soft", true}, {"warnings", warnings},
             {"sellables", 0} };
  }

  // Горизонт + фонд мощности по типам оборудования.
  double horizon = p.horizonHours;
  std::string scenName = "Базовые цены НСИ";
  if (!p.scenarioId.empty()) {
    try {
      auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { p.scenarioId });
      scenName = str(sc, "name");
      if (horizon <= 0) horizon = num(sc, "horizon_hours", 720);
    } catch (...) { warnings.push_back("Сценарий не найден — берутся базовые цены."); }
  }
  if (horizon <= 0) horizon = 720;

  std::unordered_map<std::string, double> cap;
  for (auto& [id, w] : m.wcts)
    cap[id] = (double)w.machineCount * horizon * w.efficiency;

  // Часы на единицу по типам (детерминированно) + суммарные часы.
  std::vector<std::vector<std::pair<std::string,double>>> hpu(S);
  for (size_t i = 0; i < S; ++i) {
    std::unordered_map<std::string, double> h;
    std::unordered_set<std::string> vis;
    hours_per_unit(m, m.sellables[i], h, vis);
    for (auto& [w, v] : h) hpu[i].push_back({ w, v });
    if (hpu[i].empty())
      warnings.push_back("Изделие " + m.sellables[i] + " не имеет операций/мощности.");
  }

  // Распределения цены для товарных изделий.
  std::unordered_map<std::string, PriceDist> priceDist;
  if (!p.scenarioId.empty()) {
    for (auto& d : db.query_json(
           "SELECT * FROM price_distributions WHERE scenario_id=?", { p.scenarioId })) {
      PriceDist pd;
      pd.type = str(d, "dist_type"); if (pd.type.empty()) pd.type = "normal";
      pd.mean = num(d, "mean"); pd.stddev = num(d, "stddev");
      if (d.contains("min_val") && !d["min_val"].is_null() && str(d,"min_val")!="")
        { pd.minV = num(d, "min_val"); pd.hasMin = true; }
      if (d.contains("max_val") && !d["max_val"].is_null() && str(d,"max_val")!="")
        { pd.maxV = num(d, "max_val"); pd.hasMax = true; }
      if (d.contains("mode_val") && !d["mode_val"].is_null() && str(d,"mode_val")!="")
        { pd.mode = num(d, "mode_val"); pd.hasMode = true; }
      priceDist[str(d, "product_id")] = pd;
    }
  }
  // Фолбэк: если у товарного изделия нет распределения — нормальное вокруг basePrice
  // с CV=12%, чтобы стохастика и риск всё равно моделировались.
  for (const std::string& sid : m.sellables) {
    if (priceDist.count(sid)) continue;
    const Prod& pr = m.prods.at(sid);
    PriceDist pd; pd.type = "normal"; pd.mean = pr.basePrice;
    pd.stddev = pr.basePrice * 0.12;
    priceDist[sid] = pd;
  }

  // ── Монте-Карло: общие случайные числа для честного сравнения портфелей ──
  const int N = std::max(200, p.samples);
  std::mt19937 rng(p.seed);

  // Список всех операций (для сэмплирования времени/риска).
  std::vector<const Op*> allOps;
  for (auto& [pid, ops] : m.opsOf) for (const Op& o : ops) allOps.push_back(&o);

  // Цены и себестоимости товарных изделий по прогонам.
  std::vector<std::vector<double>> price(N, std::vector<double>(S, 0));
  std::vector<std::vector<double>> cost(N, std::vector<double>(S, 0));
  std::uniform_real_distribution<double> u01(0, 1);

  for (int i = 0; i < N; ++i) {
    // Реализованное время и инфляция риска для каждой операции.
    std::unordered_map<std::string, double> realizedTime, riskInfl;
    for (const Op* o : allOps) {
      double t = pertMean(*o);
      if (o->tPess > o->tOpt) {                    // триангулярная аппроксимация PERT
        PriceDist td; td.type = "triangular"; td.minV = o->tOpt; td.maxV = o->tPess;
        td.mode = o->tNorm; td.hasMin = td.hasMax = td.hasMode = true; td.mean = o->tNorm;
        t = sample_dist(td, rng);
      }
      realizedTime[o->id] = t;
      double infl = 1.0;
      if (u01(rng) < o->riskCoef) infl = 1.0 + 0.5;  // риск-событие → +50% переделка
      riskInfl[o->id] = infl;
    }
    // Цены товарных изделий.
    for (size_t s = 0; s < S; ++s)
      price[i][s] = sample_dist(priceDist[m.sellables[s]], rng);
    // Себестоимость (мемоизация в пределах прогона).
    std::unordered_map<std::string, double> memo;
    for (size_t s = 0; s < S; ++s) {
      std::unordered_set<std::string> vis;
      cost[i][s] = unit_cost(m, m.sellables[s], realizedTime, riskInfl, memo, vis);
    }
  }

  // Средние маржа/себестоимость (для генерации кандидатов).
  std::vector<double> meanCost(S, 0), meanPrice(S, 0), stdMargin(S, 0);
  for (size_t s = 0; s < S; ++s) {
    double sc = 0, sp = 0; for (int i = 0; i < N; ++i) { sc += cost[i][s]; sp += price[i][s]; }
    meanCost[s] = sc / N; meanPrice[s] = sp / N;
    double mm = meanPrice[s] - meanCost[s], ss = 0;
    for (int i = 0; i < N; ++i) { double mg = price[i][s] - cost[i][s]; ss += (mg-mm)*(mg-mm); }
    stdMargin[s] = std::sqrt(ss / N);
  }

  // ── Кандидаты ────────────────────────────────────────────────────────────
  std::vector<Portfolio> cand;
  auto add = [&](Portfolio x) {
    for (double v : x) if (v > 0) { cand.push_back(std::move(x)); return; }
  };
  std::vector<double> scExp(S), scWorst(S), scPerHour(S), scDemand(S), scEqual(S, 1.0);
  for (size_t s = 0; s < S; ++s) {
    scExp[s]    = meanPrice[s] - meanCost[s];                       // макс ожидаемая маржа
    scWorst[s]  = scExp[s] - 1.5 * stdMargin[s];                    // макс «худшая» маржа
    double th   = std::max(1e-6, hours_total(hpu[s]));
    scPerHour[s] = scExp[s] / th;                                   // маржа на час узкого ресурса
    scDemand[s]  = m.prods.at(m.sellables[s]).demandMax;            // по спросу
  }
  add(greedy_fill(m, hpu, cap, scExp));
  add(greedy_fill(m, hpu, cap, scWorst));
  add(greedy_fill(m, hpu, cap, scPerHour));
  add(greedy_fill(m, hpu, cap, scDemand));
  add(greedy_fill(m, hpu, cap, scEqual));
  // Случайные пертурбации весов → разнообразие портфелей.
  std::uniform_real_distribution<double> uw(0.05, 1.0);
  for (int r = 0; r < 60; ++r) {
    std::vector<double> w(S);
    for (size_t s = 0; s < S; ++s) w[s] = scExp[s] * uw(rng);
    add(greedy_fill(m, hpu, cap, w));
  }
  if (cand.empty()) {                                              // на всякий случай
    Portfolio x(S, 0); for (size_t s = 0; s < S; ++s) {
      const Prod& pr = m.prods.at(m.sellables[s]);
      x[s] = pr.demandMax > 0 ? pr.demandMax : pr.batchSize;
    }
    cand.push_back(x);
  }

  // ── Оценка кандидатов по прогонам (общие случайные числа уже зафиксированы) ─
  size_t K = cand.size();
  std::vector<std::vector<double>> profit(K, std::vector<double>(N, 0));
  for (size_t c = 0; c < K; ++c)
    for (int i = 0; i < N; ++i) {
      double pr = 0;
      for (size_t s = 0; s < S; ++s)
        pr += cand[c][s] * (price[i][s] - cost[i][s]);
      profit[c][i] = pr;
    }
  // Регрет: для каждого прогона лучший среди кандидатов.
  std::vector<double> bestPer(N, -1e300);
  for (int i = 0; i < N; ++i)
    for (size_t c = 0; c < K; ++c) bestPer[i] = std::max(bestPer[i], profit[c][i]);
  std::vector<double> regret(K, 0);
  for (size_t c = 0; c < K; ++c) {
    double mr = 0; for (int i = 0; i < N; ++i) mr = std::max(mr, bestPer[i] - profit[c][i]);
    regret[c] = mr;
  }

  std::vector<Metrics> mts(K);
  for (size_t c = 0; c < K; ++c) mts[c] = metrics_of(profit[c], p.alpha);

  // Выбор робастного и ожидаемо-лучшего.
  size_t robustIdx = 0, expIdx = 0;
  double bestRobust = -1e300, bestExp = -1e300;
  for (size_t c = 0; c < K; ++c) {
    double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
    if (rs > bestRobust) { bestRobust = rs; robustIdx = c; }
    if (mts[c].mean > bestExp) { bestExp = mts[c].mean; expIdx = c; }
  }

  // ── Сборка результата ────────────────────────────────────────────────────
  auto portfolioJson = [&](size_t c) {
    json items = json::array();
    std::unordered_map<std::string, double> loadByWct;
    double totalHours = 0;
    for (size_t s = 0; s < S; ++s) {
      if (cand[c][s] <= 0) continue;
      const Prod& pr = m.prods.at(m.sellables[s]);
      double unitMargin = meanPrice[s] - meanCost[s];
      items.push_back({
        {"product_id", m.sellables[s]},
        {"qty", cand[c][s]},
        {"unit_price", meanPrice[s]},
        {"unit_cost", meanCost[s]},
        {"unit_margin", unitMargin},
        {"contribution", unitMargin * cand[c][s]},
      });
      for (auto& [w, h] : hpu[s]) { loadByWct[w] += cand[c][s] * h; totalHours += cand[c][s]*h; }
    }
    json load = json::array();
    for (auto& [w, h] : loadByWct)
      load.push_back({ {"wc_type_id", w}, {"load_hours", h},
                       {"capacity_hours", cap.count(w) ? cap[w] : 0},
                       {"utilization", cap.count(w) && cap[w] > 0 ? h / cap[w] : 0} });
    const Metrics& mt = mts[c];
    return json{
      {"items", items}, {"resource_load", load}, {"total_load_hours", totalHours},
      {"metrics", {
        {"expected", mt.mean}, {"std", mt.std}, {"worst_case", mt.worst},
        {"var", mt.varA}, {"cvar", mt.cvar}, {"p_loss", mt.pLoss},
        {"downside", mt.downside}, {"best", mt.best}, {"max_regret", regret[c]},
      }},
    };
  };

  // Гистограмма прибыли робастного портфеля.
  json hist = json::array();
  {
    std::vector<double> v = profit[robustIdx];
    std::sort(v.begin(), v.end());
    double lo = v.front(), hi = v.back();
    int bins = 24; double w = (hi - lo) / std::max(1, bins);
    if (w <= 0) w = 1;
    std::vector<int> counts(bins, 0);
    for (double x : v) { int b = (int)((x - lo) / w); if (b >= bins) b = bins-1; if (b<0) b=0; counts[b]++; }
    for (int b = 0; b < bins; ++b)
      hist.push_back({ {"x0", lo + b*w}, {"x1", lo + (b+1)*w}, {"count", counts[b]} });
  }

  json robustPf = portfolioJson(robustIdx);
  json expPf    = portfolioJson(expIdx);
  double priceOfRobustness = mts[expIdx].mean - mts[robustIdx].mean;

  // Краткий ранжированный список кандидатов (по робастному критерию).
  std::vector<size_t> rank(K); for (size_t i = 0; i < K; ++i) rank[i] = i;
  std::sort(rank.begin(), rank.end(), [&](size_t a, size_t b) {
    return robust_score(p.objective, mts[a], regret[a], p.lambda) >
           robust_score(p.objective, mts[b], regret[b], p.lambda);
  });
  json candList = json::array();
  for (size_t i = 0; i < std::min<size_t>(8, K); ++i) {
    size_t c = rank[i];
    candList.push_back({
      {"expected", mts[c].mean}, {"cvar", mts[c].cvar},
      {"worst_case", mts[c].worst}, {"std", mts[c].std},
      {"p_loss", mts[c].pLoss}, {"max_regret", regret[c]},
      {"is_robust", c == robustIdx}, {"is_expected", c == expIdx},
    });
  }

  json result = {
    {"scenario_id", p.scenarioId}, {"scenario_name", scenName},
    {"objective", p.objective}, {"samples", N}, {"alpha", p.alpha},
    {"lambda", p.lambda}, {"seed", (int)p.seed}, {"horizon_hours", horizon},
    {"sellables", (int)S},
    {"robust", robustPf}, {"expected", expPf},
    {"price_of_robustness", priceOfRobustness},
    {"histogram", hist}, {"candidates", candList},
    {"warnings", warnings},
  };
  return result;
}

}  // namespace maos
