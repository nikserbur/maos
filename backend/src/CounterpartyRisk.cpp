#include "CounterpartyRisk.h"
#include "MacroSampler.h"
#include <algorithm>
#include <climits>
#include <cmath>
#include <map>
#include <mutex>
#include <tuple>

namespace maos::cpr {
namespace {

constexpr double kTwo53 = 9007199254740992.0;

/* Слова энтропии numpy SeedSequence для списка целых: каждое — little-endian uint32, 0 → [0]. */
void push_words(std::vector<uint32_t>& w, uint64_t v) {
  if (v == 0) { w.push_back(0); return; }
  while (v > 0) { w.push_back((uint32_t)(v & 0xFFFFFFFFu)); v >>= 32; }
}

/* Поток SeedSequence([seed, 915, id, kind, entity]) — координатная привязка розыгрыша. */
macro::NumpyPcg64 stream(uint64_t seed, uint64_t id, uint32_t kind, uint32_t entity) {
  std::vector<uint32_t> w;
  for (uint64_t v : { seed, (uint64_t)kCpStream, id, (uint64_t)kind, (uint64_t)entity }) push_words(w, v);
  return macro::NumpyPcg64(w);
}

/* Равномерное на (0,1): середина 53-битной ячейки (Φ⁻¹ конечна). */
double uniform_open(macro::NumpyPcg64& r) { return ((double)(r.next_u64() >> 11) + 0.5) / kTwo53; }

double jnum(const json& j, const char* k, double def) { return j.contains(k) && j[k].is_number() ? j[k].get<double>() : def; }
/* Целое: вне ±1e6 (и не число с плавающей точкой — NaN) → INT_MIN, чтобы validate() отверг значение, а не обернул его. */
int    jint(const json& j, const char* k, int def) {
  if (!j.contains(k) || !j[k].is_number()) return def;
  const double v = j[k].get<double>();
  return std::fabs(v) <= 1e6 ? (int)std::lround(v) : INT_MIN;
}
bool   jbool(const json& j, const char* k, bool def) {
  if (!j.contains(k)) return def;
  if (j[k].is_boolean()) return j[k].get<bool>();
  if (j[k].is_number()) return j[k].get<double>() != 0;
  return def;
}
std::vector<double> jvec(const json& j, const char* k, std::vector<double> def) {
  if (!j.contains(k) || !j[k].is_array()) return def;
  std::vector<double> v;
  for (auto& e : j[k]) if (e.is_number()) v.push_back(e.get<double>());
  return v;
}
std::map<std::string, std::string> jmap(const json& j, const char* k, std::map<std::string, std::string> def) {
  if (!j.contains(k) || !j[k].is_object()) return def;
  std::map<std::string, std::string> m;
  for (auto& [key, v] : j[k].items()) if (v.is_string()) m[key] = v.get<std::string>();
  return m;
}

/* Узлы и веса Гаусса–Эрмита (∫e^{−x²}f) — Numerical Recipes gauher (Golub–Welsch не нужен для n = 64). */
void gauss_hermite(int n, std::vector<double>& x, std::vector<double>& w) {
  const double kPim4 = 0.7511255444649425;   // π^{−1/4}
  x.assign(n, 0.0); w.assign(n, 0.0);
  double z = 0, pp = 1;
  for (int i = 0; i < (n + 1) / 2; ++i) {
    if (i == 0) z = std::sqrt(2.0 * n + 1) - 1.85575 * std::pow(2.0 * n + 1, -0.16667);
    else if (i == 1) z -= 1.14 * std::pow((double)n, 0.426) / z;
    else if (i == 2) z = 1.86 * z - 0.86 * x[0];
    else if (i == 3) z = 1.91 * z - 0.91 * x[1];
    else z = 2.0 * z - x[i - 2];
    for (int it = 0; it < 200; ++it) {
      double p1 = kPim4, p2 = 0;
      for (int j = 0; j < n; ++j) { const double p3 = p2; p2 = p1; p1 = z * std::sqrt(2.0 / (j + 1)) * p2 - std::sqrt((double)j / (j + 1)) * p3; }
      pp = std::sqrt(2.0 * n) * p2;
      const double z1 = z; z = z1 - p1 / pp;
      if (std::fabs(z - z1) <= 1e-15 * std::max(1.0, std::fabs(z))) break;
    }
    x[i] = z; x[n - 1 - i] = -z;
    w[i] = 2.0 / (pp * pp); w[n - 1 - i] = w[i];
  }
}

/* Множитель режима недели t (−1 → 1). */
double mult_at(const std::vector<double>& m, int g) { return g >= 0 && g < (int)m.size() ? m[g] : 1.0; }

/* Масштаб Ломакса по режимам σ_g = σ·m_g(κ_σ) — нормирован как интенсивности: Σ_g π_g σ_g = σ. */
std::vector<double> regime_scales(double sigma, const std::vector<double>& pi, int crisis, double kappa) {
  std::vector<double> sg = regime_multipliers(pi, crisis, kappa);
  for (double& v : sg) v *= sigma;
  return sg;
}
double scale_at(const std::vector<double>& sg, int g, double sigma) { return g >= 0 && g < (int)sg.size() ? sg[g] : sigma; }

/* Недельные интенсивности h_t = h̄·m_{g(t)} по годовой PD. */
std::vector<double> hazards(double pdAnnual, const std::vector<int>& g, const std::vector<double>& m) {
  const double hb = pdAnnual > 0 ? -std::log1p(-std::min(0.999999, pdAnnual)) / 52.0 : 0.0;
  std::vector<double> h(g.size());
  for (size_t t = 0; t < g.size(); ++t) h[t] = hb * mult_at(m, g[t]);
  return h;
}

/* Неделя дефолта контрагента: X = √ρ Z + √(1−ρ) ε, E = −ln Φ(−X) (= −ln(1−Φ(X)), устойчиво). */
int default_week(double z, double rho, double eps, const std::vector<double>& h) {
  const double x = std::sqrt(rho) * z + std::sqrt(1.0 - rho) * eps;
  return hazard_week(-std::log(norm_cdf(-x)), h);
}

/* Порог события недели: q_g = min(1, q·m_g); латентная y < Φ⁻¹(q_g) (q_g ≥ 1 → всегда). */
bool below(double y, double qg) { return qg >= 1.0 || y < norm_ppf(qg); }

/* Просрочки когорт покупателя: пара (u_cohort, u_Δ) на неделю; латентная y = √ρ_L Z + √(1−ρ_L)(√λ_b ε_c +
   √(1−λ_b) ξ_τ) — общий фактор покупателя ε_c тот же, что в его дефолте (просрочки повышают условную PD).
   Δ > D_def → D_def + 1 (дефолт когорты, 90+ DPD); иначе min(Δ, Δmax) — излечение. */
std::vector<int> late_delays(macro::NumpyPcg64 r, double z, double eps, const CpParams& p, double rho,
                             const std::vector<double>& mq, const std::vector<double>& sg, const std::vector<int>& g) {
  std::vector<int> d(g.size(), 0);
  if (!(p.lateShare > 0)) return d;                        // событий нет при любых числах — поток не нужен
  const double lb = std::clamp(p.lateBuyerLoad, 0.0, 1.0);
  const double a = std::sqrt(rho), b = std::sqrt(1.0 - rho), wb = std::sqrt(lb), wi = std::sqrt(1.0 - lb);
  for (size_t t = 0; t < g.size(); ++t) {
    const double u1 = uniform_open(r), u2 = uniform_open(r);
    const double qg = std::min(1.0, p.lateShare * mult_at(mq, g[t]));
    if (qg <= 0 || !below(a * z + b * (wb * eps + wi * norm_ppf(u1)), qg)) continue;
    const int D = lomax_weeks(u2, p.lateAlpha, scale_at(sg, g[t], p.lateScale), p.defaultDpd + 1);
    d[t] = D > p.defaultDpd ? p.defaultDpd + 1 : std::min(D, p.lateMax);
  }
  return d;
}

/* Перебои поставщика: пара (u_start, u_D) на неделю t; начало при √ρ_s Z + √(1−ρ_s) ξ_t < Φ⁻¹(q^s_g), длительность
   D ~ Ломакс(α_s, σ_g) ≤ Dmax; плановые приходы a ∈ [t, t+D) ждут конца перебоя: disrupt[a] = max(·, t + D − a). */
std::vector<int> outage_delays(macro::NumpyPcg64 r, double z, const CpParams& p, double rho,
                               const std::vector<double>& mq, const std::vector<double>& sg, const std::vector<int>& g) {
  const int T = (int)g.size();
  std::vector<int> d(T, 0);
  if (!(p.disruptShare > 0)) return d;
  const double a = std::sqrt(rho), b = std::sqrt(1.0 - rho);
  for (int t = 0; t < T; ++t) {
    const double u1 = uniform_open(r), u2 = uniform_open(r);
    const double qg = std::min(1.0, p.disruptShare * mult_at(mq, g[t]));
    if (qg <= 0 || !below(a * z + b * norm_ppf(u1), qg)) continue;
    const int D = lomax_weeks(u2, p.disruptAlpha, scale_at(sg, g[t], p.disruptScale), std::max(1, p.disruptMax));
    for (int w = t; w < std::min(T, t + D); ++w) d[w] = std::max(d[w], t + D - w);
  }
  return d;
}

}  // namespace

/* ── Параметры ──────────────────────────────────────────────────────────────────────────────────────── */
CpParams CpParams::from_json(const json& j, CpParams b) {
  if (!j.is_object()) return b;
  b.enabled = jbool(j, "enabled", b.enabled);
  b.regimeStationary = jvec(j, "regime_stationary", b.regimeStationary);
  b.crisisIndex = jint(j, "crisis_regime", b.crisisIndex);
  b.rho = jnum(j, "rho", b.rho); b.lambdaF = jnum(j, "lambda_f", b.lambdaF);
  b.kappaPd = jnum(j, "regime_mult_pd", b.kappaPd);
  b.nBuyers = jint(j, "buyers_n", b.nBuyers); b.zipfA = jnum(j, "buyers_zipf", b.zipfA);
  b.buyerShares = jvec(j, "buyer_shares", b.buyerShares);
  b.buyerPd = jnum(j, "buyer_pd_annual", b.buyerPd); b.buyerLgd = jnum(j, "buyer_lgd", b.buyerLgd);
  b.recoveryLag = jint(j, "recovery_lag_weeks", b.recoveryLag);
  b.securityShare = jnum(j, "buyer_security_share", b.securityShare);
  b.securityLag = jint(j, "buyer_security_lag_weeks", b.securityLag);
  b.stopLag = jint(j, "stop_lag_weeks", b.stopLag); b.replaceLag = jint(j, "replace_lag_weeks", b.replaceLag);
  b.replaceDiscount = jnum(j, "replace_discount", b.replaceDiscount);
  b.lateShare = jnum(j, "late_share", b.lateShare); b.kappaLate = jnum(j, "late_regime_mult", b.kappaLate);
  b.lateAlpha = jnum(j, "late_tail_alpha", b.lateAlpha); b.lateScale = jnum(j, "late_scale_weeks", b.lateScale);
  b.kappaLateScale = jnum(j, "late_crisis_scale_mult", b.kappaLateScale);
  b.defaultDpd = jint(j, "default_dpd_weeks", b.defaultDpd);
  b.lateMax = jint(j, "late_max_weeks", b.lateMax); b.lateRho = jnum(j, "late_rho", b.lateRho);
  b.lateBuyerLoad = jnum(j, "late_buyer_loading", b.lateBuyerLoad);
  b.supplierPd = jnum(j, "supplier_pd_annual", b.supplierPd); b.supplierLgd = jnum(j, "supplier_lgd", b.supplierLgd);
  b.replaceSupplierLag = jint(j, "supplier_replace_lag_weeks", b.replaceSupplierLag);
  b.replacePremium = jnum(j, "supplier_replace_premium", b.replacePremium);
  b.replacePrepay = jnum(j, "supplier_prepay_replacement", b.replacePrepay);
  b.disruptShare = jnum(j, "disrupt_share", b.disruptShare); b.kappaDisrupt = jnum(j, "disrupt_regime_mult", b.kappaDisrupt);
  b.disruptAlpha = jnum(j, "disrupt_tail_alpha", b.disruptAlpha); b.disruptScale = jnum(j, "disrupt_scale_weeks", b.disruptScale);
  b.kappaDisruptScale = jnum(j, "disrupt_crisis_scale_mult", b.kappaDisruptScale);
  b.disruptMax = jint(j, "disrupt_max_weeks", b.disruptMax); b.disruptRho = jnum(j, "disrupt_rho", b.disruptRho);
  b.supplierGroups = jmap(j, "supplier_groups", b.supplierGroups);
  b.thetaMin = jnum(j, "theta_min", b.thetaMin); b.prepayDiscount = jnum(j, "prepay_discount", b.prepayDiscount);
  b.vatRestore = jbool(j, "vat_restore", b.vatRestore); b.shipShift = jbool(j, "stage2_ship_shift", b.shipShift);
  b.lexicographic = jbool(j, "lexicographic", b.lexicographic); b.lexEps = jnum(j, "lp_lex_eps", b.lexEps);
  b.lpTimeLimit = jnum(j, "lp_time_limit_sec", b.lpTimeLimit);
  return b;
}

CpParams CpParams::from_json(const json& j) { return from_json(j, CpParams{}); }

json CpParams::to_json() const {
  return { {"enabled", enabled}, {"stream", kCpStream}, {"regime_stationary", regimeStationary}, {"crisis_regime", crisisIndex},
           {"rho", rho}, {"lambda_f", lambdaF}, {"regime_mult_pd", kappaPd}, {"buyers_n", nBuyers}, {"buyers_zipf", zipfA},
           {"buyer_shares", buyerShares}, {"buyer_pd_annual", buyerPd}, {"buyer_lgd", buyerLgd},
           {"recovery_lag_weeks", recoveryLag}, {"buyer_security_share", securityShare}, {"buyer_security_lag_weeks", securityLag},
           {"stop_lag_weeks", stopLag}, {"replace_lag_weeks", replaceLag}, {"replace_discount", replaceDiscount},
           {"late_share", lateShare}, {"late_regime_mult", kappaLate}, {"late_tail_alpha", lateAlpha},
           {"late_scale_weeks", lateScale}, {"late_crisis_scale_mult", kappaLateScale}, {"default_dpd_weeks", defaultDpd},
           {"late_max_weeks", lateMax}, {"late_rho", lateRho}, {"late_buyer_loading", lateBuyerLoad},
           {"supplier_pd_annual", supplierPd}, {"supplier_lgd", supplierLgd},
           {"supplier_replace_lag_weeks", replaceSupplierLag}, {"supplier_replace_premium", replacePremium},
           {"supplier_prepay_replacement", replacePrepay}, {"disrupt_share", disruptShare},
           {"disrupt_regime_mult", kappaDisrupt}, {"disrupt_tail_alpha", disruptAlpha}, {"disrupt_scale_weeks", disruptScale},
           {"disrupt_crisis_scale_mult", kappaDisruptScale}, {"disrupt_max_weeks", disruptMax}, {"disrupt_rho", disruptRho},
           {"supplier_groups", supplierGroups},
           {"theta_min", thetaMin}, {"prepay_discount", prepayDiscount}, {"tax_bad_debt", "immediate"},
           {"vat_restore", vatRestore}, {"stage2_ship_shift", shipShift}, {"lexicographic", lexicographic}, {"lp_lex_eps", lexEps},
           {"lp_time_limit_sec", lpTimeLimit} };
}

std::vector<std::string> CpParams::validate() const {
  std::vector<std::string> e;
  auto share = [&](const char* k, double v) { if (!(v >= 0 && v <= 1)) e.push_back(std::string(k) + ": доля вне [0,1]"); };
  auto pd = [&](const char* k, double v) { if (!(v >= 0 && v <= 0.999)) e.push_back(std::string(k) + ": PD вне [0, 0.999]"); };
  auto lag = [&](const char* k, int v) { if (v < 0 || v > 520) e.push_back(std::string(k) + ": лаг вне [0, 520] нед."); };
  auto pos = [&](const char* k, double v) { if (!(v > 0)) e.push_back(std::string(k) + ": должно быть > 0"); };
  auto rhoOk = [&](const char* k, double v) { if (!(v == -1 || (v >= 0 && v <= 0.99))) e.push_back(std::string(k) + ": ρ вне [0, 0.99] (−1 → по умолчанию)"); };
  pd("buyer_pd_annual", buyerPd); pd("supplier_pd_annual", supplierPd);
  rhoOk("rho", rho); rhoOk("late_rho", lateRho); rhoOk("disrupt_rho", disruptRho);
  if (!(lambdaF >= 0 && lambdaF <= 1)) e.push_back("lambda_f: вне [0,1]");
  for (const auto& [k, v] : { std::pair<const char*, int>{ "recovery_lag_weeks", recoveryLag }, { "buyer_security_lag_weeks", securityLag },
                              { "stop_lag_weeks", stopLag }, { "replace_lag_weeks", replaceLag },
                              { "supplier_replace_lag_weeks", replaceSupplierLag } }) lag(k, v);
  if (defaultDpd < 1 || defaultDpd > 520) e.push_back("default_dpd_weeks: вне [1, 520] нед.");
  if (lateMax < 1 || lateMax > defaultDpd) e.push_back("late_max_weeks: вне [1, default_dpd_weeks] (излеченная просрочка ≤ D_def)");
  if (disruptMax < 1 || disruptMax > 520) e.push_back("disrupt_max_weeks: вне [1, 520] нед.");
  for (const auto& [k, v] : { std::pair<const char*, double>{ "late_tail_alpha", lateAlpha }, { "disrupt_tail_alpha", disruptAlpha },
                              { "late_scale_weeks", lateScale }, { "disrupt_scale_weeks", disruptScale },
                              { "regime_mult_pd", kappaPd }, { "late_regime_mult", kappaLate }, { "disrupt_regime_mult", kappaDisrupt },
                              { "late_crisis_scale_mult", kappaLateScale }, { "disrupt_crisis_scale_mult", kappaDisruptScale } }) pos(k, v);
  for (const auto& [k, v] : { std::pair<const char*, double>{ "buyer_lgd", buyerLgd }, { "supplier_lgd", supplierLgd },
                              { "buyer_security_share", securityShare }, { "replace_discount", replaceDiscount },
                              { "late_share", lateShare }, { "disrupt_share", disruptShare }, { "supplier_replace_premium", replacePremium },
                              { "supplier_prepay_replacement", replacePrepay }, { "theta_min", thetaMin }, { "prepay_discount", prepayDiscount },
                              { "late_buyer_loading", lateBuyerLoad } })
    share(k, v);
  if (nBuyers < 1 || nBuyers > 1000) e.push_back("buyers_n: вне [1, 1000]");
  if (!(zipfA >= 0 && zipfA <= 5)) e.push_back("buyers_zipf: вне [0, 5]");
  if (buyerShares.size() > 1000) e.push_back("buyer_shares: > 1000 покупателей");
  if (!buyerShares.empty()) {
    double s = 0; for (double v : buyerShares) { s += v; if (!(v >= 0)) e.push_back("buyer_shares: отрицательная доля"); }
    if (std::fabs(s - 1.0) > 1e-6) e.push_back("buyer_shares: Σω ≠ 1");
  }
  double ps = 0; for (double v : regimeStationary) { ps += v; if (!(v >= 0)) e.push_back("regime_stationary: отрицательная вероятность"); }
  if (regimeStationary.empty() || std::fabs(ps - 1.0) > 1e-6) e.push_back("regime_stationary: Σπ ≠ 1");
  if (crisisIndex < 0 || crisisIndex >= (int)regimeStationary.size()) e.push_back("crisis_regime: вне [0, k)");
  for (const auto& [k, v] : supplierGroups) if (k.empty() || v.empty()) e.push_back("supplier_groups: пустой код позиции или поставщика");
  if (!(lexEps >= 0 && lexEps <= 1e-2)) e.push_back("lp_lex_eps: вне [0, 0.01]");
  if (!(lpTimeLimit >= 1 && lpTimeLimit <= 86400)) e.push_back("lp_time_limit_sec: вне [1, 86400] с");
  return e;
}

void CpParams::apply_generator(const json& mp) {
  if (!mp.is_object() || !mp.contains("regime_stats")) return;
  const json& rs = mp["regime_stats"];
  std::vector<double> pi;
  if (rs.contains("regimes") && rs["regimes"].is_array())
    for (auto& g : rs["regimes"]) if (g.contains("stationary_prob") && g["stationary_prob"].is_number()) pi.push_back(g["stationary_prob"].get<double>());
  double s = 0; for (double v : pi) s += v;
  if (!pi.empty() && s > 0) { for (double& v : pi) v /= s; regimeStationary = pi; }
  if (rs.contains("crisis_index") && rs["crisis_index"].is_number()) crisisIndex = rs["crisis_index"].get<int>();
}

double CpParams::buyer_rho(bool regimes) const {
  if (rho >= 0) return rho;
  return regimes ? within_regime_rho(buyerPd, regimeStationary, crisisIndex, kappaPd) : basel_rho(buyerPd);
}
double CpParams::supplier_rho(bool regimes) const {
  if (rho >= 0) return rho;
  return regimes ? within_regime_rho(supplierPd, regimeStationary, crisisIndex, kappaPd) : basel_rho(supplierPd);
}
double CpParams::late_rho(bool regimes) const { return lateRho >= 0 ? lateRho : buyer_rho(regimes); }
double CpParams::disrupt_rho(bool regimes) const { return disruptRho >= 0 ? disruptRho : supplier_rho(regimes); }

const std::string& CpParams::vendor_of(const std::string& id) const {
  const auto it = supplierGroups.find(id);
  return it == supplierGroups.end() ? id : it->second;
}
uint32_t CpParams::supplier_entity(const std::string& id) const { return entity_of(vendor_of(id)); }

std::vector<double> CpParams::buyer_weights() const {
  std::vector<double> w;
  if (!buyerShares.empty()) w = buyerShares;
  else for (int c = 1; c <= std::max(1, nBuyers); ++c) w.push_back(std::pow((double)c, -zipfA));
  double s = 0; for (double v : w) s += v;
  for (double& v : w) v = s > 0 ? v / s : 0.0;
  return w;
}

/* ── Математика ─────────────────────────────────────────────────────────────────────────────────────── */
double norm_cdf(double x) { return 0.5 * std::erfc(-x / std::sqrt(2.0)); }

double norm_ppf(double p) {
  if (!(p > 0)) return -INFINITY;
  if (!(p < 1)) return INFINITY;
  const double q = p - 0.5;
  if (std::fabs(q) <= 0.425) {
    const double r = 0.180625 - q * q;
    return q * (((((((2.5090809287301226727e3 * r + 3.3430575583588128105e4) * r + 6.7265770927008700853e4) * r
                  + 4.5921953931549871457e4) * r + 1.3731693765509461125e4) * r + 1.9715909503065514427e3) * r
                  + 1.3314166789178437745e2) * r + 3.3871328727963666080e0)
         / (((((((5.2264952788528545610e3 * r + 2.8729085735721942674e4) * r + 3.9307895800092710610e4) * r
                + 2.1213794301586595867e4) * r + 5.3941960214247511077e3) * r + 6.8718700749205790830e2) * r
                + 4.2313330701600911252e1) * r + 1.0);
  }
  double r = std::sqrt(-std::log(q < 0 ? p : 1.0 - p)), v;
  if (r <= 5.0) {
    r -= 1.6;
    v = (((((((7.74545014278341407640e-4 * r + 2.27238449892691845833e-2) * r + 2.41780725177450611770e-1) * r
           + 1.27045825245236838258e0) * r + 3.64784832476320460504e0) * r + 5.76949722146069140550e0) * r
           + 4.63033784615654529590e0) * r + 1.42343711074968357734e0)
      / (((((((1.05075007164441684324e-9 * r + 5.47593808499534494600e-4) * r + 1.51986665636164571966e-2) * r
             + 1.48103976427480074590e-1) * r + 6.89767334985100004550e-1) * r + 1.67638483018380384940e0) * r
             + 2.05319162663775882187e0) * r + 1.0);
  } else {
    r -= 5.0;
    v = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 1.24266094738807843860e-3) * r
           + 2.65321895265761230930e-2) * r + 2.96560571828504891230e-1) * r + 1.78482653991729133580e0) * r
           + 5.46378491116411436990e0) * r + 6.65790464350110377720e0)
      / (((((((2.04426310338993978564e-15 * r + 1.42151175831644588870e-7) * r + 1.84631831751005468180e-5) * r
             + 7.86869131145613259100e-4) * r + 1.48753612908506148525e-2) * r + 1.36929880922735805310e-1) * r
             + 5.99832206555887937690e-1) * r + 1.0);
  }
  return q < 0 ? -v : v;
}

