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

/* ── Часы на единицу изделия по типам оборудования (детерминир., для мощности) ──
   Загрузка распространяется по производственной цепочке через ВХОДЫ операций
   (operation_inputs) — общий полуфабрикат тянет за собой весь верхний передел
   (узкое место), сколько бы изделий его ни потребляло (DAG, не дерево). */
void hours_per_unit(const Model& m, const std::string& pid,
                    std::unordered_map<std::string, double>& out,
                    std::unordered_set<std::string>& visiting, int depth = 0) {
  if (depth > 48 || visiting.count(pid)) return;     // защита от циклов цепочки
  visiting.insert(pid);
  auto opsIt = m.opsOf.find(pid);
  if (opsIt != m.opsOf.end())
    for (const Op& o : opsIt->second) {
      if (!o.primaryWct.empty()) out[o.primaryWct] += pertMean(o) / 60.0;
      for (const OpInput& in : o.inputs) {            // входы операции → цепочка
        std::unordered_map<std::string, double> sub;
        hours_per_unit(m, in.productId, sub, visiting, depth + 1);
        for (auto& [w, h] : sub) out[w] += h * in.qty;
      }
    }
  visiting.erase(pid);
}

/* ── Себестоимость единицы изделия при конкретном прогоне (sampled) ───────── */
// timeFactor[opId] — реализованное время (мин); riskInfl[opId] — множитель риска.
double unit_cost(const Model& m, const std::string& pid,
                 const std::unordered_map<std::string, double>& realizedTime,
                 const std::unordered_map<std::string, double>& riskInfl,
                 const std::unordered_map<std::string, double>& matFactor,  // множитель цены сырья
                 std::unordered_map<std::string, double>& memo,
                 std::unordered_set<std::string>& visiting, int depth = 0) {
  if (auto it = memo.find(pid); it != memo.end()) return it->second;
  if (depth > 48 || visiting.count(pid)) return 0;   // защита от циклов цепочки
  visiting.insert(pid);
  const Prod& p = m.prods.at(pid);
  // Цена покупного сырья — СТОХАСТИЧНА (может сильно вырасти): base_cost × множитель.
  double rawF = matFactor.count(pid) ? matFactor.at(pid) : 1.0;
  double c = p.purchased ? p.baseCost * rawF : 0.0;

  // Операции техкарты: обработка (машина+труд+наладка+прочее) с инфляцией риска +
  // материалы входов операции по производственной цепочке (рекурсивно): покупное
  // сырьё даёт base_cost, полуфабрикат — свою накопленную себестоимость.
  if (auto oit = m.opsOf.find(pid); oit != m.opsOf.end())
    for (const Op& o : oit->second) {
      double t   = realizedTime.count(o.id) ? realizedTime.at(o.id) : pertMean(o);
      double inf = riskInfl.count(o.id)     ? riskInfl.at(o.id)     : 1.0;
      double proc = (t / 60.0) * (o.hourRate + o.laborRate)
                  + (o.setupRequired ? o.setupCost : 0.0) + o.cost;
      c += proc * inf;
      for (const OpInput& in : o.inputs)
        c += in.qty * unit_cost(m, in.productId, realizedTime, riskInfl, matFactor, memo, visiting, depth + 1);
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
  double beta = 1.0;   // загрузка на общий рыночный фактор (корреляция цен)
};

/* CDF стандартного нормального через erfc. */
double normal_cdf(double x) { return 0.5 * std::erfc(-x / std::sqrt(2.0)); }

/* Маргиналь по стандартному нормальному шоку z (гауссова копула):
   корреляция между ценами наводится общим z через beta, см. correlated-sampling. */
double price_from_z(const PriceDist& d, double z) {
  if (d.type == "uniform" && d.hasMin && d.hasMax) {
    return d.minV + (d.maxV - d.minV) * normal_cdf(z);
  }
  if (d.type == "triangular" && d.hasMin && d.hasMax) {
    double mode = d.hasMode ? d.mode : d.mean;
    double r = normal_cdf(z), c = (mode - d.minV) / std::max(1e-9, d.maxV - d.minV);
    return (r < c) ? d.minV + std::sqrt(r * (d.maxV - d.minV) * (mode - d.minV))
                   : d.maxV - std::sqrt((1 - r) * (d.maxV - d.minV) * (d.maxV - mode));
  }
  if (d.type == "lognormal" && d.mean > 0) {
    double cv = d.stddev / d.mean;
    double sigma = std::sqrt(std::log(1.0 + cv * cv));
    double mu = std::log(d.mean) - 0.5 * sigma * sigma;
    return std::exp(mu + std::max(1e-9, sigma) * z);
  }
  return std::max(0.0, d.mean + std::max(0.0, d.stddev) * z);  // normal
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

/* Диверсифицированное распределение мощности пропорционально весам (water-filling):
   масштаб T максимизируется до первого упёршегося ограничения (мощность/спрос).
   Даёт портфель, размазанный по нескольким изделиям, — «не ставить всё на одно». */
Portfolio proportional_fill(const Model& m,
                            const std::vector<std::vector<std::pair<std::string,double>>>& hpu,
                            const std::unordered_map<std::string, double>& cap,
                            const std::vector<double>& weights) {
  size_t S = m.sellables.size();
  Portfolio x(S, 0.0);
  double sumW = 0; for (double w : weights) sumW += std::max(0.0, w);
  if (sumW <= 0) return x;

  // Нагрузка на тип оборудования при T=1 (Σ_s w_s·часы_s,wct).
  std::unordered_map<std::string, double> loadPerT;
  for (size_t s = 0; s < S; ++s) {
    double w = std::max(0.0, weights[s]);
    if (w <= 0) continue;
    for (auto& [wct, h] : hpu[s]) loadPerT[wct] += w * h;
  }
  // T, ограниченное мощностью каждого типа.
  double T = 1e18;
  for (auto& [wct, perT] : loadPerT)
    if (perT > 0 && cap.count(wct))
      T = std::min(T, cap.at(wct) / perT);
  // T, ограниченное спросом по каждому изделию.
  for (size_t s = 0; s < S; ++s) {
    double w = std::max(0.0, weights[s]);
    double dem = m.prods.at(m.sellables[s]).demandMax;
    if (w > 0 && dem > 0) T = std::min(T, dem / w);
  }
  if (T >= 1e17 || T <= 0) return x;

  for (size_t s = 0; s < S; ++s) {
    double w = std::max(0.0, weights[s]);
    if (w <= 0) continue;
    const Prod& p = m.prods.at(m.sellables[s]);
    double q = w * T;
    if (p.demandMax > 0) q = std::min(q, p.demandMax);
    q = std::floor(q / p.batchSize) * p.batchSize;
    x[s] = std::max(0.0, q);
  }
  return x;
}

/* Концентрация портфеля = макс. доля одного изделия в выручке (по средним ценам). */
double concentration(const Portfolio& x, const std::vector<double>& meanPrice) {
  double total = 0, mx = 0;
  for (size_t s = 0; s < x.size(); ++s) { double v = x[s] * meanPrice[s]; total += v; mx = std::max(mx, v); }
  return total > 0 ? mx / total : 1.0;
}

/* Индекс Херфиндаля по долям выручки → эффективное число изделий = 1/HHI. */
double herfindahl(const std::vector<double>& x, const std::vector<double>& meanPrice) {
  double total = 0; for (size_t s = 0; s < x.size(); ++s) total += x[s] * meanPrice[s];
  if (total <= 0) return 1.0;
  double hhi = 0;
  for (size_t s = 0; s < x.size(); ++s) { double sh = x[s] * meanPrice[s] / total; hhi += sh * sh; }
  return hhi;
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
  double marketCorr = 0.5;            // взаимосвязь цен (общий рыночный фактор)
  std::string scenName = "Базовые цены НСИ";
  if (!p.scenarioId.empty()) {
    try {
      auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { p.scenarioId });
      scenName = str(sc, "name");
      if (horizon <= 0) horizon = num(sc, "horizon_hours", 720);
      marketCorr = num(sc, "market_corr", 0.5);
    } catch (...) { warnings.push_back("Сценарий не найден — берутся базовые цены."); }
  }
  if (horizon <= 0) horizon = 720;
  marketCorr = std::min(0.98, std::max(0.0, marketCorr));
  const double betaMarket = std::sqrt(marketCorr);  // загрузка по умолчанию на фактор

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
      // Загрузка на рыночный фактор (корреляция). По умолчанию — от market_corr.
      pd.beta = (d.contains("beta") && str(d,"beta") != "") ? num(d, "beta", betaMarket) : betaMarket;
      pd.beta = std::min(1.0, std::max(0.0, pd.beta));
      priceDist[str(d, "product_id")] = pd;
    }
  }
  // Фолбэк: если у товарного изделия нет распределения — нормальное вокруг basePrice
  // с CV=12%, чтобы стохастика и риск всё равно моделировались.
  for (const std::string& sid : m.sellables) {
    if (priceDist.count(sid)) continue;
    const Prod& pr = m.prods.at(sid);
    PriceDist pd; pd.type = "normal"; pd.mean = pr.basePrice;
    pd.stddev = pr.basePrice * 0.12; pd.beta = betaMarket;
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

  // Покупное сырьё — для стохастики цены закупки (может сильно вырасти).
  std::vector<std::string> rawMats;
  for (auto& [id, pr] : m.prods) if (pr.purchased && pr.baseCost > 0) rawMats.push_back(id);

  std::normal_distribution<double> nstd(0.0, 1.0);
  for (int i = 0; i < N; ++i) {
    // Реализованное время и инфляция риска для каждой операции.
    std::unordered_map<std::string, double> realizedTime, riskInfl;
    for (const Op* o : allOps) {
      double t = pertMean(*o);
      if (o->tPess > o->tOpt) {                    // триангулярная аппроксимация PERT
        PriceDist td; td.type = "triangular"; td.minV = o->tOpt; td.maxV = o->tPess;
        td.mode = o->tNorm; td.hasMin = td.hasMax = td.hasMode = true; td.mean = o->tNorm;
        t = price_from_z(td, nstd(rng));
      }
      realizedTime[o->id] = t;
      double infl = 1.0;
      if (u01(rng) < o->riskCoef) infl = 1.0 + 0.5;  // риск-событие → +50% переделка
      riskInfl[o->id] = infl;
    }
    // Цены товарных изделий — КОРРЕЛИРОВАННО (гауссова копула): общий рыночный
    // шок M роднит цены, β_s задаёт силу связи. z_s = β_s·M + √(1−β_s²)·ε_s.
    // Корреляция цен s,t ≈ β_s·β_t — это и есть «анализ взаимосвязи цен».
    double M = nstd(rng);
    for (size_t s = 0; s < S; ++s) {
      const PriceDist& pd = priceDist[m.sellables[s]];
      double eps = nstd(rng);
      double z = pd.beta * M + std::sqrt(std::max(0.0, 1.0 - pd.beta * pd.beta)) * eps;
      price[i][s] = price_from_z(pd, z);
    }
    // Цена СЫРЬЯ — тоже стохастична и может СИЛЬНО вырасти: логнормальный множитель
    // (CV ~20%), коррелирован с рынком (β=√market_corr) + редкий скачок (Парето).
    std::unordered_map<std::string, double> matFactor;
    {
      const double rawCv = 0.20, betaRaw = std::sqrt(marketCorr);
      const double slRaw = std::sqrt(std::log(1.0 + rawCv * rawCv));
      for (const std::string& mid : rawMats) {
        double zr = betaRaw * M + std::sqrt(std::max(0.0, 1.0 - betaRaw * betaRaw)) * nstd(rng);
        double f = std::exp(slRaw * zr - 0.5 * slRaw * slRaw);
        if (u01(rng) < 0.06)                          // редкий скачок цены сырья
          f *= 1.0 + std::min(2.5, std::pow(std::max(1e-9, 1.0 - u01(rng)), -1.0 / 2.0) - 1.0);
        matFactor[mid] = f;
      }
    }
    // Себестоимость (мемоизация в пределах прогона).
    std::unordered_map<std::string, double> memo;
    for (size_t s = 0; s < S; ++s) {
      std::unordered_set<std::string> vis;
      cost[i][s] = unit_cost(m, m.sellables[s], realizedTime, riskInfl, matFactor, memo, vis);
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
  // Генерируем И концентрированные (greedy, «всё на одно»), И диверсифицированные
  // (water-filling по весам) портфели. Отбор по робастному критерию с ограничением
  // концентрации (maxShare) выберет устойчивый ПОРТФЕЛЬ РИСКОВ, размазанный по
  // изделиям и оборудованию.
  std::vector<Portfolio> cand;
  auto add = [&](Portfolio x) {
    for (double v : x) if (v > 0) { cand.push_back(std::move(x)); return; }
  };
  std::vector<double> margin(S), scPerHour(S);
  for (size_t s = 0; s < S; ++s) {
    margin[s]   = meanPrice[s] - meanCost[s];
    scPerHour[s] = margin[s] / std::max(1e-6, hours_total(hpu[s]));
  }
  auto pos = [](double v) { return std::max(0.0, v); };

  // Концентрированные (для контраста — будут отфильтрованы maxShare при отборе).
  add(greedy_fill(m, hpu, cap, margin));
  add(greedy_fill(m, hpu, cap, scPerHour));

  // Диверсифицированные веса → water-filling.
  std::vector<double> wExp(S), wEqual(S), wRP(S), wPH(S), wDem(S);
  for (size_t s = 0; s < S; ++s) {
    wExp[s]   = pos(margin[s]);
    wEqual[s] = margin[s] > 0 ? 1.0 : 0.0;
    wRP[s]    = margin[s] > 0 ? 1.0 / std::max(1.0, stdMargin[s]) : 0.0;  // risk-parity (1/σ)
    wPH[s]    = pos(scPerHour[s]);
    wDem[s]   = m.prods.at(m.sellables[s]).demandMax;
  }
  add(proportional_fill(m, hpu, cap, wExp));
  add(proportional_fill(m, hpu, cap, wEqual));
  add(proportional_fill(m, hpu, cap, wRP));
  add(proportional_fill(m, hpu, cap, wPH));
  add(proportional_fill(m, hpu, cap, wDem));
  // Mean-variance: веса ∝ max(0, маржа − λ·σ) — сдвиг к устойчивым изделиям.
  for (double lam : {0.5, 1.0, 1.5, 2.5, 4.0}) {
    std::vector<double> w(S);
    for (size_t s = 0; s < S; ++s) w[s] = pos(margin[s] - lam * stdMargin[s]);
    add(proportional_fill(m, hpu, cap, w));
  }
  // Случайные диверсифицированные смеси → разнообразие портфелей.
  std::uniform_real_distribution<double> uw(0.0, 1.0);
  for (int r = 0; r < 80; ++r) {
    std::vector<double> w(S);
    for (size_t s = 0; s < S; ++s) w[s] = (margin[s] > 0) ? std::pow(uw(rng), 1.5) : 0.0;
    add(proportional_fill(m, hpu, cap, w));
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
  std::vector<double> conc(K);
  for (size_t c = 0; c < K; ++c) {
    mts[c] = metrics_of(profit[c], p.alpha);
    conc[c] = concentration(cand[c], meanPrice);
  }
  double maxShare = std::min(1.0, std::max(0.1, p.maxShare));

  // Робаст — устойчивый ДИВЕРСИФИЦИРОВАННЫЙ портфель: лучший робаст-критерий среди
  // кандидатов с концентрацией ≤ maxShare («не ставить всё на одно»). Ожидаемо-лучшее —
  // наивный максимум матожидания БЕЗ ограничения (для контраста, обычно концентрирован).
  size_t robustIdx = SIZE_MAX, expIdx = 0;
  double bestRobust = -1e300, bestExp = -1e300;
  for (size_t c = 0; c < K; ++c) {
    if (conc[c] <= maxShare + 1e-9) {
      double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
      if (rs > bestRobust) { bestRobust = rs; robustIdx = c; }
    }
    if (mts[c].mean > bestExp) { bestExp = mts[c].mean; expIdx = c; }
  }
  if (robustIdx == SIZE_MAX) {                      // ни один не уложился в maxShare
    warnings.push_back("Слишком мало изделий для диверсификации в пределах maxShare.");
    for (size_t c = 0; c < K; ++c) {
      double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
      if (rs > bestRobust) { bestRobust = rs; robustIdx = c; }
    }
  }

  // ── Сборка результата ────────────────────────────────────────────────────
  auto portfolioJson = [&](size_t c) {
    const Portfolio& x = cand[c];
    // Профиль прибыли портфеля и вклад каждого изделия в риск (доля ковариации
    // с прибылью портфеля). Сумма вкладов = 1 — видно, что «гонит» риск.
    std::vector<double> P(N, 0.0);
    for (int i = 0; i < N; ++i) { double pr = 0;
      for (size_t s = 0; s < S; ++s) pr += x[s] * (price[i][s] - cost[i][s]); P[i] = pr; }
    double meanP = 0; for (double v : P) meanP += v; meanP /= N;
    double varP = 0; for (double v : P) varP += (v - meanP) * (v - meanP); varP /= N;
    if (varP < 1e-6) varP = 1e-6;
    auto riskContrib = [&](size_t s) -> double {
      if (x[s] <= 0) return 0;
      double mc = 0; for (int i = 0; i < N; ++i) mc += x[s] * (price[i][s] - cost[i][s]); mc /= N;
      double cov = 0; for (int i = 0; i < N; ++i)
        cov += (x[s] * (price[i][s] - cost[i][s]) - mc) * (P[i] - meanP);
      return (cov / N) / varP;
    };

    json items = json::array();
    std::unordered_map<std::string, double> loadByWct;
    double totalHours = 0; int nProd = 0;
    for (size_t s = 0; s < S; ++s) {
      if (x[s] <= 0) continue;
      ++nProd;
      double unitMargin = meanPrice[s] - meanCost[s];
      items.push_back({
        {"product_id", m.sellables[s]},
        {"qty", x[s]},
        {"unit_price", meanPrice[s]},
        {"unit_cost", meanCost[s]},
        {"unit_margin", unitMargin},
        {"contribution", unitMargin * x[s]},
        {"risk_contribution", riskContrib(s)},
      });
      for (auto& [w, h] : hpu[s]) { loadByWct[w] += x[s] * h; totalHours += x[s]*h; }
    }
    json load = json::array();
    for (auto& [w, h] : loadByWct)
      load.push_back({ {"wc_type_id", w}, {"load_hours", h},
                       {"capacity_hours", cap.count(w) ? cap[w] : 0},
                       {"utilization", cap.count(w) && cap[w] > 0 ? h / cap[w] : 0} });
    double hhi = herfindahl(x, meanPrice);
    const Metrics& mt = mts[c];
    return json{
      {"items", items}, {"resource_load", load}, {"total_load_hours", totalHours},
      {"diversification", {
        {"n_products", nProd}, {"hhi", hhi}, {"effective_n", hhi > 0 ? 1.0 / hhi : 1.0},
        {"concentration", concentration(x, meanPrice)},
      }},
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
    {"market_corr", marketCorr}, {"max_share", maxShare},
    {"sellables", (int)S},
    {"robust", robustPf}, {"expected", expPf},
    {"price_of_robustness", priceOfRobustness},
    {"histogram", hist}, {"candidates", candList},
    {"warnings", warnings},
  };
  return result;
}

}  // namespace maos
