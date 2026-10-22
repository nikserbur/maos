#pragma once
/**
 * Событийная среда Стадии 1 для агентов L0/L2 (волна A; METHODOLOGY-V2 §7, §11.2; A4 §3).
 *
 * Чистый модуль (БД — только в instance_from_db). Поверх ядра SchedCore (та же Model/Job/
 * Expander/sample_dur/sim_place, что и run_schedule — simulate() не дублируется):
 *
 *   reset(seed, scenario) → эпизод = один сценарий i (длительности, поломки, макро-путь,
 *   дефолт покупателя — общие случайные числа по ИДЕНТИЧНОСТИ джобы: заказ/операция/партия,
 *   а не по индексу, так что структурный ход одного заказа не меняет розыгрыши других).
 *
 *   Моменты решения:
 *   - L0 (диспетчер типа РЦ, mean-field): станок освободился → выбрать операцию из
 *     маскированной очереди (≤ kMaxCands слотов) или WAIT; маски — предшествование и
 *     входы (по построению: кандидат = все предшественники завершены К МОМЕНТУ события),
 *     допустимый тип, станок не в ремонте/ТО, свободный допущенный рабочий, календарь,
 *     WAIT — только если ожидается ещё событие.
 *   - L2 (планировщик) — начало каждой недели (и опционально по событию): структурные ходы
 *     волны A (развилка Р5): сдвиг запуска ±1 нед, дробление/слияние партий, аутсорсинг
 *     полуфабриката, альтернативная техкарта, назначение типа РЦ операции, транш/погашение.
 *     Ходы допустимы только для НЕ начатых заказов; маски — §7.3. Ходы, для которых нет НСИ
 *     (нет альтернативных техкарт / предложений поставщиков), маскируются полностью.
 *   - Серийный режим (EpochMode::Serial): эпохи = размещения в порядке simulate(); политика
 *     «ключ правила» воспроизводит simulate() ПОБИТОВО (тест эквивалентности).
 *
 *   Награда: плотная L2D-типа для L0 (−ΔLB(Cmax) − c_T·Δ оценки просрочки − c_S·наладка) и
 *   терминальная кооперативная (прибыль и минимум кассы по недельному водопаду CashWaterfall,
 *   штраф за разрыв/ковенант). CVaR-перевзвешивание эпизодов по CRN-пакету — на стенде (Python).
 *   Все константы — с кодами паспорта rl.* (Passport.cpp).
 */
#include "CashWaterfall.h"
#include "SchedCore.h"
#include <cstdint>
#include <deque>
#include <map>
#include <queue>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace maos::env {

using nlohmann::json;
using sched::Calendar;
using sched::Job;
using sched::Model;
using sched::Op;

constexpr double kWeekMin = 7.0 * 24.0 * 60.0;   // неделя, мин (период кассы — развилка Р1)

/** Заказ программы (НСИ demand_orders + экономика изделия). */
struct OrderSpec {
  std::string productId;
  double qty = 1;
  double dueMin = 0;          // срок, мин от начала горизонта (0 → синтетический, как run_schedule)
  double releaseMin = 0;      // самая ранняя дата запуска
  int    priority = 5;
  double price = 0;           // цена за единицу без НДС (base_price)
  double matCost = 0;         // материальная себестоимость единицы (по BOM, base_cost покупных)
};

/** Экземпляр задачи: модель НСИ + программа + календари + альтернативы для L2. */
struct Instance {
  std::string name = "instance";
  Model model;
  std::vector<OrderSpec> orders;
  Calendar cal;                                           // общий календарь (any=false → 24×7)
  std::unordered_map<std::string, Calendar> calByM;       // индивидуальные графики станков
  // Альтернативные техкарты (routings.is_default=0): изделие → список (routing_id, операции).
  std::unordered_map<std::string, std::vector<std::pair<std::string, std::vector<Op>>>> altRoutings;
  // Предложения аутсорсинга [К] (§7.3в: таблицы outsourcing_offers нет → цена = себестоимость × markup,
  // срок leadHours одинаков для всех полуфабрикатов; пусто/0 → ход маскирован).
  double outsourceLeadHours = 0;
  double outsourceMarkup = 1.3;
  double outsourcePrepay = 0.5;
  cash::FinParams fin;                                    // параметры водопада (fin_params)
  double payrollFixedWeekly = 0, repairBudgetWeekly = 0, otherFixedWeekly = 0;
  double tailWeight = -1;                                 // <0 → из операций
};

Instance instance_from_json(const json& j);
json     instance_to_json(const Instance& inst);
/** Экземпляр из БД проекта: программа (пусто → demand_orders), календари, экономика, альтернативы. */
Instance instance_from_db(Database& db, const std::vector<std::pair<std::string,double>>& program,
                          const std::vector<double>& dueHours, bool useCalendar);

