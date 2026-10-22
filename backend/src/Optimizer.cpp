#include "Optimizer.h"
#include "CashOptimize.h"
#include "ExactCvar.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
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
  double marketCapacity   = 0;    // ёмкость рынка (ед., которые рынок выкупает по базе)
  double priceElasticity  = 0.5;  // эластичность цены по перепроизводству
  double competitorSupply = 0;    // объём конкурентов на рынке
};

struct OpInput { std::string productId; double qty = 1; };

struct Op {
  std::string id;
  int idx = -1;                  // сквозной индекс операции (горячий цикл МК — по векторам)
  double tOpt = 0, tNorm = 0, tPess = 0;
  double cost = 0, riskCoef = 0.05;
  double tailWeight = 0.08, tailIndex = 2.5;   // тяжёлый хвост длительности (как в Стадии 1)
  bool   setupRequired = false;
  double setupTime = 0;          // наладка, мин (входит в фонд мощности на партию)
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
  bool tailUplift = true;        // R4: хвостовая поправка мощности (см. tail_uplift)
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
    pr.marketCapacity   = num(p, "market_capacity");
    pr.priceElasticity  = num(p, "price_elasticity", 0.5);
    pr.competitorSupply = num(p, "competitor_supply");
    m.prods[pr.id] = pr;
    if (pr.sellable) m.sellables.push_back(pr.id);
  }
  for (auto& [id, pr] : m.prods)
    if (!pr.parentId.empty() && m.prods.count(pr.parentId))
      m.componentsOf[pr.parentId].push_back(id);

  // Связи операций — ДВУМЯ запросами на всю модель (было по 2 запроса на каждую
  // операцию: сотни SQL-обращений под глобальным мьютексом на один /api/optimize).
  std::unordered_map<std::string, std::string> wctOf;             // op → ведущий тип
  for (auto& r : db.query_json(
         "SELECT operation_id, wc_type_id FROM operation_wc_types ORDER BY rowid"))
    wctOf.emplace(str(r, "operation_id"), str(r, "wc_type_id")); // первый = ведущий
  std::unordered_map<std::string, std::vector<OpInput>> inputsOf;
  for (auto& r : db.query_json("SELECT operation_id, product_id, qty FROM operation_inputs"))
    inputsOf[str(r, "operation_id")].push_back({ str(r, "product_id"), num(r, "qty", 1) });

  // Нормы «операция × тип» — перекрывают плоскую норму операции для ведущего типа.
  struct PairNorm { double tOpt, tNorm, tPess, setup; };
  std::unordered_map<std::string, PairNorm> normOf;
  for (auto& r : db.query_json("SELECT * FROM time_norms"))
    normOf[str(r, "operation_id") + "|" + str(r, "wc_type_id")] =
      { num(r, "t_opt"), num(r, "t_norm"), num(r, "t_pess"), num(r, "setup_time") };

  // Операции техкарт по изделию — одним JOIN-запросом (ДЕЙСТВУЮЩАЯ версия техкарты).
  int opIdx = 0;
  for (auto& o : db.query_json(
         "SELECT o.*, r.product_id AS product_of FROM routings r "
         "JOIN operations o ON o.routing_id = r.id "
         "WHERE r.product_id IS NOT NULL AND r.product_id <> '' "
         "AND COALESCE(r.is_default,1)=1 "
         "ORDER BY r.product_id, o.order_no, o.id")) {
    const std::string productId = str(o, "product_of");
    Op op;
    op.id    = str(o, "id");
    op.idx   = opIdx++;
    op.tOpt  = num(o, "t_opt");  op.tNorm = num(o, "t_norm"); op.tPess = num(o, "t_pess");
    if (op.tOpt  <= 0) op.tOpt  = op.tNorm;
    if (op.tPess <= 0) op.tPess = op.tNorm;
    op.cost  = num(o, "cost");
    op.riskCoef = num(o, "risk_coef", 0.05);
    op.tailWeight = num(o, "tail_weight", 0.08);
    op.tailIndex  = std::max(1.2, num(o, "tail_index", 2.5));
    op.setupRequired = num(o, "setup_required") != 0;
    op.setupTime = num(o, "setup_time");
    op.setupCost = num(o, "setup_cost");
    op.laborRate = num(o, "labor_rate");
    if (auto wit2 = wctOf.find(op.id); wit2 != wctOf.end()) op.primaryWct = wit2->second;
    // Норма пары «операция × ведущий тип» приоритетнее плоской нормы операции.
    if (auto nit = normOf.find(op.id + "|" + op.primaryWct); nit != normOf.end()) {
      const PairNorm& pn = nit->second;
      if (pn.tNorm > 0) {
        op.tNorm = pn.tNorm;
        op.tOpt  = pn.tOpt  > 0 ? pn.tOpt  : pn.tNorm;
        op.tPess = pn.tPess > 0 ? pn.tPess : pn.tNorm;
      }
      if (pn.setup > 0) op.setupTime = pn.setup;
    }
    auto wit = m.wcts.find(op.primaryWct);
    op.hourRate = (wit != m.wcts.end()) ? wit->second.hourRate : 0;
    if (auto iit = inputsOf.find(op.id); iit != inputsOf.end()) op.inputs = std::move(iit->second);
    m.opsOf[productId].push_back(std::move(op));
  }
  return m;
}

/* ── R4: ожидаемый множитель длительности той же модели, что sample_dur Стадии 1 ──
   d = LN(mean)·[1 + min(8, F−1)]·1{U<w} + 0.5·mean·1{U<risk},  F = U^{−1/ξ} (Парето):
   E[min(8, F−1)] = ∫₀⁸ (1+y)^{−ξ} dy = (1 − 9^{1−ξ})/(ξ−1)  (ξ ≠ 1; ξ = 1 → ln 9).
   E[d]/mean = 1 + w·E[min(8,F−1)] + 0.5·risk  (≈ 1.076 при w=0.08, ξ=2.5, risk=0.05).
   Статус множителя — [К] (w, ξ, risk — калибровка до идентификации по план-факту). */
