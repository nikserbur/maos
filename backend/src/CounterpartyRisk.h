#pragma once
/**
 * Блок контрагентского риска (CPR): платежи, дефолты и срывы поставок (METHODOLOGY-V2 §2.6в, §4.3, §4.6).
 *
 * Чистый модуль без БД: параметры fin.cp.* (паспорт; все [К]/[НОРМ] — данных предприятия нет, ничего
 * не «оценено»), розыгрыш событий сценария и их перевод в данные расчёта — потоки водопада
 * (CashWaterfall::CounterpartyFlows), данные CVaR-LP (CashLp::Problem.*I) и задержки Стадии 1.
 *
 * Стохастическая модель (обобщение рукописи «Деньги и кредит», Бураков 2026, §4.3):
 *   - режим недели g(i,t) = regime[i][min(H−1, ⌊12t/52⌋)] обученного генератора; множители интенсивностей
 *     и масштабов задержек нормированы на стационарные вероятности режимов: Σ_g π_g·m_g = 1 (якорь «через цикл»);
 *   - систематический фактор Z_i = λ_F·F̃_i + √(1−λ_F²)·η_i (один на сценарий; λ_F = 0 по умолчанию; F̃ не задан
 *     (NaN) → загрузка не применяется, Z ~ N(0,1));
 *   - время дефолта: h_{c,t} = h̄_c·m_{g(t)}, h̄ = −ln(1−PD̄)/52; копула X_c = √ρ_w·Z + √(1−ρ_w)·ε_c,
 *     E_c = −ln(1−Φ(X_c)) ~ Exp(1), τ_c = min{t : Λ(t+1) > E_c} (при постоянной h — ровно t_ex рукописи);
 *     ρ_w — корреляция ВНУТРИ режима: полная корреляция дефолтов за год (смесь режимов) = подразумеваемой ρ Базеля;
 *   - просрочки когорт счетов: своя копула (ρ_L) с общим фактором покупателя ε_c (λ_b), задержка Δ ~ Ломакс (GPD,
 *     ξ = 1/α); Δ > D_def (90+ DPD) — дефолт когорты (LGD, взыскание), иначе излечение (оплата целиком);
 *   - срывы поставок — перебои поставщика: начало по недельной интенсивности (копула ρ_s), длительность Ломакса;
 *     плановые приходы внутри перебоя ждут его конца (без обгона).
 *
 * Общие случайные числа: только поток [seed, 915]; розыгрыш привязан к координатам
 * SeedSequence([seed, 915, id, kind, entity]) (numpy PCG64, MacroSampler::NumpyPcg64). События сценария id
 * не зависят от N, горизонта (префикс по неделям), числа других контрагентов и решений (x, φ, транши).
 */
#include "CashWaterfall.h"
#include <nlohmann/json.hpp>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace maos::cpr {

using nlohmann::json;

constexpr uint32_t kCpStream = 915;          // [seed, 915]; заняты 871/872 (макро/мост), 911 (legacy), 913 (шоки RL)
/** Раскладка розыгрышей (kind) — §2.6 спецификации CPR. */
enum Kind : uint32_t { kKindZ = 0, kKindBuyerDefault = 1, kKindBuyerLate = 2, kKindSupplierDefault = 3, kKindSupplierDisrupt = 4 };

