#include "ExactCvar.h"
#include "Highs.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <mutex>

namespace maos::exact {
namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kCapBoundSlack = 1.05;   // область PWL чуть шире мощностного потолка:
                                          // иначе граница отрезка «перехватит» двойственную цену мощности
constexpr double kFeasTol = 1e-9;

/* Строка разреженной матрицы (построчное хранение для HighsLp). */
struct RowBuilder {
  std::vector<HighsInt> start{ 0 }, index;
  std::vector<double>   value, lower, upper;
  void add(const std::vector<std::pair<int,double>>& coefs, double lo, double up) {
    for (auto& [c, v] : coefs) if (v != 0.0) { index.push_back(c); value.push_back(v); }
    start.push_back((HighsInt)index.size());
    lower.push_back(lo); upper.push_back(up);
  }
  int rows() const { return (int)lower.size(); }
};

/* Потолок выпуска изделия только по мощностям: min_w Cap_w / h_{s,w}. */
double capacity_bound(const Problem& pb, size_t s) {
  double b = kInf;
  for (auto& [w, h] : pb.usage[s])
    if (h > 0 && w >= 0 && w < (int)pb.capacity.size())
      b = std::min(b, std::max(0.0, pb.capacity[w]) / h);
  return b;
}

std::string status_name(HighsModelStatus st) {
  switch (st) {
    case HighsModelStatus::kOptimal:                return "optimal";
    case HighsModelStatus::kInfeasible:             return "infeasible";
    case HighsModelStatus::kUnbounded:
    case HighsModelStatus::kUnboundedOrInfeasible:  return "unbounded";
    case HighsModelStatus::kTimeLimit:
    case HighsModelStatus::kIterationLimit:         return "time_limit";
    default:                                        return "error";
  }
}

/* Метрики по вектору прибылей — ТА ЖЕ формула, что metrics_of() в Optimizer.cpp. */
Metrics metrics_from(std::vector<double> v, double alpha) {
  Metrics mt;
  if (v.empty()) return mt;
  const size_t n = v.size();
  double s = 0; for (double x : v) s += x; mt.expected = s / n;
  std::sort(v.begin(), v.end());
  mt.worst = v.front();
  const size_t k = (size_t)tail_count(alpha, (int)n);
  double tail = 0; for (size_t i = 0; i < k; ++i) tail += v[i];
  mt.cvar = tail / k;
  return mt;
}

/* Допустимость портфеля (мощности, верхние границы, доля). */
bool capacity_ok(const Problem& pb, const std::vector<double>& x) {
  std::vector<double> load(pb.capacity.size(), 0.0);
  for (size_t s = 0; s < x.size(); ++s)
    for (auto& [w, h] : pb.usage[s]) if (w >= 0 && w < (int)load.size()) load[w] += x[s] * h;
  for (size_t w = 0; w < load.size(); ++w)
    if (load[w] > pb.capacity[w] * (1 + kFeasTol) + kFeasTol) return false;
  return true;
}
int share_violator(const Problem& pb, const std::vector<double>& x) {   // −1 = ок
  if (!pb.enforceMaxShare) return -1;
  double total = 0; for (size_t s = 0; s < x.size(); ++s) total += x[s] * pb.shareWeight[s];
  int worst = -1; double worstExcess = 0;
  for (size_t s = 0; s < x.size(); ++s) {
    const double excess = x[s] * pb.shareWeight[s] - pb.maxShare * total;
    if (excess > kFeasTol * std::max(1.0, total) && excess > worstExcess) { worstExcess = excess; worst = (int)s; }
  }
  return worst;
}

/* Критерий по вектору прибылей без сортировки целиком (nth_element) — для жадного добора. */
double criterion_value(Criterion c, std::vector<double>& v, int k) {
  if (c == Criterion::Expected) { double s = 0; for (double x : v) s += x; return s / v.size(); }
  if (c == Criterion::Worst) return *std::min_element(v.begin(), v.end());
  std::nth_element(v.begin(), v.begin() + (k - 1), v.end());
  double t = 0; for (int i = 0; i < k; ++i) t += v[i];
  return t / k;
}

/* Округление LP-решения вниз до кратных партии + жадный добор партий по истинной цели. */
void round_to_batches(const Problem& pb, const std::vector<double>& x, Result& r) {
  const size_t S = x.size(), N = pb.price.size();
  std::vector<double> xr(S);
  for (size_t s = 0; s < S; ++s) {
    const double b = std::max(1.0, pb.batch[s]);
    xr[s] = std::floor(x[s] / b + 1e-7) * b;
    if (xr[s] > pb.upper[s] * (1 + kFeasTol)) xr[s] -= b;
    xr[s] = std::max(0.0, xr[s]);
  }
  // Ремонт допустимости (эпсилон округления / нарушение доли после усечения).
  for (int guard = 0; guard < 100000 && !capacity_ok(pb, xr); ++guard) {
    size_t arg = 0; double best = -1;
    for (size_t s = 0; s < S; ++s) if (xr[s] > 0 && xr[s] > best) { best = xr[s]; arg = s; }
    if (best <= 0) break;
    xr[arg] = std::max(0.0, xr[arg] - std::max(1.0, pb.batch[arg]));
  }
  for (int guard = 0; guard < 100000; ++guard) {
    const int v = share_violator(pb, xr);
    if (v < 0) break;
    xr[v] = std::max(0.0, xr[v] - std::max(1.0, pb.batch[v]));
  }

  // Жадный добор: +1 партия изделию с наибольшим приростом цели, пока улучшает.
  std::vector<double> sold(S), mul(S), P(N, 0.0);
  for (size_t s = 0; s < S; ++s) {
    mul[s] = price_mult(pb.market[s], xr[s]);
    sold[s] = std::min(xr[s], pb.market[s].absorb);
  }
  for (size_t i = 0; i < N; ++i)
    for (size_t s = 0; s < S; ++s) P[i] += sold[s] * pb.price[i][s] * mul[s] - xr[s] * pb.cost[i][s];
  const int k = tail_count(pb.alpha, (int)N);
  std::vector<double> work = P;
  double cur = criterion_value(pb.criterion, work, k);
  for (size_t iter = 0; iter < 4 * S + 16; ++iter) {
    int bestS = -1; double bestVal = cur;
    for (size_t s = 0; s < S; ++s) {
      const double b = std::max(1.0, pb.batch[s]);
      if (xr[s] + b > pb.upper[s] * (1 + kFeasTol) + kFeasTol) continue;
      xr[s] += b;
      const bool ok = capacity_ok(pb, xr) && share_violator(pb, xr) < 0;
      const double m2 = price_mult(pb.market[s], xr[s]);
      const double s2 = std::min(xr[s], pb.market[s].absorb);
      xr[s] -= b;
      if (!ok) continue;
      for (size_t i = 0; i < N; ++i)
        work[i] = P[i] + pb.price[i][s] * (s2 * m2 - sold[s] * mul[s]) - b * pb.cost[i][s];
      const double val = criterion_value(pb.criterion, work, k);
      if (val > bestVal + 1e-12 * std::max(1.0, std::fabs(bestVal))) { bestVal = val; bestS = (int)s; }
    }
    if (bestS < 0) break;
    const size_t s = (size_t)bestS;
    const double b = std::max(1.0, pb.batch[s]);
    const double m2 = price_mult(pb.market[s], xr[s] + b), s2 = std::min(xr[s] + b, pb.market[s].absorb);
    for (size_t i = 0; i < N; ++i) P[i] += pb.price[i][s] * (s2 * m2 - sold[s] * mul[s]) - b * pb.cost[i][s];
    xr[s] += b; mul[s] = m2; sold[s] = s2; cur = bestVal;
  }
  r.xRounded = xr;
  r.roundedMetrics = evaluate(pb, xr);
  r.roundedObjective = objective_of(pb.criterion, r.roundedMetrics);
  r.roundedMaxShareOk = share_violator(pb, xr) < 0;
}

}  // namespace

