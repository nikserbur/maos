// Стадия 1 — генетический алгоритм (GaImprover): улучшение от затравки, элитизм,
// детерминизм по потокам, ранняя остановка, обмен только среди однотипных генов.
#include "GaImprover.h"
#include <gtest/gtest.h>
#include <algorithm>
#include <cmath>
#include <numeric>
#include <vector>

namespace {

// Число инверсий порядка, задаваемого ключом, относительно тождественного 0,1,…,n−1.
// Минимум 0 — ключ упорядочивает гены по возрастанию индекса (аналог «лучшего расписания»).
double inversions(const std::vector<double>& key) {
  std::vector<int> order(key.size());
  std::iota(order.begin(), order.end(), 0);
  std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return key[a] < key[b]; });
  double inv = 0;
  for (size_t i = 0; i < order.size(); ++i)
    for (size_t j = i + 1; j < order.size(); ++j)
      if (order[i] > order[j]) inv += 1;
  return inv;
}

std::vector<double> reversed(size_t n) {
  std::vector<double> k(n);
  for (size_t i = 0; i < n; ++i) k[i] = static_cast<double>(n - i);
  return k;
}

}  // namespace

TEST(GaImprover, ImprovesOnSeedAndHistoryIsMonotone) {
  maos::GaConfig cfg;
  cfg.popSize = 24; cfg.generations = 60; cfg.stallGens = 60; cfg.seed = 7; cfg.threads = 1;
  cfg.sigma0 = 1.0;                                       // шаг ~ разности соседних ключей
  const auto seed = reversed(12);                         // худший порядок: 66 инверсий
  const auto res = maos::run_key_ga({ seed }, inversions, cfg);
  ASSERT_FALSE(res.history.empty());
  EXPECT_DOUBLE_EQ(res.seedScore, 66.0);                 // оценка первой затравки
  EXPECT_LE(res.history.front().best, res.seedScore);     // поколение 0 — затравки + мутанты
  EXPECT_LT(res.bestScore, 66.0 * 0.5);                   // заметное улучшение
  EXPECT_DOUBLE_EQ(inversions(res.bestKey), res.bestScore);
  for (size_t g = 1; g < res.history.size(); ++g)         // элитизм: лучшее не ухудшается
    EXPECT_LE(res.history[g].best, res.history[g - 1].best);
  EXPECT_GT(res.evaluations, cfg.popSize);
}

TEST(GaImprover, SameSeedGivesSameResultForAnyThreadCount) {
  maos::GaConfig cfg;
  cfg.popSize = 16; cfg.generations = 20; cfg.seed = 11;
  const auto seed = reversed(10);
  cfg.threads = 1;
  const auto a = maos::run_key_ga({ seed }, inversions, cfg);
  cfg.threads = 4;
  const auto b = maos::run_key_ga({ seed }, inversions, cfg);
  EXPECT_EQ(a.bestKey, b.bestKey);
  EXPECT_DOUBLE_EQ(a.bestScore, b.bestScore);
  EXPECT_EQ(a.history.size(), b.history.size());
}

TEST(GaImprover, BestSeedIsKeptWhenNothingBeatsIt) {
  maos::GaConfig cfg;
  cfg.popSize = 8; cfg.generations = 5; cfg.seed = 3; cfg.threads = 2;
  std::vector<double> sorted(8);
  std::iota(sorted.begin(), sorted.end(), 0.0);           // уже оптимум: 0 инверсий
  const auto res = maos::run_key_ga({ reversed(8), sorted }, inversions, cfg);
  EXPECT_DOUBLE_EQ(res.bestScore, 0.0);
  EXPECT_DOUBLE_EQ(inversions(res.bestKey), 0.0);
}

TEST(GaImprover, StopsEarlyOnStagnation) {
  maos::GaConfig cfg;
  cfg.popSize = 8; cfg.generations = 100; cfg.stallGens = 3; cfg.seed = 5; cfg.threads = 1;
  const auto flat = [](const std::vector<double>&) { return 1.0; };  // нечего улучшать
  const auto res = maos::run_key_ga({ reversed(6) }, flat, cfg);
  EXPECT_TRUE(res.stoppedByStall);
  EXPECT_EQ(res.history.size(), 1u + 3u);                 // старт + 3 поколения без улучшения
}

TEST(GaImprover, SwapTouchesOnlyGenesFromSwapBegin) {
  maos::GaConfig cfg;
  cfg.popSize = 12; cfg.generations = 15; cfg.seed = 9; cfg.threads = 1;
  cfg.mutationRate = 0.0; cfg.swapRate = 1.0; cfg.swapBegin = 2;   // только обмены в хвосте
  const std::vector<double> seed = { 100, 200, 3, 2, 1 };
  // F штрафует любое изменение двух «весов» в голове и поощряет сортировку хвоста.
  const auto fit = [](const std::vector<double>& k) {
    const double head = std::abs(k[0] - 100) + std::abs(k[1] - 200);
    return head * 1000 + inversions({ k.begin() + 2, k.end() });
  };
  const auto res = maos::run_key_ga({ seed }, fit, cfg);
  EXPECT_DOUBLE_EQ(res.bestKey[0], 100.0);
  EXPECT_DOUBLE_EQ(res.bestKey[1], 200.0);
  EXPECT_DOUBLE_EQ(res.bestScore, 0.0);                   // хвост 3,2,1 → 1,2,3 обменами
}
