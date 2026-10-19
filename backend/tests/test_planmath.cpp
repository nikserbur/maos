// B1 / B10 / B14 / B16 — чистые формулы планирования (PlanMath.h).
#include "PlanMath.h"
#include <gtest/gtest.h>

namespace pm = maos::planmath;

TEST(LotStreaming, ConsumerWaitsForLastNeededInputSublot) {
  // L = 8 входных партий, N = 2 партии потребителя: партия 0 нужна половина входа
  // (входные 0..3) → ждать партию 3; партия 1 → партию 7. Старая формула k·L/N давала 0 и 4.
  EXPECT_EQ(pm::lot_input_index(0, 2, 8), 3);
  EXPECT_EQ(pm::lot_input_index(1, 2, 8), 7);
  // L = 3, N = 2: партии 0 нужно 1.5 входной партии → ждать входную 1.
  EXPECT_EQ(pm::lot_input_index(0, 2, 3), 1);
  EXPECT_EQ(pm::lot_input_index(1, 2, 3), 2);
}

TEST(LotStreaming, FewerInputSublotsThanConsumerSublots) {
  // L = 2, N = 4: партии 0,1 укладываются в первую входную, 2,3 — во вторую.
  EXPECT_EQ(pm::lot_input_index(0, 4, 2), 0);
  EXPECT_EQ(pm::lot_input_index(1, 4, 2), 0);
  EXPECT_EQ(pm::lot_input_index(2, 4, 2), 1);
  EXPECT_EQ(pm::lot_input_index(3, 4, 2), 1);
}

TEST(LotStreaming, EqualSublotsMapOneToOneAndClamp) {
  for (int k = 0; k < 16; ++k) EXPECT_EQ(pm::lot_input_index(k, 16, 16), k);
  EXPECT_EQ(pm::lot_input_index(0, 1, 1), 0);
  EXPECT_EQ(pm::lot_input_index(5, 4, 3), 2);   // за пределами → последняя
}

TEST(LotStreaming, InputSublotCoversConsumerDemandFraction) {
  // Свойство: доля входа, готовая к моменту j, ≥ доли, нужной партии k; и j — минимальная такая.
  for (int N = 1; N <= 16; ++N)
    for (int L = 1; L <= 16; ++L)
      for (int k = 0; k < N; ++k) {
        const int j = pm::lot_input_index(k, N, L);
        EXPECT_GE((j + 1) * N, (k + 1) * L) << "N=" << N << " L=" << L << " k=" << k;
        if (j > 0) EXPECT_LT(j * N, (k + 1) * L) << "N=" << N << " L=" << L << " k=" << k;
      }
}

TEST(LittlesLaw, TimeAverageEqualsLambdaTimesW) {
  // 3 заказа на горизонте T = 10: интервалы [0,4], [2,6], [5,10].
  const std::vector<std::pair<double,double>> iv = { {0, 4}, {2, 6}, {5, 10} };
  const double T = 10;
  const double L = pm::time_avg_in_system(iv, T);
  const double lambda = 3.0 / T, W = (4.0 + 4.0 + 5.0) / 3.0;
  EXPECT_NEAR(L, lambda * W, 1e-12);
  EXPECT_NEAR(L, 1.3, 1e-12);
}

TEST(MrpOffset, LotCycleUsesBatchesAndParallelMachines) {
  // Партия запуска 10 шт., batch 2 → 5 партий. Оп.1: 2 ч/партию на 1 станке → 10 ч;
  // оп.2: 1 ч/партию на 2 станках → ⌈5/2⌉ = 3 волны → 3 ч. Итого 13 ч
  // (старая формула «на единицу» давала 2 + 1 = 3 ч).
  const std::vector<pm::OpLoad> ops = { {2.0, 1}, {1.0, 2} };
  EXPECT_NEAR(pm::lot_cycle_hours(ops, 10, 2), 13.0, 1e-12);
  EXPECT_NEAR(pm::lot_cycle_hours(ops, 2, 2), 3.0, 1e-12);    // одна партия
  EXPECT_NEAR(pm::lot_cycle_hours(ops, 0, 2), 0.0, 1e-12);    // нечего запускать
  EXPECT_NEAR(pm::lot_cycle_hours({ {1.0, 4} }, 3, 1), 1.0, 1e-12);  // 3 партии на 4 станках
}

TEST(NextBottleneck, ArgmaxOverAllTypesIncludingInvestedOne) {
  // Тип «a» (куда инвестировали) остаётся самым загруженным → он и есть следующее ограничение.
  const nlohmann::json load = nlohmann::json::array({
    { {"wc_type_id", "a"}, {"utilization", 0.97} },
    { {"wc_type_id", "b"}, {"utilization", 0.80} },
  });
  const auto nb = pm::next_bottleneck(load);
  EXPECT_EQ(nb.first, "a");
  EXPECT_DOUBLE_EQ(nb.second, 0.97);
  const auto empty = pm::next_bottleneck(nlohmann::json::array());
  EXPECT_EQ(empty.first, "");
  EXPECT_DOUBLE_EQ(empty.second, 0.0);
}