double basel_rho(double pd) {
  const double w = (1.0 - std::exp(-50.0 * pd)) / (1.0 - std::exp(-50.0));
  return 0.12 * w + 0.24 * (1.0 - w);
}

std::vector<double> regime_multipliers(const std::vector<double>& pi, int crisis, double kappa) {
  double den = 0;
  for (size_t g = 0; g < pi.size(); ++g) den += pi[g] * ((int)g == crisis ? kappa : 1.0);
  std::vector<double> m(pi.size(), 1.0);
  if (!(den > 0)) return m;
  const double calm = 1.0 / den;
  for (size_t g = 0; g < pi.size(); ++g) m[g] = (int)g == crisis ? kappa * calm : calm;
  return m;
}

std::vector<std::string> clip_warnings(const CpParams& p, double* lateEff, double* disEff) {
  std::vector<std::string> w;
  auto eff = [&](double q, double kappa, const char* name, double* out) {
    const auto m = regime_multipliers(p.regimeStationary, p.crisisIndex, kappa);
    double mean = 0; bool clipped = false;
    for (size_t g = 0; g < m.size(); ++g) { const double v = q * m[g]; clipped |= v > 1.0; mean += p.regimeStationary[g] * std::min(1.0, v); }
    if (clipped) w.push_back(std::string(name) + ": q·m_g > 1 обрезано до 1; фактическое безусловное среднее " + std::to_string(mean));
    if (out) *out = mean;
  };
  eff(p.lateShare, p.kappaLate, "fin.cp.late_share", lateEff);
  eff(p.disruptShare, p.kappaDisrupt, "fin.cp.disrupt_share", disEff);
  return w;
}