double tail_uplift(const Op& o) {
  const double xi = std::max(1.2, o.tailIndex), w = std::max(0.0, o.tailWeight);
  const double eMin = std::fabs(xi - 1.0) < 1e-9 ? std::log(9.0) : (1.0 - std::pow(9.0, 1.0 - xi)) / (xi - 1.0);
  return 1.0 + w * eMin + 0.5 * std::max(0.0, o.riskCoef);
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
  const double batch = m.prods.count(pid) ? std::max(1.0, m.prods.at(pid).batchSize) : 1.0;
  if (opsIt != m.opsOf.end())
    for (const Op& o : opsIt->second) {
      // Наладка входит в фонд мощности (на партию → делим на размер партии):
      // иначе Стадия 2 обещает мощность, которую Стадия 1 съедает переналадками.
      if (!o.primaryWct.empty())
        out[o.primaryWct] += (pertMean(o) * (m.tailUplift ? tail_uplift(o) : 1.0) + o.setupTime / batch) / 60.0;
      for (const OpInput& in : o.inputs) {            // входы операции → цепочка
        std::unordered_map<std::string, double> sub;
        hours_per_unit(m, in.productId, sub, visiting, depth + 1);
        for (auto& [w, h] : sub) out[w] += h * in.qty;
      }
    }
  visiting.erase(pid);
}

/* ── Себестоимость единицы изделия при конкретном прогоне (sampled) ───────── */
// realizedTime[op.idx] — реализованное время (мин); riskInfl[op.idx] — множитель
// риска. Векторы по индексу операции вместо unordered_map<string,…>: горячий цикл
// Монте-Карло перестаёт строить хеш-таблицы на каждый прогон.
double unit_cost(const Model& m, const std::string& pid,
                 const std::vector<double>& realizedTime,
                 const std::vector<double>& riskInfl,
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
      const bool has = o.idx >= 0 && o.idx < (int)realizedTime.size();
      double t   = has ? realizedTime[o.idx] : pertMean(o);
      double inf = has ? riskInfl[o.idx]     : 1.0;
      double proc = (t / 60.0) * (o.hourRate + o.laborRate)
                  + (o.setupRequired ? o.setupCost / std::max(1.0, p.batchSize) : 0.0)  // наладка — на партию
                  + o.cost;
      c += proc * inf;
      for (const OpInput& in : o.inputs)
        c += in.qty * unit_cost(m, in.productId, realizedTime, riskInfl, matFactor, memo, visiting, depth + 1);
    }
  visiting.erase(pid);
  memo[pid] = c;
  return c;
}

/* ── Материальная себестоимость единицы (только покупное сырьё по base_cost, без
   обработки) — доля m_s = mat/cost нужна денежному слою: НДС и кредиторка только на
   материалы, конверсионные затраты — OPEX периода (CashWaterfall). */