/** Параметры fin.cp.* (паспорт: строка на каждый ключ; JSON-ключи = суффиксы кодов паспорта). */
struct CpParams {
  bool   enabled = false;                    // fin.cp.enabled [НОРМ] — 0: старая ветка побитово (legacy fin.pd)
  std::vector<double> regimeStationary{ 0.9037425748227139, 0.0962574251772861 };   // π_g [О] regime_stats
  int    crisisIndex = 1;                    // [О] regime_stats.crisis_index
  double rho = -1;                           // < 0 → ρ_w(PD̄): внутри режима, полная = Базель [НОРМ]; иначе ρ_w [К]
  double lambdaF = 0;                        // загрузка Z на F̃ [К]
  double kappaPd = 3;                        // κ_PD [К]
  int    nBuyers = 10;                       // n_b [К]
  double zipfA = 1.0;                        // ω_c ∝ c^{−a} [К]
  std::vector<double> buyerShares;           // явные доли (Σ = 1) — переопределяют Зипф
  double buyerPd = 0.04, buyerLgd = 0.9;     // годовая PD (юридический дефолт) [К]; LGD [К] (0.45 F-IRB — чувствительность)
  int    recoveryLag = 52;                   // ℓ_R, нед [НОРМ]
  double securityShare = 0; int securityLag = 8;   // g_b [НОРМ], ℓ_G [К]
  int    stopLag = 1, replaceLag = 4;        // s_stop, ℓ_rs [К]
  double replaceDiscount = 0.05;             // h_rs [К]
  double lateShare = 0.15, kappaLate = 2;    // q̄, κ_q [К]
  double lateAlpha = 1.5, lateScale = 3;     // Ломакс α, σ (нед; безусловный — нормирован по π) [К]
  double kappaLateScale = 1.5;               // κ_σ просрочек [К]
  int    defaultDpd = 13;                    // D_def: просрочка > D_def нед — дефолт когорты (90+ DPD) [НОРМ]
  int    lateMax = 13;                       // Δmax излеченной просрочки (≤ D_def) [техн.]
  double lateRho = 0.10;                     // ρ_L просрочек [К]; < 0 → = ρ_w покупателя
  double lateBuyerLoad = 0.3;                // λ_b — доля общего фактора покупателя ε_c в латентной просрочки [К]
  double supplierPd = 0.04, supplierLgd = 0.9;    // [К] / [К]
  int    replaceSupplierLag = 2;             // ℓ_rep [К]
  double replacePremium = 0.10, replacePrepay = 0.5;   // π_rep, φ_rep [К]
  double disruptShare = 0.01, kappaDisrupt = 2;        // q^s — начало перебоя на неделю, κ_s [К]
  double disruptAlpha = 2.0, disruptScale = 2.0;       // α_s, σ_s длительности перебоя [К]
  double kappaDisruptScale = 1.5;            // κ_σ^s перебоев [К]
  int    disruptMax = 26;                    // потолок длительности перебоя, нед [техн.]
  double disruptRho = 0.10;                  // ρ_s перебоев [К]; < 0 → = ρ_w поставщика
  std::map<std::string, std::string> supplierGroups;   // позиция НСИ → поставщик (пусто → позиция = поставщик) [К]
  double thetaMin = 0.05;                    // θ_min [К]
  double prepayDiscount = 0;                 // d_φ — скидка за предоплату [К] (только водопад)
  bool   vatRestore = true;                  // пп. 3 п. 3 ст. 170 НК РФ [НОРМ]
  bool   shipShift = true;                   // сдвиг отгрузок Стадии 2 [НОРМ-упрощение]
  bool   lexicographic = false;              // лексикографическая фаза 2 LP (PoL)
  double lexEps = 1e-7;                      // допуск фазы 2 [техн.]
  double lpTimeLimit = 30;                   // лимит времени HiGHS на одну задачу CVaR-LP, с (= exact::Problem) [техн.]

  /** Наложение сохранённых/запрошенных значений на base (неизвестные ключи игнорируются). */
  static CpParams from_json(const json& j, CpParams base);
  static CpParams from_json(const json& j);
  json to_json() const;
  /** Нарушения диапазонов (T22): пусто → корректно. */
  std::vector<std::string> validate() const;
  /** Стационарные вероятности и кризисный режим — из обученного генератора (regime_stats), если есть. */
  void apply_generator(const json& macroParams);
  /** ρ копул; regimes — сценарий с режимами генератора (иначе m ≡ 1 и ρ_w = ρ Базеля). */
  double buyer_rho(bool regimes = true) const;     // дефолты покупателей
  double supplier_rho(bool regimes = true) const;
  double late_rho(bool regimes = true) const;      // просрочки покупателей
  double disrupt_rho(bool regimes = true) const;   // перебои поставщиков
  std::vector<double> buyer_weights() const; // ω_c (Σ = 1)
  /** Поставщик позиции НСИ (supplier_groups; нет → сама позиция) и его entity потока [seed, 915]. */
  const std::string& vendor_of(const std::string& productId) const;
  uint32_t supplier_entity(const std::string& productId) const;
};