const char* criterion_name(Criterion c) {
  switch (c) {
    case Criterion::Expected: return "expected";
    case Criterion::Worst:    return "worst";
    default:                  return "cvar";
  }
}

const char* solver_version() { return highsVersion(); }

/* Глобальный планировщик задач HiGHS общий на процесс — сериализуем решения из
   разных потоков httplib (решение занимает доли секунды). Общий с CashLp. */
std::mutex& highs_mutex() { static std::mutex m; return m; }

double price_mult(const Market& mk, double q) {
  if (mk.capM <= 0) return 1.0;
  const double fill = (mk.competitor + q) / mk.capM;
  return std::max(mk.mulLo, std::min(mk.mulHi, 1.0 + mk.elasticity * (1.0 - fill)));
}

double revenue_volume(const Market& mk, double q) {
  return std::min(q, mk.absorb) * price_mult(mk, q);
}

Pwl build_pwl(const Market& mk, double domain, int minSegments, int maxSegments, double relTol) {
  Pwl f;
  f.domain = std::max(0.0, domain);
  if (!(f.domain > 0)) return f;
  if (!std::isfinite(f.domain)) {                     // только линейная g (рынок не задан)
    f.len.push_back(kInf);
    f.slope.push_back(price_mult(mk, 0.0));
    return f;
  }
  minSegments = std::max(1, minSegments);
  maxSegments = std::max(minSegments, maxSegments);
  const double D = f.domain;
  auto g = [&](double q) { return revenue_volume(mk, q); };

  // Узлы излома: зажим множителя (hi/lo) и потолок продаж absorb.
  std::vector<double> knots{ 0.0, D };
  if (mk.capM > 0 && mk.elasticity != 0) {
    for (double lim : { mk.mulHi, mk.mulLo }) {
      const double q = mk.capM * (1.0 - (lim - 1.0) / mk.elasticity) - mk.competitor;
      if (q > 0 && q < D) knots.push_back(q);
    }
  }
  if (mk.absorb > 0 && mk.absorb < D) knots.push_back(mk.absorb);
  std::sort(knots.begin(), knots.end());
  knots.erase(std::unique(knots.begin(), knots.end(),
                          [&](double a, double b) { return std::fabs(a - b) <= 1e-12 * D; }),
              knots.end());

  const double scale = std::max(1e-300, std::fabs(g(D)));
  auto segErr = [&](double l, double r) {             // sup (g − хорда) по 3 точкам отрезка
    const double gl = g(l), gr = g(r);
    double e = 0;
    for (double t : { 0.25, 0.5, 0.75 }) {
      const double q = l + t * (r - l);
      e = std::max(e, g(q) - (gl + t * (gr - gl)));
    }
    return e;
  };

  for (size_t p = 0; p + 1 < knots.size(); ++p) {
    const double l = knots[p], r = knots[p + 1];
    int K = 1;
    if (segErr(l, r) > 1e-13 * scale) {               // кривой кусок → K равных отрезков
      K = minSegments;
      for (;;) {
        double e = 0;
        for (int k = 0; k < K; ++k) e = std::max(e, segErr(l + (r - l) * k / K, l + (r - l) * (k + 1) / K));
        if (e <= relTol * scale || K >= maxSegments) break;
        K = std::min(maxSegments, K * 2);
      }
    }
    for (int k = 0; k < K; ++k) {
      const double a = l + (r - l) * k / K, b = (k + 1 == K) ? r : l + (r - l) * (k + 1) / K;
      f.len.push_back(b - a);
      f.slope.push_back((g(b) - g(a)) / (b - a));
      f.maxErr = std::max(f.maxErr, segErr(a, b));
    }
  }
  for (size_t k = 1; k < f.slope.size(); ++k)
    if (f.slope[k] > f.slope[k - 1] + 1e-12 * std::max(1.0, std::fabs(f.slope[k - 1]))) f.concave = false;
  f.maxErr = std::max(0.0, f.maxErr);
  return f;
}

