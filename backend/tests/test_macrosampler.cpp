// MacroSampler (волна M): побитовое совпадение с rl/macro/sample.py на фикстуре
// (backend/tests/fixtures/macro_params_small.json + macro_expected.json, пишет
// `python -m rl.macro.make_fixture`), порт numpy PCG64/SeedSequence, точное центрирование
// (§2.6а тесты а–б), меню стрессов §2.6б, недельная сетка §2.3.
#include "MacroSampler.h"
#include <gtest/gtest.h>
#include <cmath>
#include <fstream>
#include <string>

#ifndef MAOS_TEST_FIXTURES
#define MAOS_TEST_FIXTURES "tests/fixtures"
#endif

namespace {

using maos::macro::MacroSampler;
using maos::macro::Stress;
using nlohmann::json;

json read_json(const std::string& name) {
  std::ifstream in(std::string(MAOS_TEST_FIXTURES) + "/" + name);
  if (!in) throw std::runtime_error("нет фикстуры " + name);
  json j; in >> j; return j;
}

struct Fixture {
  MacroSampler s;
  json exp;
  Fixture() : s(MacroSampler::from_json(read_json("macro_params_small.json"))), exp(read_json("macro_expected.json")) {
    s.set_nodes_path(std::string(MAOS_TEST_FIXTURES) + "/../../../rl/macro/params/reference_nodes.json");
  }
  uint64_t seed() const { return exp["seed"].get<uint64_t>(); }
};

void expect_bitwise(const std::vector<std::vector<maos::macro::Vec3>>& z, const json& ref) {
  ASSERT_EQ(z.size(), ref.size());
  for (size_t i = 0; i < z.size(); ++i)
    for (size_t t = 0; t < z[i].size(); ++t)
      for (int d = 0; d < 3; ++d)
        EXPECT_EQ(z[i][t][d], ref[i][t][d].get<double>()) << "i=" << i << " t=" << t << " d=" << d;
}

void expect_bitwise(const std::vector<std::vector<double>>& a, const json& ref) {
  ASSERT_EQ(a.size(), ref.size());
  for (size_t i = 0; i < a.size(); ++i)
    for (size_t t = 0; t < a[i].size(); ++t)
      EXPECT_EQ(a[i][t], ref[i][t].get<double>()) << "i=" << i << " t=" << t;
}

}  // namespace

TEST(MacroSampler, NumpyPcg64SeedSequenceStreamMatchesNumpy) {
  Fixture f;
  maos::macro::NumpyPcg64 rng(maos::macro::NumpyPcg64::entropy(f.seed(), maos::macro::kMacroStream));
  for (auto& u : f.exp["uniforms_first8_stream871"]) EXPECT_EQ(rng.next_double(), u.get<double>());
  maos::macro::NumpyPcg64 rb(maos::macro::NumpyPcg64::entropy(f.seed(), maos::macro::kBridgeStream));
  rb.advance((unsigned __int128)1 * 2 * maos::macro::kMaxWeeks);   // advance() как numpy bit_generator.advance
  for (auto& u : f.exp["bridge_uniforms_first4_id1"]) EXPECT_EQ(rb.next_double(), u.get<double>());
}

TEST(MacroSampler, PathsRegimesBlocksLevelsAndWeeksAreBitwiseEqualToPython) {
  Fixture f;
  const int n = f.exp["n"], W = f.exp["weeks"];
  const auto r = f.s.sample(n, f.seed(), W);
  EXPECT_EQ(r.months, f.exp["months"].get<int>());
  expect_bitwise(r.paths.z, f.exp["z"]);
  for (int i = 0; i < n; ++i)
    for (int t = 0; t < r.months; ++t) {
      EXPECT_EQ(r.paths.regime[i][t], f.exp["regime"][i][t].get<int>());
      EXPECT_EQ(r.paths.blockId[i][t], f.exp["block_id"][i][t].get<int>());
    }
  for (int t = 0; t < r.months; ++t)
    for (int d = 0; d < 3; ++d) EXPECT_EQ(r.expectedZ[t][d], f.exp["expected_z"][t][d].get<double>());
  expect_bitwise(r.monthly.cpi, f.exp["monthly"]["cpi"]);
  expect_bitwise(r.monthly.key, f.exp["monthly"]["key"]);
  expect_bitwise(r.monthly.fx,  f.exp["monthly"]["fx"]);
  expect_bitwise(r.weekly.cpi, f.exp["weekly"]["cpi"]);
  expect_bitwise(r.weekly.key, f.exp["weekly"]["key"]);
  expect_bitwise(r.weekly.fx,  f.exp["weekly"]["fx"]);
  EXPECT_EQ(r.sigmaBbFx, f.exp["weekly"]["sigma_bb_fx"].get<double>());
}