/* ── Математика (публично для тестов) ─────────────────────────────────────────────────────────────── */
double norm_cdf(double x);
/** Φ⁻¹ по AS241 (Wichura 1988, PPND16), относительная точность ~1e−16. */
double norm_ppf(double p);
/** ρ(PD) Базеля II для корпоративных требований без поправки на МСП (BCBS 2006 §272; 483-П). */
double basel_rho(double pd);
/** m_g при κ для кризисного режима: Σ π_g m_g = 1. */
std::vector<double> regime_multipliers(const std::vector<double>& pi, int crisis, double kappa);
/** Обрезка q·m_crisis > 1 до 1: предупреждения и фактические безусловные средние Σπ_g·min(1, q·m_g). */
std::vector<std::string> clip_warnings(const CpParams& p, double* lateEffective = nullptr, double* disruptEffective = nullptr);
/** τ = min{t : Λ(t+1) > E}, Λ — накопленная недельная интенсивность h; −1 → за горизонтом h.size(). */
int hazard_week(double E, const std::vector<double>& h);
/** Неделя дефолта по равномерному U (E = −ln(1−U)) — для сверки с t_ex рукописи. */
int default_week_from_uniform(double U, const std::vector<double>& h);
/** Непрерывная задержка Ломакса (GPD, ξ = 1/α, β = σ/α): σ((1−u)^{−1/α} − 1). */
double lomax_delay(double u, double alpha, double sigma);
/** Задержка Ломакса в неделях: min(maxW, max(1, ⌈σ((1−u)^{−1/α} − 1)⌉)). */
int lomax_weeks(double u, double alpha, double sigma, int maxW);
/** Подразумеваемая парная корреляция дефолтов однофакторной модели: ∫φ(z)p(z)²dz (Гаусс–Эрмит, 64 узла). */
double implied_default_corr(double pdT, double rho);
/** Полная парная корреляция дефолтов за 52 нед. при смеси режимов (режим на весь год с вероятностью π_g,
 *  PD_g = 1 − (1−PD̄)^{m_g}) и корреляции внутри режима rhoW. */
double regime_mixture_corr(double pdAnnual, const std::vector<double>& pi, int crisis, double kappa, double rhoW);
/** ρ_w внутри режима: regime_mixture_corr(ρ_w) = implied_default_corr(PD̄, ρ_Basel(PD̄)) — поиск корня на [0, ρ_Basel];
 *  вклад режима уже выше цели → 0. Без режимов (κ = 1) — ρ_Basel. */
double within_regime_rho(double pdAnnual, const std::vector<double>& pi, int crisis, double kappa);
/** Устойчивый идентификатор поставщика (FNV-1a 32 кода позиции НСИ) — entity потока [seed, 915]. */
uint32_t entity_of(const std::string& productId);

/* ── Режимы ───────────────────────────────────────────────────────────────────────────────────────── */
/** Режимы по МЕСЯЦАМ с разрешёнными метками: эпизод (−1) → метка HMM исходного месяца blockId,
 *  квантильный стресс (−2) → кризис. Пусто → без генератора (m ≡ 1). */
std::vector<std::vector<int>> resolve_regimes(const std::vector<std::vector<int>>& regime,
                                              const std::vector<std::vector<int>>& blockId,
                                              const json& macroParams, int crisisIndex);
