#pragma once
/**
 * Волна A3: «Инвестпроекты» в «Аналитике» — CRN-оценка кандидатов L3 на текущем портфеле (demand_orders).
 *
 * POST /api/analytics/investment дополняется блоком `crn` (поля только добавлены): кандидаты по TOC и
 * двойственным ценам мощности CVaR-LP (`exact.duals` прогона оптимизатора) + запрошенный тип РЦ; для каждого —
 * E[ЧДД], 95 %-ДИ, CVaR₀.₁(ЧДД), ΔE/ΔCVaR прибыли, CVaR₀.₀₅(C_min), P(кассового разрыва), дисконтированный срок
 * окупаемости (ВК 477) на отбирающем наборе сценариев A и на ОТЛОЖЕННОМ наборе B обученного макро-генератора
 * (ключевая ставка пути → проценты по траншам); вердикт «внедрить» — по правилу §9 на наборе B. При fin.cp.enabled
 * сценарии несут события контрагентов (CPR, поток [seed, 915]) — база и проект идут на одних событиях.
 */
#include "CounterpartyRisk.h"
#include "Database.h"
#include "MacroSampler.h"
#include "SimEnv.h"
#include <nlohmann/json.hpp>

namespace maos::invest {

/** Сценарии набора (n, seed, weeks) из обученного генератора (ms = nullptr → постоянные fin_params); cp ≠ nullptr —
 *  CPR: события контрагентов сценария i = cpr::draw(cp, seed, i, режимы пути i, F̃_i, max(52, weeks), n_b, ent). */
std::vector<env::Scenario> macro_scenarios(const macro::MacroSampler* ms, int n, uint64_t seed, int weeks,
                                           const cpr::CpParams* cp, const std::vector<uint32_t>& ent);

/** body: wc_type_id, machine_capex (за станок, 0 → норматив), n_scenarios (48), seed (20261023), cont_weeks (260),
 *  liq_threshold (0), rule ("" → лучшее из 7 по CVaR на наборе A), horizon_weeks (26). r0 — ответ оптимизатора (duals). */
nlohmann::json analytics_crn(Database& db, const nlohmann::json& body, const nlohmann::json& r0,
                             const macro::MacroSampler* sampler);

}  // namespace maos::invest