/** Внешние условия сценария i (из MacroSampler / стенда; пусто → плат по fin_params). */
struct Scenario {
  int idx = 0;
  std::vector<double> keyRate, fx, cpi;    // по неделям
  std::vector<int> regime;                 // режим HMM по неделям (−1 → нет)
  int    defaultWeek = -1;                 // дефолт крупнейшего покупателя
  double lgd = 0;
  double leadMul = 1.0;                    // стресс: задержки поставок × leadMul
  double priceMul = 1.0;                   // стресс цен сбыта
  static Scenario from_json(const json& j);
};

enum class EpochMode { Event = 0, Serial = 1 };

struct EnvConfig {
  EpochMode mode = EpochMode::Event;
  int  kMaxCands = 16;          // слотов кандидатов L0 [К] rl.k_max_cands
  int  kMaxOrders = 16;         // слотов заказов в наблюдении L2 [К] rl.k_max_orders
  int  kMaxWct = 32;            // слотов типов РЦ в наблюдении L2 [К] rl.k_max_wct
  int  horizonWeeks = 26;       // горизонт кассы [К] rl.horizon_weeks
  bool l2Enabled = false;       // недельные эпохи L2
  int  maxMovesPerWeek = 3;     // ходов L2 за эпоху [К] rl.max_moves_per_week
  bool breakdowns = true;       // случайные поломки (ТО — всегда)
  bool deterministic = false;   // длительности = средние (эталон/CP-SAT/тест эквивалентности)
  bool denseReward = true;
  // Веса награды [К] rl.reward.*
  double cTard = 1.0, cSetup = 0.5, wProfit = 1.0, wCash = 1.0, lambdaBreach = 1.0;
  double tardPenaltyPerWeek = 0.01, tardPenaltyCap = 0.2;   // штраф за просрочку, доля стоимости заказа/нед [К]
  double repairCostMul = 1.0;   // стоимость ремонта = часы × ставка типа × mul [К]
  double waitWindowMin = 240;   // WAIT допустим, только если ближайшее завершение ≤ Δ мин [К] rl.wait_window (§7.3а)
  double cWait = 0.5;           // явная цена простоя при WAIT: c_W·Δt/масштаб [К] rl.reward.c_wait
  unsigned seed = 42;
};

/** Запись структурного хода (контракт StructuralMove UX-V2 §4.7; impact — в оценщике). */
struct MoveLog {
  std::string id, kind;
  int orderIdx = -1; int week = 0;
  json before, after;
  std::vector<std::string> masksChecked;
};

struct StepResult {
  double reward = 0;
  bool done = false;
  int level = 0;                // 0 → следующая эпоха L0, 2 → L2, −1 → эпизод завершён
};

class SimEnv {
public:
  SimEnv(Instance inst, EnvConfig cfg);

  /** Новый эпизод: seed сценария (длительности/поломки/дефолт), внешние условия. */
  void reset(uint64_t seed, const Scenario& sc = Scenario{});
  StepResult step(int action);              // действие текущей эпохи (L0: слот|WAIT; L2: код хода)
  StepResult step_job(int jobIdx);          // L0: конкретная джоба из ПОЛНОГО списка готовых (правила/replay)

  bool done() const { return done_; }
  int  level() const { return level_; }     // 0 | 2 | −1
  double now() const { return now_; }
  int  epoch_machine() const { return curMachine_; }

  // Наблюдения и маски (фиксированной размерности).
  const std::vector<float>& obs_l0() const { return obsL0_; }
  const std::vector<uint8_t>& mask_l0() const { return maskL0_; }
  const std::vector<float>& obs_l2() const { return obsL2_; }
  const std::vector<uint8_t>& mask_l2() const { return maskL2_; }
  int obs_l0_size() const { return cfg_.kMaxCands * kCandFeats + kMachFeats + kPoolFeats + kGlobFeats; }
  int act_l0_size() const { return cfg_.kMaxCands + 1; }   // + WAIT
  int obs_l2_size() const { return cfg_.kMaxOrders * kOrderFeats + cfg_.kMaxWct + kFinFeats; }
  int act_l2_size() const { return 1 + kMoveKinds * cfg_.kMaxOrders + kFinActs; }

  /** Готовые кандидаты текущей эпохи (полный список, индексы джоб) и слот → джоба. */
  const std::vector<int>& candidates() const { return cands_; }
  int rule_choice(const std::string& rule) const;         // argmin ключа правила по кандидатам
  int key_choice(const std::vector<double>& key) const;   // argmin произвольного ключа (ГА/CUSTOM)
  int rule_slot(const std::string& rule) const;           // то же, но слот действия (или WAIT, если вне слотов)
  std::string describe_l2(int action) const;

  json summary() const;                                    // KPI эпизода + финансы + ходы
  json gantt() const;
  const std::vector<Job>& jobs() const { return jobs_; }
  const Instance& instance() const { return inst_; }
  const EnvConfig& config() const { return cfg_; }
  const std::vector<MoveLog>& moves() const { return moves_; }
  double lower_bound() const { return lbCmax_; }
  int    n_decisions() const { return nDecisions_; }