int hazard_week(double E, const std::vector<double>& h) {
  double lam = 0;
  size_t t = 0;
  while (t < h.size()) {
    size_t b = t;
    while (b < h.size() && h[b] == h[t]) ++b;                 // участок постоянной интенсивности [t, b)
    const double hr = h[t], len = (double)(b - t);
    if (hr > 0 && lam + hr * len > E) {
      const double k = std::floor((E - lam) / hr);
      return (int)std::min<double>((double)(b - 1), (double)t + std::max(0.0, k));
    }
    lam += hr * len;
    t = b;
  }
  return -1;
}

int default_week_from_uniform(double U, const std::vector<double>& h) { return hazard_week(-std::log(1.0 - U), h); }

double lomax_delay(double u, double alpha, double sigma) { return sigma * (std::pow(1.0 - u, -1.0 / alpha) - 1.0); }

int lomax_weeks(double u, double alpha, double sigma, int maxW) {
  const double y = lomax_delay(u, alpha, sigma);
  if (!(y < (double)maxW)) return maxW;
  return std::min(maxW, std::max(1, (int)std::ceil(y)));
}

namespace {
/* ∫φ(z)·p(z)²dz однофакторной модели, p(z) = Φ((Φ⁻¹(PD) − √ρ z)/√(1−ρ)) — Гаусс–Эрмит, 64 узла. */
double joint_pd2(double pdT, double rho) {
  struct Gh { std::vector<double> x, w; };
  static const Gh gh = [] { Gh g; gauss_hermite(64, g.x, g.w); return g; }();   // потокобезопасная инициализация
  const double c = norm_ppf(pdT), sr = std::sqrt(rho), s1 = std::sqrt(1.0 - rho);
  double p2 = 0;
  for (size_t k = 0; k < gh.x.size(); ++k) {
    const double z = std::sqrt(2.0) * gh.x[k];
    const double pz = rho < 1 ? norm_cdf((c - sr * z) / s1) : (z < c ? 1.0 : 0.0);
    p2 += gh.w[k] * pz * pz;
  }
  return p2 / std::sqrt(M_PI);
}
}  // namespace