TEST(MacroSampler, PathIdIsIndependentOfBatchSizeAndStartIndex) {
  Fixture f;
  const int W = f.exp["weeks"];
  const auto full = f.s.sample(f.exp["n"], f.seed(), W);
  const auto part = f.s.sample(1, f.seed(), W, 0, 2);
  for (int t = 0; t < full.months; ++t)
    for (int d = 0; d < 3; ++d) EXPECT_EQ(part.paths.z[0][t][d], full.paths.z[2][t][d]);
  expect_bitwise(part.paths.z, f.exp["start_index_2"]["z"]);
  expect_bitwise(part.weekly.fx, f.exp["start_index_2"]["weekly_fx"]);
  for (int w = 0; w < W; ++w) EXPECT_EQ(part.weekly.fx[0][w], full.weekly.fx[2][w]);
}

TEST(MacroSampler, SameSeedSameResultDifferentSeedDiffers) {
  Fixture f;
  const auto a = f.s.sample(3, 11, 8), b = f.s.sample(3, 11, 8), c = f.s.sample(3, 12, 8);
  EXPECT_EQ(a.paths.z, b.paths.z); EXPECT_EQ(a.weekly.fx, b.weekly.fx);
  EXPECT_NE(a.paths.z, c.paths.z);
}

TEST(MacroSampler, MeanOfManyPathsConvergesToExactConditionalExpectation) {
  Fixture f;
  const int n = 6000, H = 5;
  const auto m = f.s.sample_months(n, H, 2026);
  const auto Ez = f.s.expected_path(H);
  for (int t = 0; t < H; ++t)
    for (int d = 0; d < 3; ++d) {
      double s = 0, ss = 0;
      for (int i = 0; i < n; ++i) { s += m.z[i][t][d]; ss += m.z[i][t][d] * m.z[i][t][d]; }
      const double mean = s / n, sd = std::sqrt(std::max(0.0, ss / n - mean * mean));
      EXPECT_LT(std::fabs(mean - Ez[t][d]), 4.5 * sd / std::sqrt((double)n) + 1e-9) << "t=" << t << " d=" << d;
    }
}

TEST(MacroSampler, StressMenuForcedRegimeQuantileEpisodeAndNodesReference) {
  Fixture f;
  const int H = f.exp["months"];
  Stress forced; forced.mode = "regime"; forced.regime = 1;
  const auto fr = f.s.sample(2, f.seed(), 0, H, 0, forced);
  expect_bitwise(fr.paths.z, f.exp["forced_regime_1"]["z"]);
  for (auto& row : fr.paths.regime) for (int v : row) EXPECT_EQ(v, 1);

  Stress q; q.mode = "quantile"; q.quantile = 0.95;
  const auto qr = f.s.sample(1, f.seed(), 0, H, 0, q);
  expect_bitwise(qr.paths.z, f.exp["quantile_095"]["z"]);
  expect_bitwise(qr.monthly.cpi, f.exp["quantile_095"]["cpi"]);
  Stress bad = q; bad.quantile = 0.123;
  EXPECT_THROW(f.s.sample(1, 1, 0, H, 0, bad), std::runtime_error);
  Stress badRegime = forced; badRegime.regime = 9;
  EXPECT_THROW(f.s.sample(1, 1, 0, H, 0, badRegime), std::runtime_error);

  Stress ep; ep.mode = "episode"; ep.episode = f.exp["episode"]["month"].get<std::string>(); ep.episodeMonths = 12;
  const auto er = f.s.sample(1, f.seed(), 0, H, 0, ep);
  expect_bitwise(er.paths.z, f.exp["episode"]["z"]);
  for (int t = 0; t < H; ++t) EXPECT_EQ(er.paths.blockId[0][t], f.exp["episode"]["block_id"][0][t].get<int>());

  maos::macro::Reference ref; ref.cpi = "nodes";
  const auto nr = f.s.sample(1, f.seed(), 0, H, 0, Stress{}, ref);
  for (int t = 0; t < H; ++t) EXPECT_EQ(nr.cpiRef[t], f.exp["ref_nodes"]["cpi_ref"][t].get<double>());
  expect_bitwise(nr.monthly.cpi, f.exp["ref_nodes"]["cpi"]);
  EXPECT_EQ(Stress::from_json(json{ {"quantile_t", 0.9} }).mode, "quantile");
  EXPECT_EQ(Stress::from_json(json{ {"regime", 0} }).to_json()["regime"].get<int>(), 0);
}

