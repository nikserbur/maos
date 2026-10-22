#pragma once
/**
 * Ядро Стадии 1, общее для run_schedule (Scheduler.cpp) и событийной среды SimEnv
 * (волна A, METHODOLOGY-V2 §7, §11.2): модель НСИ, развёртка программы в граф джобов,
 * календари, розыгрыш длительностей, ключи диспетч-правил и ШАГ РАЗМЕЩЕНИЯ
 * списочного планирования (sim_place). Определения — в Scheduler.cpp: SimEnv не
 * дублирует simulate(), а переиспользует тот же объектный код (тест эквивалентности
 * test_simenv.cpp). Время — минуты от начала горизонта; день 0 = Пн 00:00.
 */
#include "Database.h"
#include "PlanMath.h"
#include <nlohmann/json.hpp>
#include <array>
#include <cmath>
#include <random>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace maos::sched {

using nlohmann::json;

double num(const json& j, const char* k, double def = 0);
std::string str(const json& j, const char* k);

/* ── Рабочий календарь: операции «растягиваются» через нерабочие интервалы ──
   Время — минуты от начала горизонта; день 0 = Пн 00:00. */
struct Calendar {
  std::array<std::vector<std::pair<int,int>>, 7> day;   // dow(0=Пн..6=Вс) → [start,end] мин дня
  bool any = false;
  // Ближайшая рабочая абсолютная минута ≥ t.
  double nextWork(double t) const {
    if (!any) return t;
    for (int g = 0; g < 21; ++g) {
      long abs = (long)std::floor(t); int dow = (int)(((abs / 1440) % 7 + 7) % 7); int mod = (int)(abs % 1440);
      for (auto& [s, e] : day[dow]) { if (mod < s) return (double)((abs / 1440) * 1440 + s); if (mod < e) return t; }
      t = (double)(((abs / 1440) + 1) * 1440);          // следующий день
    }
    return t;
  }
  // Финиш после накопления `work` рабочих минут начиная с t (с учётом нерабочих окон).
  double advance(double t, double work) const {
    if (!any) return t + work;
    t = nextWork(t); double rem = work;
    for (int g = 0; g < 4000 && rem > 1e-9; ++g) {
      long abs = (long)std::floor(t); int dow = (int)(((abs / 1440) % 7 + 7) % 7); int mod = (int)(abs % 1440);
      int end = -1; for (auto& [s, e] : day[dow]) if (mod >= s && mod < e) { end = e; break; }
      if (end < 0) { t = nextWork(t); continue; }
      double avail = (double)((abs / 1440) * 1440 + end) - t;
      if (avail >= rem) return t + rem;
      rem -= avail; t = nextWork((double)((abs / 1440) * 1440 + end));
    }
    return t;
  }
};

// Рабочих минут в [0, makespan] (фонд времени для загрузки/простоя ресурса).
double working_span(const Calendar& cal, double makespan);
Calendar load_calendar(Database& db, bool enabled);
/* Индивидуальный график станка ('8x5' | '12x2' | '24x7'); false → общий календарь. */
bool machine_calendar(std::string sched, Calendar& c);

/* ── Доменные структуры ──────────────────────────────────────────────────── */
struct Op {
  std::string id, name, wcType;                        // wcType = ведущий (для отчётов)
  std::vector<std::string> wcTypes;                    // ВСЕ допустимые типы (FJSP)
  double tExp = 0, sigma = 0, setupTime = 0, riskCoef = 0.05;
  double hourRate = 0, laborRate = 0, tailWeight = 0.08, tailIndex = 2.5;
  int orderNo = 10;
  std::vector<std::pair<std::string,double>> inputs;  // (productId, qty)
  std::vector<std::pair<std::string,double>> tByType; // норма на типе, мин (FJSP-бенчмарки; пусто → tExp)
};
struct Prod { double batchSize = 1, stock = 0, leadHours = 0; bool purchased = false; };