double implied_default_corr(double pdT, double rho) {
  if (!(pdT > 0 && pdT < 1)) return 0.0;
  return (joint_pd2(pdT, rho) - pdT * pdT) / (pdT * (1.0 - pdT));
}

double regime_mixture_corr(double pdAnnual, const std::vector<double>& pi, int crisis, double kappa, double rhoW) {
  const auto m = regime_multipliers(pi, crisis, kappa);
  double pbar = 0, p2 = 0;
  for (size_t g = 0; g < m.size(); ++g) {
    const double pdg = 1.0 - std::pow(1.0 - pdAnnual, m[g]);
    pbar += pi[g] * pdg;
    if (pdg > 0 && pdg < 1) p2 += pi[g] * joint_pd2(pdg, rhoW);
    else p2 += pi[g] * pdg;                                       // вырожденный режим: P(оба) = PD_g
  }
  return pbar > 0 && pbar < 1 ? (p2 - pbar * pbar) / (pbar * (1.0 - pbar)) : 0.0;
}

double within_regime_rho(double pdAnnual, const std::vector<double>& pi, int crisis, double kappa) {
  const double rb = basel_rho(pdAnnual);
  if (!(pdAnnual > 0 && pdAnnual < 1)) return rb;
  static std::mutex mu;                                           // кэш: решается один раз на набор параметров
  static std::map<std::vector<double>, double> cache;
  std::vector<double> key{ pdAnnual, (double)crisis, kappa };
  key.insert(key.end(), pi.begin(), pi.end());
  { std::lock_guard<std::mutex> lk(mu); if (auto it = cache.find(key); it != cache.end()) return it->second; }
  const double target = implied_default_corr(pdAnnual, rb);
  double lo = 0, hi = rb, res;
  if (regime_mixture_corr(pdAnnual, pi, crisis, kappa, lo) >= target) res = 0.0;        // режим уже даёт всю корреляцию
  else if (regime_mixture_corr(pdAnnual, pi, crisis, kappa, hi) <= target) res = rb;
  else {
    for (int it = 0; it < 60; ++it) {
      const double mid = 0.5 * (lo + hi);
      (regime_mixture_corr(pdAnnual, pi, crisis, kappa, mid) < target ? lo : hi) = mid;
    }
    res = 0.5 * (lo + hi);
  }
  std::lock_guard<std::mutex> lk(mu);
  cache[key] = res;
  return res;
}

