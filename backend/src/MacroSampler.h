#pragma once
/**
 * Сэмплер обученного макро-генератора по сохранённым параметрам (METHODOLOGY-V2 §2.2, §2.3, §2.6а, §2.6б).
 *
 * Чистый модуль без БД: читает `macro_params.json`, который пишет `rl/macro/fit.py` (порт RJMF
 * Methodology §6/§6.1 — Бураков 2026; RJMF 2026), и воспроизводит пути `rl/macro/sample.py`
 * ПОБИТОВО при одном seed: та же арифметика в том же порядке (файл собирается с -ffp-contract=off),
 * тот же генератор случайных чисел — numpy PCG64 (XSL-RR) + SeedSequence([seed, 871]),
 * 3841 равномерных на id (RJMF §6.1): путь id не зависит от n и размера пакета.
 *
 * Состояние месяца z_m = [100 ln(1+π/100), i − π − 2, 100 ln S − тренд] (стандартизовано):
 *   z_m = z_{m−1} A + ε_m,  ε_m — эмпирический блок остатков по фильтрованному режиму HMM.
 * Точное лог-центрирование: e_m = z_m − E[z_m] (E — аналитически, не по выборке), затем
 *   π_m = (100 + π_ref,m) exp(e_π/100) − 100;  i_m = i_ref,m + e_i + (π_m − π_ref,m);
 *   S_m = S_0 P_m /(1+π_USD)^{m/12} exp(e_S/100) — ППС-опора [НОРМ].
 * Месяц → неделя (§2.3): инфляция — линейно; ставка — ступень (действует до заседания);
 * курс — линейно + броуновский мост σ_bb [О] (поток [seed, 872]).
 */
#include <nlohmann/json.hpp>
#include <array>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace maos::macro {

using nlohmann::json;
using Vec3 = std::array<double, 3>;

constexpr int kUniformsPerId = 3841;   // 1920 режим + 1920 блок + 1 (RJMF)
constexpr int kMaxMonths     = 1920;
constexpr int kMaxWeeks      = 520;
constexpr int kMacroStream   = 871;
constexpr int kBridgeStream  = 872;

/** numpy-совместимый PCG64 (XSL-RR, 128-битный LCG) с посевом через SeedSequence(entropy). */
class NumpyPcg64 {
public:
  explicit NumpyPcg64(const std::vector<uint32_t>& entropyWords);
  void     advance(unsigned __int128 delta);
  uint64_t next_u64();
  double   next_double();                       // (u64 >> 11) · 2⁻⁵³, как numpy random()
  static std::vector<uint32_t> entropy(uint64_t seed, uint32_t stream);   // SeedSequence([seed, stream])
private:
  unsigned __int128 state_ = 0, inc_ = 0;
  void step();
};

/** Меню §2.6б: базовый / режим навязан / квантильный стресс / исторический эпизод. */
struct Stress {
  std::string mode = "base";          // base | regime | quantile | episode
  int         regime = -1;
  double      quantile = 0.95;
  std::string episode;                // "YYYY-MM"
  int         episodeMonths = 12;
  static Stress from_json(const json& j);
  json to_json() const;
};

/** Базовая траектория [НОРМ]: инфляция flat|nodes|пользовательская; ставка flat|пользовательская. */
struct Reference {
  std::string cpi = "flat";
  std::vector<double> cpiUser;
  std::string key = "flat";
  std::vector<double> keyUser;
  static Reference from_json(const json& j);
};

struct MonthlyPaths {
  int n = 0, H = 0;
  std::vector<std::vector<Vec3>> z;           // [n][H] исходные единицы признаков
  std::vector<std::vector<int>>  regime;      // −1 эпизод, −2 квантильный стресс
  std::vector<std::vector<int>>  blockId;
  std::vector<std::vector<Vec3>> innov;       // стандартизованные инновации ε_m (для общего фактора F)
};

struct Levels {                                // [n][T]
  std::vector<std::vector<double>> cpi, key, fx;
};

struct SampleResult {
  int months = 0, weeks = 0;
  MonthlyPaths paths;
  std::vector<Vec3>   expectedZ;
  std::vector<double> cpiRef, keyRef;
  Levels monthly, weekly;
  double sigmaBbFx = 0;
  std::array<int64_t, 2> macroStream{}, bridgeStream{};
};

class MacroSampler {
public:
  /** Загрузка из файла; понятная ошибка, если файла нет или схема не та. */
  static MacroSampler load(const std::string& path);
  static MacroSampler from_json(json params);
  /** Поиск параметров: $MAOS_MACRO_PARAMS → rl/macro/params/macro_params.json → backend/data/macro_params.json. */
  static std::string default_path();

  int regimes() const { return k_; }
  int block() const { return block_; }
  int nResid() const { return N_; }
  const json& params() const { return p_; }
  void set_nodes_path(std::string path) { nodesPath_ = std::move(path); }
  static int months_for_weeks(int weeks);

  std::vector<Vec3> expected_path(int H) const;
  MonthlyPaths sample_months(int n, int H, uint64_t seed, int startIndex = 0, const Stress& st = {}) const;
  std::pair<std::vector<double>, std::vector<double>> reference(int H, const Reference& ref) const;
  Levels to_levels(const MonthlyPaths& m, const std::vector<Vec3>& Ez,
                   const std::vector<double>& cpiRef, const std::vector<double>& keyRef) const;
  Levels to_weeks(const Levels& monthly, int W, uint64_t seed, int startIndex, bool bridge) const;
  SampleResult sample(int n, uint64_t seed, int horizonWeeks, int horizonMonths = 0, int startIndex = 0,
                      const Stress& st = {}, const Reference& ref = {}, bool bridge = true) const;
  /** Общий макро-фактор сценария F_i (§2.4): первая SVD-компонента инноваций, усреднённая по
   *  горизонту и стандартизованная (σ по истории): заменяет i.i.d. фактор M v0.63. */
  std::vector<double> common_factor(const MonthlyPaths& m) const;

  /** Паспорт режимов (GET /api/macro/regimes) и сводка обучения/валидации. */
  json regimes_json() const;
  json summary_json() const;

private:
  json p_;
  int k_ = 1, block_ = 1, N_ = 0, rank_ = 1;
  std::array<Vec3, 3> A_{};
  Vec3 mean_{}, sd_{}, last_{};
  std::vector<Vec3> resid_;
  Vec3 v1_{};                                       // первый правый сингулярный вектор остатков
  double s1_ = 1;                                   // первое сингулярное число
  std::vector<std::vector<double>> P_, Pb_;
  std::vector<double> pLast_;
  std::vector<int> labels_;
  std::vector<std::vector<int>> pools_;
  std::vector<std::string> months_;
  double sigmaBbFx_ = 0, usdInflation_ = 0.02;
  double cpi0_ = 0, key0_ = 0, fx0_ = 1;
  std::string lastMonth_;
  std::string nodesPath_;                           // reference_nodes.json рядом с параметрами
  std::vector<int> episode_pool(const std::string& month, int months) const;
  double t_quantile(int d, double q) const;
};

}  // namespace maos::macro
