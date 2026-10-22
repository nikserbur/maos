#pragma once
/**
 * Правило «RL» Стадии 1 (волна A, RL-METHODOLOGY-PROPOSAL §8 п.3; METHODOLOGY-V2 §11.2 RlRule):
 * политика L0 (и, если есть, L2) из ONNX (rl/train/export_onnx.py) через ONNX Runtime.
 *
 *   - Политика L0 прогоняется в событийной SimEnv по средним длительностям → порядок стартов
 *     операций → КЛЮЧ ПРИОРИТЕТОВ (ранг старта) для run_schedule: дальше работает тот же конвейер
 *     (Ганта, Монте-Карло по CRN, ГА-дошлифовка по желанию). Путь EDD/SPT/… не меняется.
 *   - Политика L2 (если загружена) даёт структурные ходы; их эффект «до/после» считается на N
 *     сценариях (CRN) в SimEnv и отдаётся как `moves` по контракту StructuralMove (UX-V2 §4.7).
 *   - Без onnxruntime (MAOS_WITH_ONNX=0) или без файла политики available()=false, и
 *     run_schedule(rule="RL") возвращает понятную ошибку error_soft.
 *
 * Поиск политики: $MAOS_RL_POLICY_DIR → rl/results → ../rl/results → backend/data (файлы
 * l0_policy.onnx [+ .json], l2_policy.onnx [+ .json]).
 */
#include "Database.h"
#include "SimEnv.h"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace maos::rl {

using nlohmann::json;

/** Загрузка политик при старте сервера (идемпотентно; ошибки — в status()). */
void load_default();
bool available();            // L0 загружена и исполняема
bool l2_available();
json status();               // GET /api/rl/status

/** Маскированный argmax логитов политики уровня level (0|2). −1 → политики нет. */
int act(int level, const std::vector<float>& obs, const std::vector<uint8_t>& mask);

struct RlPlan {
  bool ok = false; std::string error;
  std::vector<double> key;   // ключ приоритетов для simulate(): ранг старта в RL-расписании
  json moves;                // MovesResult (UX-V2 §4.7) или null
  json rlEval;               // сводка RL в SimEnv: Cmax/просрочка по средним, MC по сценариям
};

/** План политикой RL для программы run_schedule (те же джобы: та же развёртка Expander). */
RlPlan plan(Database& db, const std::vector<std::pair<std::string,double>>& program,
            const std::vector<double>& dueHours, bool useCalendar, unsigned seed, int nScen, double alpha);

}  // namespace maos::rl
