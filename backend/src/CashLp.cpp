#include "CashLp.h"
#include "Highs.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <mutex>

namespace maos::cashlp {
namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kCapBoundSlack = 1.05;   // как в ExactCvar: область PWL шире потолка мощности

struct RowBuilder {
  std::vector<HighsInt> start{ 0 }, index;
  std::vector<double>   value, lower, upper;
  std::vector<std::pair<int,double>> tmp;
  void add(const std::vector<std::pair<int,double>>& coefs, double lo, double up) {
    tmp.assign(coefs.begin(), coefs.end());            // один столбец может входить несколько раз
    std::sort(tmp.begin(), tmp.end(), [](auto& a, auto& b) { return a.first < b.first; });
    for (size_t k = 0; k < tmp.size(); ++k) {
      double v = tmp[k].second;
      while (k + 1 < tmp.size() && tmp[k + 1].first == tmp[k].first) v += tmp[++k].second;
      if (v != 0.0) { index.push_back(tmp[k].first); value.push_back(v); }
    }
    start.push_back((HighsInt)index.size());
    lower.push_back(lo); upper.push_back(up);
  }
  int rows() const { return (int)lower.size(); }
};

double capacity_bound(const exact::Problem& pb, size_t s) {
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

exact::Metrics metrics_from(std::vector<double> v, double alpha) {
  exact::Metrics mt;
  if (v.empty()) return mt;
  double s = 0; for (double x : v) s += x; mt.expected = s / v.size();
  std::sort(v.begin(), v.end());
  mt.worst = v.front();
  const int k = exact::tail_count(alpha, (int)v.size());
  double tail = 0; for (int i = 0; i < k; ++i) tail += v[i];
  mt.cvar = tail / k;
  return mt;
}

}  // namespace

std::vector<double> uniform_profile(int T) {
  return std::vector<double>(std::max(1, T), 1.0 / std::max(1, T));
}

std::vector<double> payment_profile(const std::vector<double>& production, double prepayShare,
                                    int leadWeeks, int dpoWeeks, int totalLen) {
  std::vector<double> psi(std::max(1, totalLen), 0.0);
  const double phi = std::min(1.0, std::max(0.0, prepayShare));
  for (int t = 0; t < (int)production.size(); ++t) {
    const int tPre = std::max(0, t - std::max(0, leadWeeks));                       // заказ за L до выпуска
    const int tPost = std::min((int)psi.size() - 1, tPre + std::max(0, leadWeeks) + std::max(0, dpoWeeks));
    psi[tPre] += phi * production[t];
    psi[tPost] += (1.0 - phi) * production[t];
  }
  return psi;
}

Result solve(const Problem& P) {
  Result r;
  const auto t0 = std::chrono::steady_clock::now();
  const exact::Problem& pb = P.base;
  const CashParams& cp = P.cp;
  const size_t N = pb.price.size(), S = pb.market.size(), W = pb.capacity.size();
  const int T = std::max(1, P.T), TT = T + std::max(0, cp.runoffWeeks);
  if (N == 0 || S == 0 || pb.cost.size() != N || pb.upper.size() != S || pb.batch.size() != S ||
      pb.usage.size() != S || P.ship.size() != S || P.pay.size() != S || P.vatCostShare.size() != S ||
      P.fixed.size() != N || P.rate.size() != N || (pb.enforceMaxShare && pb.shareWeight.size() != S)) {
    r.reason = "invalid problem dimensions"; return r;
  }
  for (size_t i = 0; i < N; ++i)
    if (pb.price[i].size() != S || pb.cost[i].size() != S || (int)P.fixed[i].size() < TT || (int)P.rate[i].size() < TT)
      { r.reason = "invalid scenario matrix"; return r; }
  for (size_t s = 0; s < S; ++s)
    if ((int)P.ship[s].size() < T || (int)P.pay[s].size() < TT) { r.reason = "invalid profile length"; return r; }
  const bool cvar = pb.criterion != exact::Criterion::Expected;
  r.tailK = pb.criterion == exact::Criterion::Worst ? 1 : exact::tail_count(pb.alpha, (int)N);
  r.tailKBeta = exact::tail_count(cp.beta, (int)N);
  const double v1 = 1.0 + cp.tauV;

  // ── PWL, масштабы (как ExactCvar) ────────────────────────────────────────
  std::vector<double> D(S), sigma(S), meanP(S, 0.0), meanC(S, 0.0);
  for (size_t i = 0; i < N; ++i)
    for (size_t s = 0; s < S; ++s) { meanP[s] += pb.price[i][s] / N; meanC[s] += pb.cost[i][s] / N; }
  std::vector<exact::Pwl> pwl(S);
  double M = 0;
  for (size_t s = 0; s < S; ++s) {
    const double U = std::max(0.0, pb.upper[s]), cb = capacity_bound(pb, s);
    D[s] = std::min(U, std::isfinite(cb) ? cb * kCapBoundSlack : kInf);
    if (!std::isfinite(D[s]) && pb.market[s].capM > 0) D[s] = std::max(0.0, pb.market[s].absorb);
    sigma[s] = (std::isfinite(D[s]) && D[s] > 0) ? D[s] : 1.0;
    pwl[s] = exact::build_pwl(pb.market[s], D[s], pb.minSegments, pb.maxSegments, pb.pwlRelTol);
    M += meanP[s] * exact::revenue_volume(pb.market[s], sigma[s]) + meanC[s] * sigma[s];
  }
  if (!(M > 0) || !std::isfinite(M)) M = 1.0;
  std::vector<int> taxWeeks;                 // концы налоговых периодов внутри горизонта
  for (int t = 0; t < T; ++t) if ((t + 1) % std::max(1, cp.taxPeriodWeeks) == 0) taxWeeks.push_back(t);
  const int Q = (int)taxWeeks.size();
  // НДС к уплате: период q → доли в недели due; vatDue[t] = {(q, доля)}.
  struct VatPart { int q; double share; };
  std::vector<std::vector<VatPart>> vatDue(TT);
  std::vector<std::pair<int,int>> vatPeriods;   // [from, to] недель выручки/закупок
  if (cp.vatRemittance && cp.tauV > 0) {
    const int vp = std::max(1, cp.vatPeriodWeeks), vn = std::max(1, cp.vatInstalments), vl = std::max(0, cp.vatInstalmentLagWeeks);
    for (int t = 0; t < T; ++t) if ((t + 1) % vp == 0) {           // только полные периоды (как водопад)
      const int q = (int)vatPeriods.size();
      vatPeriods.push_back({ t + 1 - vp, t });
      if (vl == 0) vatDue[t].push_back({ q, 1.0 });
      else for (int j = 0; j < vn; ++j) { const int due = t + (j + 1) * vl; if (due < TT) vatDue[due].push_back({ q, 1.0 / vn }); }
    }
  }

  // ── Столбцы ───────────────────────────────────────────────────────────────
  std::vector<int> segOff(S + 1, 0);
  for (size_t s = 0; s < S; ++s) segOff[s + 1] = segOff[s] + (int)pwl[s].len.size();
  const int cX = 0, cY = (int)S, cSeg = 2 * (int)S;
  const int cR = cSeg + segOff[S];                        // R_{i,t}: i*T + t
  const int cC = cR + (int)N * T;                         // C_{i,t}: i*TT + t
  const int cD = cC + (int)N * TT;
  const int nFin = cp.firstStage ? TT : (int)N * TT;      // d, rep
  const int cd = cD + (int)N * TT, cRep = cd + nFin;
  const int cTax = cRep + nFin;                           // T_{i,q}: i*Q + q
  const int cEta = cTax + (int)N * Q;
  const int cU = cEta + 1;
  const int cZeta = cU + (cvar ? (int)N : 0);
  const int cV = cZeta + 1;
  const int nCol = cV + (int)N;
  auto fin = [&](int i, int t) { return cp.firstStage ? t : i * TT + t; };

  HighsLp lp;
  lp.num_col_ = nCol;
  lp.col_cost_.assign(nCol, 0.0);
  lp.col_lower_.assign(nCol, 0.0);
  lp.col_upper_.assign(nCol, kHighsInf);
  for (size_t s = 0; s < S; ++s) {
    const double U = std::max(0.0, pb.upper[s]);
    lp.col_upper_[cX + s] = std::isfinite(U) ? U / sigma[s] : kHighsInf;
    lp.col_lower_[cY + s] = -kHighsInf;
    for (size_t k = 0; k < pwl[s].len.size(); ++k)
      lp.col_upper_[cSeg + segOff[s] + k] = std::isfinite(pwl[s].len[k]) ? pwl[s].len[k] / sigma[s] : kHighsInf;
  }
  for (size_t i = 0; i < N; ++i) {
    for (int t = 0; t < T; ++t) lp.col_lower_[cR + i * T + t] = -kHighsInf;
    for (int t = 0; t < TT; ++t) {
      lp.col_lower_[cC + i * TT + t] = -kHighsInf;
      lp.col_upper_[cD + i * TT + t] = std::max(0.0, cp.creditLimit) / M;
    }
  }
  lp.col_lower_[cEta] = -kHighsInf;
  lp.col_lower_[cZeta] = -kHighsInf;
  // Цель (min −F/M).
  if (cvar) {
    lp.col_cost_[cEta] = -1.0;
    for (size_t i = 0; i < N; ++i) lp.col_cost_[cU + i] = 1.0 / r.tailK;
  } else {
    for (size_t i = 0; i < N; ++i) {
      for (size_t s = 0; s < S; ++s) {
        lp.col_cost_[cY + s] += -pb.price[i][s] * sigma[s] / M / N;
        lp.col_cost_[cX + s] +=  pb.cost[i][s]  * sigma[s] / M / N;
      }
      for (int t = 1; t < TT; ++t) lp.col_cost_[cD + i * TT + t - 1] += P.rate[i][t] / N;
      lp.col_cost_[cD + i * TT + TT - 1] += P.rate[i][TT - 1] / N;      // терминальный период
      for (int q = 0; q < Q; ++q) lp.col_cost_[cTax + i * Q + q] += 1.0 / N;
    }
  }
  if (cp.lambdaL > 0) {
    lp.col_cost_[cZeta] += -cp.lambdaL;
    for (size_t i = 0; i < N; ++i) lp.col_cost_[cV + i] += cp.lambdaL / r.tailKBeta;
  }

  // ── Строки ────────────────────────────────────────────────────────────────
  RowBuilder rb;
  std::vector<std::pair<int,double>> row;
  for (size_t s = 0; s < S; ++s) {
    row.assign({ { cX + (int)s, 1.0 } });
    for (size_t k = 0; k < pwl[s].len.size(); ++k) row.push_back({ cSeg + segOff[s] + (int)k, -1.0 });
    rb.add(row, 0.0, 0.0);
  }
  for (size_t s = 0; s < S; ++s) {
    row.assign({ { cY + (int)s, 1.0 } });
    for (size_t k = 0; k < pwl[s].len.size(); ++k) row.push_back({ cSeg + segOff[s] + (int)k, -pwl[s].slope[k] });
    rb.add(row, 0.0, 0.0);
  }
  std::vector<int> capRow(W, -1);
  std::vector<double> capScale(W, 1.0);
  for (size_t w = 0; w < W; ++w) {
    row.clear();
    capScale[w] = pb.capacity[w] > 0 ? pb.capacity[w] : 1.0;
    for (size_t s = 0; s < S; ++s)
      for (auto& [ww, h] : pb.usage[s]) if (ww == (int)w && h > 0) row.push_back({ cX + (int)s, h * sigma[s] / capScale[w] });
    if (row.empty()) continue;
    capRow[w] = rb.rows();
    rb.add(row, -kHighsInf, std::max(0.0, pb.capacity[w]) / capScale[w]);
  }
  if (pb.enforceMaxShare)
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
  const int K = (int)cp.dsoKernel.size();
  std::vector<double> cumShip(S);                        // Φ_{s,q} для налоговых строк
  for (size_t i = 0; i < N; ++i) {
    const int iT = (int)i * T, iTT = (int)i * TT;
    // Выручка по отгрузкам.
    for (int t = 0; t < T; ++t) {
      row.assign({ { cR + iT + t, 1.0 } });
      for (size_t s = 0; s < S; ++s)
        row.push_back({ cY + (int)s, -pb.price[i][s] * P.ship[s][t] * sigma[s] / M });
      rb.add(row, 0.0, 0.0);
    }
    // Касса и долг по периодам.
    for (int t = 0; t < TT; ++t) {
      row.assign({ { cC + iTT + t, 1.0 } });
      double rhs = -P.fixed[i][t] / M;
      if (t > 0) row.push_back({ cC + iTT + t - 1, -1.0 }); else rhs += cp.c0 / M;
      for (int k = 0; k < K && t - k >= 0; ++k)
        if (t - k < T) row.push_back({ cR + iT + t - k, -cp.dsoKernel[k] * v1 });
      for (size_t s = 0; s < S; ++s) {                  // материалы — по ψ с НДС; конверсия — при выпуске
        const double m = P.vatCostShare[s];
        const double k = P.pay[s][t] * m * (1.0 + cp.tauV) + (t < T ? P.ship[s][t] : 0.0) * (1.0 - m);
        if (k > 0) row.push_back({ cX + (int)s, k * pb.cost[i][s] * sigma[s] / M });
      }
      if (t > 0) row.push_back({ cD + iTT + t - 1, P.rate[i][t] }); else rhs -= P.rate[i][0] * cp.d0 / M;
      row.push_back({ cRep + fin((int)i, t), 1.0 });
      row.push_back({ cd + fin((int)i, t), -1.0 });
      for (int q = 0; q < Q; ++q) if (taxWeeks[q] == t) row.push_back({ cTax + (int)i * Q + q, 1.0 });
      for (const VatPart& vp : vatDue[t]) {                 // + доля НДС периода q
        const auto [from, to] = vatPeriods[vp.q];
        for (int tau = from; tau <= to; ++tau) row.push_back({ cR + iT + tau, cp.tauV * vp.share });
        for (size_t s = 0; s < S; ++s) {
          double pi = 0; for (int tau = from; tau <= to; ++tau) pi += P.ship[s][tau];
          if (pi > 0) row.push_back({ cX + (int)s, -cp.tauV * vp.share * pi * pb.cost[i][s] * P.vatCostShare[s] * sigma[s] / M });
        }
      }
      rb.add(row, rhs, rhs);
      row.assign({ { cD + iTT + t, 1.0 }, { cd + fin((int)i, t), -1.0 }, { cRep + fin((int)i, t), 1.0 } });
      double rhsD = 0;
      if (t > 0) row.push_back({ cD + iTT + t - 1, -1.0 }); else rhsD = cp.d0 / M;
      rb.add(row, rhsD, rhsD);
    }
    // Налог по накопленной базе (линеаризация с переносом убытка).
    std::fill(cumShip.begin(), cumShip.end(), 0.0);
    double cumF = 0; int tPrev = 0;
    for (int q = 0; q < Q; ++q) {
      const int tq = taxWeeks[q];
      for (int t = tPrev; t <= tq; ++t) { cumF += P.fixed[i][t] / M; for (size_t s = 0; s < S; ++s) cumShip[s] += P.ship[s][t]; }
      tPrev = tq + 1;
      row.clear();
      for (int qq = 0; qq <= q; ++qq) row.push_back({ cTax + (int)i * Q + qq, 1.0 });
      for (int t = 0; t <= tq; ++t) row.push_back({ cR + iT + t, -cp.tauP });
      for (size_t s = 0; s < S; ++s)
        if (cumShip[s] > 0) row.push_back({ cX + (int)s, cp.tauP * cumShip[s] * pb.cost[i][s] * sigma[s] / M });
      for (int t = 1; t <= tq; ++t) row.push_back({ cD + iTT + t - 1, cp.tauP * P.rate[i][t] });
      rb.add(row, cp.tauP * (-cumF - P.rate[i][0] * cp.d0 / M), kHighsInf);
    }
    // Прибыль сценария и CVaR.
    if (cvar) {
      row.clear();
      for (size_t s = 0; s < S; ++s) {
        row.push_back({ cY + (int)s,  pb.price[i][s] * sigma[s] / M });
        row.push_back({ cX + (int)s, -pb.cost[i][s]  * sigma[s] / M });
      }
      for (int t = 1; t < TT; ++t) row.push_back({ cD + iTT + t - 1, -P.rate[i][t] });
      row.push_back({ cD + iTT + TT - 1, -P.rate[i][TT - 1] });        // долг на конец горизонта — ещё период процентов
      for (int q = 0; q < Q; ++q) row.push_back({ cTax + (int)i * Q + q, -1.0 });
      row.push_back({ cEta, -1.0 });
      row.push_back({ cU + (int)i, 1.0 });
      rb.add(row, P.rate[i][0] * cp.d0 / M, kHighsInf);
    }
    // CVaR минимума кассы: C_{i,t} − ζ + v_i ≥ 0.
    for (int t = 0; t < TT; ++t)
      rb.add({ { cC + iTT + t, 1.0 }, { cZeta, -1.0 }, { cV + (int)i, 1.0 } }, 0.0, kHighsInf);
  }
  int liqRow = -1;
  if (cp.liquidityConstraint) {
    row.assign({ { cZeta, 1.0 } });
    for (size_t i = 0; i < N; ++i) row.push_back({ cV + (int)i, -1.0 / r.tailKBeta });
    liqRow = rb.rows();
    rb.add(row, cp.lMin / M, kHighsInf);
  }

  lp.num_row_ = rb.rows();
  lp.row_lower_ = rb.lower; lp.row_upper_ = rb.upper;
  lp.a_matrix_.format_  = MatrixFormat::kRowwise;
  lp.a_matrix_.num_col_ = nCol; lp.a_matrix_.num_row_ = lp.num_row_;
  lp.a_matrix_.start_ = rb.start; lp.a_matrix_.index_ = rb.index; lp.a_matrix_.value_ = rb.value;
  lp.sense_ = ObjSense::kMinimize;
  r.nCols = nCol; r.nRows = lp.num_row_; r.nNz = (long)rb.index.size();

  // ── Решение ───────────────────────────────────────────────────────────────
  std::vector<double> col, rowDual, colDual;
  double objVal = 0;
  HighsModelStatus st = HighsModelStatus::kNotset;
  {
    std::lock_guard<std::mutex> lk(exact::highs_mutex());
    Highs highs;
    highs.setOptionValue("output_flag", false);
    highs.setOptionValue("time_limit", std::max(0.1, pb.timeLimitSec));
    highs.setOptionValue("random_seed", 0);
    if (highs.passModel(std::move(lp)) == HighsStatus::kError) { r.reason = "HiGHS rejected the model"; return r; }
    const HighsStatus rs = highs.run();
    st = highs.getModelStatus();
    if (rs == HighsStatus::kError && st == HighsModelStatus::kNotset) { r.reason = "HiGHS run failed"; return r; }
    const HighsSolution& sol = highs.getSolution();
    if (sol.value_valid) col = sol.col_value;
    if (sol.dual_valid) { rowDual = sol.row_dual; colDual = sol.col_dual; }
    objVal = highs.getInfo().objective_function_value;
    r.status = status_name(st);
    if (st != HighsModelStatus::kOptimal) r.reason = highs.modelStatusToString(st);
  }
  r.solveMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  if (st != HighsModelStatus::kOptimal || col.size() != (size_t)nCol) return r;

  // ── Разбор ────────────────────────────────────────────────────────────────
  r.lpObjective = -objVal * M;
  r.x.assign(S, 0.0); r.xRounded.assign(S, 0.0);
  for (size_t s = 0; s < S; ++s) {
    double v = col[cX + s] * sigma[s];
    if (v < 1e-9 * sigma[s]) v = 0.0;
    r.x[s] = std::min(std::max(0.0, pb.upper[s]), v);
    const double b = std::max(1.0, pb.batch[s]);
    r.xRounded[s] = std::floor(r.x[s] / b + 1e-7) * b;
  }
  r.eta = cvar ? col[cEta] * M : 0; r.zeta = col[cZeta] * M;
  r.cash.assign(N, std::vector<double>(TT)); r.debt = r.cash; r.draw = r.cash; r.repay = r.cash;
  r.tax.assign(N, std::vector<double>(TT, 0.0));
  r.interestTotal.assign(N, 0.0); r.taxTotal.assign(N, 0.0); r.minCash.assign(N, 0.0); r.profit.assign(N, 0.0);
  int neg = 0;
  for (size_t i = 0; i < N; ++i) {
    double prevD = cp.d0, mn = kInf;
    for (int t = 0; t < TT; ++t) {
      r.cash[i][t]  = col[cC + i * TT + t] * M;
      r.debt[i][t]  = col[cD + i * TT + t] * M;
      r.draw[i][t]  = col[cd + fin((int)i, t)] * M;
      r.repay[i][t] = col[cRep + fin((int)i, t)] * M;
      r.interestTotal[i] += P.rate[i][t] * prevD; prevD = r.debt[i][t];
      mn = std::min(mn, r.cash[i][t]);
    }
    r.interestTotal[i] += P.rate[i][TT - 1] * prevD;                  // терминальный период (как в LP)
    for (int q = 0; q < Q; ++q) { const double tx = col[cTax + i * Q + q] * M; r.tax[i][taxWeeks[q]] = tx; r.taxTotal[i] += tx; }
    r.minCash[i] = mn; if (mn < -1e-9 * M) ++neg;
    double pr = 0;
    for (size_t s = 0; s < S; ++s)
      pr += exact::revenue_volume(pb.market[s], r.x[s]) * pb.price[i][s] - r.x[s] * pb.cost[i][s];
    r.profit[i] = pr - r.interestTotal[i] - r.taxTotal[i];
  }
  r.pNegativeCash = (double)neg / N;
  r.metrics = metrics_from(r.profit, pb.criterion == exact::Criterion::Worst ? 1.0 / N : pb.alpha);
  r.objective = exact::objective_of(pb.criterion, r.metrics);
  r.cfar = metrics_from(r.minCash, cp.beta).cvar;

  std::vector<double> load(W, 0.0);
  for (size_t s = 0; s < S; ++s)
    for (auto& [w, h] : pb.usage[s]) if (w >= 0 && w < (int)W) load[w] += r.x[s] * h;
  for (size_t w = 0; w < W; ++w) {
    if (capRow[w] < 0) continue;
    exact::Dual d;
    d.resource = (int)w; d.load = load[w]; d.capacity = pb.capacity[w];
    d.utilization = pb.capacity[w] > 0 ? load[w] / pb.capacity[w] : 0.0;
    d.binding = pb.capacity[w] - load[w] <= 1e-6 * std::max(1.0, pb.capacity[w]);
    if (!rowDual.empty()) {
      const double sp = -rowDual[capRow[w]] * M / capScale[w];
      d.shadowPrice = std::fabs(sp) < 1e-9 * M / capScale[w] ? 0.0 : sp;
    }
    r.duals.push_back(d);
  }
  if (liqRow >= 0 && !rowDual.empty()) {
    r.liquidityDual = -rowDual[liqRow];                     // ∂F/∂L_min (F = −obj·M, L̃ = L/M)
    if (std::fabs(r.liquidityDual) < 1e-12) r.liquidityDual = 0;
    r.liquidityBinding = r.zeta - r.cfar <= 1e-6 * std::max(1.0, M) || r.liquidityDual != 0;
  }
  if (!colDual.empty() && cp.creditLimit > 0) {
    double sum = 0;
    for (size_t i = 0; i < N; ++i)
      for (int t = 0; t < TT; ++t) sum += std::max(0.0, -colDual[cD + i * TT + t]);
    r.creditLimitDual = sum;                                // ∂F/∂Limit (все границы сдвигаются вместе)
  }
  return r;
}

}  // namespace maos::cashlp
