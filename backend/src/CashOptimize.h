#pragma once
/**
 * Связка Стадии 2 с денежным слоем (волна F): по ТЕМ ЖЕ сценариям цен/себестоимостей
 * (общие случайные числа), что и эвристика/ExactCvar, строит CVaR-LP с кассой (CashLp),
 * решает рекурс и «график заранее», кривую цены ликвидности PoL(L) с парным бутстреп-ДИ,
 * и прогоняет решение через водопад (CashWaterfall) — P(разрыв), DSCR, тождества.
 * Параметры денег — из fin_params (Passport). Внутренний заголовок Optimizer.cpp.
 */
#include "Database.h"
#include "ExactCvar.h"
#include "Optimizer.h"
#include <nlohmann/json.hpp>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace maos {

struct CashInputs {
  std::vector<std::string> sellables;
  std::vector<std::vector<std::pair<std::string,double>>> hpu;   // [s] → (тип, ч/ед.)
  std::unordered_map<std::string, double> cap;                    // тип → фонд, ч
  std::vector<std::vector<double>> price, cost, price2, cost2;    // N×S (+ OOS)
  std::vector<exact::Market> market;
  std::vector<double> upper, batch, meanPrice, matShare;          // m_s — материальная доля себестоимости
  double maxShare = 1.0;
  bool   enforceShare = false;
  double horizonHours = 720;
};

nlohmann::json cash_compare(Database& db, const CashInputs& in, const OptimizeParams& p);

}  // namespace maos
