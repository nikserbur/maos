#pragma once
/**
 * Волна A3: «Инвестпроекты» в «Аналитике» — CRN-оценка кандидатов L3 на текущем портфеле (demand_orders).
 *
 * POST /api/analytics/investment дополняется блоком `crn` (поля только добавлены): кандидаты по TOC и
 * двойственным ценам мощности CVaR-LP (`exact.duals` прогона оптимизатора) + запрошенный тип РЦ; для каждого —
 * E[ЧДД], 95 %-ДИ, CVaR₀.₁(ЧДД), ΔE/ΔCVaR прибыли, CVaR₀.₀₅(C_min), P(кассового разрыва), дисконтированный срок
 * окупаемости (ВК 477) на отбирающем наборе сценариев A и на ОТЛОЖЕННОМ наборе B обученного макро-генератора
 * (ключевая ставка пути → проценты по траншам); вердикт «внедрить» — по правилу §9 на наборе B.
 */
#include "Database.h"
#include "MacroSampler.h"
#include <nlohmann/json.hpp>

namespace maos::invest {

/** body: wc_type_id, machine_capex (за станок, 0 → норматив), n_scenarios (48), seed (20261023), cont_weeks (260),
 *  liq_threshold (0), rule ("" → лучшее из 7 по CVaR на наборе A), horizon_weeks (26). r0 — ответ оптимизатора (duals). */
nlohmann::json analytics_crn(Database& db, const nlohmann::json& body, const nlohmann::json& r0,
                             const macro::MacroSampler* sampler);

}  // namespace maos::invest