  static constexpr int kCandFeats = 12, kMachFeats = 4, kPoolFeats = 4, kGlobFeats = 6;
  static constexpr int kOrderFeats = 8, kFinFeats = 12;
  static constexpr int kMoveKinds = 7, kFinActs = 5;
  static const char* const kMoveKindNames[kMoveKinds];

private:
  struct OrderState {
    int    nBatches = 0;              // 0 → по умолчанию (Expander::nBatches)
    int    shiftWeeks = 0;
    int    routingAlt = -1;           // −1 → действующая техкарта
    std::set<std::string> outsourced; // полуфабрикаты, купленные вместо изготовления
    std::map<std::string,std::string> forcedType;   // opId → тип
    bool   started = false;
    double startMin = -1, finishMin = -1;
    int    jobBegin = 0, jobEnd = 0;
  };
  struct Event { double t; int kind; int id; bool operator>(const Event& o) const {
    return t != o.t ? t > o.t : (kind != o.kind ? kind > o.kind : id > o.id); } };

  Instance inst_; EnvConfig cfg_;
  std::vector<Job> jobs_; sched::SimState st_;
  std::vector<double> dur_;                 // розыгрыш длительностей сценария (по идентичности)
  std::vector<std::string> machineIds_; std::unordered_map<std::string,int> machineIdx_;
  std::vector<std::string> wctIds_; std::unordered_map<std::string,int> wctIdx_;
  std::vector<OrderState> ord_; std::vector<double> due_;
  std::vector<double> orderWork_;
  std::unordered_map<std::string, std::vector<double>> keyByRule_;
  std::vector<int> topo_;
  uint64_t seed_ = 0; Scenario sc_;
  // Событийный режим.
  std::priority_queue<Event, std::vector<Event>, std::greater<Event>> events_;
  std::vector<char> idle_, pollPending_; std::vector<double> readyAt_, finishAt_;
  double now_ = 0; bool done_ = false; int level_ = 0; int curMachine_ = -1;
  std::vector<int> cands_; std::vector<int> slotJob_;
  std::vector<float> obsL0_, obsL2_; std::vector<uint8_t> maskL0_, maskL2_;
  int nDecisions_ = 0, nWait_ = 0, nPlaced_ = 0;
  int week_ = 0, movesThisWeek_ = 0; bool inL2_ = false;
  double lbCmax_ = 0, tardEst_ = 0, scaleT_ = 1, scaleMoney_ = 1;
  double lastSetup_ = 0;
  // Финансы по неделям.
  std::vector<cash::PeriodInput> weekly_;
  std::vector<double> drawPlan_, repayPlan_;
  cash::ScenarioResult cashRes_; bool cashValid_ = false;
  std::vector<MoveLog> moves_; int moveSeq_ = 0;
  double pendingReward_ = 0;

  // Построение.
  void rebuild_jobs(const std::vector<char>* keepDone = nullptr);
  void draw_durations();
  std::mt19937 job_rng(int j, uint32_t stream) const;
  void init_events();
  bool advance();                        // → true если найдена эпоха решения (L0/L2); false → эпизод завершён
  void place_job(int j, const std::string& machineId, double notBefore);
  void auto_place_ready_supply(int j);
  void collect_candidates(int mIdx);
  void build_obs_l0();
  void build_obs_l2();
  void update_bounds();
  double dense_delta();
  void finish_episode();
  void on_job_done(int j);
  void book_order_start(int k, double t);
  void book_order_finish(int k, double t);
  void book_week_fixed();
  cash::ScenarioResult run_cash(int weeks) const;
  // L2.
  bool apply_move(int action, std::string& why);
  bool move_allowed(int kind, int k) const;
  int  next_week_events();
  double order_cycle_min(int k) const;
  std::string largest_semi_input(int k) const;
  std::string bottleneck_op_of(int k, std::string& altType) const;
  std::pair<double,double> cash_state() const;   // (касса, невыбранный лимит) на текущую неделю
};

/** Правило на одном сценарии — базовая линия стенда. */
json evaluate_rule(SimEnv& env, const std::string& rule, uint64_t seed, const Scenario& sc);
/** Эпизод по произвольному ключу приоритетов (длина = число джоб). */
json evaluate_key(SimEnv& env, const std::vector<double>& key, uint64_t seed, const Scenario& sc);
/** ГА по ключам (та же хромосома, что GaImprover в run_schedule: 5 весов критериев + сдвиг
 *  приоритета заказа); пригодность — среднее (Cmax + 0.5·просрочка) по сценариям seed0..seed0+nScen−1 (CRN).
 *  Возвращает лучший ключ, историю и оценку. */
json ga_improve(const SimEnv& env, int generations, int nScen, uint64_t seed0, double timeBudgetSec,
                const std::vector<std::string>& seedRules);

}  // namespace maos::env