uint32_t entity_of(const std::string& id) {
  uint32_t h = 2166136261u;
  for (unsigned char ch : id) { h ^= ch; h *= 16777619u; }
  return h;
}

/* ── Режимы ─────────────────────────────────────────────────────────────────────────────────────────── */
std::vector<std::vector<int>> resolve_regimes(const std::vector<std::vector<int>>& regime,
                                              const std::vector<std::vector<int>>& blockId,
                                              const json& mp, int crisisIndex) {
  std::vector<int> labels;
  if (mp.is_object() && mp.contains("hmm") && mp["hmm"].contains("labels"))
    for (auto& v : mp["hmm"]["labels"]) labels.push_back(v.get<int>());
  std::vector<std::vector<int>> out(regime.size());
  for (size_t i = 0; i < regime.size(); ++i) {
    out[i].resize(regime[i].size());
    for (size_t m = 0; m < regime[i].size(); ++m) {
      int g = regime[i][m];
      if (g == -2) g = crisisIndex;                                   // квантильный стресс → кризис [К]
      else if (g == -1) {                                             // эпизод → метка HMM исходного месяца
        const int b = i < blockId.size() && m < blockId[i].size() ? blockId[i][m] : -1;
        g = b >= 0 && b < (int)labels.size() ? labels[b] : crisisIndex;
      }
      out[i][m] = g;
    }
  }
  return out;
}

int regime_of_week(const std::vector<int>& months, int t) {
  if (months.empty()) return -1;
  const int m = std::min((int)months.size() - 1, (int)std::floor(12.0 * t / 52.0));
  return months[std::max(0, m)];
}

/* ── События ────────────────────────────────────────────────────────────────────────────────────────── */
bool CpEvents::has_buyer_events() const {
  for (const auto& b : buyers) {
    if (b.defaultWeek >= 0) return true;
    for (int d : b.late) if (d > 0) return true;
  }
  return false;
}
bool CpEvents::has_supplier_events() const {
  for (const auto& s : suppliers) {
    if (s.defaultWeek >= 0) return true;
    for (int d : s.disrupt) if (d > 0) return true;
  }
  return false;
}

CpEvents draw(const CpParams& p, uint64_t seed, uint64_t id, const std::vector<int>& monthsRegime, double fTilde,
              int T, int nBuyers, const std::vector<uint32_t>& supplierEntities) {
  CpEvents e; e.T = std::max(0, T);
  macro::NumpyPcg64 rz = stream(seed, id, kKindZ, 0);
  const bool hasF = std::isfinite(fTilde);                  // нет фактора → без загрузки: Z ~ N(0,1) при любом λ_F
  const double lf = hasF ? std::clamp(p.lambdaF, 0.0, 1.0) : 0.0;
  e.z = lf * (hasF ? fTilde : 0.0) + std::sqrt(1.0 - lf * lf) * norm_ppf(uniform_open(rz));
  std::vector<int> g(e.T);
  for (int t = 0; t < e.T; ++t) g[t] = regime_of_week(monthsRegime, t);
  const bool reg = !monthsRegime.empty();
  const auto mPd = regime_multipliers(p.regimeStationary, p.crisisIndex, p.kappaPd);
  const auto mLate = regime_multipliers(p.regimeStationary, p.crisisIndex, p.kappaLate);
  const auto mDis = regime_multipliers(p.regimeStationary, p.crisisIndex, p.kappaDisrupt);
  const auto sLate = regime_scales(p.lateScale, p.regimeStationary, p.crisisIndex, p.kappaLateScale);
  const auto sDis = regime_scales(p.disruptScale, p.regimeStationary, p.crisisIndex, p.kappaDisruptScale);
  const auto hB = hazards(p.buyerPd, g, mPd), hS = hazards(p.supplierPd, g, mPd);
  const double rB = p.buyer_rho(reg), rS = p.supplier_rho(reg), rL = p.late_rho(reg), rD = p.disrupt_rho(reg);
  e.buyers.resize(std::max(0, nBuyers));
  for (int c = 0; c < nBuyers; ++c) {
    macro::NumpyPcg64 rb = stream(seed, id, kKindBuyerDefault, (uint32_t)c);
    const double eps = norm_ppf(uniform_open(rb));           // общий фактор покупателя ε_c (дефолт и просрочки)
    e.buyers[c].defaultWeek = default_week(e.z, rB, eps, hB);
    e.buyers[c].late = late_delays(stream(seed, id, kKindBuyerLate, (uint32_t)c), e.z, eps, p, rL, mLate, sLate, g);
  }
  e.suppliers.resize(supplierEntities.size());
  for (size_t j = 0; j < supplierEntities.size(); ++j) {
    SupplierEvents& s = e.suppliers[j];
    s.entity = supplierEntities[j];
    macro::NumpyPcg64 rs = stream(seed, id, kKindSupplierDefault, s.entity);
    s.defaultWeek = default_week(e.z, rS, norm_ppf(uniform_open(rs)), hS);
    s.disrupt = outage_delays(stream(seed, id, kKindSupplierDisrupt, s.entity), e.z, p, rD, mDis, sDis, g);
  }
  return e;
}

json events_to_json(const CpEvents& e) {
  json b = json::array(), s = json::array();
  for (const auto& x : e.buyers) b.push_back({ {"default_week", x.defaultWeek}, {"late", x.late} });
  for (const auto& x : e.suppliers) s.push_back({ {"entity", x.entity}, {"default_week", x.defaultWeek}, {"disrupt", x.disrupt} });
  return { {"z", e.z}, {"weeks", e.T}, {"buyers", b}, {"suppliers", s} };
}

CpEvents events_from_json(const json& j) {
  CpEvents e;
  if (!j.is_object()) return e;
  e.z = jnum(j, "z", 0); e.T = jint(j, "weeks", 0);
  if (j.contains("buyers")) for (auto& x : j["buyers"])
    e.buyers.push_back({ jint(x, "default_week", -1), x.value("late", std::vector<int>{}) });
  if (j.contains("suppliers")) for (auto& x : j["suppliers"]) {
    SupplierEvents s; s.entity = x.value("entity", 0u); s.defaultWeek = jint(x, "default_week", -1);
    s.disrupt = x.value("disrupt", std::vector<int>{});
    e.suppliers.push_back(s);
  }
  return e;
}

