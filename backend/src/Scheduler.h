#pragma once
#include "Database.h"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

/**
 * Стадия 1 — оптимизация ИСПОЛНЕНИЯ плана (как произвести).
 * Модель — docs/SCHEDULING.md и ТЗ «Требования к производственному плану/
 * оптимизации/эвристики». Гибкая задача цеха (FJSP): программа разворачивается
 * в граф операций по производственной цепочке (техкарты + входы операций),
 * симуляция (списочное планирование по диспетч-правилу) ставит операции на
 * станки нужного типа и рабочих как можно раньше; длительности — ТЯЖЕЛОХВОСТНЫЕ
 * (Монте-Карло). Выход: диаграмма Ганта, загрузка оборудования, планы рабочих,
 * узкие места, простои, KPI (makespan/tardiness/utilization) + риск по хвосту.
 */
namespace maos {

using nlohmann::json;

struct OrderLine { std::string productId; double qty = 1; double dueHours = 0; };

struct ScheduleParams {
  std::vector<OrderLine> program;     // что и сколько (если пусто → из run/демо)
  std::string runId;                  // optimization_runs.id → программа из портфеля
  std::string rule = "auto";          // SPT|LPT|EDD|CR|MWKR|MS|FIFO|auto (лучшее)
  double wTime = 1.0, wCost = 0.0, wRisk = 0.5;  // веса целевой функции
  int    samples = 600;               // прогонов Монте-Карло (тяжёлый хвост)
  double alpha   = 0.10;              // хвост для CVaR makespan/tardiness
  unsigned seed  = 42;
  double tailWeight = -1;             // <0 → из операций; иначе глобальный override
  bool   useCalendar = true;          // учитывать рабочий календарь (смены/выходные)
};

// Строит и оптимизирует расписание; ПЕРСИСТИТ план (plans/plan_tasks) и
// возвращает полный JSON: Ганта, загрузка, планы рабочих, узкие места,
// простои, KPI (детерминированные + риск по тяжёлому хвосту), сравнение правил.
json run_schedule(Database& db, const ScheduleParams& p);

}  // namespace maos
