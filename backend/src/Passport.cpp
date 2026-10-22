#include "Passport.h"
#include <algorithm>
#include <stdexcept>

namespace maos::passport {
namespace {

std::string jstr(const json& j, const std::string& k) {
  if (!j.contains(k) || j[k].is_null()) return "";
  if (j[k].is_string()) return j[k].get<std::string>();
  return j[k].dump();
}
double jnum(const json& j, const std::string& k, double def) {
  const std::string s = jstr(j, k);
  if (s.empty()) return def;
  try { return std::stod(s); } catch (...) { return def; }
}

/* Запись паспорта: code, block, name, value, unit, status, source, file_ref. */
struct Row { const char *code, *block, *name, *value, *unit, *status, *source, *file; };

/* Финансовые параметры (fin_params) — статусы по §10.2; Р8: данных предприятия нет. */
const Row kFinance[] = {
  { "fin.c0", "деньги", "Касса на начало горизонта (ед. = ед. цен НСИ)", "0", "₽", "К", "баланса предприятия нет → 0", "fin_params.c0" },
  { "fin.c_min", "деньги", "Порог кассы правила выборки транша", "0", "тыс. ₽", "К", "§4.3 п.8", "fin_params.c_min" },
  { "fin.credit_limit", "деньги", "Лимит кредитной линии (ед. = ед. цен НСИ)", "20000000", "₽", "К", "договора нет; масштаб демо-стенда", "fin_params.credit_limit" },
  { "fin.key_rate", "деньги", "Ключевая ставка (константа до волны M)", "0.16", "год.", "НОРМ", "cbr.ru на дату расчёта; волна M → MacroSampler", "fin_params.key_rate" },
  { "fin.spread", "деньги", "Спред линии над ключевой", "0.03", "год.", "НОРМ", "типовые условия", "fin_params.spread" },
  { "fin.overdraft_spread", "деньги", "Штрафной спред овердрафта", "0.10", "год.", "НОРМ", "типовые условия", "fin_params.overdraft_spread" },
  { "fin.overdraft_limit", "деньги", "Лимит овердрафта (0 → невозможен)", "0", "тыс. ₽", "НОРМ", "договора нет", "fin_params.overdraft_limit" },
  { "fin.tau_v", "деньги", "НДС", "0.22", "доля", "НОРМ", "ст. 164 НК РФ с 01.01.2026 [FZ-425]", "fin_params.tau_v" },
  { "fin.tau_p", "деньги", "Налог на прибыль", "0.25", "доля", "НОРМ", "ст. 284 НК РФ с 01.01.2025 [FZ-176]", "fin_params.tau_p" },
  { "fin.tau_soc", "деньги", "Страховые взносы", "0.30", "доля", "НОРМ", "гл. 34 НК РФ", "fin_params.tau_soc" },
  { "fin.property_tax_weekly", "деньги", "Налог на имущество (константа в F_t)", "0", "тыс. ₽/нед", "НОРМ", "Р2; паспорт ЕО отсутствует", "fin_params.property_tax_weekly" },
  { "fin.payroll_fixed_weekly", "деньги", "Постоянная зарплата W^fix (без взносов)", "0", "тыс. ₽/нед", "К", "штатное расписание отсутствует", "fin_params.payroll_fixed_weekly" },
  { "fin.repair_budget_weekly", "деньги", "Плановый бюджет ремонтов B^rep", "0", "тыс. ₽/нед", "НОРМ", "бюджет ТОиР отсутствует", "fin_params.repair_budget_weekly" },
  { "fin.other_fixed_weekly", "деньги", "Прочие постоянные платежи", "0", "тыс. ₽/нед", "К", "—", "fin_params.other_fixed_weekly" },
  { "fin.dso_kernel", "деньги", "Ядро инкассации w_k (DSO)", "[0,0.5,0.5]", "доли по неделям", "К", "реестра дебиторки нет (§10.2: О при наличии)", "fin_params.dso_kernel" },
  { "fin.pd", "деньги", "Вероятность дефолта покупателя на горизонте", "0.02", "доля", "К", "590-П как ориентир категорий", "fin_params.pd" },
  { "fin.lgd", "деньги", "Потери при дефолте LGD", "0.45", "доля", "НОРМ", "Basel II foundation LGD 45 %", "fin_params.lgd" },
  { "fin.prepay_share", "деньги", "Предоплата поставщику φ", "0", "доля", "НОРМ", "договоров поставки нет", "fin_params.prepay_share" },
  { "fin.dpo_weeks", "деньги", "Отсрочка оплаты DPO", "2", "нед", "НОРМ", "типовые условия", "fin_params.dpo_weeks" },
  { "fin.lead_weeks", "деньги", "Срок поставки L", "1", "нед", "К", "истории закупок нет (§3.1: О)", "fin_params.lead_weeks" },
  { "fin.vat_period_weeks", "деньги", "Налоговый период НДС", "13", "нед", "НОРМ", "ст. 163 НК РФ (квартал)", "fin_params.vat_period_weeks" },
  { "fin.vat_instalments", "деньги", "Число долей уплаты НДС", "3", "шт", "НОРМ", "ст. 174 НК РФ", "fin_params.vat_instalments" },
  { "fin.vat_instalment_lag_weeks", "деньги", "Шаг долей НДС", "4", "нед", "НОРМ", "ст. 174 НК РФ (ежемесячно)", "fin_params.vat_instalment_lag_weeks" },
  { "fin.tax_period_weeks", "деньги", "Период авансов по налогу на прибыль", "4", "нед", "НОРМ", "ст. 286 НК РФ", "fin_params.tax_period_weeks" },
  { "fin.payroll_weeks", "деньги", "Недели выплаты зарплаты (t mod 4)", "[2,0]", "—", "НОРМ", "ст. 136 ТК РФ (2 раза в месяц)", "fin_params.payroll_weeks" },
  { "fin.dscr_covenant", "деньги", "Ковенант DSCR", "1.2", "—", "НОРМ", "типовой ковенант", "fin_params.dscr_covenant" },
  { "fin.rate_owner", "деньги", "Ставка дисконта собственника r_O", "0.18", "год.", "НОРМ", "без источника (R1 §5 №46)", "fin_params.rate_owner" },
  { "fin.rate_bank", "деньги", "Требуемая доходность банка r_B", "0.16", "год.", "НОРМ", "§4.6 п.6", "fin_params.rate_bank" },
  { "fin.beta", "деньги", "Уровень CVaR минимума кассы β", "0.05", "—", "К", "сетка V9", "fin_params.beta" },
  { "fin.l_min", "деньги", "Порог ликвидности L_min", "0", "тыс. ₽", "К", "сетка V9 / кривая PoL", "fin_params.l_min" },
  { "fin.horizon_weeks", "деньги", "Горизонт кассы (0 → из horizon_hours)", "0", "нед", "К", "развилка Р1", "fin_params.horizon_weeks" },
  { "fin.cash_samples", "деньги", "Сценариев в LP с кассой (префикс CRN-выборки)", "300", "шт", "НОРМ", "по SE CVaR (§6.1)", "fin_params.cash_samples" },
  { "fin.runoff_weeks", "деньги", "Дорасчёт после горизонта (инкассация/оплата)", "0 → max(|w|, DPO+L)", "нед", "техн.", "§5.2а", "CashLp.cp.runoffWeeks" },
  { "fin.pol_grid", "деньги", "Сетка L для кривой цены ликвидности", "[-0.2,-0.1,-0.05,0,0.05,0.1] × E[Π]", "—", "К", "§6 PoL(L)", "CashOptimize.cpp" },
  { "fin.bootstrap_b", "деньги", "Число бутстреп-выборок B", "1000", "шт", "НОРМ", "§6.1", "CashOptimize.cpp" },
  { "fin.stage2_tail_uplift", "мощность", "Хвостовая поправка мощности Стадии 2: 1 + w·E[min(8,F−1)] + risk·0.5", "по операции (≈1.076 при w=0.08, ξ=2.5, risk=0.05)", "множитель", "К", "R4: та же модель, что sample_dur Стадии 1; w, ξ, risk — К до идентификации", "Optimizer.cpp:tail_uplift" },
  { "fin.feedback_apply", "мощность", "Применение stage1_feedback к мощности", "только при apply_feedback=true", "флаг", "НОРМ", "R5: воспроизводимость по seed", "Optimizer.cpp:run_optimization" },
};

/* Константы кода из R1 §5 (65 строк) — текущий статус, целевой статус в note. */
const Row kCode[] = {
  { "r1.01", "мощность", "Коэффициент готовности типа РЦ efficiency", "0.85", "доля", "НОРМ", "без источника; цель: О по machinery_log", "Optimizer.cpp:60; schema.sql:26" },
  { "r1.02", "длительности", "risk_coef (вероятность переделки)", "0.05", "доля", "НОРМ", "цель: О по план-факту", "Optimizer.cpp:148; Scheduler.cpp:207" },
  { "r1.03", "длительности", "tail_weight", "0.08", "доля", "UI", "цель: О (POT)", "Optimizer.cpp:149; Scheduler.cpp:208" },
  { "r1.04", "длительности", "tail_index (нижняя граница)", "2.5 (≥1.2)", "—", "UI", "цель: О (Хилл/GPD)", "Optimizer.cpp:150; Scheduler.cpp:208" },
  { "r1.05", "длительности", "Кап Парето-множителя", "1+min(8,F−1)", "—", "НОРМ", "цель: К с раскрытием P(cap)", "Optimizer.cpp:740; Scheduler.cpp:351" },
  { "r1.06", "длительности", "Множитель переделки Ст.2 / добавка Ст.1", "×1.5 / +0.5·mean", "—", "НОРМ", "цель: О", "Optimizer.cpp:743; Scheduler.cpp:352" },
  { "r1.07", "длительности", "σ длительности при t_opt=t_pess", "0.15·mean", "—", "НОРМ", "цель: О", "Optimizer.cpp:733; Scheduler.cpp:206" },
  { "r1.08", "длительности", "Пол длительности", "0.5 мин / 0.1 мин", "мин", "техн.", "—", "Optimizer.cpp:731; Scheduler.cpp:345" },
  { "r1.09", "длительности", "tExp при пустых нормах", "30", "мин", "UI", "цель: запрет (ошибка НСИ)", "Scheduler.cpp:205" },
  { "r1.10", "расписание", "Потолок transfer-партий", "16", "шт", "НОРМ", "цель: К + тест чувствительности", "Scheduler.cpp:294" },
  { "r1.11", "расписание", "Защиты по размеру: N=1 / N≤40 / без ГА", "4000 / 1500 / 3000", "операций", "НОРМ", "производительность; раскрыть в паспорте прогона", "Scheduler.cpp:311,720,797" },
  { "r1.12", "отказы", "Интенсивность отказов", "λ=(0.5+1.5u)/MTBF", "—", "UI", "цель: О (Weibull по наработке)", "Scheduler.cpp:540" },
  { "r1.13", "отказы", "CV времени ремонта", "0.6", "—", "НОРМ", "цель: О", "Scheduler.cpp:544" },
  { "r1.14", "отказы", "Не более 1 отказа на операцию", "—", "—", "техн.", "упрощение, раскрыть", "Scheduler.cpp:542" },
  { "r1.15", "календарь", "Графики станков", "8x5=08–16, 12x2=08–20", "ч", "НОРМ", "цель: Н (НСИ)", "Scheduler.cpp:260,265" },
  { "r1.16", "поставка", "Поставка: σ, risk, tail_w, tail_idx", "0.20, 0.05, 0.12, 2.0", "—", "UI", "цель: О по истории закупок", "Scheduler.cpp:677–678" },
  { "r1.17", "расписание", "Синтетические сроки", "h·(0.45+0.55(k+1)/n)", "—", "синтетика", "запрет в валидации", "Scheduler.cpp:696" },
  { "r1.18", "расписание", "Веса целевой F", "w_t=1, w_c=0, w_r=0.5; 0.5·E[T]; 0.001·T_det", "—", "НОРМ", "цель: К + фронт Парето", "Scheduler.h:31; Scheduler.cpp:770" },
  { "r1.19", "риск", "α (хвост CVaR)", "0.10", "—", "К", "сетка 0.01–0.5 (V9)", "Scheduler.h:33; Optimizer.h:26" },
  { "r1.20", "риск", "N сценариев Ст.1 / Ст.2", "max(60,s)/max(200,s); 600/2000", "шт", "НОРМ", "по SE CVaR", "Scheduler.cpp:719; Optimizer.cpp:700" },
  { "r1.21", "риск", "Seed поломок", "seed+7919·s", "—", "техн.", "цель: раздельные потоки", "Scheduler.cpp:740" },
  { "r1.22", "ГА", "NS, NV", "min(30,N/2), min(N−NS,120)", "шт", "НОРМ", "цель: К", "Scheduler.cpp:799–800" },
  { "r1.23", "ГА", "pop, elite, tournament, crossBias, mutation, swap, σ₀, stall, time", "16,2,3,0.7,0.15,0.5,0.1,8,6с", "—", "НОРМ", "BRKGA-типовые", "GaImprover.h:18–28" },
  { "r1.24", "ГА", "Адаптация σ", "×0.85/×1.25, [0.25σ₀,2σ₀]", "—", "НОРМ", "цель: К", "GaImprover.cpp:148,151" },
  { "r1.25", "мощность", "Множитель обратной связи stage1_feedback", "max(1, 1+Σsetup/Σwork)", "—", "техн.", "R5: применяется только явно (apply_feedback)", "Scheduler.cpp:1087–1107" },
  { "r1.26", "техн.", "Бины очереди/утилизации", "48", "шт", "техн.", "—", "Scheduler.cpp:949; main.cpp:3334" },
  { "r1.27", "рынок", "price_elasticity по умолчанию", "0.5", "—", "UI", "цель: О (регрессия цена–объём)", "Optimizer.cpp:106" },
  { "r1.28", "цены", "ν Стьюдента (цены)", "5", "—", "НОРМ", "цель: О (MLE)", "Optimizer.cpp:268" },
  { "r1.29", "цены", "α Ломакса (цены); q", "2.3; ≤0.9999", "—", "UI", "цель: О (Хилл)", "Optimizer.cpp:275–276" },
  { "r1.30", "цены", "market_corr умолч. / клип", "0.5 / ≤0.98", "—", "НОРМ", "цель: О (PCA по реальным рядам)", "Optimizer.cpp:580,602" },
  { "r1.31", "цены", "beta распределения по умолчанию", "0.7", "—", "НОРМ", "цель: О", "schema.sql:246; main.cpp:2048" },
  { "r1.32", "спрос", "Год для спроса", "8640", "ч", "НОРМ", "цель: 8760 или сменный фонд (R22)", "Optimizer.cpp:595" },
  { "r1.33", "цены", "Фолбэк CV цены", "0.12", "—", "UI", "цель: О", "Optimizer.cpp:688,693" },
  { "r1.34", "цены", "База волатильности / клип множителя", "0.06 / [0.2,6]", "—", "UI", "цель: убрать (σ из генератора)", "Optimizer.cpp:695" },
  { "r1.35", "сырьё", "Сырьё: CV, p скачка, α, кап", "0.20, 0.06, 2, 2.5", "—", "UI", "цель: О", "Optimizer.cpp:759–765" },
  { "r1.36", "спрос", "capM фолбэк", "demand_max×1.2", "ед", "UI", "цель: Н (НСИ)", "Optimizer.cpp:800" },
  { "r1.37", "спрос", "Пол demandMul", "0.1", "—", "техн.", "—", "Optimizer.cpp:796" },
  { "r1.38", "рынок", "Клип множителя цены", "[0.5,1.3]", "—", "UI", "цель: О", "Optimizer.cpp:891; ExactCvar.h:39" },
  { "r1.39", "портфель", "Сетка λ mean-variance; масштабы; смеси; показатель", "{0.5,1,1.5,2.5,4}; {0.5,0.7}; 80; 1.5", "—", "НОРМ", "пул — базовая линия", "Optimizer.cpp:851–873" },
  { "r1.40", "портфель", "maxShare умолч./клип", "0.6 / [0.1,1]", "—", "НОРМ", "цель: К (развилка)", "Optimizer.h:30; Optimizer.cpp:925" },
  { "r1.41", "портфель", "Полоса отбора", "0.03", "—", "UI", "цель: убрать (R15)", "Optimizer.cpp:955" },
  { "r1.42", "риск", "OOS: seed-смещение, порог предупреждения", "9973, 0.10", "—", "техн.", "—", "Optimizer.cpp:1069,1089" },
  { "r1.43", "риск", "samples, lambda, seed умолч.", "2000, 1.0, 42", "—", "НОРМ", "—", "Optimizer.h:25–28" },
  { "r1.44", "LP", "kCapBoundSlack, pwlRelTol, сегменты, time_limit, kFeasTol", "1.05, 1e-4, 16/64, 30с, 1e-9", "—", "техн.", "—", "ExactCvar.cpp:13–15; ExactCvar.h:68–70" },
  { "r1.45", "LP", "k = max(1,⌊αN⌋)", "—", "—", "НОРМ", "R23 (документ)", "ExactCvar.cpp:256–258" },
  { "r1.46", "инвестиции", "Ставка дисконта", "0.18", "год.", "НОРМ", "без источника; цель: WACC или ключевая+спред", "main.cpp:530" },
  { "r1.47", "инвестиции", "Срок службы", "60 (≤600)", "мес", "НОРМ", "цель: Н (паспорт ЕО)", "main.cpp:574" },
  { "r1.48", "календарь", "Месяц", "720", "ч", "НОРМ", "цель: календарь", "main.cpp:571; schema.sql:231" },
  { "r1.49", "инвестиции", "samples, addN", "[200,4000], ≤50", "—", "техн.", "—", "main.cpp:528,536" },
  { "r1.50", "прогноз", "months, infl, vol, corr, keyRate, runs, backtest", "≤36, 0.01, 0.05, 0.5, 0.08, 3000, ≤12", "—", "UI", "цель: генератор (волна M)", "main.cpp:2260–2271" },
  { "r1.51", "макро", "Дрейф санкций, чувствительность к ставке, якорь", "0.012, −0.0018, 0.08", "—", "UI", "«усилены для наглядности»; цель: О (VAR) или удалить", "main.cpp:2298" },
  { "r1.52", "макро", "Усиление волатильности", "1+1.6·S", "—", "UI", "цель: О (режимы HMM)", "main.cpp:2299" },
  { "r1.53", "макро", "Энергия, логистика, налог", "^0.32, ^0.18, 1.0", "—", "UI", "цель: О (доли в себестоимости)", "main.cpp:2300–2301" },
  { "r1.54", "прогноз", "EMD: IMF, сифтинги, SD, экстремумы", "5, 10, 0.05, <4", "—", "НОРМ", "цель: заменить", "main.cpp:2228–2244" },
  { "r1.55", "прогноз", "Гармоники: периоды, K", "{2…24}; 3/1", "—", "UI", "цель: тест значимости или удалить", "main.cpp:2390,2405" },
  { "r1.56", "прогноз", "ν по эксцессу", "6/exKurt+4 ∈ [3,40]", "—", "техн.", "эвристика; цель: MLE", "main.cpp:2430" },
  { "r1.57", "прогноз", "Stable: сетка α, γ, интегрирование", "{1.3,1.5,1.7,1.9}, {0.7,1,1.4}, 160×0.15", "—", "техн.", "эвристика; цель: MLE или удалить", "main.cpp:2452–2459" },
  { "r1.58", "прогноз", "Оверрайд типа: ν; α; клип отн. σ", "5; 1.6; [0.005,0.6]", "—", "UI", "цель: генератор", "main.cpp:2323,2477–2478" },
  { "r1.59", "данные", "Синтетическая история цен v9", "drift 0.006, σ 0.045/0.055, N=30", "—", "синтетика", "флаг synthetic, запрет в валидации (Р7)", "main.cpp:1710–1712" },
  { "r1.60", "данные", "Синтетическая история (новые изделия)", "σ 0.040/0.055, тренд 0.4–0.8 %, сезон 3–8 %, φ=0.5", "—", "синтетика", "то же", "main.cpp:3481–3487" },
  { "r1.61", "данные", "Синтетическая ключевая ставка", "last 0.21, drift 0.004, σ 0.05", "—", "синтетика", "цель: Н (cbr.ru)", "main.cpp:1753–1755" },
  { "r1.62", "цены", "Загрузка PCA", "strength·u_i/u_max, strength=√corr", "—", "техн.", "эвристика; цель: О", "main.cpp:2602–2603" },
  { "r1.63", "MRP", "lead_time, safety_stock", "НСИ", "—", "НОРМ", "цель: О (распределение срока)", "main.cpp:3027–3038" },
  { "r1.64", "калибровка", "Калибровка: деление на qty", "—", "—", "техн.", "R20: заблокировано без plan_fact_ops", "main.cpp:3222" },
  { "r1.65", "KPI", "Светофоры KPI", "OTD 0.95/0.8; UTIL 0.55/0.3; BN 0.95/0.8; WAIT 0.35/0.6; SETUP 0.1/0.2; AVAIL 0.9/0.75", "—", "UI", "цель: НОРМ с источником", "kpiCatalog.ts" },
  { "kpi.p_breach", "KPI", "Светофор P(разрыв)", "0.05 / 0.15", "доля", "К", "§6.0", "fin_params (светофоры)" },
  { "kpi.dscr_min_p05", "KPI", "Светофор DSCR p05", "1.2 / 1.0", "—", "К", "§6.0", "fin_params (светофоры)" },
  { "kpi.debt_peak", "KPI", "Светофор пика долга (доля лимита)", "0.70 / 0.90", "доля", "К", "§6.0", "fin_params (светофоры)" },
};

/* Волна M: обученный макро-генератор (блок [1]) и pass-through §2.4. Статусы по §10.2:
   генератор — О (cbr.ru, n = 157, валидация CRPS), опора — НОРМ, эластичности предприятия — К (Р8). */
/* Волна A (RL): константы среды SimEnv, награды, обучения и базовых линий — все [К]/[НОРМ]/техн.
   (данных предприятия нет, Р8); значения — см. docs/research/A1-rl-wave.md §2 и rl/train/*.py. */
const Row kRl[] = {
  { "rl.k_max_cands", "агенты", "Слотов кандидатов в наблюдении L0 (очередь усекается по EDD-порядку)", "16", "шт", "К", "A4 §3: фиксированный размер для ONNX", "SimEnv.h:EnvConfig.kMaxCands" },
  { "rl.k_max_orders", "агенты", "Слотов заказов в наблюдении/действиях L2", "16", "шт", "К", "—", "SimEnv.h:EnvConfig.kMaxOrders" },
  { "rl.k_max_wct", "агенты", "Слотов типов РЦ в наблюдении L2 (очередь по типу)", "32", "шт", "К", "—", "SimEnv.h:EnvConfig.kMaxWct" },
  { "rl.horizon_weeks", "агенты", "Горизонт эпизода/кассы H_P", "26", "нед", "К", "§7.2, развилка Р1", "SimEnv.h:EnvConfig.horizonWeeks" },
  { "rl.max_moves_per_week", "агенты", "Структурных ходов L2 за недельную эпоху", "3", "шт", "К", "§7.3; лимит пакета UX §4.10", "SimEnv.h:EnvConfig.maxMovesPerWeek" },
  { "rl.max_shift_weeks", "агенты", "Предел сдвига даты запуска заказа", "4", "нед", "К", "UX §4.10: «сдвиг ≤ 10 дн» → 4 нед для недельной сетки", "SimEnv.cpp:kMaxShiftWeeks" },
  { "rl.max_batches", "агенты", "Потолок transfer-партий при дроблении", "16", "шт", "НОРМ", "r1.10", "SimEnv.cpp:kMaxBatches" },
  { "rl.outsource_lead_hours", "агенты", "Срок поставки при аутсорсинге полуфабриката (нет outsourcing_offers)", "72", "ч", "К", "§7.3в: коммерческих предложений нет", "SimEnv.cpp:instance_from_db" },
  { "rl.outsource_markup", "агенты", "Цена аутсорсинга = материальная себестоимость × markup", "1.3", "—", "К", "§7.3в «цена = себестоимость × 1.3»", "SimEnv.cpp:instance_from_db" },
  { "rl.outsource_prepay", "агенты", "Доля предоплаты поставщику аутсорсинга (маска C_t+U_t ≥ предоплата)", "0.5", "доля", "К", "§7.3", "SimEnv.cpp:instance_from_db" },
  { "rl.reward.c_tard", "агенты", "Вес Δ оценки просрочки в плотной награде L0", "1.0", "—", "К", "§7.3а; A4 §2.2", "SimEnv.h:EnvConfig.cTard" },
  { "rl.reward.c_setup", "агенты", "Вес наладки в плотной награде L0", "0.5", "—", "К", "§7.3а", "SimEnv.h:EnvConfig.cSetup" },
  { "rl.reward.w_profit", "агенты", "Вес прибыли (терминальная награда, доля стоимости портфеля)", "1.0", "—", "К", "§7.3 награда L2", "SimEnv.h:EnvConfig.wProfit" },
  { "rl.reward.w_cash", "агенты", "Вес минимума кассы (терминальная награда)", "1.0", "—", "К", "§7.3", "SimEnv.h:EnvConfig.wCash" },
  { "rl.reward.lambda_breach", "агенты", "Штраф за кассовый разрыв (ковенант — ½)", "1.0", "—", "К", "§7.3 λ_cov", "SimEnv.h:EnvConfig.lambdaBreach" },
  { "rl.reward.c_energy", "агенты", "Вес энергии в награде L0 (кВт·ч по типам отсутствуют)", "0", "—", "К", "§7.3а: e_w нет в НСИ → 0", "SimEnv.cpp (не используется)" },
  { "rl.tard_penalty_per_week", "агенты", "Договорной штраф за просрочку, доля стоимости заказа в неделю", "0.01", "доля/нед", "К", "договоров нет", "SimEnv.h:EnvConfig.tardPenaltyPerWeek" },
  { "rl.tard_penalty_cap", "агенты", "Потолок штрафа за просрочку", "0.2", "доля", "К", "договоров нет", "SimEnv.h:EnvConfig.tardPenaltyCap" },
  { "rl.repair_cost_mul", "агенты", "Стоимость ремонта = часы ремонта × ставка типа × mul", "1.0", "—", "К", "бюджета ТОиР нет", "SimEnv.h:EnvConfig.repairCostMul" },
  { "rl.wait_window", "агенты", "WAIT допустим, если ближайшее завершение ≤ Δ", "240", "мин", "К", "§7.3а «в пределах Δ»; без окна политика выучивала 98 % WAIT", "SimEnv.h:EnvConfig.waitWindowMin" },
  { "rl.reward.c_wait", "агенты", "Цена простоя при WAIT: c_W·Δt/масштаб", "0.5", "—", "К", "начисляется самому WAIT (A1 §2.4)", "SimEnv.h:EnvConfig.cWait" },
  { "rl.cash_risk_flag", "агенты", "Флаг «касса в зоне риска» в наблюдении L0: C_t < порог", "0", "доля стоимости портфеля", "К", "§7.3а (P(C<0) > 10 % — после волны F2)", "SimEnv.cpp:kCashRiskShare" },
  { "rl.fin_scale", "агенты", "Экземпляры MAOS: лимит линии 15 % и касса 5 % стоимости портфеля", "0.15 / 0.05", "доля", "К", "лимит демо (20 млн ₽) несопоставим с заказами", "rl/bench/instances.py:FIN_SCALE" },
  { "rl.crn.streams", "агенты", "Потоки CRN по идентичности джобы: 1 — длительности, 2 — поломки; дефолт — [seed, 911]", "splitmix64", "—", "техн.", "§11.3а", "SimEnv.cpp:job_rng; rl/env/scenarios.py" },
  { "rl.ppo.net", "агенты", "Сеть политики/критика MaskablePPO", "MLP [128,128]", "—", "К", "sb3-contrib; A4 §3 (MLP до внимания)", "rl/train/train_l0.py:PPO" },
  { "rl.ppo.hyper", "агенты", "n_steps, batch, lr, γ, λ_GAE, clip, epochs", "512, 256, 3e-4, 0.995, 0.95, 0.2, 4", "—", "К", "типовые PPO", "rl/train/train_l0.py:PPO" },
  { "rl.ppo.entropy", "агенты", "Отжиг энтропии по стадиям куррикулума", "0.02 → 0.01 → 0.003", "—", "К", "AI Economist (Zheng 2022)", "rl/train/train_l0.py:ENT" },
  { "rl.curriculum", "агенты", "Стадии §7.4: малые/без поломок → все/хвосты → + кризисный режим → L2", "шаги 60k/100k/100k; L2 30k", "шт", "К", "§7.4", "rl/train/train_l0.py; train_l2.py" },
  { "rl.valid", "агенты", "Валидация ранней остановки: seed и сценариев на экземпляр", "777, 4", "—", "НОРМ", "§10.2а п.3 (отдельный seed, не holdout)", "rl/train/common.py:EvalSpec" },
  { "rl.holdout", "агенты", "Отложенные сценарии V5: seed, N на экземпляр", "2026102201, 200", "—", "НОРМ", "§10.2а п.1", "rl/eval/v5.py" },
  { "rl.bootstrap_b", "агенты", "Бутстреп-выборок для ДИ IQM", "2000", "шт", "НОРМ", "rliable", "rl/train/common.py:paired_bootstrap_ci" },
  { "rl.ga_baseline", "агенты", "ГА-базовая линия: сценариев, поколений, время, seed", "8, 30, 30 с, 1000", "—", "НОРМ", "как GaImprover Стадии 1", "rl/eval/v5.py" },
  { "rl.cpsat_limit", "агенты", "Лимит времени CP-SAT (V4)", "60", "с", "НОРМ", "§10.1 V4", "rl/bench/run_v4.py" },
  { "rl.gate", "агенты", "Гейт самоулучшения: 95 %-ДИ IQM ΔCVaR_0.1(Π) > 0 и ΔCVaR_0.05(C_min) ≥ 0", "—", "—", "НОРМ", "§7.4, §10.2а п.1", "rl/eval/v5.py:compare" },
  { "rl.policy_version", "агенты", "Версия/SHA256 политики ONNX правила «RL»", "см. rl/results/l0_policy.json", "—", "техн.", "A1 §5", "RlRule.cpp" },
};

const Row kMacro[] = {
  { "macro.generator", "макро", "VAR(1)+SVD+HMM+блоки: A, Σ, V, P_HMM, μ_HMM, b, число режимов", "2 режима, блок 4 мес, ρ(A)=0.949, ранг 3", "—", "О", "cbr.ru 2013-09…2026-09, n_obs=157; выбор по CRPS на 24 целях 2021–2022 (rl/macro/params/learning.json)", "rl/macro/fit.py; MacroSampler.cpp" },
  { "macro.selection_crps", "макро", "Совместный стандартизованный CRPS выбранной модели / персистентности", "0.976 / 1.141", "—", "О", "24 перекрывающихся цели, 384 пути; learning.json", "rl/macro/anchored.py:select" },
  { "macro.holdout_coverage80", "макро", "Покрытие 80 % полос на отложенных месяцах 2023-01…2026-09, h = 12", "π 0.62 · ставка 0.40 · курс 0.76 (n = 45)", "доля", "О", "learning.json holdout; недопокрытие ставки раскрыто (хвост 2023–24 вне носителя)", "rl/macro/validate.py" },
  { "macro.sigma_bb_fx", "макро", "σ броуновского моста курса (месяц → неделя)", "6.89", "%-лог", "О", "дневной курс cbr.ru 2013–2026, 156 месяцев", "rl/macro/data.py:_bridge_sigma; MacroSampler.cpp:to_weeks" },
  { "macro.sigma_bb_key", "макро", "σ моста ключевой ставки", "0 (ступень)", "—", "Н", "ставка меняется только в даты заседаний", "MacroSampler.cpp:to_weeks" },
  { "macro.sigma_bb_cpi", "макро", "σ моста инфляции", "0 (линейно)", "—", "НОРМ", "дневного ряда нет — помечено", "MacroSampler.cpp:to_weeks" },
  { "macro.ref_cpi", "макро", "Опора инфляции π_ref", "flat = последнее наблюдение; nodes = узлы прогноза ЦБ от 24.07.2026", "% г/г", "НОРМ", "reference_nodes.json (сценарная опора, не распределение)", "MacroSampler.cpp:reference" },
  { "macro.ref_key", "макро", "Опора ключевой ставки i_ref", "flat = последнее наблюдение (14.0)", "% год.", "НОРМ", "форвардные узлы ЦБ по ставке не загружены", "MacroSampler.cpp:reference" },
  { "macro.usd_inflation", "макро", "π_USD ППС-опоры курса", "0.02", "год.", "НОРМ", "RJMF §6.3", "MacroSampler.cpp:to_levels" },
  { "macro.seed_streams", "макро", "Потоки CRN генератора", "[seed,871] макро · [seed,872] мост; 3841 равномерных/id", "—", "техн.", "RJMF §6.1: путь id не зависит от n и пакета", "MacroSampler.cpp:sample_months" },
  { "macro.pt_fx_product", "pass-through", "b^FX изделий: Δln p = … + b^FX·Δln S", "0.10", "—", "К", "истории цен предприятия нет → доля импортной составляющей (§2.4); цель: О (HAC-регрессия)", "Optimizer.cpp:genScenarios" },
  { "macro.pt_fx_raw", "pass-through", "b^FX покупного сырья", "0.30", "—", "К", "структура затрат (доля импорта) — НСИ без поля; цель: О", "Optimizer.cpp:genScenarios" },
  { "macro.pt_cpi", "pass-through", "b^π цен изделий и сырья (на накопленную инфляцию горизонта)", "1.0", "—", "К", "полная индексация; цель: О", "Optimizer.cpp:genScenarios" },
  { "macro.pt_conv_cpi", "pass-through", "Индексация конверсионных затрат (труд, энергия, прочее) на инфляцию", "1.0", "—", "К", "§2.4: тариф на энергию — ряда нет → индекс по инфляции", "Optimizer.cpp:genScenarios" },
  { "macro.pt_energy", "pass-through", "Эластичность тарифа на энергию τ_t к инфляции", "1.0", "—", "К", "ряда тарифа нет (§2.1 опционально)", "Optimizer.cpp:genScenarios" },
  { "macro.pt_logistics_fx", "pass-through", "Эластичность логистического индекса ℓ_t к курсу", "0.30", "—", "К", "ряда нет; применяется к Pay^log (в демо = 0)", "CashOptimize.cpp:waterfall_eval" },
  { "macro.pt_logistics_cpi", "pass-through", "Эластичность ℓ_t к инфляции", "1.0", "—", "К", "то же", "CashOptimize.cpp:waterfall_eval" },
  { "macro.gamma_F", "pass-through", "γ_s — загрузка цены на общий макро-фактор F (первая SVD-компонента)", "β_s из price_distributions (сохраняется)", "—", "К", "§2.4: F заменяет i.i.d. фактор M v0.63; β — как в сценарии", "Optimizer.cpp:genScenarios" },
  { "macro.rate_lag", "pass-through", "Лаг ставки кредита за ключевой l_r", "0", "нед", "НОРМ", "кредитного договора нет; r_t = i_t + spread", "CashOptimize.cpp:cash_compare" },
  { "macro.mode_default", "макро", "Режим генератора по умолчанию", "base (p_last, P_HMM, эмпирические блоки)", "—", "НОРМ", "§2.6б; стрессы — не прогноз", "main.cpp:/api/optimize" },
};

/* Волна M: UI-коэффициенты ползунков больше не участвуют в расчёте (R1 §2.11, §2.5). */
const char* kDeprecatedUi[] = { "r1.50", "r1.51", "r1.52", "r1.53", "r1.58" };

const char* kFinColumns[] = {
  "c0", "c_min", "credit_limit", "d0", "key_rate", "spread", "overdraft_spread", "overdraft_limit",
  "tau_v", "tau_p", "tau_soc", "property_tax_weekly", "payroll_fixed_weekly", "repair_budget_weekly",
  "other_fixed_weekly", "pd", "lgd", "prepay_share", "dpo_weeks", "lead_weeks", "vat_period_weeks",
  "vat_instalments", "vat_instalment_lag_weeks", "tax_period_weeks", "dscr_covenant", "rate_owner",
  "rate_bank", "beta", "l_min", "horizon_weeks", "cash_samples", "auto_repay",
};
const char* kFinJsonColumns[] = { "dso_kernel", "payroll_weeks" };

void seed_rows(Database& db, const Row* rows, size_t n) {
  for (size_t i = 0; i < n; ++i)
    db.exec("INSERT OR IGNORE INTO param_passport(code,block,name,value,unit,status,source,file_ref) "
            "VALUES(?,?,?,?,?,?,?,?)",
            { rows[i].code, rows[i].block, rows[i].name, rows[i].value, rows[i].unit,
              rows[i].status, rows[i].source, rows[i].file });
}

std::vector<double> parse_doubles(const std::string& s, std::vector<double> def) {
  try {
    json j = json::parse(s);
    if (!j.is_array()) return def;
    std::vector<double> v; for (auto& e : j) v.push_back(e.get<double>());
    return v.empty() ? def : v;
  } catch (...) { return def; }
}

}  // namespace

void migrate(Database& db) {
  db.exec_safe("CREATE TABLE IF NOT EXISTS param_passport ("
               "code TEXT PRIMARY KEY, block TEXT, name TEXT, value TEXT, unit TEXT, "
               "status TEXT NOT NULL, source TEXT, file_ref TEXT, note TEXT, "
               "updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec_safe("CREATE TABLE IF NOT EXISTS fin_params ("
               "entity TEXT PRIMARY KEY, period_type TEXT NOT NULL DEFAULT 'week', "
               "c0 REAL NOT NULL DEFAULT 0, c_min REAL NOT NULL DEFAULT 0, "
               "credit_limit REAL NOT NULL DEFAULT 20000000, d0 REAL NOT NULL DEFAULT 0, "
               "key_rate REAL NOT NULL DEFAULT 0.16, spread REAL NOT NULL DEFAULT 0.03, "
               "overdraft_spread REAL NOT NULL DEFAULT 0.10, overdraft_limit REAL NOT NULL DEFAULT 0, "
               "tau_v REAL NOT NULL DEFAULT 0.22, tau_p REAL NOT NULL DEFAULT 0.25, tau_soc REAL NOT NULL DEFAULT 0.30, "
               "property_tax_weekly REAL NOT NULL DEFAULT 0, payroll_fixed_weekly REAL NOT NULL DEFAULT 0, "
               "repair_budget_weekly REAL NOT NULL DEFAULT 0, other_fixed_weekly REAL NOT NULL DEFAULT 0, "
               "dso_kernel TEXT NOT NULL DEFAULT '[0,0.5,0.5]', pd REAL NOT NULL DEFAULT 0.02, lgd REAL NOT NULL DEFAULT 0.45, "
               "prepay_share REAL NOT NULL DEFAULT 0, dpo_weeks INTEGER NOT NULL DEFAULT 2, lead_weeks INTEGER NOT NULL DEFAULT 1, "
               "vat_period_weeks INTEGER NOT NULL DEFAULT 13, vat_instalments INTEGER NOT NULL DEFAULT 3, "
               "vat_instalment_lag_weeks INTEGER NOT NULL DEFAULT 4, tax_period_weeks INTEGER NOT NULL DEFAULT 4, "
               "payroll_weeks TEXT NOT NULL DEFAULT '[2,0]', dscr_covenant REAL NOT NULL DEFAULT 1.2, "
               "rate_owner REAL NOT NULL DEFAULT 0.18, rate_bank REAL NOT NULL DEFAULT 0.16, "
               "beta REAL NOT NULL DEFAULT 0.05, l_min REAL NOT NULL DEFAULT 0, horizon_weeks INTEGER NOT NULL DEFAULT 0, "
               "cash_samples INTEGER NOT NULL DEFAULT 300, auto_repay INTEGER NOT NULL DEFAULT 0, "
               "effective_from TEXT NOT NULL DEFAULT '2026-01-01', "
               "updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec_safe("INSERT OR IGNORE INTO fin_params(entity) VALUES('default')");
  // Таблица план-факта операций (пустая до импорта): R20 — калибровка только по ней.
  db.exec_safe("CREATE TABLE IF NOT EXISTS plan_fact_ops ("
               "id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, machine_id TEXT, "
               "planned_min REAL, actual_min REAL NOT NULL, qty REAL NOT NULL DEFAULT 1, "
               "started_at TEXT, finished_at TEXT, source TEXT, synthetic INTEGER NOT NULL DEFAULT 0, "
               "imported_at TEXT NOT NULL DEFAULT (datetime('now')))");
  // R5: версия/хэш обратной связи в прогоне оптимизации.
  db.exec_safe("ALTER TABLE optimization_runs ADD COLUMN feedback_hash TEXT");
  db.exec_safe("ALTER TABLE optimization_runs ADD COLUMN feedback_applied INTEGER NOT NULL DEFAULT 0");
  seed_rows(db, kFinance, sizeof(kFinance) / sizeof(kFinance[0]));
  seed_rows(db, kCode, sizeof(kCode) / sizeof(kCode[0]));
  seed_rows(db, kMacro, sizeof(kMacro) / sizeof(kMacro[0]));
  seed_rows(db, kRl, sizeof(kRl) / sizeof(kRl[0]));
  for (const char* code : kDeprecatedUi)
    db.exec("UPDATE param_passport SET note='подобрано для UI — не используется в расчёте (волна M: заменено MacroSampler)', "
            "updated_at=datetime('now') WHERE code=? AND COALESCE(note,'') NOT LIKE 'подобрано для UI%'", { code });
  db.exec("UPDATE param_passport SET note='synthetic=1 (macro_ts); прогноз ставки — MacroSampler по cbr.ru', "
          "updated_at=datetime('now') WHERE code='r1.61' AND COALESCE(note,'')=''");
  db.exec("UPDATE param_passport SET note='synthetic=1 (ts_data); запрет в обучении/валидации', "
          "updated_at=datetime('now') WHERE code IN ('r1.59','r1.60') AND COALESCE(note,'')=''");
}

double number(Database& db, const std::string& code, double def) {
  try {
    json r = db.query_one("SELECT value FROM param_passport WHERE code=?", { code });
    return jnum(r, "value", def);
  } catch (...) { return def; }
}

json fin_params_json(Database& db) {
  json row = db.query_one("SELECT * FROM fin_params WHERE entity='default'");
  json out = json::object();
  for (auto& [k, v] : row.items()) {
    const std::string s = v.is_string() ? v.get<std::string>() : v.dump();
    if (k == "entity" || k == "period_type" || k == "effective_from" || k == "updated_at") { out[k] = s; continue; }
    if (k == "dso_kernel" || k == "payroll_weeks") { try { out[k] = json::parse(s); } catch (...) { out[k] = json::array(); } continue; }
    try { out[k] = std::stod(s); } catch (...) { out[k] = s; }
  }
  return out;
}

json save_fin_params(Database& db, const json& body) {
  if (!body.is_object()) throw std::runtime_error("fin_params: object expected");
  std::lock_guard<std::recursive_mutex> lk(db.mutex());
  for (const char* col : kFinColumns) {
    if (!body.contains(col) || body[col].is_null()) continue;
    const double v = jnum(body, col, 0.0);
    if (!std::isfinite(v)) throw std::runtime_error(std::string("fin_params.") + col + ": not a number");
    const std::string c = col;
    if ((c == "tau_v" || c == "tau_p" || c == "tau_soc" || c == "prepay_share" || c == "pd" || c == "lgd" || c == "beta") &&
        (v < 0 || v > 1)) throw std::runtime_error("fin_params." + c + ": доля вне [0,1]");
    if ((c.find("weeks") != std::string::npos || c == "vat_instalments" || c == "cash_samples") && v < 0)
      throw std::runtime_error("fin_params." + c + ": отрицательное значение");
    db.exec("UPDATE fin_params SET " + c + "=?, updated_at=datetime('now') WHERE entity='default'", { std::to_string(v) });
  }
  for (const char* col : kFinJsonColumns) {
    if (!body.contains(col) || !body[col].is_array()) continue;
    for (auto& e : body[col]) if (!e.is_number()) throw std::runtime_error(std::string("fin_params.") + col + ": массив чисел");
    db.exec(std::string("UPDATE fin_params SET ") + col + "=?, updated_at=datetime('now') WHERE entity='default'",
            { body[col].dump() });
  }
  if (body.contains("effective_from") && body["effective_from"].is_string())
    db.exec("UPDATE fin_params SET effective_from=? WHERE entity='default'", { body["effective_from"].get<std::string>() });
  return fin_params_json(db);
}

cash::FinParams load_fin_params(Database& db) {
  json j = fin_params_json(db);
  cash::FinParams fp;
  auto g = [&](const char* k, double def) { return j.contains(k) && j[k].is_number() ? j[k].get<double>() : def; };
  fp.c0 = g("c0", 0); fp.cMin = g("c_min", 0); fp.creditLimit = g("credit_limit", 0); fp.d0 = g("d0", 0);
  fp.keyRate = g("key_rate", 0.16); fp.spread = g("spread", 0.03);
  fp.overdraftSpread = g("overdraft_spread", 0.10); fp.overdraftLimit = g("overdraft_limit", 0);
  fp.tauV = g("tau_v", 0.22); fp.tauP = g("tau_p", 0.25); fp.tauSoc = g("tau_soc", 0.30);
  fp.propertyTaxWeekly = g("property_tax_weekly", 0);
  fp.prepayShare = g("prepay_share", 0); fp.dpoWeeks = (int)g("dpo_weeks", 2); fp.leadWeeks = (int)g("lead_weeks", 1);
  fp.vatPeriodWeeks = (int)g("vat_period_weeks", 13); fp.vatInstalments = (int)g("vat_instalments", 3);
  fp.vatInstalmentLagWeeks = (int)g("vat_instalment_lag_weeks", 4); fp.taxPeriodWeeks = (int)g("tax_period_weeks", 4);
  fp.dscrCovenant = g("dscr_covenant", 1.2); fp.rateOwner = g("rate_owner", 0.18); fp.rateBank = g("rate_bank", 0.16);
  fp.autoRepay = g("auto_repay", 0) != 0;
  if (j.contains("dso_kernel") && j["dso_kernel"].is_array() && !j["dso_kernel"].empty())
    fp.dsoKernel = parse_doubles(j["dso_kernel"].dump(), fp.dsoKernel);
  if (j.contains("payroll_weeks") && j["payroll_weeks"].is_array()) {
    fp.payrollWeeks.clear();
    for (auto& e : j["payroll_weeks"]) if (e.is_number()) fp.payrollWeeks.push_back(e.get<int>());
  }
  return fp;
}

json passport_list(Database& db) {
  return db.query_json("SELECT code,block,name,value,unit,status,source,file_ref,note,updated_at "
                       "FROM param_passport ORDER BY block, code");
}

json passport_update(Database& db, const std::string& code, const json& body) {
  static const char* kStatuses[] = { "Н", "О", "К", "НОРМ", "UI", "техн.", "синтетика" };
  if (!body.is_object()) throw std::runtime_error("passport: object expected");
  std::lock_guard<std::recursive_mutex> lk(db.mutex());
  db.query_one("SELECT code FROM param_passport WHERE code=?", { code });   // 404 → not found
  if (body.contains("status")) {
    const std::string st = jstr(body, "status");
    if (std::find(std::begin(kStatuses), std::end(kStatuses), st) == std::end(kStatuses))
      throw std::runtime_error("passport: недопустимый статус «" + st + "»");
    // Статус «О» (оценка по данным) допустим только с указанием источника данных и n_obs.
    if (st == "О" && (jstr(body, "source").empty() || jnum(body, "n_obs", 0) <= 0))
      throw std::runtime_error("passport: статус «О» требует source и n_obs > 0 (калибровка не называется оценкой)");
    db.exec("UPDATE param_passport SET status=?, updated_at=datetime('now') WHERE code=?", { st, code });
  }
  for (const char* k : { "value", "source", "note", "unit" })
    if (body.contains(k) && body[k].is_string())
      db.exec(std::string("UPDATE param_passport SET ") + k + "=?, updated_at=datetime('now') WHERE code=?",
              { body[k].get<std::string>(), code });
  return db.query_one("SELECT * FROM param_passport WHERE code=?", { code });
}

}  // namespace maos::passport
