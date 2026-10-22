#pragma once
#include "Database.h"
#include <nlohmann/json.hpp>
#include <string>
#include <unordered_map>

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
  double volatility    = 0.06;        // волатильность сценария → МУЛЬТИПЛИКАТОР ширины распределений
  double demand        = 1.0;         // сценарный множитель СПРОСА → масштабирует ёмкость рынка
  // Инвест-what-if: временная докупка станков (wc_type_id → +N) для оценки
  // окупаемости. Прибавляется к machineCount типа → растёт мощность. Не пишет в БД.
  std::unordered_map<std::string, int> machineBonus;
  // Точная модель (Rockafellar–Uryasev LP, HiGHS) по ТЕМ ЖЕ сценариям, что эвристика:
  // добавляет в ответ объект "exact" (эвристический результат не меняется).
  bool   compareExact   = false;
  std::string exactCriterion;         // "" → по objective; cvar | expected | worst(case)
  int    exactSegments  = 16;         // мин. число отрезков PWL на криволинейный участок
  // R5 (воспроизводимость): поправка мощности из stage1_feedback применяется ТОЛЬКО явно;
  // по умолчанию /api/optimize не зависит от истории расписаний. Хэш фидбэка пишется в прогон.
  bool   applyFeedback  = false;
  // R4: хвостовая поправка мощности Стадии 2 (та же модель длительностей, что Стадия 1).
  bool   tailUplift     = true;
  // Волна F — CVaR-LP с кассой (METHODOLOGY-V2 §5.2): объект "cash_lp" в ответе.
  bool   cash           = false;
  double beta           = -1;         // уровень CVaR минимума кассы; <0 → fin_params.beta
  double lMin           = 0;          // порог ликвидности L_min; NaN → fin_params.l_min
  bool   lMinSet        = false;
  std::string financingStage = "recourse";   // recourse | first (график траншей заранее)
  int    horizonWeeks   = 0;          // 0 → fin_params.horizon_weeks → ⌈horizon_hours/168⌉
  int    cashSamples    = 0;          // 0 → fin_params.cash_samples (префикс CRN-выборки)
  std::string scheduleRefId;          // plans.id опорного расписания → профиль отгрузок φ_{s,t}
  bool   polCurve       = true;       // кривая цены ликвидности PoL(L) с бутстреп-ДИ
};

/**
 * Запускает оптимизацию, ПЕРСИСТИТ результат (optimization_runs, portfolios,
 * portfolio_items, plans, plan_tasks) и возвращает полный JSON-результат:
 * робастный и ожидаемо-лучший портфели, их метрики риска, гистограмму прибыли,
 * загрузку ресурсов, разбивку по изделиям и «цену устойчивости».
 */
json run_optimization(Database& db, const OptimizeParams& p);

}  // namespace maos
