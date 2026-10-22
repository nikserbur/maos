#include "MacroSampler.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <stdexcept>

// Арифметика ниже обязана совпадать с rl/macro/sample.py побитово: порядок операций
// фиксирован (см. комментарии «как в Python»), сборка файла — с -ffp-contract=off (CMakeLists).

namespace maos::macro {
namespace {

using Mat = std::vector<std::vector<double>>;

/* c[i][j] = a[i][0]·b[0][j] + a[i][1]·b[1][j] + … — последовательно слева направо (как sample.matmul). */
Mat matmul(const Mat& a, const Mat& b) {
  const size_t n = a.size(), k = b.size(), m = b[0].size();
  Mat out(n, std::vector<double>(m, 0.0));
  for (size_t i = 0; i < n; ++i)
    for (size_t j = 0; j < m; ++j) {
      double s = a[i][0] * b[0][j];
      for (size_t l = 1; l < k; ++l) s = s + a[i][l] * b[l][j];
      out[i][j] = s;
    }
  return out;
}

std::vector<double> vecmat(const std::vector<double>& v, const Mat& b) { return matmul(Mat{ v }, b)[0]; }

Vec3 vecmat3(const Vec3& v, const std::array<Vec3, 3>& A) {
  Vec3 out{};
  for (int j = 0; j < 3; ++j) {
    double s = v[0] * A[0][j];
    s = s + v[1] * A[1][j];
    s = s + v[2] * A[2][j];
    out[j] = s;
  }
  return out;
}

/* P^block, block ∈ {1,2,4,8}: повторное возведение в квадрат (как sample.mat_pow2). */
Mat mat_pow2(const Mat& P, int block) {
  int steps = block == 1 ? 0 : block == 2 ? 1 : block == 4 ? 2 : block == 8 ? 3 : -1;
  if (steps < 0) throw std::runtime_error("macro: block ∉ {1,2,4,8}");
  Mat r = P;
  for (int s = 0; s < steps; ++s) r = matmul(r, r);
  return r;
}

Vec3 to_vec3(const json& j) { return { j.at(0).get<double>(), j.at(1).get<double>(), j.at(2).get<double>() }; }

Mat to_mat(const json& j) {
  Mat m;
  for (auto& row : j) { std::vector<double> r; for (auto& v : row) r.push_back(v.get<double>()); m.push_back(r); }
  return m;
}

/* Box–Muller на двух равномерных (как sample.to_weeks): sqrt(−2 ln(1−u1))·cos(2π u2). */
double gauss(double u1, double u2) {
  return std::sqrt(-2.0 * std::log(1.0 - u1)) * std::cos(2.0 * M_PI * u2);
}

}  // namespace

/* ── numpy PCG64 + SeedSequence ──────────────────────────────────────────────────────
 * Порт numpy/random/_bit_generator.pyx (SeedSequence) и numpy/random/src/pcg64 (XSL-RR). */
namespace {
constexpr uint32_t INIT_A = 0x43b0d7e5u, MULT_A = 0x931e8875u, INIT_B = 0x8b51f9ddu, MULT_B = 0x58f38dedu;
constexpr uint32_t MIX_MULT_L = 0xca01f9ddu, MIX_MULT_R = 0x4973f715u, XSHIFT = 16;
constexpr int POOL = 4;

uint32_t hashmix(uint32_t value, uint32_t& hc) {
  value ^= hc; hc *= MULT_A; value *= hc; value ^= value >> XSHIFT; return value;
}
uint32_t mix(uint32_t x, uint32_t y) {
  uint32_t r = MIX_MULT_L * x - MIX_MULT_R * y; r ^= r >> XSHIFT; return r;
}
uint64_t rotr64(uint64_t v, unsigned rot) { return (v >> rot) | (v << ((-rot) & 63)); }
const unsigned __int128 kMult = ((unsigned __int128)2549297995355413924ULL << 64) | 4865540595714422341ULL;
}  // namespace

std::vector<uint32_t> NumpyPcg64::entropy(uint64_t seed, uint32_t stream) {
  std::vector<uint32_t> w;                         // _int_to_uint32_array: little-endian слова, ≥ 1 слово
  if (seed == 0) w.push_back(0);
  while (seed > 0) { w.push_back((uint32_t)(seed & 0xFFFFFFFFu)); seed >>= 32; }
  w.push_back(stream);
  return w;
}

NumpyPcg64::NumpyPcg64(const std::vector<uint32_t>& ent) {
  uint32_t pool[POOL], hc = INIT_A;
  for (int i = 0; i < POOL; ++i) pool[i] = hashmix(i < (int)ent.size() ? ent[i] : 0u, hc);
  for (int s = 0; s < POOL; ++s)
    for (int d = 0; d < POOL; ++d)
      if (s != d) pool[d] = mix(pool[d], hashmix(pool[s], hc));
  for (size_t s = POOL; s < ent.size(); ++s)
    for (int d = 0; d < POOL; ++d) pool[d] = mix(pool[d], hashmix(ent[s], hc));
  uint32_t st[8]; uint32_t hb = INIT_B;             // generate_state(4, uint64) → 8 слов uint32
  for (int i = 0; i < 8; ++i) {
    uint32_t v = pool[i % POOL];
    v ^= hb; hb *= MULT_B; v *= hb; v ^= v >> XSHIFT; st[i] = v;
  }
  auto u64 = [&](int i) { return (uint64_t)st[2 * i] | ((uint64_t)st[2 * i + 1] << 32); };   // view(uint64), LE
  const unsigned __int128 initstate = ((unsigned __int128)u64(0) << 64) | u64(1);
  const unsigned __int128 initseq   = ((unsigned __int128)u64(2) << 64) | u64(3);
  state_ = 0; inc_ = (initseq << 1) | 1u;
  step(); state_ += initstate; step();
}

void NumpyPcg64::step() { state_ = state_ * kMult + inc_; }

uint64_t NumpyPcg64::next_u64() {
  step();
  return rotr64((uint64_t)(state_ >> 64) ^ (uint64_t)state_, (unsigned)(state_ >> 122));
}

double NumpyPcg64::next_double() { return (double)(next_u64() >> 11) * (1.0 / 9007199254740992.0); }

void NumpyPcg64::advance(unsigned __int128 delta) {
  unsigned __int128 accMult = 1, accPlus = 0, curMult = kMult, curPlus = inc_;
  while (delta > 0) {
    if (delta & 1) { accMult *= curMult; accPlus = accPlus * curMult + curPlus; }
    curPlus = (curMult + 1) * curPlus; curMult *= curMult; delta >>= 1;
  }
  state_ = accMult * state_ + accPlus;
}

/* ── Stress / Reference ────────────────────────────────────────────────────────── */
Stress Stress::from_json(const json& j) {
  Stress s;
  if (!j.is_object()) return s;
  if (j.contains("regime") && !j["regime"].is_null()) { s.mode = "regime"; s.regime = j["regime"].get<int>(); }
  else if (j.contains("quantile_t") && !j["quantile_t"].is_null()) { s.mode = "quantile"; s.quantile = j["quantile_t"].get<double>(); }
  else if (j.contains("episode") && j["episode"].is_string()) {
    s.mode = "episode"; s.episode = j["episode"].get<std::string>();
    if (j.contains("months") && j["months"].is_number()) s.episodeMonths = j["months"].get<int>();
  }
  return s;
}

json Stress::to_json() const {
  if (mode == "regime")   return { {"regime", regime} };
  if (mode == "quantile") return { {"quantile_t", quantile} };
  if (mode == "episode")  return { {"episode", episode}, {"months", episodeMonths} };
  return nullptr;
}

Reference Reference::from_json(const json& j) {
  Reference r;
  if (!j.is_object()) return r;
  if (j.contains("cpi")) {
    if (j["cpi"].is_array()) { r.cpi = "user"; for (auto& v : j["cpi"]) r.cpiUser.push_back(v.get<double>()); }
    else if (j["cpi"].is_string()) r.cpi = j["cpi"].get<std::string>();
  }
  if (j.contains("key")) {
    if (j["key"].is_array()) { r.key = "user"; for (auto& v : j["key"]) r.keyUser.push_back(v.get<double>()); }
    else if (j["key"].is_string()) r.key = j["key"].get<std::string>();
  }
  return r;
}

/* ── Загрузка ─────────────────────────────────────────────────────────────────── */
std::string MacroSampler::default_path() {
  if (const char* env = std::getenv("MAOS_MACRO_PARAMS"); env && *env) return env;
  namespace fs = std::filesystem;
  for (const char* rel : { "rl/macro/params/macro_params.json", "../rl/macro/params/macro_params.json",
                           "../../rl/macro/params/macro_params.json", "backend/data/macro_params.json",
                           "../data/macro_params.json", "data/macro_params.json" })
    if (fs::exists(rel)) return fs::absolute(rel).string();
  return "rl/macro/params/macro_params.json";
}

MacroSampler MacroSampler::load(const std::string& path) {
  std::ifstream in(path);
  if (!in) throw std::runtime_error("macro: нет файла параметров генератора «" + path +
                                    "» — выполните rl/.venv/bin/python -m rl.macro.fit (или задайте MAOS_MACRO_PARAMS)");
  json p;
  try { in >> p; } catch (const std::exception& e) { throw std::runtime_error("macro: " + path + ": " + e.what()); }
  MacroSampler s = from_json(std::move(p));
  s.nodesPath_ = (std::filesystem::path(path).parent_path() / "reference_nodes.json").string();
  return s;
}

MacroSampler MacroSampler::from_json(json p) {
  if (p.value("schema", std::string()) != "maos.macro_params/1")
    throw std::runtime_error("macro: неизвестная схема параметров (ожидается maos.macro_params/1)");
  MacroSampler s;
  s.k_ = p["hmm"]["k"].get<int>(); s.block_ = p["block"].get<int>(); s.rank_ = p.value("rank", 1);
  for (int i = 0; i < 3; ++i) s.A_[i] = to_vec3(p["A"][i]);
  s.mean_ = to_vec3(p["mean"]); s.sd_ = to_vec3(p["sd"]); s.last_ = to_vec3(p["last"]);
  for (auto& r : p["resid"]) s.resid_.push_back(to_vec3(r));
  s.N_ = (int)s.resid_.size();
  if (s.N_ < 2) throw std::runtime_error("macro: пустые остатки");
  s.v1_ = to_vec3(p["svd_vectors"][0]); s.s1_ = std::max(1e-12, p["svd_values"][0].get<double>());
  s.P_ = to_mat(p["hmm"]["P"]); s.Pb_ = mat_pow2(s.P_, s.block_);
  for (auto& v : p["hmm"]["filtered_last"]) s.pLast_.push_back(v.get<double>());
  for (auto& v : p["hmm"]["labels"]) s.labels_.push_back(v.get<int>());
  const int lim = std::max(1, s.N_ - s.block_ + 1);
  s.pools_.assign(s.k_, {});
  for (int j = 0; j < s.k_; ++j) {
    for (int i = 0; i < lim && i < (int)s.labels_.size(); ++i) if (s.labels_[i] == j) s.pools_[j].push_back(i);
    if (s.pools_[j].empty()) for (int i = 0; i < lim; ++i) s.pools_[j].push_back(i);
  }
  if (p.contains("history") && p["history"].contains("month"))
    for (auto& m : p["history"]["month"]) s.months_.push_back(m.get<std::string>());
  if (p.contains("sigma_bb") && p["sigma_bb"].contains("fx_pct_log")) s.sigmaBbFx_ = p["sigma_bb"]["fx_pct_log"].get<double>();
  s.usdInflation_ = p.value("usd_inflation", 0.02);
  const json& lo = p["last_obs"];
  s.cpi0_ = lo["cpi_yoy_pp"].get<double>(); s.key0_ = lo["key_pp"].get<double>(); s.fx0_ = lo["usd_rub"].get<double>();
  s.lastMonth_ = lo.value("month", std::string());
  s.p_ = std::move(p);
  return s;
}

int MacroSampler::months_for_weeks(int weeks) { return (int)std::floor((weeks * 12.0) / 52.0) + 2; }

/* ── §6.1 точное условное ожидание ───────────────────────────────────────────── */
std::vector<Vec3> MacroSampler::expected_path(int H) const {
  // ε̄_{j,k}: последовательная сумма / len (как sample.pool_means).
  std::vector<std::vector<Vec3>> pm(k_, std::vector<Vec3>(block_));
  for (int j = 0; j < k_; ++j)
    for (int k = 0; k < block_; ++k) {
      Vec3 s{ 0.0, 0.0, 0.0 };
      for (int idx : pools_[j]) { const Vec3& r = resid_[(idx + k) % N_]; s = { s[0] + r[0], s[1] + r[1], s[2] + r[2] }; }
      const double len = (double)pools_[j].size();
      pm[j][k] = { s[0] / len, s[1] / len, s[2] / len };
    }
  std::vector<double> prob = pLast_;
  Vec3 cur = last_;
  std::vector<Vec3> out;
  for (int t = 0; t < H; ++t) {
    if (t % block_ == 0) prob = vecmat(prob, t == 0 ? P_ : Pb_);
    const int k = t % block_;
    Vec3 drift{ 0.0, 0.0, 0.0 };
    for (int j = 0; j < k_; ++j) for (int d = 0; d < 3; ++d) drift[d] = drift[d] + prob[j] * pm[j][k][d];
    const Vec3 nxt = vecmat3(cur, A_);
    for (int d = 0; d < 3; ++d) cur[d] = nxt[d] + drift[d];
    out.push_back({ cur[0] * sd_[0] + mean_[0], cur[1] * sd_[1] + mean_[1], cur[2] * sd_[2] + mean_[2] });
  }
  return out;
}

std::vector<int> MacroSampler::episode_pool(const std::string& month, int months) const {
  int at = -1;
  for (size_t i = 0; i < months_.size(); ++i) if (months_[i] == month) { at = (int)i; break; }
  if (at < 0) throw std::runtime_error("macro: эпизод " + month + " вне истории");
  const int lo = std::max(0, at - 1), hi = std::min(N_, lo + months);
  std::vector<int> pool;
  for (int s = lo; s < std::max(lo + 1, hi - block_ + 1); ++s) pool.push_back(s);
  return pool;
}

double MacroSampler::t_quantile(int d, double q) const {
  char key[32]; std::snprintf(key, sizeof key, "%g", q);
  const json& tq = p_["student_t"][d]["quantiles"];
  if (!tq.contains(key)) throw std::runtime_error(std::string("macro: quantile_t ") + key + " недопустим (сетка: " + tq.dump() + ")");
  return tq[key].get<double>();
}

/* ── выборка месячных состояний ──────────────────────────────────────────────── */
MonthlyPaths MacroSampler::sample_months(int n, int H, uint64_t seed, int startIndex, const Stress& st) const {
  if (H > kMaxMonths) throw std::runtime_error("macro: горизонт > 1920 месяцев");
  if (n < 0 || H <= 0) throw std::runtime_error("macro: n/H некорректны");
  MonthlyPaths out; out.n = n; out.H = H;
  out.z.assign(n, std::vector<Vec3>(H)); out.regime.assign(n, std::vector<int>(H, 0)); out.blockId.assign(n, std::vector<int>(H, 0));
  out.innov.assign(n, std::vector<Vec3>(H));
  if (st.mode == "quantile") {                         // детерминированный q-квантильный путь (стресс, не прогноз)
    Vec3 eps{ t_quantile(0, st.quantile), t_quantile(1, st.quantile), t_quantile(2, st.quantile) };
    Vec3 cur = last_;
    std::vector<Vec3> path;
    for (int t = 0; t < H; ++t) {
      const Vec3 nxt = vecmat3(cur, A_);
      for (int d = 0; d < 3; ++d) cur[d] = nxt[d] + eps[d];
      path.push_back({ cur[0] * sd_[0] + mean_[0], cur[1] * sd_[1] + mean_[1], cur[2] * sd_[2] + mean_[2] });
    }
    for (int i = 0; i < n; ++i) for (int t = 0; t < H; ++t) { out.z[i][t] = path[t]; out.regime[i][t] = -2; out.blockId[i][t] = -1; out.innov[i][t] = eps; }
    return out;
  }
  const int forced = st.mode == "regime" ? st.regime : -1;
  if (forced >= k_) throw std::runtime_error("macro: режим " + std::to_string(forced) + " — всего режимов " + std::to_string(k_));
  const bool episode = st.mode == "episode";
  const std::vector<int> epool = episode ? episode_pool(st.episode, st.episodeMonths) : std::vector<int>{};
  NumpyPcg64 rng(NumpyPcg64::entropy(seed, kMacroStream));
  rng.advance((unsigned __int128)startIndex * kUniformsPerId);
  std::vector<double> u(kUniformsPerId);
  for (int i = 0; i < n; ++i) {
    for (double& x : u) x = rng.next_double();
    std::vector<double> prob = pLast_;
    Vec3 cur = last_;
    int state = 0, selected = 0;
    for (int t = 0; t < H; ++t) {
      if (t % block_ == 0) {
        if (forced >= 0) state = forced;
        else {
          const std::vector<double> prior = vecmat(prob, t == 0 ? P_ : Pb_);
          double cum = 0.0; int cnt = 0;
          for (int j = 0; j < k_; ++j) { cum = cum + prior[j]; if (u[t] > cum) ++cnt; }
          state = std::min(cnt, k_ - 1);
        }
        const std::vector<int>& pool = episode ? epool : pools_[state];
        selected = pool[std::min((int)(u[kMaxMonths + t] * (double)pool.size()), (int)pool.size() - 1)];
        for (int j = 0; j < k_; ++j) prob[j] = j == state ? 1.0 : 0.0;
      }
      const int idx = (selected + t % block_) % N_;
      const Vec3 nxt = vecmat3(cur, A_);
      const Vec3& r = resid_[idx];
      cur = { nxt[0] + r[0], nxt[1] + r[1], nxt[2] + r[2] };
      out.z[i][t] = { cur[0] * sd_[0] + mean_[0], cur[1] * sd_[1] + mean_[1], cur[2] * sd_[2] + mean_[2] };
      out.regime[i][t] = episode ? -1 : state;
      out.blockId[i][t] = idx;
      out.innov[i][t] = r;
    }
  }
  return out;
}

/* ── базовые траектории [НОРМ] ───────────────────────────────────────────────── */
std::pair<std::vector<double>, std::vector<double>> MacroSampler::reference(int H, const Reference& ref) const {
  std::vector<double> cpi(H, cpi0_), key(H, key0_);
  if (ref.cpi == "user" && !ref.cpiUser.empty())
    for (int t = 0; t < H; ++t) cpi[t] = ref.cpiUser[std::min((size_t)t, ref.cpiUser.size() - 1)];
  else if (ref.cpi == "nodes") {
    // Узлы ЦБ (конец квартала) → месячная опора интерполяцией в ln(1+π/100) (sample._interp_nodes).
    namespace fs = std::filesystem;
    const fs::path nodesPath = nodesPath_.empty() ? fs::path(default_path()).parent_path() / "reference_nodes.json"
                                                  : fs::path(nodesPath_);
    std::ifstream in(nodesPath);
    if (!in) throw std::runtime_error("macro: нет reference_nodes.json рядом с параметрами (" + nodesPath.string() + ")");
    json nodes; in >> nodes;
    const int y0 = std::stoi(lastMonth_.substr(0, 4)), m0 = std::stoi(lastMonth_.substr(5, 2));
    std::vector<double> xs{ 0.0 }, ys{ std::log1p(cpi0_ / 100.0) };
    for (auto& nd : nodes["cpi_quarterly_nodes"]) {
      const std::string mo = nd["month"].get<std::string>();
      const int k = (std::stoi(mo.substr(0, 4)) - y0) * 12 + (std::stoi(mo.substr(5, 2)) - m0);
      if (k > 0) { xs.push_back((double)k); ys.push_back(std::log1p(nd["midpoint_pp"].get<double>() / 100.0)); }
    }
    for (int t = 1; t <= H; ++t) {
      double v;
      if ((double)t >= xs.back()) v = ys.back();
      else {
        size_t j = 0; for (size_t i = 0; i < xs.size(); ++i) if (xs[i] <= (double)t) j = i;
        v = ys[j] + (ys[j + 1] - ys[j]) * ((double)t - xs[j]) / (xs[j + 1] - xs[j]);
      }
      cpi[t - 1] = 100.0 * std::expm1(v);
    }
  }
  if (ref.key == "user" && !ref.keyUser.empty())
    for (int t = 0; t < H; ++t) key[t] = ref.keyUser[std::min((size_t)t, ref.keyUser.size() - 1)];
  return { cpi, key };
}

/* ── перевод в уровни (RJMF §6.1, §6.3) ──────────────────────────────────────── */
Levels MacroSampler::to_levels(const MonthlyPaths& m, const std::vector<Vec3>& Ez,
                               const std::vector<double>& cpiRef, const std::vector<double>& keyRef) const {
  Levels L;
  L.cpi.assign(m.n, std::vector<double>(m.H)); L.key = L.cpi; L.fx = L.cpi;
  for (int i = 0; i < m.n; ++i) {
    std::vector<double> levels;                            // P_{−11..0}: нормировка начального уровня цен
    for (int j = 11; j >= 0; --j) levels.push_back(std::pow(1.0 + cpi0_ / 100.0, -j / 12.0));
    for (int t = 0; t < m.H; ++t) {
      const double ePi = m.z[i][t][0] - Ez[t][0], eI = m.z[i][t][1] - Ez[t][1], eS = m.z[i][t][2] - Ez[t][2];
      const double p = (100.0 + cpiRef[t]) * std::exp(ePi / 100.0) - 100.0;
      L.cpi[i][t] = p;
      L.key[i][t] = keyRef[t] + eI + (p - cpiRef[t]);
      const double P = levels[levels.size() - 12] * (1.0 + p / 100.0);
      levels.push_back(P);
      L.fx[i][t] = fx0_ * P / std::pow(1.0 + usdInflation_, (t + 1) / 12.0) * std::exp(eS / 100.0);
    }
  }
  return L;
}

/* ── месяц → неделя (§2.3) ───────────────────────────────────────────────────── */
Levels MacroSampler::to_weeks(const Levels& mo, int W, uint64_t seed, int startIndex, bool bridge) const {
  if (W > kMaxWeeks) throw std::runtime_error("macro: горизонт > 520 недель");
  const int n = (int)mo.cpi.size(), H = n ? (int)mo.cpi[0].size() : 0;
  if (H < months_for_weeks(W)) throw std::runtime_error("macro: недостаточно месяцев для недельной сетки");
  const double sbb = bridge ? sigmaBbFx_ : 0.0;
  NumpyPcg64 rng(NumpyPcg64::entropy(seed, kBridgeStream));
  rng.advance((unsigned __int128)startIndex * 2 * kMaxWeeks);
  std::vector<double> u(2 * kMaxWeeks);
  Levels L;
  L.cpi.assign(n, std::vector<double>(W)); L.key = L.cpi; L.fx = L.cpi;
  for (int i = 0; i < n; ++i) {
    for (double& x : u) x = rng.next_double();
    std::vector<double> pc{ cpi0_ }, pk{ key0_ }, ps{ 100.0 * std::log(fx0_) };
    for (int t = 0; t < H; ++t) { pc.push_back(mo.cpi[i][t]); pk.push_back(mo.key[i][t]); ps.push_back(100.0 * std::log(mo.fx[i][t])); }
    int mPrev = -1; double fPrev = 0.0, bval = 0.0;
    for (int w = 0; w < W; ++w) {
      const double tau = ((w + 1) * 12.0) / 52.0;
      const int m = (int)std::floor(tau);
      const double f = tau - m;
      if (m != mPrev) { mPrev = m; fPrev = 0.0; bval = 0.0; }
      L.cpi[i][w] = pc[m] + f * (pc[m + 1] - pc[m]);          // линейно, σ_bb = 0 (помечено)
      L.key[i][w] = pk[m];                                       // ступень: ставка действует до заседания
      const double eta = gauss(u[2 * w], u[2 * w + 1]);
      if (f > 0.0)
        bval = bval * (1.0 - f) / (1.0 - fPrev) + sbb * std::sqrt((f - fPrev) * (1.0 - f) / (1.0 - fPrev)) * eta;
      else bval = 0.0;
      fPrev = f;
      const double lf = ps[m] + f * (ps[m + 1] - ps[m]) + bval;
      L.fx[i][w] = std::exp(lf / 100.0);
    }
  }
  return L;
}

SampleResult MacroSampler::sample(int n, uint64_t seed, int horizonWeeks, int horizonMonths, int startIndex,
                                  const Stress& st, const Reference& ref, bool bridge) const {
  const int H = horizonMonths > 0 ? horizonMonths : months_for_weeks(horizonWeeks);
  SampleResult r;
  r.months = H; r.weeks = horizonWeeks;
  r.paths = sample_months(n, H, seed, startIndex, st);
  r.expectedZ = expected_path(H);
  std::tie(r.cpiRef, r.keyRef) = reference(H, ref);
  r.monthly = to_levels(r.paths, r.expectedZ, r.cpiRef, r.keyRef);
  if (horizonWeeks > 0) r.weekly = to_weeks(r.monthly, horizonWeeks, seed, startIndex, bridge);
  r.sigmaBbFx = bridge ? sigmaBbFx_ : 0.0;
  r.macroStream = { (int64_t)seed, kMacroStream }; r.bridgeStream = { (int64_t)seed, kBridgeStream };
  return r;
}

std::vector<double> MacroSampler::common_factor(const MonthlyPaths& m) const {
  // f_m = ε_m·v₁ (σ_f = s₁/√N по истории); F_i = Σ_m f_m / (√H·σ_f) — единичная дисперсия при i.i.d. месяцах.
  const double sigmaF = s1_ / std::sqrt((double)N_);
  std::vector<double> F(m.n, 0.0);
  for (int i = 0; i < m.n; ++i) {
    double s = 0;
    for (int t = 0; t < m.H; ++t) s += m.innov[i][t][0] * v1_[0] + m.innov[i][t][1] * v1_[1] + m.innov[i][t][2] * v1_[2];
    F[i] = s / (std::sqrt((double)std::max(1, m.H)) * sigmaF);
  }
  return F;
}

/* ── паспорт режимов и сводка ────────────────────────────────────────────────── */
json MacroSampler::regimes_json() const {
  json rs = p_.value("regime_stats", json::object());
  json out = { {"k", k_}, {"block_months", block_}, {"regimes", rs.value("regimes", json::array())},
               {"transition", rs.value("transition", json::array())}, {"crisis_index", rs.value("crisis_index", 0)},
               {"p_last", pLast_}, {"note", rs.value("note", std::string())},
               {"last_obs", p_.value("last_obs", json::object())},
               {"stress_quantiles", json::array()}, {"episodes_available", { months_.empty() ? std::string() : months_.front(),
                                                                             months_.empty() ? std::string() : months_.back() }} };
  if (p_.contains("student_t") && !p_["student_t"].empty())
    for (auto& [q, v] : p_["student_t"][0]["quantiles"].items()) out["stress_quantiles"].push_back(std::stod(q));
  return out;
}

json MacroSampler::summary_json() const {
  json val = p_.value("validation", json::object());
  json out = { {"schema", p_.value("schema", std::string())}, {"trained_at", p_.value("trained_at", std::string())},
               {"data", p_.value("data", json::object())}, {"features", p_.value("features", json::array())},
               {"regimes", k_}, {"block_months", block_}, {"rank", rank_}, {"n_resid", N_},
               {"ridge", p_.value("ridge", 0.0)}, {"spectral_radius", p_.value("spectral_radius", 0.0)},
               {"fx_trend", p_.value("fx_trend", json::array())}, {"sigma_bb", p_.value("sigma_bb", json::object())},
               {"selection", p_.value("selection", json::object())},
               {"holdout", val.value("holdout", json::object())},
               {"tail_diagnostics", p_.value("tail_diagnostics", json::array())},
               {"last_obs", p_.value("last_obs", json::object())}, {"usd_inflation", usdInflation_},
               {"status", "О: обучено на cbr.ru с валидацией по CRPS; опора [НОРМ]; стрессы — не прогноз"} };
  return out;
}

}  // namespace maos::macro