struct WorkerInfo {
  std::string id, name;
  std::vector<std::string> skills;   // токены компетенций (имена/ID типов РЦ), lowercase
  double costPerHour = 0;
};

struct Model {
  std::unordered_map<std::string, Prod> prods;
  std::unordered_map<std::string, std::vector<Op>> opsOf;                 // product → ops
  std::unordered_map<std::string, std::vector<std::string>> machinesOf;  // wcType → machineIds
  std::unordered_map<std::string, std::string> machineName, machineWct, wcName, prodName;
  std::unordered_map<std::string, std::string> machineSched;             // станок → график ('8x5'…)
  // Надёжность/обслуживание по ТИПУ: MTBF (ч, при полной загрузке), средний
  // ремонт (ч), интервал ТО по наработке (ч) и длительность ТО (ч).
  struct WctRisk { double mtbf = 0, repairH = 0, mtbm = 0, maintH = 0; };
  std::unordered_map<std::string, WctRisk> wctRisk;
  std::vector<WorkerInfo> workers;
  // Матрица компетенций: тип РЦ → индексы допущенных рабочих (пусто = любой).
  std::unordered_map<std::string, std::vector<int>> eligibleWorkers;
};

Model load_model(Database& db);

/* ── Развёртка программы в граф операций (jobs) ───────────────────────────── */
struct Job {
  int orderIdx; std::string productId, opId, opName, wcType;
  std::vector<std::string> wcTypes;                    // допустимые типы станков (FJSP)
  double durMean, sigma, riskCoef, tailWeight, tailIndex, hourRate, laborRate, dueMin;
  double setupTime = 0;                                // наладка при смене изделия на станке
  double batches = 1;                                  // партий (batch_size) в этой джобе
  int nInputs = 0;                                     // входных материалов у операции
  bool needsWorker = true;                             // B3: false у «поставки» (только lead time)
  std::vector<int> preds;
  // SimEnv (волна A): норма на КАЖДОМ допустимом типе (мин; пусто → durMean для всех) и
  // «не раньше» запуска заказа (сдвиг даты запуска L2). Для simulate() — нейтральны.
  std::vector<std::pair<std::string,double>> durByType;
  double releaseMin = 0;
  int batchIdx = 0, nBatchesOf = 1;                    // k-я из N transfer-партий (CRN по идентичности)
};

struct Expander {
  const Model& m; std::vector<Job>& jobs;
  std::unordered_set<std::string> visiting;                    // защита от циклов BOM
  // Структурные ходы SimEnv (волна A, §7.3) — необязательные переопределения; nullptr →
  // поведение run_schedule без изменений.
  const std::unordered_map<std::string,int>* batchOverride = nullptr;                 // изделие → N партий
  const std::unordered_map<std::string,std::vector<Op>>* opsOverride = nullptr;       // изделие → альтернативная техкарта
  const std::unordered_map<std::string,std::pair<double,double>>* outsourced = nullptr; // изделие → (lead мин, σ мин): «купить вместо сделать»
  const std::unordered_map<std::string,std::string>* forcedType = nullptr;            // opId → назначенный тип РЦ

  // Число transfer-партий = ОБЪЁМ / РАЗМЕР ПАРТИИ изделия (sizeFactor = mult/batchSize):
  // каждая партия проходит операции и сразу «течёт» к следующей на свободном станке.
  // Ограничено 30 для трактуемости (при большем — одна джоба = несколько партий).
  static int nBatches(double sizeFactor) {
    int n = (int)std::lround(sizeFactor);
    return std::max(1, std::min(16, n));   // потолок для трактуемости/скорости планирования
  }