double eval_pwl(const Pwl& f, double q) {
  double y = 0, left = std::max(0.0, q);
  for (size_t k = 0; k < f.len.size() && left > 0; ++k) {
    const double t = std::min(left, f.len[k]);
    y += f.slope[k] * t;
    left -= t;
  }
  return y;
}

int tail_count(double alpha, int n) {
  return (int)std::max<size_t>(1, (size_t)std::floor(alpha * n));
}

Metrics evaluate_on(const Problem& pb, const Matrix& price, const Matrix& cost,
                    const std::vector<double>& x) {
  const size_t S = x.size();
  std::vector<double> sold(S), mul(S);
  for (size_t s = 0; s < S; ++s) {
    mul[s] = price_mult(pb.market[s], x[s]);
    sold[s] = std::min(x[s], pb.market[s].absorb);
  }
  std::vector<double> P(price.size(), 0.0);
  for (size_t i = 0; i < price.size(); ++i) {
    double pr = 0;
    for (size_t s = 0; s < S; ++s) pr += sold[s] * price[i][s] * mul[s] - x[s] * cost[i][s];
    P[i] = pr;
  }
  return metrics_from(std::move(P), pb.alpha);
}

Metrics evaluate(const Problem& pb, const std::vector<double>& x) {
  return evaluate_on(pb, pb.price, pb.cost, x);
}