/* ── Покупатели → потоки водопада ──────────────────────────────────────────────────────────────────── */
namespace {

using FlowKey = std::tuple<int, int, int>;                 // (from, to, kind)
using FlowMap = std::map<FlowKey, double>;

void put(FlowMap& m, int from, int to, int kind, double share) { if (share != 0) m[{ from, std::max(from, to), kind }] += share; }

/* Экспозиция дефолтного покупателя по части когорты τ: обеспечение, списание LGD, взыскание. */
void exposure(const CpParams& p, int tc, int tau, double part, int TT, FlowMap& coll, FlowMap& wo) {
  const double g = std::min(1.0, std::max(0.0, p.securityShare));
  if (g > 0 && tc + p.securityLag < TT) put(coll, tau, tc + p.securityLag, cash::kFlowSecurity, g * part);
  put(wo, tau, std::max(tc, tau), cash::kFlowLgd, p.buyerLgd * (1.0 - g) * part);
  if (std::max(tau, tc + p.recoveryLag) < TT) put(coll, tau, tc + p.recoveryLag, cash::kFlowRecovery, (1.0 - p.buyerLgd) * (1.0 - g) * part);
}

/* Когорты одного покупателя c (доля ω): в срок / излеченная просрочка (Δ ≤ D_def, оплата целиком) / дефолт когорты
   (Δ > D_def: часть k признаётся дефолтной на τ+k+D_def — LGD и взыскание, как у дефолта покупателя); после
   юридического дефолта τ_c — экспозиция; после s_stop — заменяющий покупатель. */
void buyer_cohorts(const BuyerEvents& b, double omega, const CpParams& p, const std::vector<double>& kernel, double tauV,
                   int TT, FlowMap& coll, FlowMap& wo) {
  const int tc = b.defaultWeek;
  const long stop = tc >= 0 ? (long)tc + p.stopLag : LONG_MAX;
  const double d = p.replaceDiscount / (1.0 + tauV);       // бонус h_rs·Rev — доля счёта с НДС
  for (int tau = 0; tau < TT; ++tau) {
    if (tau >= stop) {                                     // заменяющий покупатель: бонус, ядро со сдвигом ℓ_rs
      put(wo, tau, tau, cash::kFlowBonus, omega * d);
      for (size_t k = 0; k < kernel.size(); ++k)
        if (tau + (int)k + p.replaceLag < TT) put(coll, tau, tau + (int)k + p.replaceLag, cash::kFlowCollect, omega * kernel[k] * (1.0 - d));
      continue;
    }
    const int lag = tau < (int)b.late.size() ? b.late[tau] : 0;
    const bool cohortDefault = lag > p.defaultDpd;           // 90+ DPD — дефолт когорты, не излечение
    for (size_t k = 0; k < kernel.size(); ++k) {
      const double part = omega * kernel[k];
      if (part == 0) continue;
      if (cohortDefault) {
        const long td = (long)tau + (long)k + p.defaultDpd;   // признание дефолта когорты
        exposure(p, tc >= 0 && tc <= td ? tc : (int)std::min<long>(td, INT_MAX / 2), tau, part, TT, coll, wo);
        continue;
      }
      const long t = (long)tau + (long)k + lag;
      if (tc >= 0 && t >= tc) exposure(p, tc, tau, part, TT, coll, wo);
      else if (t < TT) put(coll, tau, (int)t, cash::kFlowCollect, part);
    }
  }
}

void emit(const FlowMap& m, std::vector<cash::BuyerFlow>& out) {
  for (const auto& [k, v] : m) out.push_back({ std::get<0>(k), std::get<1>(k), v, (unsigned char)std::get<2>(k) });
}

}  // namespace

void buyer_flows(const CpEvents& e, const CpParams& p, const std::vector<double>& kernel, double tauV, int TT,
                 cash::CounterpartyFlows& out) {
  if (!e.has_buyer_events()) return;
  const std::vector<double> w = p.buyer_weights();
  FlowMap coll, wo;
  for (size_t c = 0; c < e.buyers.size() && c < w.size(); ++c) buyer_cohorts(e.buyers[c], w[c], p, kernel, tauV, TT, coll, wo);
  emit(coll, out.buyerCollect);
  emit(wo, out.buyerWriteOff);
}

/* ── Поставщики ─────────────────────────────────────────────────────────────────────────────────────── */
SupplyStatus supply_status(const SupplierEvents& s, const CpParams& p, int tauO, int L) {
  SupplyStatus st;
  const int a = tauO + L;                                  // плановый приход
  const int tj = s.defaultWeek, dis = a >= 0 && a < (int)s.disrupt.size() ? s.disrupt[a] : 0;
  st.arrive = a + dis;                                     // фактический приход (перебой — до его конца)
  if (tj >= 0 && tauO >= tj + p.replaceSupplierLag) { st.state = SupplyState::Replaced; st.arrive = a; return st; }
  if (tj >= 0 && (tauO >= tj || tj <= st.arrive)) {       // перенос [τ_j, τ_j+ℓ_rep) или аннулирование τ_o < τ_j ≤ приход
    st.state = tauO >= tj ? SupplyState::Moved : SupplyState::Cancelled;
    st.reorderWeek = tj + p.replaceSupplierLag;
    st.delay = std::max(0, st.reorderWeek - tauO);
    return st;
  }
  if (dis > 0) { st.state = SupplyState::Disrupted; st.delay = dis; }
  return st;
}

namespace {

struct Part { int to; double amount, prepay; };

/* События поставщика в пределах горизонта плана TT (события тянутся на 52+ недель — префикс). */
SupplierEvents within(const SupplierEvents& s, int TT) {
  SupplierEvents c = s;
  if (c.defaultWeek >= TT) c.defaultWeek = -1;
  return c;
}

/* Заказ поставщику j недели τ (сумма a) по статусу: части прихода, аннулирование, перезаказ с надбавкой. */
void plan_order(const SupplierEvents& s, const CpParams& p, int tau, double a, int L, double phi, int TT,
                std::vector<double>& orders, std::vector<double>& prem, std::vector<std::vector<Part>>& parts,
                std::vector<cash::SupplyCancel>& cancels) {
  const SupplyStatus st = supply_status(s, p, tau, L);
  const double up = a * (1.0 + p.replacePremium);
  switch (st.state) {
    case SupplyState::Normal: case SupplyState::Disrupted:
      orders[tau] += a; parts[tau].push_back({ st.arrive, a, phi }); return;
    case SupplyState::Replaced:
      orders[tau] += up; prem[tau] += up - a; parts[tau].push_back({ tau + L, up, p.replacePrepay }); return;
    case SupplyState::Cancelled:
      orders[tau] += a;
      cancels.push_back({ tau, s.defaultWeek, st.arrive, s.defaultWeek + p.recoveryLag, a, phi, p.supplierLgd });
      [[fallthrough]];
    case SupplyState::Moved: {
      const int r = std::min(TT - 1, st.reorderWeek);
      orders[r] += up; prem[r] += up - a; parts[r].push_back({ r + L, up, p.replacePrepay });
      return;
    }
  }
}

}  // namespace

SupplyPlan supplier_plan(const CpEvents& e, const CpParams& p, const std::vector<std::vector<double>>& orderJ,
                         const std::vector<double>& orderOther, int L, double phi, int TT, cash::CounterpartyFlows& out) {
  SupplyPlan sp;
  sp.orders.assign(TT, 0.0); sp.premium.assign(TT, 0.0);
  if (!e.has_supplier_events()) {                          // нет событий → без потоков (старая ветка водопада)
    for (int t = 0; t < TT; ++t) {
      if (t < (int)orderOther.size()) sp.orders[t] += orderOther[t];
      for (const auto& oj : orderJ) if (t < (int)oj.size()) sp.orders[t] += oj[t];
    }
    return sp;
  }
  std::vector<std::vector<Part>> parts(TT);
  std::vector<cash::SupplyCancel> cancels;
  for (int t = 0; t < TT && t < (int)orderOther.size(); ++t)
    if (orderOther[t] > 0) { sp.orders[t] += orderOther[t]; parts[t].push_back({ t + L, orderOther[t], phi }); }
  for (size_t j = 0; j < orderJ.size() && j < e.suppliers.size(); ++j) {
    const SupplierEvents sj = within(e.suppliers[j], TT);         // дефолт за горизонтом плана не действует
    for (int t = 0; t < TT && t < (int)orderJ[j].size(); ++t)
      if (orderJ[j][t] > 0) plan_order(sj, p, t, orderJ[j][t], L, phi, TT, sp.orders, sp.premium, parts, cancels);
  }
  out.supplyArrive.assign(TT, {});
  for (int t = 0; t < TT; ++t) {
    if (!(sp.orders[t] > 0)) continue;
    std::map<std::pair<int, double>, double> merged;       // (to, prepay) → сумма
    for (const Part& q : parts[t]) merged[{ q.to, q.prepay }] += q.amount;
    for (const auto& [k, a] : merged) out.supplyArrive[t].push_back({ k.first, a / sp.orders[t], k.second });
  }
  for (cash::SupplyCancel c : cancels) { c.share /= sp.orders[c.from]; out.supplyCancel.push_back(c); }
  return sp;
}

