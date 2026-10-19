#pragma once
/**
 * Чистые вспомогательные формулы планирования (без БД и состояния), вынесенные
 * из Scheduler.cpp / main.cpp, чтобы их можно было проверить юнит-тестами.
 * Определения KPI — docs/AUDIT-2026-10.md §4.2.
 */
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace maos::planmath {

/**
 * Lot streaming (B1). Вход потребителя разбит на L равных transfer-партий,
 * потребитель — на N. Партия потребителя k (0..N−1) нуждается в доле (k+1)/N
 * входа, а входная партия j покрывает долю (j+1)/L ⇒ k должна ждать ПОСЛЕДНЮЮ
 * нужную входную партию j = ⌈(k+1)·L/N⌉ − 1 (зажато в [0, L−1]).
 */
inline int lot_input_index(int k, int N, int L) {
  if (L <= 1 || N <= 0) return 0;
  const long long num = (long long)(k + 1) * L;
  const long long j = (num + N - 1) / N - 1;               // ceil((k+1)·L/N) − 1
  return (int)std::max(0LL, std::min<long long>(L - 1, j));
}

/**
 * Средний задел по времени (B10): L = (1/T)·∫₀ᵀ N(t) dt, где N(t) — число заказов,
 * находящихся в системе (между запуском первой операции и выпуском). Считается
 * разверткой событий — независимо от формулы Литтла L = λ·W, чтобы её проверять.
 */
inline double time_avg_in_system(const std::vector<std::pair<double,double>>& intervals, double T) {
  if (!(T > 0)) return 0;
  std::vector<std::pair<double,int>> ev;                  // (время, +1/−1)
  ev.reserve(intervals.size() * 2);
  for (auto& [s, f] : intervals) {
    const double a = std::max(0.0, std::min(s, f)), b = std::min(T, std::max(s, f));
    if (b > a) { ev.push_back({ a, +1 }); ev.push_back({ b, -1 }); }
  }
  std::sort(ev.begin(), ev.end());
  double area = 0, prev = 0; int n = 0;
  for (auto& [t, d] : ev) { area += n * (t - prev); prev = t; n += d; }
  return area / T;
}

/** Операция техкарты для MRP-смещения: часы на ОДНУ партию и число параллельных станков. */
struct OpLoad { double hoursPerBatch = 0; int parallelMachines = 1; };

/**
 * Цикл обработки ПАРТИИ ЗАПУСКА (B14) для lead-time offset MRP, ч:
 * nb = ⌈qty / batch⌉ партий; на операции они распределяются по m параллельным
 * станкам ⇒ ⌈nb/m⌉ «волн» по hoursPerBatch; операции маршрута идут
 * последовательно (без перекрытия — консервативная оценка, как в классическом MRP).
 */
inline double lot_cycle_hours(const std::vector<OpLoad>& ops, double lotQty, double batchSize) {
  if (!(lotQty > 0)) return 0;
  const double b = batchSize > 0 ? batchSize : 1.0;
  const double nb = std::max(1.0, std::ceil(lotQty / b - 1e-9));
  double h = 0;
  for (const OpLoad& o : ops) {
    const double m = (double)std::max(1, o.parallelMachines);
    h += std::max(0.0, o.hoursPerBatch) * std::ceil(nb / m - 1e-9);
  }
  return h;
}

/**
 * «Следующее узкое место» (B16): argmax загрузки по ВСЕМ типам РЦ после
 * инвестиции — может совпасть с типом, в который инвестировали (если он
 * остаётся ограничением). Вход — массив resource_load [{wc_type_id, utilization}].
 * Возвращает (wc_type_id, utilization); пустой массив → ("", 0).
 */
inline std::pair<std::string,double> next_bottleneck(const nlohmann::json& load) {
  std::string id; double best = -1;
  if (load.is_array())
    for (auto& e : load) {
      if (!e.is_object() || !e.contains("wc_type_id") || !e["wc_type_id"].is_string()) continue;
      const double u = e.contains("utilization") && e["utilization"].is_number()
                     ? e["utilization"].get<double>() : 0.0;
      if (u > best) { best = u; id = e["wc_type_id"].get<std::string>(); }
    }
  return { id, id.empty() ? 0.0 : best };
}

}  // namespace maos::planmath