double material_cost(const Model& m, const std::string& pid,
                     std::unordered_set<std::string>& visiting, int depth = 0) {
  if (depth > 48 || visiting.count(pid) || !m.prods.count(pid)) return 0;
  const Prod& p = m.prods.at(pid);
  if (p.purchased) return p.baseCost;
  visiting.insert(pid);
  double c = 0;
  if (auto oit = m.opsOf.find(pid); oit != m.opsOf.end())
    for (const Op& o : oit->second)
      for (const OpInput& in : o.inputs) c += in.qty * material_cost(m, in.productId, visiting, depth + 1);
  visiting.erase(pid);
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
  double v;
  if (d.type == "uniform" && d.hasMin && d.hasMax) {
    v = d.minV + (d.maxV - d.minV) * normal_cdf(z);
  } else if (d.type == "triangular" && d.hasMin && d.hasMax) {
    double mode = d.hasMode ? d.mode : d.mean;
    double r = normal_cdf(z), c = (mode - d.minV) / std::max(1e-9, d.maxV - d.minV);
    v = (r < c) ? d.minV + std::sqrt(r * (d.maxV - d.minV) * (mode - d.minV))
                : d.maxV - std::sqrt((1 - r) * (d.maxV - d.minV) * (d.maxV - mode));
  } else if (d.type == "lognormal" && d.mean > 0) {
    double cv = d.stddev / d.mean;
    double sigma = std::sqrt(std::log(1.0 + cv * cv));
    double mu = std::log(d.mean) - 0.5 * sigma * sigma;
    v = std::exp(mu + std::max(1e-9, sigma) * z);
  } else if (d.type == "t") {
    // Стьюдент: симметричные ТЯЖЁЛЫЕ хвосты — моделирует резкие скачки И падения.
    // t-квантиль через разложение Корниша-Фишера от нормального квантиля z; ν=5.
    const double nu = 5.0, z2 = z * z;
    const double tq = z + (z2 + 1.0) * z / (4.0 * nu)
                        + (5.0 * z2 * z2 + 16.0 * z2 + 3.0) * z / (96.0 * nu * nu);
    const double scale = std::max(0.0, d.stddev) / std::sqrt(nu / (nu - 2.0));
    v = d.mean + scale * tq;
  } else if (d.type == "pareto") {
    // Парето (двусторонний степенной хвост): редкие, но БОЛЬШИЕ скачки/обвалы цен. α=2.3.
    const double a = 2.3;
    const double q = std::min(0.9999, 2.0 * std::fabs(normal_cdf(z) - 0.5));
    const double mag = std::pow(1.0 - q, -1.0 / a) - 1.0;     // степенная величина хвоста
    v = d.mean + std::max(0.0, d.stddev) * (z < 0 ? -1.0 : 1.0) * mag;
  } else {
    v = d.mean + std::max(0.0, d.stddev) * z;  // normal
  }
  // ЖЁСТКИЙ клип по заданным границам [min,max] — иначе ошибочный mean (напр. 100 млн)
  // даёт абсурдную цену. Границы — «коридор» цены, заданный в условиях сценария.
  if (d.hasMin && v < d.minV) v = d.minV;
  if (d.hasMax && v > d.maxV) v = d.maxV;
  return std::max(0.0, v);
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

/* ── Точная модель Стадии 2 рядом с эвристикой (ExactCvar.*) ──────────────────
   Строит LP по ТЕМ ЖЕ сценариям, мощностям, границам спроса и ограничению доли,
   что и пул кандидатов, решает HiGHS и сравнивает с эвристикой по тому же критерию. */
struct ExactInputs {
  const Model& m;
  const std::vector<std::vector<std::pair<std::string,double>>>& hpu;
  const std::unordered_map<std::string, double>& cap;
  const std::vector<std::vector<double>>& price;
  const std::vector<std::vector<double>>& cost;
  const std::vector<std::vector<double>>& price2;   // out-of-sample выборка
  const std::vector<std::vector<double>>& cost2;
  const std::vector<exact::Market>& market;
  const std::vector<double>& absorb;
  const std::vector<double>& meanPrice;
  const std::vector<Portfolio>& cand;
  const std::vector<Metrics>& mts;
  const std::vector<double>& conc;
  size_t robustIdx, expIdx;
  double maxShare;
  bool   shareFeasible;                              // эвристика уложилась в maxShare
};

json exact_compare(const ExactInputs& in, const OptimizeParams& p) {
  const std::string want = p.exactCriterion.empty() ? p.objective : p.exactCriterion;
  exact::Criterion crit;
  if (want == "cvar")                                crit = exact::Criterion::Cvar;
  else if (want == "worstcase" || want == "worst")   crit = exact::Criterion::Worst;
  else if (want == "expected" || want == "mean")     crit = exact::Criterion::Expected;
  else
    return { {"status", "not_applicable"}, {"criterion", want}, {"solver", "HiGHS"},
             {"reason", "Критерий не представим линейной программой (mean-variance — "
                        "квадратичный корень, min-regret эвристики — относительно пула кандидатов)."} };

  const size_t S = in.m.sellables.size();
  // Эталон эвристики: тот портфель, что видит пользователь, если критерии совпадают;
  // иначе — лучший кандидат пула по этому критерию (в тех же ограничениях).
  const bool heurIsCvar = p.objective != "worstcase" && p.objective != "meanvariance" &&
                          p.objective != "minregret";
  const bool enforce = crit != exact::Criterion::Expected && in.shareFeasible;
  auto objOf = [&](size_t c) {
    const Metrics& mt = in.mts[c];
    return exact::objective_of(crit, { mt.mean, mt.cvar, mt.worst });
  };
  size_t bestIdx = SIZE_MAX;
  for (size_t c = 0; c < in.cand.size(); ++c) {
    if (enforce && in.conc[c] > in.maxShare + 1e-9) continue;
    if (bestIdx == SIZE_MAX || objOf(c) > objOf(bestIdx)) bestIdx = c;
  }
  size_t refIdx = bestIdx; std::string refKind = "best_candidate";
  if (crit == exact::Criterion::Expected)                       { refIdx = in.expIdx;    refKind = "expected"; }
  else if (crit == exact::Criterion::Cvar && heurIsCvar)        { refIdx = in.robustIdx; refKind = "robust"; }
  else if (crit == exact::Criterion::Worst && p.objective == "worstcase") { refIdx = in.robustIdx; refKind = "robust"; }

  // Задача: типы оборудования — в детерминированном порядке.
  std::vector<std::string> wcIds;
  for (auto& [id, c] : in.cap) wcIds.push_back(id);
  std::sort(wcIds.begin(), wcIds.end());
  std::unordered_map<std::string, int> wcIdx;
  for (size_t w = 0; w < wcIds.size(); ++w) wcIdx[wcIds[w]] = (int)w;

  exact::Problem pb;
  pb.price = in.price; pb.cost = in.cost;
  pb.market = in.market;
  pb.alpha = p.alpha;
  pb.criterion = crit;
  pb.minSegments = std::max(1, std::min(256, p.exactSegments));
  pb.maxSegments = std::max(pb.minSegments, 4 * pb.minSegments);
  pb.enforceMaxShare = enforce;
  pb.maxShare = in.maxShare;
  pb.shareWeight = in.meanPrice;
  for (auto& id : wcIds) pb.capacity.push_back(in.cap.at(id));
  pb.usage.resize(S);
  for (size_t s = 0; s < S; ++s) {
    const Prod& pr = in.m.prods.at(in.m.sellables[s]);
    // Та же граница, что у кандидатов: demand_max (уже ≤ absorb); без неё — absorb,
    // без рынка — 1e9 (как greedy_fill).
    pb.upper.push_back(pr.demandMax > 0 ? pr.demandMax
                       : (in.absorb[s] < 1e17 ? std::max(0.0, in.absorb[s]) : 1e9));
    pb.batch.push_back(std::max(1.0, pr.batchSize));
    for (auto& [w, h] : in.hpu[s])
      if (auto it = wcIdx.find(w); it != wcIdx.end()) pb.usage[s].push_back({ it->second, h });
  }

  exact::Result r = exact::solve(pb);
  const int N = (int)in.price.size();
  json out = {
    {"status", r.status}, {"solver", "HiGHS"}, {"solver_version", exact::solver_version()},
    {"criterion", exact::criterion_name(crit)}, {"heuristic_reference", refKind},
    {"n_scenarios", N}, {"solve_ms", r.solveMs},
    {"n_vars", r.nCols}, {"n_rows", r.nRows}, {"n_nonzeros", r.nNz},
    {"max_share_enforced", enforce}, {"max_share", in.maxShare},
    {"tail_k", r.tailK}, {"alpha_effective", (double)r.tailK / std::max(1, N)},
  };
  if (!r.reason.empty()) out["reason"] = r.reason;
  if (r.status != "optimal") return out;

  auto pct = [](double a, double b) -> json {
    if (std::fabs(b) < 1e-12) return nullptr;
    return 100.0 * (a - b) / std::fabs(b);
  };
  json items = json::array();
  for (size_t s = 0; s < S; ++s)
    if (r.x[s] > 0 || r.xRounded[s] > 0)
      items.push_back({ {"product_id", in.m.sellables[s]}, {"qty", r.x[s]}, {"qty_rounded", r.xRounded[s]} });
  json duals = json::array();
  std::vector<exact::Dual> ds = r.duals;
  std::stable_sort(ds.begin(), ds.end(),
                   [](const exact::Dual& a, const exact::Dual& b) { return a.shadowPrice > b.shadowPrice; });
  for (const exact::Dual& d : ds)
    duals.push_back({ {"wc_type", wcIds[d.resource]}, {"shadow_price", d.shadowPrice},
                      {"utilization", d.utilization}, {"load_hours", d.load},
                      {"capacity_hours", d.capacity}, {"binding", d.binding} });

  const Metrics& hm = in.mts[refIdx];
  const double hObj = objOf(refIdx);
  const exact::Metrics oos  = exact::evaluate_on(pb, in.price2, in.cost2, r.x);
  const exact::Metrics hOos = exact::evaluate_on(pb, in.price2, in.cost2, in.cand[refIdx]);
  out.update({
    {"objective", r.objective}, {"expected", r.metrics.expected},
    {"cvar", r.metrics.cvar}, {"worst", r.metrics.worst},
    {"lp_objective", r.lpObjective}, {"upper_bound", r.lpObjective + r.pwlMaxError},
    {"portfolio", items},
    {"rounded", { {"objective", r.roundedObjective}, {"expected", r.roundedMetrics.expected},
                  {"cvar", r.roundedMetrics.cvar}, {"worst", r.roundedMetrics.worst},
                  {"max_share_ok", r.roundedMaxShareOk} }},
    {"heuristic", { {"objective", hObj}, {"expected", hm.mean}, {"cvar", hm.cvar},
                    {"worst", hm.worst}, {"best_candidate_objective", objOf(bestIdx)},
                    {"n_candidates", (int)in.cand.size()},
                    {"oos_objective", exact::objective_of(crit, hOos)} }},
    {"gap_vs_heuristic", {
      {"objective_abs", r.objective - hObj}, {"objective_pct", pct(r.objective, hObj)},
      {"cvar_pct", pct(r.metrics.cvar, hm.cvar)}, {"expected_pct", pct(r.metrics.expected, hm.mean)},
      {"worst_pct", pct(r.metrics.worst, hm.worst)},
      {"rounded_objective_pct", pct(r.roundedObjective, hObj)},
      {"vs_best_candidate_pct", pct(r.objective, objOf(bestIdx))},
      {"oos_objective_pct", pct(exact::objective_of(crit, oos), exact::objective_of(crit, hOos))},
    }},
    {"duals", duals},
    {"pwl_segments", r.pwlSegments}, {"pwl_segments_total", r.pwlSegmentsTotal},
    {"pwl_max_error", r.pwlMaxError}, {"pwl_max_rel_error", r.pwlMaxRelError},
    {"pwl_concave", r.pwlConcave},
    {"oos", { {"expected", oos.expected}, {"cvar", oos.cvar}, {"worst", oos.worst},
              {"objective", exact::objective_of(crit, oos)} }},
  });
  return out;
}

}  // namespace