int product_delay(const CpEvents& e, const CpParams& p, const std::vector<double>& thetaS, const std::vector<char>& shortage,
                  int t, int L) {
  const int tauO = std::max(0, t - L);
  int d = 0;
  for (size_t j = 0; j < e.suppliers.size() && j < thetaS.size(); ++j)
    if (j < shortage.size() && shortage[j] && thetaS[j] >= p.thetaMin && thetaS[j] > 0)
      d = std::max(d, supply_status(e.suppliers[j], p, tauO, L).delay);
  return d;
}

double product_premium(const CpEvents& e, const CpParams& p, const std::vector<double>& thetaS, int tauO, int L) {
  double s = 0;
  for (size_t j = 0; j < e.suppliers.size() && j < thetaS.size(); ++j) {
    const SupplyState st = supply_status(e.suppliers[j], p, tauO, L).state;
    if (st == SupplyState::Cancelled || st == SupplyState::Moved || st == SupplyState::Replaced) s += thetaS[j] * p.replacePremium;
  }
  return s;
}

/* ── LP ─────────────────────────────────────────────────────────────────────────────────────────────── */
namespace {

void add_at(std::vector<double>& v, int t, double a) { if (a != 0 && !v.empty()) v[std::min((int)v.size() - 1, std::max(0, t))] += a; }

/* ψ и потери материала доли a (на ед. материальной себестоимости), заказанной в τ_o поставщику со статусом st. */
void lp_supplier_part(const SupplierEvents& s, const SupplyStatus& st, const CpParams& p, int tauO, double a, double phi,
                      int L, int dpo, double tauV, std::vector<double>& psi, std::vector<double>& loss) {
  const double up = a * (1.0 + p.replacePremium);
  const int TT = (int)psi.size();
  switch (st.state) {
    case SupplyState::Normal: case SupplyState::Disrupted:
      add_at(psi, tauO, a * phi); add_at(psi, st.arrive + dpo, a * (1.0 - phi)); return;
    case SupplyState::Replaced:
      add_at(psi, tauO, up * p.replacePrepay); add_at(psi, tauO + L + dpo, up * (1.0 - p.replacePrepay));
      add_at(loss, tauO, up - a); return;
    case SupplyState::Cancelled: {
      add_at(psi, tauO, a * phi);                              // уплаченная предоплата → требование SC
      add_at(loss, s.defaultWeek, p.supplierLgd * phi * (1.0 + tauV) * a);
      const int rec = s.defaultWeek + p.recoveryLag;
      if (rec < TT) psi[rec] -= (1.0 - p.supplierLgd) * phi * a;   // взыскание — со знаком «−»
      [[fallthrough]];
    }
    case SupplyState::Moved: {
      const int r = std::min(TT - 1, st.reorderWeek);
      add_at(psi, r, up * p.replacePrepay); add_at(psi, r + L + dpo, up * (1.0 - p.replacePrepay));
      add_at(loss, r, up - a);
      return;
    }
  }
}

}  // namespace

LpScenario lp_data(const CpEvents& e, const CpParams& p, const cash::CounterpartyFlows& buyers,
                   const std::vector<std::vector<double>>& ship, const std::vector<std::vector<double>>& theta,
                   const std::vector<char>& shortage, double phi, int L, int dpo, double tauV, int TT) {
  LpScenario d;
  d.collect = buyers.buyerCollect; d.writeOff = buyers.buyerWriteOff;
  if (!e.has_supplier_events()) return d;
  const size_t S = ship.size();
  d.pay.assign(S, std::vector<double>(TT, 0.0)); d.matLoss = d.pay; d.ship = d.pay;
  for (size_t s = 0; s < S; ++s)
    for (int t = 0; t < (int)ship[s].size(); ++t) {
      const double f = ship[s][t];
      if (!(f > 0)) continue;
      const int tauO = std::max(0, t - L);
      const int D = p.shipShift ? product_delay(e, p, theta[s], shortage, t, L) : 0;
      d.ship[s][std::min(TT - 1, t + D)] += f;
      double other = 1.0;
      for (size_t j = 0; j < e.suppliers.size() && j < theta[s].size(); ++j) {
        if (!(theta[s][j] > 0)) continue;
        other -= theta[s][j];
        const SupplierEvents sj = within(e.suppliers[j], TT);
        lp_supplier_part(sj, supply_status(sj, p, tauO, L), p, tauO, theta[s][j] * f, phi, L, dpo, tauV, d.pay[s], d.matLoss[s]);
      }
      if (other > 1e-12) { add_at(d.pay[s], tauO, other * f * phi); add_at(d.pay[s], tauO + L + dpo, other * f * (1.0 - phi)); }
    }
  return d;
}

/* ── Стадия 1 ───────────────────────────────────────────────────────────────────────────────────────── */
int stage1_delay(const CpEvents& e, const CpParams& p, const std::vector<int>& materials, int L, int tauO) {
  int d = 0;
  for (int j : materials)
    if (j >= 0 && j < (int)e.suppliers.size()) d = std::max(d, supply_status(e.suppliers[j], p, tauO, L).delay);
  return d;
}

double supply_job_extra(const CpEvents& e, const CpParams& p, const std::vector<int>& materials,
                        const std::vector<double>& leadShare, int L, int tauO, double durMin) {
  double finish = durMin;                                    // без событий — разыгранная длительность
  for (size_t k = 0; k < materials.size(); ++k) {
    const int j = materials[k];
    if (j < 0 || j >= (int)e.suppliers.size()) continue;
    const int D = supply_status(e.suppliers[j], p, tauO, L).delay;
    if (D <= 0) continue;
    const double share = k < leadShare.size() ? std::clamp(leadShare[k], 0.0, 1.0) : 1.0;
    finish = std::max(finish, durMin * share + 10080.0 * D);
  }
  return finish - durMin;
}

std::vector<std::vector<double>> stage1_apply(const std::vector<CpEvents>& ev, const CpParams& p,
                                              const std::vector<std::vector<int>>& orderMaterials,
                                              const std::vector<std::vector<double>>& orderLeadShare,
                                              const std::vector<int>& tauO, int L, const std::vector<int>& supplyJob,
                                              std::vector<std::vector<double>>& durMC) {
  std::vector<std::vector<double>> X(ev.size(), std::vector<double>(supplyJob.size(), 0.0));
  const std::vector<double> none;
  for (size_t s = 0; s < ev.size() && s < durMC.size(); ++s)
    for (size_t k = 0; k < supplyJob.size(); ++k) {
      if (supplyJob[k] < 0 || k >= orderMaterials.size()) continue;
      double& dur = durMC[s][supplyJob[k]];
      X[s][k] = supply_job_extra(ev[s], p, orderMaterials[k], k < orderLeadShare.size() ? orderLeadShare[k] : none, L,
                                 k < tauO.size() ? tauO[k] : 0, dur);
      dur += X[s][k];
    }
  return X;
}