  // Возвращает batch-джобы ПОСЛЕДНЕЙ операции изделия (для побатчевой стыковки с потребителем).
  // B2: каждое потребление раскрывается СВОЕЙ партией ровно на свой объём `mult`.
  // Раньше результат запоминался по ключу «заказ#изделие», и второе потребление того же
  // полуфабриката в заказе (другая операция/ветка BOM) повторно использовало первую
  // развёртку — с ЕЁ объёмом: работа второго потребления терялась.
  std::vector<int> expand(int orderIdx, const std::string& pid, double mult, double dueMin, int depth = 0) {
    if (depth > 64) return {};
    std::string key = std::to_string(orderIdx) + "#" + pid;
    if (visiting.count(key)) return {};                       // цикл цепочки
    // Аутсорсинг (L2): полуфабрикат не изготавливается — одна «поставка» со сроком поставщика.
    if (outsourced && outsourced->count(pid)) {
      const auto& [leadMin, sigMin] = outsourced->at(pid);
      Job j; j.orderIdx = orderIdx; j.productId = pid; j.opId = "outsource"; j.opName = "Аутсорсинг: " + pid;
      j.durMean = std::max(1.0, leadMin); j.sigma = sigMin; j.riskCoef = 0.05; j.tailWeight = 0.12; j.tailIndex = 2.0;
      j.hourRate = 0; j.laborRate = 0; j.dueMin = dueMin; j.needsWorker = false; j.batches = mult;
      jobs.push_back(j); return { (int)jobs.size() - 1 };
    }
    const std::vector<Op>* opsPtr = nullptr;
    if (opsOverride && opsOverride->count(pid)) opsPtr = &opsOverride->at(pid);
    else if (auto oit = m.opsOf.find(pid); oit != m.opsOf.end()) opsPtr = &oit->second;
    if (!opsPtr || opsPtr->empty()) return {};
    visiting.insert(key);
    double batch = m.prods.count(pid) ? m.prods.at(pid).batchSize : 1;
    double sizeFactor = std::max(1.0, mult / batch);
    int N = (jobs.size() > 4000) ? 1 : nBatches(sizeFactor);   // защита от взрыва числа джобов
    if (batchOverride && batchOverride->count(pid))             // L2: дробление/слияние партий
      N = std::max(1, std::min(16, std::min(batchOverride->at(pid), (int)std::ceil(sizeFactor))));

    std::vector<int> prevBatch;                               // batch-джобы предыдущей операции
    for (const Op& o : *opsPtr) {
      // Входы BOM — раскрыть один раз; стыкуем ПОБАТЧЕВО (партия k ← партия входа).
      std::vector<std::vector<int>> ins;
      for (auto& [q, qty] : o.inputs) {
        auto v = expand(orderIdx, q, mult * qty, dueMin, depth + 1);
        if (!v.empty()) ins.push_back(v);
      }
      std::vector<int> curBatch(N);
      for (int k = 0; k < N; ++k) {
        Job j; j.orderIdx = orderIdx; j.productId = pid; j.opId = o.id; j.opName = o.name;
        j.wcType = o.wcType; j.wcTypes = o.wcTypes;
        j.batchIdx = k; j.nBatchesOf = N;
        for (auto& [t, mean] : o.tByType) j.durByType.push_back({ t, mean * sizeFactor / N });
        if (forcedType && forcedType->count(o.id)) {           // L2: назначение типа РЦ/станка
          j.wcType = forcedType->at(o.id); j.wcTypes = { j.wcType };
        }
        j.durMean = o.tExp * sizeFactor / N;          // работа делится по партиям
        j.batches = sizeFactor / N;                   // масштаб джобы (для калибровки НСИ)
        j.setupTime = o.setupTime;                    // наладка — в simulate при смене изделия
        j.sigma = o.sigma * std::sqrt(std::max(1.0, sizeFactor / N));
        j.riskCoef = o.riskCoef; j.tailWeight = o.tailWeight; j.tailIndex = o.tailIndex;
        j.nInputs = (int)o.inputs.size();
        j.hourRate = o.hourRate; j.laborRate = o.laborRate; j.dueMin = dueMin;
        if (!prevBatch.empty()) j.preds.push_back(prevBatch[k]);              // тот же batch пред. операции
        // B1: партия k ждёт ПОСЛЕДНЮЮ нужную ей входную партию ⌈(k+1)·L/N⌉−1
        // (раньше — первую, k·L/N: при L>N потребитель стартовал раньше входов).
        for (auto& v : ins) j.preds.push_back(v[planmath::lot_input_index(k, N, (int)v.size())]);
        curBatch[k] = (int)jobs.size(); jobs.push_back(j);
      }
      prevBatch = std::move(curBatch);
    }
    visiting.erase(key); return prevBatch;
  }
};

