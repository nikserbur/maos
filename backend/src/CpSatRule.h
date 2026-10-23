#pragma once
/**
 * Правило «CP-SAT» Стадии 1 (волна A2, PLAN-V2 §8 п.1–2): точная детерминированная модель
 * в Python-sidecar (rl/cpsat_service.py, OR-Tools; модель — rl/bench/cpsat_full.py).
 *
 *   run_schedule → build_payload (та же развёртка джобов Expander, что у правил; станки,
 *   календари, рабочие, сроки, подсказка = план лучшего правила) → solve (HTTP POST /solve
 *   к $MAOS_CPSAT_URL, по умолчанию http://127.0.0.1:8091) → старты и станки фиксируются
 *   существующим механизмом пинов (PinMap: «не раньше» + станок) → неизменный конвейер
 *   Монте-Карло/CVaR и проверка вне выборки.
 *
 *   Тёплый старт ГА (режим «ключи по операциям»): затравка = нормированные старты CP-SAT
 *   (opkey_from_starts), правила — затравками через ранги их ключей (opkey_from_key).
 *
 * Sidecar недоступен → Solution.ok = false с понятной причиной (run_schedule отвечает error_soft).
 */
#include "SchedCore.h"
#include <functional>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace maos::cpsat {

using nlohmann::json;

struct Solution {
  bool ok = false;
  std::string error;                 // причина при ok = false
  std::string status;                // OPTIMAL | FEASIBLE | HINT | INFEASIBLE | UNKNOWN | ERROR | UNAVAILABLE
  double objective = 0, bound = 0, timeS = 0, makespan = 0, tardiness = 0;
  std::vector<double> starts;        // мин, по индексу джоба
  std::vector<std::string> machines; // "" → без станка (поставка)
  std::string setupMode;             // circuit | conservative
  std::string calendarMode;          // warp (единый календарь, ось рабочего времени) | forbidden | none
  std::string routing;               // free | fixed_from_hint (крупная модель)
  bool fromHint = false;             // HINT: солвер не нашёл решения за лимит — исправленный план правила
};

/** Подмена решателя (тесты): payload → ответ в формате sidecar. nullptr → HTTP. */
using SolverFn = std::function<json(const json& payload)>;
void set_solver_override(SolverFn fn);

/** URL sidecar: $MAOS_CPSAT_URL → http://127.0.0.1:8091. */
std::string sidecar_url();

/** Вход модели по развёртке run_schedule (индексы джобов совпадают). hint — план правила (может быть nullptr). */
json build_payload(const sched::Model& m, const std::vector<sched::Job>& jobs, const sched::Calendar& cal,
                   const std::unordered_map<std::string, sched::Calendar>& calByM, const std::vector<double>& due,
                   double timeLimitS, unsigned seed, double wTard, const sched::SimOut* hint);

/** Решить: override или HTTP к sidecar (таймаут = лимит солвера + запас). */
Solution solve(const json& payload, double timeLimitS);

/** Разбор ответа sidecar (общий для HTTP и подмены); проверяет размерности. */
Solution parse_solution(const json& r, size_t nJobs);

/** Пины «не раньше старта CP-SAT + станок CP-SAT»; пользовательские пины имеют приоритет. */
sched::PinMap pins_from(const Solution& s, const sched::PinMap& userPins);
/** Только станки CP-SAT (старт «не раньше» = 0) — маршрутизация для режима ключей по операциям. */
sched::PinMap machine_pins_from(const Solution& s, const sched::PinMap& userPins);

/** Ключ приоритетов = ранг старта (равные старты — по индексу). */
std::vector<double> rank_key(const std::vector<double>& starts);
/** Затравка ключей по операциям из стартов: s_i / max s ∈ [0, 1]. */
std::vector<double> opkey_from_starts(const std::vector<double>& starts);
/** Затравка из произвольного ключа правила: нормированный ранг ∈ [0, 1] (порядок сохраняется). */
std::vector<double> opkey_from_key(const std::vector<double>& key);

}  // namespace maos::cpsat
