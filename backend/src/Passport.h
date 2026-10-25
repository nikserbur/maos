#pragma once
/**
 * Паспорт параметров и финансовые параметры (METHODOLOGY-V2 §3.2, §10.2, §11.1).
 *
 * param_passport: каждому числу модели — статус (Н наблюдение / О оценка по данным /
 * К калибровка / НОРМ норматив / UI подобрано для наглядности / техн. / синтетика),
 * источник и место в коде. Решение владельца Р8: данных предприятия нет → ни один
 * внутренний параметр не имеет статуса О; калибровка не называется оценкой.
 *
 * fin_params: строка entity='default' — параметры водопада кассы (CashWaterfall) и
 * CVaR-LP с кассой (CashLp); ставки налогов хранятся с датой начала действия, не в коде.
 */
#include "CashWaterfall.h"
#include "CounterpartyRisk.h"
#include "Database.h"
#include <nlohmann/json.hpp>
#include <string>

namespace maos::passport {

using nlohmann::json;

/** Идемпотентно: создаёт/дополняет таблицы и сеет паспорт + fin_params по умолчанию. */
void migrate(Database& db);

/** Текущая строка fin_params (entity='default') как JSON (все столбцы). */
json fin_params_json(Database& db);
/** Обновление fin_params: только известные столбцы, с валидацией; возвращает новую строку. */
json save_fin_params(Database& db, const json& body);
/** Параметры водопада из fin_params. */
cash::FinParams load_fin_params(Database& db);
/** Параметры водопада из строки fin_params (JSON fin_params_json или с переопределением). */
cash::FinParams fin_params_from_json(const json& fin);
/** fin_params с переопределением на один запрос (fin_override) — без записи в БД, с той же проверкой диапазонов;
 *  неизвестный ключ → исключение. */
json fin_params_with_override(Database& db, const json& override);
/** CPR: параметры fin.cp.* из fin_params.counterparty (+ переопределение запроса), с проверкой диапазонов. */
cpr::CpParams counterparty_params(const json& fin, const json& requestOverride);

/** Список паспорта (все параметры) — GET /api/passport. */
json passport_list(Database& db);
/** Обновить статус/источник/значение одной записи — PUT /api/passport/:code. */
json passport_update(Database& db, const std::string& code, const json& body);
/** Числовое значение записи паспорта (волна M: эластичности pass-through macro.*); def — если нет/не число. */
double number(Database& db, const std::string& code, double def);

}  // namespace maos::passport