TEST(MacroSampler, WeeklyGridStepsKeyRateAndInterpolatesOthers) {
  Fixture f;
  const int W = 26;
  const auto r = f.s.sample(2, 3, W, 0, 0, Stress{}, maos::macro::Reference{}, false);
  EXPECT_EQ(r.months, MacroSampler::months_for_weeks(W));
  const json& lo = f.s.params()["last_obs"];
  for (int i = 0; i < 2; ++i) {
    EXPECT_EQ(r.weekly.key[i][0], lo["key_pp"].get<double>());        // недели 0–3: текущая ставка (ступень)
    EXPECT_EQ(r.weekly.key[i][4], r.monthly.key[i][0]);                // τ = 60/52 → месяц 1
    const double c0 = lo["cpi_yoy_pp"], c1 = r.monthly.cpi[i][0];
    EXPECT_GE(r.weekly.cpi[i][0], std::min(c0, c1) - 1e-9); EXPECT_LE(r.weekly.cpi[i][0], std::max(c0, c1) + 1e-9);
    const double s0 = lo["usd_rub"], s1 = r.monthly.fx[i][0];
    EXPECT_GE(r.weekly.fx[i][0], std::min(s0, s1) - 1e-9); EXPECT_LE(r.weekly.fx[i][0], std::max(s0, s1) + 1e-9);
  }
  const auto rb = f.s.sample(2, 3, W);                                 // с мостом: τ = 3 → мост = 0
  EXPECT_NE(rb.weekly.fx, r.weekly.fx);
  EXPECT_NEAR(rb.weekly.fx[0][12], r.weekly.fx[0][12], 1e-9);
  EXPECT_THROW(f.s.sample(1, 1, maos::macro::kMaxWeeks + 1), std::runtime_error);
}

TEST(MacroSampler, RegimesAndSummaryJsonAndLoadErrors) {
  Fixture f;
  const json rj = f.s.regimes_json();
  EXPECT_EQ(rj["k"].get<int>(), f.s.regimes());
  EXPECT_EQ(rj["regimes"].size(), (size_t)f.s.regimes());
  EXPECT_FALSE(rj["stress_quantiles"].empty());
  const json sj = f.s.summary_json();
  EXPECT_EQ(sj["block_months"].get<int>(), f.s.block());
  EXPECT_THROW(MacroSampler::load("/nonexistent/macro_params.json"), std::runtime_error);
  EXPECT_THROW(MacroSampler::from_json(json{ {"schema", "other"} }), std::runtime_error);
}

// Пресеты «Как 2022» и т. п.: эпизод повторяется ПО ПОРЯДКУ один раз (order=replay) — одинаковые шоки
// у всех путей, режим — метка HMM месяца; дальше — базовая выборка. Окно за концом истории — ошибка.
TEST(MacroSampler, EpisodeReplayRepeatsWindowInOrderOnceThenBaseDynamics) {
  Fixture f;
  const json& hist = f.s.params()["history"]["month"];
  const json& labels = f.s.params()["hmm"]["labels"];
  Stress ep = Stress::from_json(json{ {"episode", hist[10].get<std::string>()}, {"months", 4}, {"order", "replay"} });
  ASSERT_EQ(ep.episodeOrder, "replay");
  EXPECT_EQ(ep.to_json()["order"].get<std::string>(), "replay");
  EXPECT_EQ(Stress::from_json(json{ {"episode", "2020-11"}, {"months", 4} }).episodeOrder, "blocks");   // прежние сценарии — как были
  const int H = 9, n = 4;
  const auto r = f.s.sample_months(n, H, f.seed(), 0, ep);
  for (int t = 0; t < 4; ++t) {
    EXPECT_EQ(r.blockId[0][t], 9 + t);                                   // остаток r ↔ месяц r+1
    EXPECT_EQ(r.regime[0][t], labels[9 + t].get<int>());
    for (int i = 1; i < n; ++i) EXPECT_EQ(r.z[i][t], r.z[0][t]) << "t=" << t;   // шоки окна одинаковы у всех путей
  }
  bool differs = false;
  for (int i = 1; i < n; ++i) differs = differs || r.z[i][H - 1] != r.z[0][H - 1];
  EXPECT_TRUE(differs) << "после окна пути расходятся (базовая выборка)";
  for (int i = 0; i < n; ++i) for (int t = 0; t < H; ++t) EXPECT_GE(r.regime[i][t], 0);
  const auto again = f.s.sample_months(n, H, f.seed(), 0, ep);
  EXPECT_EQ(again.z, r.z);

  Stress late = ep; late.episode = hist[hist.size() - 3].get<std::string>(); late.episodeMonths = 6;
  EXPECT_THROW(f.s.sample_months(1, H, 1, 0, late), std::runtime_error);   // не «заворачивает» к началу истории
  Stress first = ep; first.episode = hist[0].get<std::string>();
  EXPECT_THROW(f.s.sample_months(1, H, 1, 0, first), std::runtime_error);
  Stress shortH = ep; shortH.episodeMonths = 30;
  EXPECT_NO_THROW(f.s.sample_months(1, 2, 1, 0, shortH));                // L = min(окно, горизонт)… окно в истории
  const json rj = f.s.regimes_json();
  EXPECT_EQ(rj["history"]["month"].size(), hist.size());
  EXPECT_EQ(rj["episode_first"].get<std::string>(), hist[1].get<std::string>());
}