/* ── Сводка ─────────────────────────────────────────────────────────────────────────────────────────── */
namespace {

double mean_of(const std::vector<double>& v) { double s = 0; for (double x : v) s += x; return v.empty() ? 0 : s / v.size(); }

json regime_late_shares(const std::vector<CpEvents>& ev, const std::vector<std::vector<int>>* months, int T, int k) {
  std::vector<double> late(std::max(1, k), 0.0), tot(std::max(1, k), 0.0);
  for (size_t i = 0; i < ev.size(); ++i)
    for (const auto& b : ev[i].buyers)
      for (int t = 0; t < T && t < (int)b.late.size(); ++t) {
        const int g = months && i < months->size() ? std::max(0, regime_of_week((*months)[i], t)) : 0;
        if (g >= (int)tot.size()) continue;
        tot[g] += 1; late[g] += b.late[t] > 0 ? 1 : 0;
      }
  json out = json::array();
  for (size_t g = 0; g < tot.size(); ++g) out.push_back(tot[g] > 0 ? json(late[g] / tot[g]) : json(nullptr));
  return out;
}

/* Эмпирическая парная корреляция дефолтов покупателей по сценариям: (E[n(n−1)]/(m(m−1)) − p̄²)/(p̄(1−p̄)). */
double empirical_default_corr(const std::vector<CpEvents>& ev, int T) {
  double pairs = 0, ind = 0, cells = 0, pairCells = 0;
  for (const auto& e : ev) {
    const double m = (double)e.buyers.size();
    double n = 0; for (const auto& b : e.buyers) n += b.defaultWeek >= 0 && b.defaultWeek < T ? 1 : 0;
    ind += n; cells += m; pairs += n * (n - 1); pairCells += m * (m - 1);
  }
  if (cells <= 0 || pairCells <= 0) return 0.0;
  const double pb = ind / cells;
  return pb > 0 && pb < 1 ? (pairs / pairCells - pb * pb) / (pb * (1 - pb)) : 0.0;
}

/* Поставщики сценария по entity (позиции одного поставщика — общие события, считаются один раз). */
std::map<uint32_t, const SupplierEvents*> unique_suppliers(const CpEvents& e) {
  std::map<uint32_t, const SupplierEvents*> u;
  for (const auto& x : e.suppliers) u.emplace(x.entity, &x);
  return u;
}

/* Перебои: начала (disrupt[a] > 0 и не продолжение предыдущего: disrupt[a−1] ≠ disrupt[a] + 1) и их длительности. */
void count_outages(const std::vector<int>& d, int T, double& n, double& dur) {
  for (int a = 0; a < T && a < (int)d.size(); ++a)
    if (d[a] > 0 && (a == 0 || d[a - 1] != d[a] + 1)) { n += 1; dur += d[a]; }
}

struct SupplyStats { double anyDefault = 0, defaults = 0, outages = 0, outageWeeks = 0, supplierWeeks = 0; };
SupplyStats supply_stats(const std::vector<CpEvents>& ev, int T) {
  SupplyStats st;
  for (const auto& e : ev) {
    int s = 0;
    for (const auto& [ent, x] : unique_suppliers(e)) {
      s += x->defaultWeek >= 0 && x->defaultWeek < T ? 1 : 0;
      count_outages(x->disrupt, T, st.outages, st.outageWeeks);
      st.supplierWeeks += T;
    }
    st.defaults += s; st.anyDefault += s > 0;
  }
  return st;
}

/* Доля когорт покупателей с дефолтом когорты (Δ > D_def, 90+ DPD). */
double cohort_default_share(const std::vector<CpEvents>& ev, const CpParams& p, int T) {
  double cells = 0, hits = 0;
  for (const auto& e : ev)
    for (const auto& b : e.buyers)
      for (int t = 0; t < T && t < (int)b.late.size(); ++t) { cells += 1; hits += b.late[t] > p.defaultDpd ? 1 : 0; }
  return cells > 0 ? hits / cells : 0.0;
}

bool any_regimes(const std::vector<std::vector<int>>* months) {
  if (!months) return false;
  for (const auto& m : *months) if (!m.empty()) return true;
  return false;
}

json default_corr_json(const CpParams& p, const std::vector<CpEvents>& ev, int T, bool reg) {
  const double pdT = 1.0 - std::pow(1.0 - p.buyerPd, T / 52.0), rb = basel_rho(p.buyerPd), rw = p.buyer_rho(reg);
  return { {"within_regime", implied_default_corr(pdT, rw)}, {"empirical", empirical_default_corr(ev, T)},
           {"pd_horizon", pdT}, {"rho", rw}, {"rho_basel", rb},
           {"total_annual", reg ? regime_mixture_corr(p.buyerPd, p.regimeStationary, p.crisisIndex, p.kappaPd, rw)
                                : implied_default_corr(p.buyerPd, rw)},
           {"target_annual", implied_default_corr(p.buyerPd, rb)},
           {"note", p.rho >= 0 ? "ρ задана [К] как корреляция внутри режима"
                               : "ρ_w внутри режима откалибрована: полная корреляция дефолтов за год при смеси режимов "
                                 "(режим на весь год) = подразумеваемой ρ Базеля; без режимов ρ_w = ρ Базеля"} };
}

}  // namespace

json summary(const CpParams& p, uint64_t seed, const SummaryInput& in, const std::vector<std::string>& warnings) {
  const std::vector<CpEvents>& ev = *in.events;
  const int T = in.T;
  double nb = 0, anyB = 0;
  for (const auto& e : ev) {
    int b = 0;
    for (const auto& x : e.buyers) b += x.defaultWeek >= 0 && x.defaultWeek < T ? 1 : 0;
    nb += b; anyB += b > 0;
  }
  const SupplyStats ss = supply_stats(ev, T);
  const double N = std::max<size_t>(1, ev.size());
  const double rev = mean_of(in.revenueVat);
  const int k = (int)p.regimeStationary.size();
  json shipDelay = { {"mean_weeks", mean_of(in.shipDelay)}, {"share_scenarios", 0.0} };
  { double c = 0; for (double v : in.shipDelay) c += v > 0; shipDelay["share_scenarios"] = in.shipDelay.empty() ? 0.0 : c / in.shipDelay.size(); }
  return {
    {"enabled", p.enabled}, {"stream", { seed, kCpStream }}, {"params", p.to_json()},
    {"status", "К/НОРМ (паспорт fin.cp.*): эффект при калибровке на демо-экземпляре, не оценка"},
    {"n_scenarios", (int)ev.size()}, {"horizon_weeks", T},
    {"p_buyer_default", anyB / N}, {"p_supplier_default", ss.anyDefault / N},
    {"mean_buyer_defaults", nb / N}, {"mean_supplier_defaults", ss.defaults / N},
    {"ecl_pct_revenue", rev > 0 ? 100.0 * mean_of(in.badDebt) / rev : 0.0},
    {"bad_debt_mean", mean_of(in.badDebt)}, {"discount_mean", mean_of(in.discount)},
    {"supplier_loss_mean", mean_of(in.supLoss)}, {"recoveries_mean", mean_of(in.recoveries)},
    {"late_share_by_regime", regime_late_shares(ev, in.monthsRegime, T, k)},
    {"cohort_default_share", cohort_default_share(ev, p, T)},
    {"default_corr", default_corr_json(p, ev, T, any_regimes(in.monthsRegime))},
    {"supply", { {"outages_per_supplier_year", ss.supplierWeeks > 0 ? 52.0 * ss.outages / ss.supplierWeeks : 0.0},
                 {"outage_mean_weeks", ss.outages > 0 ? ss.outageWeeks / ss.outages : 0.0},
                 {"disrupt_share", ss.supplierWeeks > 0 ? ss.outageWeeks / ss.supplierWeeks : 0.0},
                 {"disrupt_mean_weeks", ss.outages > 0 ? ss.outageWeeks / ss.outages : 0.0},
                 {"ship_delay", shipDelay} }},
    {"warnings", warnings},
  };
}

}  // namespace maos::cpr