/** Режим недели t: months[min(H−1, ⌊12t/52⌋)]; пусто → −1 (m ≡ 1). */
int regime_of_week(const std::vector<int>& months, int t);

/* ── События сценария ─────────────────────────────────────────────────────────────────────────────── */
/** late[τ] = Δ (0 — в срок; 1..Δmax — излечение; D_def + 1 — дефолт когорты, 90+ DPD). */
struct BuyerEvents { int defaultWeek = -1; std::vector<int> late; };
/** disrupt[a] = задержка планового прихода недели a (перебой [s, e) ∋ a → e − a; 0 — без перебоя). */
struct SupplierEvents { uint32_t entity = 0; int defaultWeek = -1; std::vector<int> disrupt; };
struct CpEvents {
  double z = 0;                              // систематический фактор Z_i
  int T = 0;                                 // недель розыгрыша
  std::vector<BuyerEvents> buyers;
  std::vector<SupplierEvents> suppliers;
  bool has_buyer_events() const;
  bool has_supplier_events() const;
  bool empty() const { return !has_buyer_events() && !has_supplier_events(); }
};

/** Розыгрыш событий сценария id на T недель (Z, дефолты, просрочки, перебои). monthsRegime — режимы по
 *  месяцам (resolve_regimes; пусто → m ≡ 1), fTilde — ориентированный общий фактор F̃_i (NaN — нет фактора:
 *  загрузка λ_F не применяется, Z ~ N(0,1)). */
CpEvents draw(const CpParams& p, uint64_t seed, uint64_t id, const std::vector<int>& monthsRegime, double fTilde,
              int T, int nBuyers, const std::vector<uint32_t>& supplierEntities);
json events_to_json(const CpEvents& e);
CpEvents events_from_json(const json& j);

/* ── Покупатели → потоки водопада ────────────────────────────────────────────────────────────────── */
/** Инкассация/взыскание/обеспечение и списания по когортам счетов (доли счёта недели from с НДС) на TT недель.
 *  Нет событий покупателей → пусто (старая ветка водопада по ядру DSO). */
void buyer_flows(const CpEvents& e, const CpParams& p, const std::vector<double>& kernel, double tauV, int TT,
                 cash::CounterpartyFlows& out);

/* ── Поставщики ───────────────────────────────────────────────────────────────────────────────────── */
enum class SupplyState { Normal, Disrupted, Cancelled, Moved, Replaced };
struct SupplyStatus { SupplyState state = SupplyState::Normal; int delay = 0, reorderWeek = -1, arrive = 0; };
/** Судьба заказа поставщику недели τ_o при сроке L (недель) — одна функция для Стадий 1, 2 и SimEnv:
 *  перебой (приход τ_o+L+Δ^s, Δ^s = disrupt[τ_o+L]), аннулирование (τ_o < τ_j ≤ τ_o+L+Δ^s — дефолт до
 *  фактического прихода), перенос к заменяющему ([τ_j, τ_j+ℓ_rep)), замена (позже — надбавка без задержки);
 *  у перенесённых и заменённых заказов перебой не применяется (заменяющий — без риска). */
SupplyStatus supply_status(const SupplierEvents& s, const CpParams& p, int tauO, int L);

/** План закупок с событиями: заказы по неделям (с перезаказами и надбавкой), части прихода, аннулирования.
 *  orderJ[j][τ] — заказ поставщику j (без надбавки), orderOther[τ] — заказы вне риска (вне множества поставщиков). */
struct SupplyPlan {
  std::vector<double> orders;                // [τ] Ord_τ без НДС, включая перезаказы и надбавку
  std::vector<double> premium;               // [τ] надбавка π_rep в Ord_τ (справочно)
};
SupplyPlan supplier_plan(const CpEvents& e, const CpParams& p, const std::vector<std::vector<double>>& orderJ,
                         const std::vector<double>& orderOther, int L, double phi, int TT, cash::CounterpartyFlows& out);

