#include "GaImprover.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <exception>
#include <numeric>
#include <random>
#include <thread>

namespace maos {

namespace {

using Clock = std::chrono::steady_clock;

// Оценка особей с need[i]=1 пулом потоков. Порядок оценки не влияет на результат:
// пригодность детерминирована, а случайные решения ГА — вне этой функции.
void evaluate_all(const std::vector<std::vector<double>>& pop, std::vector<double>& score,
                  const std::vector<char>& need, const KeyFitness& fit, int threads) {
  std::vector<size_t> todo;
  for (size_t i = 0; i < pop.size(); ++i) if (need[i]) todo.push_back(i);
  const size_t T = std::min<size_t>(static_cast<size_t>(std::max(1, threads)), todo.size());
  if (T <= 1) { for (size_t i : todo) score[i] = fit(pop[i]); return; }
  std::atomic<size_t> next{ 0 };
  std::exception_ptr err;
  std::atomic<bool> failed{ false };
  auto worker = [&] {
    try {
      for (size_t k; !failed && (k = next.fetch_add(1)) < todo.size();)
        score[todo[k]] = fit(pop[todo[k]]);
    } catch (...) {
      if (!failed.exchange(true)) err = std::current_exception();
    }
  };
  std::vector<std::thread> pool;
  pool.reserve(T);
  for (size_t t = 0; t < T; ++t) pool.emplace_back(worker);
  for (auto& th : pool) th.join();
  if (err) std::rethrow_exception(err);
}

// Мутация: гауссов шум у доли генов + (с вероятностью swapRate) обмен значениями двух
// однотипных генов — перестановочный ход, не зависящий от масштаба.
void mutate(std::vector<double>& k, double sigma, const GaConfig& cfg, std::mt19937& rng) {
  std::uniform_real_distribution<double> U(0.0, 1.0);
  std::normal_distribution<double> noise(0.0, sigma);
  for (double& v : k) if (U(rng) < cfg.mutationRate) v += noise(rng);
  const size_t lo = static_cast<size_t>(std::max(0, cfg.swapBegin));
  if (k.size() >= lo + 2 && U(rng) < cfg.swapRate) {
    std::uniform_int_distribution<size_t> pick(lo, k.size() - 1);
    const size_t a = pick(rng), b = pick(rng);       // порядок вызовов фиксирован
    std::swap(k[a], k[b]);
  }
}

size_t argmin(const std::vector<double>& v) {
  return static_cast<size_t>(std::min_element(v.begin(), v.end()) - v.begin());
}

double mean(const std::vector<double>& v) {
  return v.empty() ? 0.0 : std::accumulate(v.begin(), v.end(), 0.0) / static_cast<double>(v.size());
}

}  // namespace

GaResult run_key_ga(const std::vector<std::vector<double>>& seeds,
                    const KeyFitness& fitness, const GaConfig& cfg) {
  GaResult res;
  if (seeds.empty() || seeds.front().empty()) return res;
  const auto t0 = Clock::now();
  const int P = std::max(2, cfg.popSize);
  const int threads = cfg.threads > 0 ? cfg.threads
                                      : static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
  std::mt19937 rng(cfg.seed);

  // Стартовая популяция: затравки + их мутанты с удвоенным шагом.
  std::vector<std::vector<double>> pop;
  pop.reserve(P);
  for (const auto& s : seeds) {
    if (static_cast<int>(pop.size()) >= P) break;
    if (s.size() == seeds.front().size()) pop.push_back(s);
  }
  const size_t nSeeds = pop.size();
  double sigma = cfg.sigma0;
  for (size_t k = 0; static_cast<int>(pop.size()) < P; ++k) {
    std::vector<double> m = pop[k % nSeeds];
    mutate(m, sigma * 2, cfg, rng);
    pop.push_back(std::move(m));
  }
  std::vector<double> score(P);
  evaluate_all(pop, score, std::vector<char>(P, 1), fitness, threads);
  res.evaluations = P;
  res.seedScore = score[0];
  size_t bi = argmin(score);
  res.bestKey = pop[bi];
  res.bestScore = score[bi];
  if (res.bestScore < res.seedScore) ++res.improvements;   // мутант/другая затравка уже лучше
  res.history.push_back({ 0, res.bestScore, mean(score), sigma });

  const int E = std::clamp(cfg.elite, 1, P - 1);
  std::uniform_real_distribution<double> U(0.0, 1.0);
  std::uniform_int_distribution<int> pickI(0, P - 1);
  auto tournament = [&] {
    int best = pickI(rng);
    for (int t = 1; t < cfg.tournament; ++t) { const int c = pickI(rng); if (score[c] < score[best]) best = c; }
    return best;
  };

  int stall = 0;
  for (int g = 1; g <= cfg.generations; ++g) {
    const double elapsed = std::chrono::duration<double>(Clock::now() - t0).count();
    if (elapsed > cfg.timeBudgetSec) { res.stoppedByTime = true; break; }

    std::vector<int> order(P);
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return score[a] < score[b]; });

    std::vector<std::vector<double>> next;
    next.reserve(P);
    std::vector<double> nextScore(P, 0.0);
    std::vector<char> need(P, 1);
    for (int e = 0; e < E; ++e) {                         // элита — без изменений и переоценки
      next.push_back(pop[order[e]]);
      nextScore[e] = score[order[e]];
      need[e] = 0;
    }
    while (static_cast<int>(next.size()) < P) {
      int a = tournament(), b = tournament();
      if (score[b] < score[a]) std::swap(a, b);           // a — лучший родитель
      std::vector<double> child(pop[a].size());
      for (size_t i = 0; i < child.size(); ++i) child[i] = U(rng) < cfg.crossBias ? pop[a][i] : pop[b][i];
      mutate(child, sigma, cfg, rng);
      next.push_back(std::move(child));
    }
    evaluate_all(next, nextScore, need, fitness, threads);
    res.evaluations += P - E;
    pop = std::move(next);
    score = std::move(nextScore);

    bi = argmin(score);
    const double tol = 1e-12 * std::max(1.0, std::abs(res.bestScore));
    if (score[bi] < res.bestScore - tol) {               // рекорд: сужаем шаг (эксплуатация)
      res.bestScore = score[bi];
      res.bestKey = pop[bi];
      ++res.improvements;
      stall = 0;
      sigma = std::max(sigma * 0.85, cfg.sigma0 * 0.25);
    } else {                                              // застой: расширяем шаг (исследование)
      ++stall;
      sigma = std::min(sigma * 1.25, cfg.sigma0 * 2.0);
    }
    res.history.push_back({ g, res.bestScore, mean(score), sigma });
    if (stall >= cfg.stallGens) { res.stoppedByStall = true; break; }
  }
  return res;
}

}  // namespace maos