/* ── Главная процедура ───────────────────────────────────────────────────── */
json run_optimization(Database& db, const OptimizeParams& p) {
  Model m = load_model(db);
  // Инвест-what-if: временно наращиваем число станков типа (мощность растёт в cap[]).
  for (auto& [id, n] : p.machineBonus)
    if (auto it = m.wcts.find(id); it != m.wcts.end()) it->second.machineCount += n;
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

  // НСИ хранит спрос/ёмкость/конкурентов как ГОДОВЫЕ объёмы (год = 12 мес × 720 ч).
  // Планирование само «дисконтирует» их на горизонт: 6 мес → половина годового.
  // Разброс спроса поверх этого задаёт сценарий (множитель demand в Монте-Карло).
  const double yearFrac = horizon / 8640.0;
  for (auto& [id, pr] : m.prods) {
    pr.demandMax        *= yearFrac;
    pr.marketCapacity   *= yearFrac;
    pr.competitorSupply *= yearFrac;
  }

  marketCorr = std::min(0.98, std::max(0.0, marketCorr));
  const double betaMarket = std::sqrt(marketCorr);  // загрузка по умолчанию на фактор

  // Точечные оверрайды цены/себестоимости из сценария (Стадия E) — без копии сценария.
  std::unordered_map<std::string, double> ovrPrice;
  if (!p.scenarioId.empty()) {
    for (auto& o : db.query_json(
           "SELECT product_id,base_price,base_cost FROM scenario_overrides WHERE scenario_id=?",
           { p.scenarioId })) {
      const std::string pid = str(o, "product_id"), bp = str(o, "base_price"), bc = str(o, "base_cost");
      auto it = m.prods.find(pid);
      if (!bp.empty()) { ovrPrice[pid] = std::stod(bp); if (it != m.prods.end()) it->second.basePrice = ovrPrice[pid]; }
      if (!bc.empty() && it != m.prods.end()) it->second.baseCost = std::stod(bc);
    }
  }

  // Доля рабочего времени по календарю смен (напр. 5×16ч ≈ 0.476): раньше Стадия 2
  // считала фонд 24/7, а Стадия 1 планировала по сменам — портфель
  // систематически не вписывался в реальный фонд (несогласованность стадий).
  double calFactor = 1.0;
  try {
    auto sched = db.query_json("SELECT id FROM schedules WHERE is_default=1 LIMIT 1");
    if (!sched.empty()) {
      double workMin = 0;
      for (auto& sh : db.query_json(
             "SELECT start_min, end_min FROM shifts WHERE schedule_id=?", { str(sched[0], "id") }))
        workMin += std::max(0.0, num(sh, "end_min") - num(sh, "start_min"));
      if (workMin > 0) calFactor = std::min(1.0, workMin / (7.0 * 1440.0));
    }
  } catch (...) {}

  std::unordered_map<std::string, double> cap;
  for (auto& [id, w] : m.wcts)
    cap[id] = (double)w.machineCount * horizon * w.efficiency * calFactor;

  // ── RECOURSE (обратный ход Стадия 1 → Стадия 2): поправка потребления мощности
  // из ФАКТИЧЕСКОГО расписания (stage1_feedback: наладки и пр. поверх нормо-часов).
  // Оптимизатор перестаёт обещать мощность по наивной сумме нормо-часов.
  // R5: читается ТОЛЬКО при явном apply_feedback — иначе /api/optimize не зависит от
  // истории расписаний (воспроизводимость по seed). Хэш фидбэка пишется в ответ/прогон.
  std::unordered_map<std::string, double> fbFactor;
  std::string fbHash = "none"; int fbRows = 0;
  try {
    uint64_t h = 1469598103934665603ull;
    for (auto& r : db.query_json("SELECT product_id, factor FROM stage1_feedback ORDER BY product_id")) {
      const std::string pid = str(r, "product_id"), f = str(r, "factor");
      for (char ch : pid + "=" + f + ";") { h ^= (unsigned char)ch; h *= 1099511628211ull; }
      ++fbRows;
      if (p.applyFeedback) fbFactor[pid] = std::max(1.0, num(r, "factor", 1.0));
    }
    if (fbRows > 0) { char buf[20]; std::snprintf(buf, sizeof buf, "%016llx", (unsigned long long)h); fbHash = buf; }
  } catch (...) {}
  m.tailUplift = p.tailUplift;

  // Часы на единицу по типам (детерминированно) + суммарные часы.
  int calibrated = 0;
  std::vector<std::vector<std::pair<std::string,double>>> hpu(S);
  for (size_t i = 0; i < S; ++i) {
    std::unordered_map<std::string, double> h;
    std::unordered_set<std::string> vis;
    hours_per_unit(m, m.sellables[i], h, vis);
    double fb = 1.0;
    if (auto it = fbFactor.find(m.sellables[i]); it != fbFactor.end() && it->second > 1.0) {
      fb = it->second; ++calibrated;
    }
    for (auto& [w, v] : h) hpu[i].push_back({ w, v * fb });
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
  // Оверрайд цены сценария применяется и поверх распределений (центрируем на новой цене).
  for (auto& [pid, mp] : ovrPrice)
    if (priceDist.count(pid)) { priceDist[pid].mean = mp; priceDist[pid].stddev = mp * 0.12; }
  // Волатильность сценария = МУЛЬТИПЛИКАТОР ширины всех распределений (как и в прогнозе, база 6%).
  const double volMul = std::max(0.2, std::min(6.0, p.volatility / 0.06));
  if (std::fabs(volMul - 1.0) > 1e-6)
    for (auto& [pid, pd] : priceDist) pd.stddev *= volMul;

  // ── Монте-Карло: общие случайные числа для честного сравнения портфелей ──
  const int N = std::max(200, p.samples);

  // Список всех операций (для сэмплирования времени/риска).
  std::vector<const Op*> allOps;
  for (auto& [pid, ops] : m.opsOf) for (const Op& o : ops) allOps.push_back(&o);
  size_t nOps = 0;
  for (const Op* o : allOps) nOps = std::max(nOps, (size_t)o->idx + 1);

  // Покупное сырьё — для стохастики цены закупки (может сильно вырасти).
  std::vector<std::string> rawMats;
  for (auto& [id, pr] : m.prods) if (pr.purchased && pr.baseCost > 0) rawMats.push_back(id);

  // Генератор сценариев (цены + себестоимости) при заданном сиде. Вызывается
  // дважды: основная выборка И независимая out-of-sample проверка решения (SAA:
  // оценка на свежих сценариях выявляет переобучение портфеля под выборку).
  auto genScenarios = [&](unsigned seed, int n,
                          std::vector<std::vector<double>>& price,
                          std::vector<std::vector<double>>& cost) {
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> u01(0, 1);
    std::normal_distribution<double> nstd(0.0, 1.0);
    price.assign(n, std::vector<double>(S, 0));
    cost.assign(n, std::vector<double>(S, 0));
    // Векторы по индексу операции (не unordered_map) — без хеш-аллокаций в цикле.
    std::vector<double> realizedTime(nOps, 0.0), riskInfl(nOps, 1.0);
    for (int i = 0; i < n; ++i) {
      for (const Op* o : allOps) {
        // Длительность операции: логнормаль вокруг PERT + примесь Парето-хвоста —
        // ТА ЖЕ модель, что в симуляции Стадии 1 (Двухстадийная модель §2).
        // Раньше здесь была тонкохвостная триангулярная аппроксимация, и CVaR
        // себестоимости систематически недооценивал хвостовой риск.
        const double mean  = std::max(0.5, pertMean(*o));
        double sigma = (o->tPess - o->tOpt) / 6.0;
        if (sigma <= 0) sigma = mean * 0.15;
        const double cv = sigma / mean;
        const double sl = std::sqrt(std::log(1.0 + cv * cv));
        const double mu = std::log(mean) - 0.5 * sl * sl;
        double t = std::exp(mu + std::max(1e-6, sl) * nstd(rng));
        if (u01(rng) < o->tailWeight) {
          double f = std::pow(std::max(1e-9, 1.0 - u01(rng)), -1.0 / o->tailIndex);
          t *= 1.0 + std::min(8.0, f - 1.0);
        }
        realizedTime[o->idx] = t;
        riskInfl[o->idx] = (u01(rng) < o->riskCoef) ? 1.5 : 1.0;  // брак → +50% переделка
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
  };

  std::vector<std::vector<double>> price, cost;
  genScenarios(p.seed, N, price, cost);

  // Средние маржа/себестоимость (для генерации кандидатов).
  std::vector<double> meanCost(S, 0), meanPrice(S, 0), stdMargin(S, 0);
  for (size_t s = 0; s < S; ++s) {
    double sc = 0, sp = 0; for (int i = 0; i < N; ++i) { sc += cost[i][s]; sp += price[i][s]; }
    meanCost[s] = sc / N; meanPrice[s] = sp / N;
    double mm = meanPrice[s] - meanCost[s], ss = 0;
    for (int i = 0; i < N; ++i) { double mg = price[i][s] - cost[i][s]; ss += (mg-mm)*(mg-mm); }
    stdMargin[s] = std::sqrt(ss / N);
  }

  // ── МОДЕЛЬ СПРОСА И КОНКУРЕНЦИИ ────────────────────────────────────────────
  // Рынок поглощает НЕ БОЛЕЕ absorb = ёмкость·спрос_сценария − конкуренты единиц:
  // всё сверх этого уровня ПРОДАТЬ НЕЛЬЗЯ (выручки нет, себестоимость понесена).
  // Уровень пока задаётся в НСИ (products.market_capacity) и масштабируется
  // сценарным множителем спроса — задел под вычисление из макро-данных.
  const double demandMul = std::max(0.1, p.demand);
  auto capOf = [&](size_t s) -> double {                 // ёмкость рынка изделия, ед.
    const Prod& pr = m.prods.at(m.sellables[s]);
    const double capM = pr.marketCapacity > 0 ? pr.marketCapacity
                       : (pr.demandMax > 0 ? pr.demandMax * 1.2 : 0.0);
    return capM > 0 ? capM * demandMul : 0.0;            // 0 = рынок не задан
  };
  std::vector<double> absorb(S, 1e18);                   // потолок продаж, ед.
  for (size_t s = 0; s < S; ++s) {
    const double capM = capOf(s);
    if (capM > 0)
      absorb[s] = std::max(0.0, capM - m.prods.at(m.sellables[s]).competitorSupply);
  }
  // Кандидаты не планируют заведомо непродаваемые объёмы: спрос = min(demand_max, absorb).
  for (size_t s = 0; s < S; ++s) {
    if (absorb[s] >= 1e17) continue;
    Prod& pr = m.prods.at(m.sellables[s]);
    pr.demandMax = pr.demandMax > 0 ? std::min(pr.demandMax, absorb[s]) : absorb[s];
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
  // Объёмно-масштабированные варианты структурных портфелей: меньше произвести ⇒ выше
  // цена (модель спроса). Даёт оптимизатору выбор «объём vs цена» — иначе все кандидаты
  // у потолка спроса/мощности, и objective/max_share почти не влияют на результат.
  {
    const size_t base = cand.size();
    for (double scale : { 0.5, 0.7 })
      for (size_t b = 0; b < base; ++b) {
        Portfolio x = cand[b];
        for (double& v : x) v *= scale;
        add(std::move(x));
      }
  }
  // Случайные диверсифицированные смеси → разнообразие портфелей.
  std::mt19937 candRng(p.seed ^ 0x9e3779b9u);   // отдельный от сценарного генератора
  std::uniform_real_distribution<double> uw(0.0, 1.0);
  for (int r = 0; r < 80; ++r) {
    std::vector<double> w(S);
    for (size_t s = 0; s < S; ++s) w[s] = (margin[s] > 0) ? std::pow(uw(candRng), 1.5) : 0.0;
    add(proportional_fill(m, hpu, cap, w));
  }
  if (cand.empty()) {                                              // на всякий случай
    Portfolio x(S, 0); for (size_t s = 0; s < S; ++s) {
      const Prod& pr = m.prods.at(m.sellables[s]);
      x[s] = pr.demandMax > 0 ? pr.demandMax : pr.batchSize;
    }
    cand.push_back(x);
  }

  // Цена падает с НАСЫЩЕНИЕМ рынка (свой объём + конкуренты к ёмкости): чем дальше
  // от уровня поглощения, тем ниже цена сбыта. mul ∈ [0.5, 1.3].
  auto priceMul = [&](double q, size_t s) -> double {
    const Prod& pr = m.prods.at(m.sellables[s]);
    const double capM = capOf(s);
    if (capM <= 0) return 1.0;
    const double fill = (pr.competitorSupply + q) / capM;          // насыщение рынка
    return std::max(0.5, std::min(1.3, 1.0 + pr.priceElasticity * (1.0 - fill)));
  };
  // Прибыль позиции: произвели q, ПРОДАЛИ min(q, absorb) по цене с насыщением.
  auto soldOf = [&](double q, size_t s) -> double { return std::min(q, absorb[s]); };

  // ── Оценка кандидатов по прогонам (общие случайные числа уже зафиксированы) ─
  size_t K = cand.size();
  std::vector<std::vector<double>> profit(K, std::vector<double>(N, 0));
  for (size_t c = 0; c < K; ++c) {
    std::vector<double> mul(S);
    for (size_t s = 0; s < S; ++s) mul[s] = priceMul(cand[c][s], s);  // зависит от объёма портфеля
    for (int i = 0; i < N; ++i) {
      double pr = 0;
      for (size_t s = 0; s < S; ++s)   // продали sold, произвели (и оплатили) всё q
        pr += soldOf(cand[c][s], s) * price[i][s] * mul[s] - cand[c][s] * cost[i][s];
      profit[c][i] = pr;
    }
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

  // БАЛАНС ЗАГРУЗКИ оборудования: отношение мин/макс утилизации задействованных WC-типов
  // (1 = идеально ровно). Вторичный критерий — среди одинаково устойчивых портфелей берём
  // тот, что РОВНЕЕ грузит цеха (меньше простоя), а не перекошенный на одну стадию.
  auto evennessOf = [&](size_t c) -> double {
    std::unordered_map<std::string, double> load;
    for (size_t s = 0; s < S; ++s) if (cand[c][s] > 0)
      for (auto& [wc, h] : hpu[s]) load[wc] += cand[c][s] * h;
    double mn = 1e300, mx = 0;
    for (auto& [wc, capH] : cap) {
      if (capH <= 0) continue;
      double u = (load.count(wc) ? load.at(wc) : 0.0) / capH;
      if (u > 1e-9) { mn = std::min(mn, u); mx = std::max(mx, u); }
    }
    return (mx > 0 && mn < 1e300) ? mn / mx : 0.0;
  };

  // Робаст: лучший робаст-критерий среди кандидатов с концентрацией ≤ maxShare; среди
  // близких к нему (в пределах 3%) — самый сбалансированный по оборудованию.
  size_t robustIdx = SIZE_MAX, expIdx = 0;
  double bestRobust = -1e300, bestExp = -1e300;
  for (size_t c = 0; c < K; ++c) {
    if (conc[c] <= maxShare + 1e-9) {
      double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
      if (rs > bestRobust) bestRobust = rs;
    }
    if (mts[c].mean > bestExp) { bestExp = mts[c].mean; expIdx = c; }
  }
  if (bestRobust > -1e299) {
    const double tol = 0.03 * std::fabs(bestRobust) + 1e-6;
    double bestEven = -1.0;
    for (size_t c = 0; c < K; ++c) {
      if (conc[c] > maxShare + 1e-9) continue;
      double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
      if (rs < bestRobust - tol) continue;
      double ev = evennessOf(c);
      if (ev > bestEven) { bestEven = ev; robustIdx = c; }
    }
  }
  if (robustIdx == SIZE_MAX) {                      // ни один не уложился в maxShare
    warnings.push_back("Слишком мало изделий для диверсификации в пределах maxShare.");
    double br = -1e300;
    for (size_t c = 0; c < K; ++c) {
      double rs = robust_score(p.objective, mts[c], regret[c], p.lambda);
      if (rs > br) { br = rs; robustIdx = c; }
    }
  }

  // ── Сборка результата ────────────────────────────────────────────────────
  auto portfolioJson = [&](size_t c) {
    const Portfolio& x = cand[c];
    std::vector<double> mul(S); for (size_t s = 0; s < S; ++s) mul[s] = priceMul(x[s], s);  // эндогенная цена
    // Профиль прибыли портфеля и вклад каждого изделия в риск (доля ковариации
    // с прибылью портфеля). Сумма вкладов = 1 — видно, что «гонит» риск.
    std::vector<double> P(N, 0.0);
    for (int i = 0; i < N; ++i) { double pr = 0;
      for (size_t s = 0; s < S; ++s)
        pr += soldOf(x[s], s) * price[i][s] * mul[s] - x[s] * cost[i][s];
      P[i] = pr; }
    double meanP = 0; for (double v : P) meanP += v; meanP /= N;
    double varP = 0; for (double v : P) varP += (v - meanP) * (v - meanP); varP /= N;
    if (varP < 1e-6) varP = 1e-6;
    auto riskContrib = [&](size_t s) -> double {
      if (x[s] <= 0) return 0;
      const double sq = soldOf(x[s], s);
      double mc = 0; for (int i = 0; i < N; ++i) mc += sq * price[i][s] * mul[s] - x[s] * cost[i][s]; mc /= N;
      double cov = 0; for (int i = 0; i < N; ++i)
        cov += (sq * price[i][s] * mul[s] - x[s] * cost[i][s] - mc) * (P[i] - meanP);
      return (cov / N) / varP;
    };

    json items = json::array();
    std::unordered_map<std::string, double> loadByWct;
    double totalHours = 0; int nProd = 0;
    for (size_t s = 0; s < S; ++s) {
      if (x[s] <= 0) continue;
      ++nProd;
      const double effPrice = meanPrice[s] * mul[s];   // цена с учётом модели спроса
      double unitMargin = effPrice - meanCost[s];
      const double sold = soldOf(x[s], s);             // рынок поглощает не всё
      items.push_back({
        {"product_id", m.sellables[s]},
        {"qty", x[s]},
        {"sold_qty", sold},
        {"unit_price", effPrice},
        {"unit_cost", meanCost[s]},
        {"unit_margin", unitMargin},
        {"price_mult", mul[s]},
        {"contribution", sold * effPrice - x[s] * meanCost[s]},
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

  // Гистограммы прибыли: робастный И ожидаемо-лучший на ОБЩЕЙ шкале (для наложения —
  // видно, что устойчивый ýже и без «хвоста» убытков, а наивный шире/рискованнее).
  json hist = json::array();
  {
    const std::vector<double>& vr = profit[robustIdx];
    const std::vector<double>& ve = profit[expIdx];
    double lo = std::min(*std::min_element(vr.begin(), vr.end()), *std::min_element(ve.begin(), ve.end()));
    double hi = std::max(*std::max_element(vr.begin(), vr.end()), *std::max_element(ve.begin(), ve.end()));
    int bins = 24; double w = (hi - lo) / std::max(1, bins);
    if (w <= 0) w = 1;
    std::vector<int> cr(bins, 0), ce(bins, 0);
    auto fill = [&](const std::vector<double>& v, std::vector<int>& c) {
      for (double x : v) { int b = (int)((x - lo) / w); if (b >= bins) b = bins - 1; if (b < 0) b = 0; c[b]++; } };
    fill(vr, cr); fill(ve, ce);
    for (int b = 0; b < bins; ++b)
      hist.push_back({ {"x0", lo + b*w}, {"x1", lo + (b+1)*w}, {"count", cr[b]}, {"count_expected", ce[b]} });
  }

  json robustPf = portfolioJson(robustIdx);
  json expPf    = portfolioJson(expIdx);
  double priceOfRobustness = mts[expIdx].mean - mts[robustIdx].mean;

  // ── Out-of-sample проверка (SAA): выбранный портфель переоценивается на
  // НЕЗАВИСИМОЙ выборке сценариев. Большое расхождение метрик = решение
  // переобучено под конкретную выборку (оптимизационный bias) — честная
  // оценка качества решения вместо in-sample оптимизма.
  json oosJson = nullptr;
  std::vector<std::vector<double>> price2, cost2;   // нужны и точной модели (OOS)
  {
    genScenarios(p.seed + 9973u, N, price2, cost2);
    const Portfolio& xr = cand[robustIdx];
    std::vector<double> mul(S);
    for (size_t s = 0; s < S; ++s) mul[s] = priceMul(xr[s], s);
    std::vector<double> prof2(N, 0.0);
    for (int i = 0; i < N; ++i) {
      double pr2 = 0;
      for (size_t s = 0; s < S; ++s)
        pr2 += soldOf(xr[s], s) * price2[i][s] * mul[s] - xr[s] * cost2[i][s];
      prof2[i] = pr2;
    }
    Metrics oos = metrics_of(prof2, p.alpha);
    const Metrics& ins = mts[robustIdx];
    const double gapExp  = ins.mean != 0 ? (ins.mean - oos.mean) / std::fabs(ins.mean) : 0;
    const double gapCvar = ins.cvar != 0 ? (ins.cvar - oos.cvar) / std::fabs(ins.cvar) : 0;
    oosJson = {
      {"expected", oos.mean}, {"cvar", oos.cvar}, {"worst_case", oos.worst},
      {"std", oos.std}, {"p_loss", oos.pLoss},
      {"gap_expected", gapExp}, {"gap_cvar", gapCvar},
    };
    if (std::fabs(gapExp) > 0.10)
      warnings.push_back("Out-of-sample: ожидаемая прибыль на независимой выборке отличается на "
                         + std::to_string((int)std::lround(gapExp * 100))
                         + "% — увеличьте число сценариев (samples).");
  }

  // Краткий ранжированный список кандидатов (по робастному критерию).
  std::vector<size_t> rank(K); for (size_t i = 0; i < K; ++i) rank[i] = i;
  std::sort(rank.begin(), rank.end(), [&](size_t a, size_t b) {
    return robust_score(p.objective, mts[a], regret[a], p.lambda) >
           robust_score(p.objective, mts[b], regret[b], p.lambda);
  });
  // ГРАНИЦА ПАРЕТО: доходность (mean ↑) vs риск (std ↓). Кандидат недоминируем, если
  // ни один другой не даёт ОДНОВРЕМЕННО ≥ доходность и ≤ риск (хотя бы строго по одному).
  std::vector<char> pareto(K, 0);
  for (size_t c = 0; c < K; ++c) {
    bool dom = false;
    for (size_t o = 0; o < K && !dom; ++o) {
      if (o == c) continue;
      if (mts[o].mean >= mts[c].mean && mts[o].std <= mts[c].std &&
          (mts[o].mean > mts[c].mean || mts[o].std < mts[c].std)) dom = true;
    }
    pareto[c] = dom ? 0 : 1;
  }
  // Возвращаем ВСЕ парето-оптимальные (граница) + ДОМИНИРУЕМЫЕ по рангу (серое облако
  // для контраста) — до 90 точек.
  std::vector<size_t> selC; std::unordered_set<size_t> seenC;
  for (size_t c = 0; c < K; ++c) if (pareto[c]) { selC.push_back(c); seenC.insert(c); }
  for (size_t i = 0; i < K && selC.size() < 90; ++i) {
    size_t c = rank[i]; if (!seenC.count(c) && !pareto[c]) { selC.push_back(c); seenC.insert(c); }
  }
  json candList = json::array();
  for (size_t c : selC) {
    candList.push_back({
      {"expected", mts[c].mean}, {"cvar", mts[c].cvar},
      {"worst_case", mts[c].worst}, {"std", mts[c].std},
      {"p_loss", mts[c].pLoss}, {"max_regret", regret[c]},
      {"concentration", conc[c]},
      {"is_robust", c == robustIdx}, {"is_expected", c == expIdx},
      {"is_pareto", pareto[c] != 0},
    });
  }

  json result = {
    {"scenario_id", p.scenarioId}, {"scenario_name", scenName},
    {"objective", p.objective}, {"samples", N}, {"alpha", p.alpha},
    {"lambda", p.lambda}, {"seed", (int)p.seed}, {"horizon_hours", horizon},
    {"market_corr", marketCorr}, {"max_share", maxShare},
    {"sellables", (int)S},
    {"calendar_factor", calFactor},
    {"stage1_calibrated", calibrated},   // изделий с recourse-поправкой из расписания
    {"feedback", { {"applied", p.applyFeedback}, {"hash", fbHash}, {"rows", fbRows} }},   // R5
    {"tail_uplift", p.tailUplift},       // R4: хвостовая поправка мощности (tail_uplift)
    {"robust", robustPf}, {"expected", expPf},
    {"price_of_robustness", priceOfRobustness},
    {"oos", oosJson},
    {"histogram", hist}, {"candidates", candList},
    {"warnings", warnings},
  };

  // ── Точная модель (Rockafellar–Uryasev LP, HiGHS) — аддитивно, по запросу ──
  if (p.compareExact) {
    try {
      std::vector<exact::Market> market(S);
      for (size_t s = 0; s < S; ++s) {
        const Prod& pr = m.prods.at(m.sellables[s]);
        market[s].capM = capOf(s);                // как в priceMul(): после подрезки demandMax
        market[s].competitor = pr.competitorSupply;
        market[s].elasticity = pr.priceElasticity;
        market[s].absorb = absorb[s];
      }
      const ExactInputs in{ m, hpu, cap, price, cost, price2, cost2, market, absorb, meanPrice,
                            cand, mts, conc, robustIdx, expIdx, maxShare, bestRobust > -1e299 };
      result["exact"] = exact_compare(in, p);
    } catch (const std::exception& e) {
      result["exact"] = { {"status", "error"}, {"solver", "HiGHS"}, {"reason", e.what()} };
    }
  }

  // ── Волна F: CVaR-LP с кассой (§5.2) по тем же сценариям + водопад §4.3 ──────
  if (p.cash) {
    try {
      CashInputs ci;
      ci.sellables = m.sellables; ci.hpu = hpu; ci.cap = cap;
      ci.price = price; ci.cost = cost; ci.price2 = price2; ci.cost2 = cost2;
      ci.market.resize(S); ci.meanPrice = meanPrice; ci.maxShare = maxShare;
      ci.enforceShare = bestRobust > -1e299; ci.horizonHours = horizon;
      for (size_t s = 0; s < S; ++s) {
        const Prod& pr = m.prods.at(m.sellables[s]);
        ci.market[s].capM = capOf(s); ci.market[s].competitor = pr.competitorSupply;
        ci.market[s].elasticity = pr.priceElasticity; ci.market[s].absorb = absorb[s];
        ci.upper.push_back(pr.demandMax > 0 ? pr.demandMax : (absorb[s] < 1e17 ? std::max(0.0, absorb[s]) : 1e9));
        ci.batch.push_back(std::max(1.0, pr.batchSize));
        std::unordered_set<std::string> vis;
        const double mat = material_cost(m, m.sellables[s], vis);
        ci.matShare.push_back(meanCost[s] > 0 ? std::min(1.0, std::max(0.0, mat / meanCost[s])) : 0.0);
      }
      result["cash_lp"] = cash_compare(db, ci, p);
    } catch (const std::exception& e) {
      result["cash_lp"] = { {"status", "error"}, {"solver", "HiGHS"}, {"reason", e.what()} };
    }
  }
  return result;
}

}  // namespace maos