// Ставка в путях не ниже исторического минимума (kKeyFloorPp = 4,25 %) — в базовом режиме, кризисном,
// на крайних путях и в эпизодах (вперемешку и по порядку); недельная сетка наследует порог.
TEST(MacroSampler, KeyRateNeverBelowFloorInAnyMode) {
  Fixture f;
  const json& hist = f.s.params()["history"]["month"];
  const int H = 13, W = 40;
  std::vector<Stress> modes(6);
  modes[1].mode = "regime"; modes[1].regime = 1;
  modes[2].mode = "quantile"; modes[2].quantile = 0.05;
  modes[3].mode = "quantile"; modes[3].quantile = 0.95;
  modes[4] = Stress::from_json(json{ {"episode", hist[16].get<std::string>()}, {"months", 6} });
  modes[5] = Stress::from_json(json{ {"episode", hist[16].get<std::string>()}, {"months", 6}, {"order", "replay"} });
  for (const auto& st : modes) {
    const auto r = f.s.sample(50, f.seed(), W, H, 0, st);
    for (const auto& path : r.monthly.key) for (double k : path) EXPECT_GE(k, maos::macro::kKeyFloorPp) << st.mode;
    for (const auto& path : r.weekly.key) for (double k : path) EXPECT_GE(k, maos::macro::kKeyFloorPp) << st.mode;
  }
  EXPECT_DOUBLE_EQ(f.s.summary_json()["floors"]["key_pp"].get<double>(), maos::macro::kKeyFloorPp);
  EXPECT_DOUBLE_EQ(f.s.regimes_json()["key_floor_pp"].get<double>(), maos::macro::kKeyFloorPp);
}

// «Что если» по курсу: ref.fx сдвигает уровень курса во всех путях и месяцах, остальное не трогает.
TEST(MacroSampler, ReferenceFxShiftScalesFxLevelsOnly) {
  Fixture f;
  const int H = 8;
  const auto base = f.s.sample(5, f.seed(), 0, H);
  const auto ref = maos::macro::Reference::from_json(json{ {"fx", 1.3} });
  EXPECT_DOUBLE_EQ(ref.fx, 1.3);
  const auto shifted = f.s.sample(5, f.seed(), 0, H, 0, Stress{}, ref);
  for (int i = 0; i < 5; ++i)
    for (int t = 0; t < H; ++t) {
      EXPECT_NEAR(shifted.monthly.fx[i][t], base.monthly.fx[i][t] * 1.3, 1e-9);
      EXPECT_EQ(shifted.monthly.key[i][t], base.monthly.key[i][t]);
      EXPECT_EQ(shifted.monthly.cpi[i][t], base.monthly.cpi[i][t]);
    }
  EXPECT_DOUBLE_EQ(maos::macro::Reference::from_json(json{ {"fx", 40.0} }).fx, maos::macro::kFxShiftMax);
  EXPECT_DOUBLE_EQ(maos::macro::Reference::from_json(json{ {"fx", "x"} }).fx, 1.0);
}
