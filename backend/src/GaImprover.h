#pragma once
#include <functional>
#include <vector>

/**
 * Стадия 1 — генетический алгоритм над вещественной хромосомой (random-key GA,
 * Bean 1994; смещённое скрещивание и элита — BRKGA, Gonçalves & Resende 2011).
 * Кодирование — забота вызывающего: функция пригодности сама декодирует
 * хромосому в ключи приоритетов и прогоняет списочное планирование (simulate).
 * Минимизирует целевую F (меньше — лучше). Функция пригодности обязана быть
 * детерминированной и потокобезопасной: особи поколения оцениваются параллельно,
 * а все случайные решения ГА принимаются в одном потоке — результат не зависит
 * от числа потоков.
 */
namespace maos {

struct GaConfig {
  int popSize = 16;
  int generations = 30;        // максимум поколений (0 — только оценка затравки)
  int elite = 2;               // лучшие переходят в следующее поколение без изменений
  int tournament = 3;          // размер турнира при отборе родителей
  double crossBias = 0.7;      // BRKGA: ген берётся у лучшего из родителей с этой вероятностью
  double mutationRate = 0.1;   // доля генов, получающих гауссов шум
  double swapRate = 0.5;       // вероятность обмена значениями двух генов у потомка
  int swapBegin = 0;           // обмен только среди генов [swapBegin, n) — однотипных
  double sigma0 = 0.05;        // σ шума в долях диапазона ключа [0,1]
  int stallGens = 6;           // ранняя остановка: столько поколений без улучшения
  double timeBudgetSec = 6.0;  // предел по времени (крупные планы)
  unsigned seed = 42;
  int threads = 0;             // 0 → std::thread::hardware_concurrency()
};

struct GaGeneration { int gen = 0; double best = 0; double mean = 0; double sigma = 0; };

struct GaResult {
  std::vector<double> bestKey;          // лучшая хромосома
  double bestScore = 0;
  double seedScore = 0;                 // F первой затравки (базовая линия — лучшее правило)
  std::vector<GaGeneration> history;    // [0] — стартовая популяция (затравки + мутанты)
  int evaluations = 0;
  int improvements = 0;                 // поколений, в которых улучшился рекорд
  bool stoppedByTime = false;
  bool stoppedByStall = false;
};

using KeyFitness = std::function<double(const std::vector<double>&)>;

/// seeds — стартовые хромосомы одной длины (например, все диспетч-правила; первой —
/// базовая линия). Возвращает лучшую найденную хромосому (затравка тоже кандидат).
GaResult run_key_ga(const std::vector<std::vector<double>>& seeds,
                    const KeyFitness& fitness, const GaConfig& cfg);

}  // namespace maos
