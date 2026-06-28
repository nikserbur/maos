#pragma once
#include "Database.h"
#include <nlohmann/json.hpp>
#include <string>

/**
 * Устойчивая стохастическая оптимизация производства под неопределённость
 * внешних условий (цены). Модель и обоснование — docs/OPTIMIZATION.md.
 *
 * Идея: цены продукции — стохастические (заданы распределениями в сценарии),
 * себестоимость собирается снизу вверх по связанным реестрам (BOM + техкарты +
 * операции + типы оборудования). Методом Монте-Карло строится распределение
 * прибыли для каждого портфеля-кандидата, и выбирается **самое устойчивое**
 * решение (по CVaR / худшему случаю / mean-variance / min-regret), а не
 * «наивно лучшее» по матожиданию.
 */
namespace maos {

using nlohmann::json;

struct OptimizeParams {
  std::string scenarioId;             // price_scenarios.id ("" → базовые цены НСИ)
  std::string objective = "cvar";     // cvar | worstcase | meanvariance | minregret
  int    samples       = 2000;        // число прогонов Монте-Карло
  double alpha         = 0.10;        // хвост для VaR/CVaR (доля худших исходов)
  double lambda        = 1.0;         // штраф за СКО в mean-variance
  unsigned seed        = 42;          // воспроизводимость
  double horizonHours  = 0;           // 0 → взять из сценария / по умолчанию
  double maxShare      = 0.6;         // макс. доля одного изделия в выручке портфеля
                                      // («не ставить всё на одно» → диверсификация)
};

/**
 * Запускает оптимизацию, ПЕРСИСТИТ результат (optimization_runs, portfolios,
 * portfolio_items, plans, plan_tasks) и возвращает полный JSON-результат:
 * робастный и ожидаемо-лучший портфели, их метрики риска, гистограмму прибыли,
 * загрузку ресурсов, разбивку по изделиям и «цену устойчивости».
 */
json run_optimization(Database& db, const OptimizeParams& p);

}  // namespace maos