/** PERT→логнормаль + хвост Парето + переделка (CRN: одинаковые розыгрыши для всех правил). */
double sample_dur(const Job& j, double twOverride, std::mt19937& rng);

using CustomRule = std::vector<std::pair<std::string,double>>;

/** Ключи приоритетов диспетч-правила (меньше — раньше): SPT|LPT|EDD|CR|MWKR|MS|FIFO|CUSTOM. */
std::vector<double> priorities(const std::string& rule, const std::vector<Job>& jobs,
                               const std::vector<double>& orderWork,
                               const CustomRule& custom = {});

/* ── Симуляция (списочное планирование) ───────────────────────────────────── */
struct SimOut {
  std::vector<double> start, end; std::vector<std::string> machineId; std::vector<int> worker;
  double makespan = 0;
  int nSetups = 0; double setupMinutes = 0, setupCost = 0;   // переналадки при смене изделия
  int nBreakdowns = 0; double breakdownMinutes = 0, maintMinutes = 0;   // поломки и плановое ТО
  std::unordered_map<std::string,double> busyByMachine; std::vector<double> busyByWorker;
  // По джобам: наладка и простой (ТО + ремонт), мин — для единой загрузки (B9):
  // продуктивное время = обработка, а наладка и простой учитываются отдельно.
  std::vector<double> setupJ, downJ;
};

using PinMap = std::unordered_map<int, std::pair<double, std::string>>;  // jobIdx → (startMin, machineId)

/** Состояние списочного планирования между шагами размещения (simulate / SimEnv). */
struct SimState {
  SimOut out;
  std::unordered_map<std::string,double> mFree;            // станок → освобождается, мин
  std::vector<double> wFree;                               // рабочий → освобождается, мин
  std::unordered_map<std::string,std::string> lastProd;    // станок → последнее изделие (наладки)
  std::unordered_map<std::string,double> usage;            // станок → наработка, мин (ТО/поломки)
  std::vector<int> predLeft;                               // неразмещённых предшественников
  std::vector<std::vector<int>> succ;
  std::vector<char> done; size_t nDone = 0;
};

/** Результат одного размещения. */
struct Placement {
  std::string machineId; int worker = -1;
  double start = 0, end = 0, setup = 0, downtime = 0, proc = 0;
};

void sim_init(SimState& st, const Model& m, const std::vector<Job>& jobs);

/** Разместить джобу best как можно раньше (ядро simulate): станок — least-loaded среди
 *  допустимых типов, либо forcedMachine (решение агента); notBefore — момент события
 *  (событийный режим SimEnv). rng = nullptr → без случайных поломок. */
Placement sim_place(SimState& st, const Model& m, const std::vector<Job>& jobs, int best,
                    const std::vector<double>& dur, const Calendar& cal,
                    const std::unordered_map<std::string, Calendar>& calByM,
                    const PinMap& pins, std::mt19937* rng,
                    const std::string& forcedMachine = std::string(), double notBefore = 0.0);

/** Списочное планирование по ключу (серийная схема): pop min-key из готовых → sim_place. */
SimOut simulate(const Model& m, const std::vector<Job>& jobs,
                const std::vector<double>& key, const std::vector<double>& dur,
                const Calendar& cal,
                const std::unordered_map<std::string, Calendar>& calByM,
                const PinMap& pins, std::mt19937* rng = nullptr);

double order_tardiness(const std::vector<Job>& jobs, const SimOut& o, int nOrders,
                       const std::vector<double>& due, int& nLate);
double cvar_upper(std::vector<double> v, double alpha);   // среднее ХУДШИХ (больших) alpha
double mean_of(const std::vector<double>& v);

}  // namespace maos::sched