double objective_of(Criterion c, const Metrics& m) {
  switch (c) {
    case Criterion::Expected: return m.expected;
    case Criterion::Worst:    return m.worst;
    default:                  return m.cvar;
  }
}

Result solve(const Problem& pb) {
  Result r;
  const auto t0 = std::chrono::steady_clock::now();
  const size_t N = pb.price.size(), S = pb.market.size(), W = pb.capacity.size();
  if (N == 0 || S == 0 || pb.cost.size() != N || pb.upper.size() != S || pb.batch.size() != S ||
      pb.usage.size() != S || (pb.enforceMaxShare && pb.shareWeight.size() != S)) {
    r.reason = "invalid problem dimensions";
    return r;
  }
  for (size_t i = 0; i < N; ++i)
    if (pb.price[i].size() != S || pb.cost[i].size() != S) { r.reason = "invalid scenario matrix"; return r; }
  r.tailK = tail_count(pb.alpha, (int)N);

  // ── Области PWL, масштабы переменных и денег ──────────────────────────────
  std::vector<double> D(S), sigma(S), meanP(S, 0.0), meanC(S, 0.0), maxP(S, 0.0);
  for (size_t i = 0; i < N; ++i)
    for (size_t s = 0; s < S; ++s) {
      meanP[s] += pb.price[i][s] / N; meanC[s] += pb.cost[i][s] / N;
      maxP[s] = std::max(maxP[s], pb.price[i][s]);
    }
  std::vector<Pwl> pwl(S);
  double M = 0;
  for (size_t s = 0; s < S; ++s) {
    const double U = std::max(0.0, pb.upper[s]);
    const double cb = capacity_bound(pb, s);
    D[s] = std::min(U, std::isfinite(cb) ? cb * kCapBoundSlack : kInf);
    if (!std::isfinite(D[s]) && pb.market[s].capM > 0) D[s] = std::max(0.0, pb.market[s].absorb);
    sigma[s] = (std::isfinite(D[s]) && D[s] > 0) ? D[s] : 1.0;
    pwl[s] = build_pwl(pb.market[s], D[s], pb.minSegments, pb.maxSegments, pb.pwlRelTol);
    r.pwlSegments = std::max(r.pwlSegments, (int)pwl[s].len.size());
    r.pwlSegmentsTotal += (int)pwl[s].len.size();
    r.pwlConcave = r.pwlConcave && pwl[s].concave;
    if (std::isfinite(pwl[s].maxErr)) r.pwlMaxError += maxP[s] * pwl[s].maxErr;
    const double gD = std::isfinite(D[s]) ? revenue_volume(pb.market[s], D[s]) : 0.0;
    if (gD > 0) r.pwlMaxRelError = std::max(r.pwlMaxRelError, pwl[s].maxErr / gD);
    M += meanP[s] * revenue_volume(pb.market[s], sigma[s]) + meanC[s] * sigma[s];
  }
  if (!(M > 0) || !std::isfinite(M)) M = 1.0;

  // ── Столбцы ───────────────────────────────────────────────────────────────
  // [0,S) x̃_s = x_s/σ_s · [S,2S) ỹ_s = y_s/σ_s · отрезки PWL · η̃|t̃ · ũ_i (cvar)
  std::vector<int> segOff(S + 1, 0);
  for (size_t s = 0; s < S; ++s) segOff[s + 1] = segOff[s] + (int)pwl[s].len.size();
  const int cX = 0, cY = (int)S, cSeg = 2 * (int)S;
  const int cEta = cSeg + segOff[S];
  const bool scen = pb.criterion != Criterion::Expected;
  const int cU = cEta + (scen ? 1 : 0);
  const int nCol = cU + (pb.criterion == Criterion::Cvar ? (int)N : 0);

  HighsLp lp;
  lp.num_col_ = nCol;
  lp.col_cost_.assign(nCol, 0.0);
  lp.col_lower_.assign(nCol, 0.0);
  lp.col_upper_.assign(nCol, kHighsInf);
  for (size_t s = 0; s < S; ++s) {
    const double U = std::max(0.0, pb.upper[s]);
    lp.col_upper_[cX + s] = std::isfinite(U) ? U / sigma[s] : kHighsInf;
    lp.col_lower_[cY + s] = -kHighsInf;                 // ỹ задаётся равенством
    for (size_t k = 0; k < pwl[s].len.size(); ++k)
      lp.col_upper_[cSeg + segOff[s] + k] = std::isfinite(pwl[s].len[k]) ? pwl[s].len[k] / sigma[s] : kHighsInf;
  }
  if (scen) lp.col_lower_[cEta] = -kHighsInf;           // η / t свободны

  // Цель (min −F/M).
  if (pb.criterion == Criterion::Expected) {
    for (size_t s = 0; s < S; ++s) {
      lp.col_cost_[cY + s] = -meanP[s] * sigma[s] / M;
      lp.col_cost_[cX + s] =  meanC[s] * sigma[s] / M;
    }
  } else {
    lp.col_cost_[cEta] = -1.0;
    if (pb.criterion == Criterion::Cvar)
      for (size_t i = 0; i < N; ++i) lp.col_cost_[cU + i] = 1.0 / r.tailK;
  }

  // ── Строки ────────────────────────────────────────────────────────────────
  RowBuilder rb;
  std::vector<std::pair<int,double>> row;
  for (size_t s = 0; s < S; ++s) {                       // x̃_s = Σ_k seg_k
    row.assign({ { cX + (int)s, 1.0 } });
    for (size_t k = 0; k < pwl[s].len.size(); ++k) row.push_back({ cSeg + segOff[s] + (int)k, -1.0 });
    rb.add(row, 0.0, 0.0);
  }
  for (size_t s = 0; s < S; ++s) {                       // ỹ_s = Σ_k slope_k·seg_k
    row.assign({ { cY + (int)s, 1.0 } });
    for (size_t k = 0; k < pwl[s].len.size(); ++k) row.push_back({ cSeg + segOff[s] + (int)k, -pwl[s].slope[k] });
    rb.add(row, 0.0, 0.0);
  }
  std::vector<int> capRow(W, -1);
  std::vector<double> capScale(W, 1.0);
  for (size_t w = 0; w < W; ++w) {                       // Σ_s h_{s,w}·x_s ≤ Cap_w
    row.clear();
    capScale[w] = pb.capacity[w] > 0 ? pb.capacity[w] : 1.0;
    for (size_t s = 0; s < S; ++s)
      for (auto& [ww, h] : pb.usage[s]) if (ww == (int)w && h > 0) row.push_back({ cX + (int)s, h * sigma[s] / capScale[w] });
    if (row.empty()) continue;
    capRow[w] = rb.rows();
    rb.add(row, -kHighsInf, std::max(0.0, pb.capacity[w]) / capScale[w]);
  }
  if (pb.enforceMaxShare) {                              // x_s·w_s ≤ maxShare·Σ_t x_t·w_t
    for (size_t s = 0; s < S; ++s) {
      if (pb.shareWeight[s] <= 0) continue;
      row.clear();
      for (size_t t = 0; t < S; ++t) {
        double c = -pb.maxShare * pb.shareWeight[t] * sigma[t] / M;
        if (t == s) c += pb.shareWeight[s] * sigma[s] / M;
        row.push_back({ cX + (int)t, c });
      }
      rb.add(row, -kHighsInf, 0.0);
    }
  }
  if (scen) {                                            // P_i − η + u_i ≥ 0  |  P_i − t ≥ 0
    for (size_t i = 0; i < N; ++i) {
      row.clear();
      for (size_t s = 0; s < S; ++s) {
        row.push_back({ cY + (int)s,  pb.price[i][s] * sigma[s] / M });
        row.push_back({ cX + (int)s, -pb.cost[i][s]  * sigma[s] / M });
      }
      row.push_back({ cEta, -1.0 });
      if (pb.criterion == Criterion::Cvar) row.push_back({ cU + (int)i, 1.0 });
      rb.add(row, 0.0, kHighsInf);
    }
  }

  lp.num_row_ = rb.rows();
  lp.row_lower_ = rb.lower;
  lp.row_upper_ = rb.upper;
  lp.a_matrix_.format_  = MatrixFormat::kRowwise;
  lp.a_matrix_.num_col_ = nCol;
  lp.a_matrix_.num_row_ = lp.num_row_;
  lp.a_matrix_.start_   = rb.start;
  lp.a_matrix_.index_   = rb.index;
  lp.a_matrix_.value_   = rb.value;
  lp.sense_ = ObjSense::kMinimize;
  r.nCols = nCol; r.nRows = lp.num_row_; r.nNz = (long)rb.index.size();

  // ── Решение ───────────────────────────────────────────────────────────────
  std::vector<double> colValue, rowDual;
  double objVal = 0;
  HighsModelStatus st = HighsModelStatus::kNotset;
  {
    std::lock_guard<std::mutex> lk(highs_mutex());
    Highs highs;
    highs.setOptionValue("output_flag", false);
    highs.setOptionValue("time_limit", std::max(0.1, pb.timeLimitSec));
    highs.setOptionValue("random_seed", 0);
    if (highs.passModel(std::move(lp)) == HighsStatus::kError) {
      r.reason = "HiGHS rejected the model";
      return r;
    }
    const HighsStatus rs = highs.run();
    st = highs.getModelStatus();
    if (rs == HighsStatus::kError && st == HighsModelStatus::kNotset) {
      r.reason = "HiGHS run failed";
      return r;
    }
    const HighsSolution& sol = highs.getSolution();
    if (sol.value_valid) colValue = sol.col_value;
    if (sol.dual_valid) rowDual = sol.row_dual;
    objVal = highs.getInfo().objective_function_value;
    r.status = status_name(st);
    if (st != HighsModelStatus::kOptimal) r.reason = highs.modelStatusToString(st);
  }
  r.solveMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  if (st != HighsModelStatus::kOptimal || colValue.size() != (size_t)nCol) return r;

  // ── Разбор решения ────────────────────────────────────────────────────────
  r.lpObjective = -objVal * M;
  r.x.assign(S, 0.0);
  for (size_t s = 0; s < S; ++s) {
    double v = colValue[cX + s] * sigma[s];
    if (v < 1e-9 * sigma[s]) v = 0.0;
    r.x[s] = std::min(std::max(0.0, pb.upper[s]), v);
  }
  r.metrics = evaluate(pb, r.x);
  r.objective = objective_of(pb.criterion, r.metrics);

  std::vector<double> load(W, 0.0);
  for (size_t s = 0; s < S; ++s)
    for (auto& [w, h] : pb.usage[s]) if (w >= 0 && w < (int)W) load[w] += r.x[s] * h;
  for (size_t w = 0; w < W; ++w) {
    if (capRow[w] < 0) continue;
    Dual d;
    d.resource = (int)w;
    d.load = load[w];
    d.capacity = pb.capacity[w];
    d.utilization = pb.capacity[w] > 0 ? load[w] / pb.capacity[w] : 0.0;
    d.binding = pb.capacity[w] - load[w] <= 1e-6 * std::max(1.0, pb.capacity[w]);
    if (!rowDual.empty()) {
      const double sp = -rowDual[capRow[w]] * M / capScale[w];   // ∂F/∂Cap_w (min −F/M)
      d.shadowPrice = std::fabs(sp) < 1e-9 * M / capScale[w] ? 0.0 : sp;
    }
    r.duals.push_back(d);
  }
  round_to_batches(pb, r.x, r);
  return r;
}

}  // namespace maos::exact