/** Задержка материалов изделия s при выпуске в неделю t: max_j D_j(t − L) по дефицитным j с θ_{s,j} ≥ θ_min. */
int product_delay(const CpEvents& e, const CpParams& p, const std::vector<double>& thetaS,
                  const std::vector<char>& shortage, int t, int L);
/** Доля надбавки материала изделия s, заказанного в τ_o (Σ_j θ_{s,j}·π_rep по перезаказанным/заменённым). */
double product_premium(const CpEvents& e, const CpParams& p, const std::vector<double>& thetaS, int tauO, int L);

/* ── Данные CVaR-LP одного сценария ───────────────────────────────────────────────────────────────── */
struct LpScenario {
  std::vector<cash::BuyerFlow> collect, writeOff;     // κ и λ (доли счёта)
  std::vector<std::vector<double>> pay, matLoss, ship;   // [s][t<TT]; пусто → общий путь
};
/** ψ^(i), потери материала и сдвиг отгрузок по изделиям; ship [s][t<T] — опорный профиль, theta [s][j]. */
LpScenario lp_data(const CpEvents& e, const CpParams& p, const cash::CounterpartyFlows& buyers,
                   const std::vector<std::vector<double>>& ship, const std::vector<std::vector<double>>& theta,
                   const std::vector<char>& shortage, double phi, int L, int dpo, double tauV, int TT);

/* ── Стадия 1 ─────────────────────────────────────────────────────────────────────────────────────── */
/** Задержка поставки заказа (недель) по дефицитным материалам: max_j supply_status(j, τ_o, L).delay (перебой
 *  Δ^s или дефолт до фактического прихода τ_j + ℓ_rep − τ_o); materials — индексы в e.suppliers, L — единый
 *  договорной срок fin.lead_weeks (как в Стадии 2 и денежном слое SimEnv). */
int stage1_delay(const CpEvents& e, const CpParams& p, const std::vector<int>& materials, int L, int tauO);

/** Добавка к разыгранной длительности supply-джобы durMin (мин): материал k приходит к durMin·share_k (share_k —
 *  его срок / срок supply-джобы, т. е. максимум по дефицитным материалам) + 10080·D_k; джоба кончается с последним:
 *  max(0, max_k(durMin·share_k + 10080·D_k) − durMin) — задержка материала в пределах запаса до максимума не удлиняет. */
double supply_job_extra(const CpEvents& e, const CpParams& p, const std::vector<int>& materials,
                        const std::vector<double>& leadShare, int L, int tauO, double durMin);

/** Добавки supply-джоб [s][k] (мин) по событиям сценариев, прибавленные к durMC[s][supplyJob[k]]
 *  (supplyJob[k] < 0 → у заказа нет поставки). orderMaterials[k] — индексы дефицитных материалов заказа в
 *  e.suppliers, orderLeadShare[k] — их доли срока supply-джобы, tauO[k] — неделя запуска заказа. */
std::vector<std::vector<double>> stage1_apply(const std::vector<CpEvents>& ev, const CpParams& p,
                                              const std::vector<std::vector<int>>& orderMaterials,
                                              const std::vector<std::vector<double>>& orderLeadShare,
                                              const std::vector<int>& tauO, int L, const std::vector<int>& supplyJob,
                                              std::vector<std::vector<double>>& durMC);

/* ── Сводка для API (cash_lp.counterparty) ───────────────────────────────────────────────────────── */
struct SummaryInput {
  const std::vector<CpEvents>* events = nullptr;
  const std::vector<std::vector<int>>* monthsRegime = nullptr;   // [i][месяц] (может быть пусто)
  int T = 0;                                                     // горизонт без дорасчёта
  std::vector<double> badDebt, discount, supLoss, recoveries, revenueVat, shipDelay;  // по сценариям
};
json summary(const CpParams& p, uint64_t seed, const SummaryInput& in, const std::vector<std::string>& warnings);

}  // namespace maos::cpr
