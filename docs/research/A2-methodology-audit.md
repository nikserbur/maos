# A2 — Methodology audit of MAOS v0.58.0 (Stage 1 scheduler, Stage 2 robust portfolio, analytics, forecast)

Read-only audit of the code against the docs (CONCEPT, SCHEDULING, OPTIMIZATION, ANALYTICS, REQUIREMENTS, ARCHITECTURE, ROADMAP, README). Line numbers refer to the working tree at v0.58.0. Repo not modified.

**Overall verdict.** The engineering is solid, and several choices are good (common random numbers, an out-of-sample SAA check, an empirical CVaR estimator, a one-factor copula that is always PSD, a forecast backtest against a naive baseline). The methodology as a thesis contribution is weaker in four places:
- **(a)** Stage 2 picks from about 120 heuristic candidates, although the CVaR problem could be solved exactly as an LP/QP.
- **(b)** The "two-stage stochastic program" claim is not what the code does.
- **(c)** There is no benchmark, statistical test or sensitivity analysis.
- **(d)** Several KPI/finance/calibration formulas are wrong or inconsistent between modules.

---

## 1. Per-method table

| # | Method | What the code actually does | Verdict | Modern alternative a 2026 reviewer expects | Prio |
|---|---|---|---|---|---|
| 1 | Stage-1 scheduler (FJSP) | Serial list scheduling: a static priority key, append-only machine timelines (no gap insertion), greedy earliest-free machine, then greedy earliest-free worker (Scheduler.cpp:446-546). The result is **semi-active**, not "активное" as SCHEDULING.md §2 claims. Machine assignment is not a decision variable. | Questionable | CP-SAT interval model (OR-Tools; `NoOverlap` + optional intervals for FJSP) as the exact/anytime reference; Giffler–Thompson active SGS; CP still outperforms MIP on shop problems (Naderi, Ruiz & Roshanaei 2023) | P0 |
| 2 | Dispatching rules | 7 static rules (SPT/LPT/EDD/CR/MWKR/MS/FIFO). CR = due/rem and MS = due−rem are evaluated once, with no "now" (Scheduler.cpp:397-406). | Correct as static variants; must be named "static" | Dynamic rules; GP-evolved rules (Branke et al. 2016); learning-to-dispatch: Zhang et al. 2020 (NeurIPS, arXiv:2010.12367), Song et al. 2023 (IEEE TII 19(2), HGNN for FJSP), Corsini et al. 2024 (NeurIPS, arXiv:2401.11849) | P2 |
| 3 | Improver | 30 iterations of hill climbing on the priority keys (Gaussian noise on 20% of keys), scored on the **first 30 MC scenarios**, the same ones used for reporting (Scheduler.cpp:749-787) | Questionable (in-sample, weak search) | Iterated greedy, tabu on the critical path (N5/N7 neighbourhoods), simulated annealing; hold-out evaluation | P1 |
| 4 | Lot streaming | Equal consistent sublots, N = min(16, qty/batch). Sublot k waits for sublot k of the previous op. Mapping to input sublots is wrong (bug B1). | Mostly correct; bug | Classical lot-streaming models (Trietsch & Baker 1993; Chang & Chiu 2005 review); variable sublots via CP | P1 |
| 5 | Activity times ("PERT") | PERT mean (a+4m+b)/6 and σ=(b−a)/6 parameterise a **lognormal**. A Pareto multiplier (prob tail_weight, capped at 9×) and +50% rework are added (Scheduler.cpp:326-336; Optimizer.cpp:583-595). Not β-PERT, despite OPTIMIZATION.md §1 ("PERT-треугольное (β-PERT)") and Optimizer.cpp:61. | Defensible model, wrongly named; cap makes all moments finite | State it as "lognormal + truncated-Pareto mixture"; fit it to data (MLE/AIC) rather than PERT moments (Keefer & Verdini 1993 on PERT bias) | P1 |
| 6 | Breakdowns / PM | Usage-based PM; failure hazard λ=(0.5+1.5·u)/MTBF; at most one failure per op; lognormal repair (CV 0.6) (Scheduler.cpp:500-526) | Ad hoc but explicit | Standard: TTF ~ Weibull on operating time, repair ~ lognormal; cite ГОСТ 27.002-2015 | P2 |
| 7 | Stage-1 risk objective | (1−w)·E[Cmax] + w·CVaR_α(Cmax) + w_c·setup-minutes + 0.5·E[T] + 0.001·T_det (Scheduler.cpp:729) | Coherent mix of mean and CVaR, but hard-coded weights; "cost" is setup minutes, not money | Expose all weights; report a mean–CVaR Pareto front | P1 |
| 8 | Stage-2 portfolio optimisation | About 120 candidates (greedy, water-filling, mean-variance weights, random mixtures, ×0.5/×0.7 scaling). The best is picked by the criterion, **then a 3% tolerance band with a load-evenness tie-break** (Optimizer.cpp:673-734, 795-816). No local search, although OPTIMIZATION.md §7 step 6 and REQUIREMENTS claim one. | Questionable: heuristic for a problem that is tractable exactly | **Rockafellar–Uryasev LP** (2000; 2002): max η − (1/αN)Σu_i, u_i ≥ η − P_i(x), with capacity/demand constraints. With the linear inverse-demand term this becomes a concave QP (still exact via HiGHS/OSQP/Gurobi). Extensions: Wasserstein-DRO CVaR (Mohajerin Esfahani & Kuhn 2018; Kuhn, Shafiee & Wiesemann 2025, Acta Numerica, arXiv:2411.02549); integer batches as a MILP | **P0** |
| 9 | CVaR / VaR estimator | Empirical lower-tail mean of the ⌊αN⌋ worst profits (Optimizer.cpp:309-312); upper tail for makespan (Scheduler.cpp:559-562) | Correct (equals the RU estimator when αN is an integer) | Add bootstrap or asymptotic CIs; N≥200 gives 20 tail points, but large Stage-1 plans use N≤40 → only 4 tail points (Scheduler.cpp:692) | P1 |
| 10 | Min-regret | Regret relative to the best **candidate in the pool** per scenario (Optimizer.cpp:762-769) | Correct only relative to the pool (depends on irrelevant alternatives) | Per-scenario optimum by LP (cheap with #8); Savage criterion stated as such | P2 |
| 11 | Price correlation | One-factor Gaussian copula z=βM+√(1−β²)ε, β∈[0,1] (Optimizer.cpp:597-606, 530). PSD by construction, so no Cholesky needed, but **no negative or sector structure and no tail dependence**. | Correct but restrictive | Full correlation matrix + Cholesky (with nearest-PSD repair, Higham 2002); t-copula or vine copulas for tail dependence (McNeil, Frey & Embrechts 2015) | P1 |
| 12 | Heavy-tailed prices | "t": Cornish–Fisher approximation with fixed ν=5 (−6% at p=0.999). "pareto": symmetric Lomax α=2.3, whose **SD is ≈2.26× the stated σ**. Then a hard clip at [min,max] creates point masses that fix the CVaR (Optimizer.cpp:264-285). | Questionable: different families are not comparable at "equal σ" | Exact quantile functions (Boost.Math); normalise each family to the stated σ; truncate without point masses (or don't truncate) | P1 |
| 13 | Unit-cost uncertainty | **One** time and rework draw per operation per scenario applied to the whole horizon volume (Optimizer.cpp:577-596, 220-231). This is fully systematic risk: a 6% Bernoulli makes all units 1.5× more expensive. | Questionable: overstates cost variance by about √q unless interpreted as norm (epistemic) error | Split epistemic (norm) from aleatory (per-batch) noise; aggregate per batch via CLT/binomial thinning | P1 |
| 14 | Demand/market model | Price multiplier clamp(1+e·(1−(C_comp+q)/Cap), 0.5, 1.3), sales = min(q, absorb), with absorb = Cap−C_comp. Candidates are capped at absorb, so fill ≤ 1 and the multiplier is always ≥ 1: the overproduction branch is unreachable (Optimizer.cpp:662-666, 738-746). Demand is deterministic, although docs say truncated normal. "Elasticity" here is a slope, not ε=∂lnQ/∂lnP. | Questionable | Constant-elasticity or linear inverse demand with stochastic intercept; Cournot competitor response; newsvendor-type expected sales E[min(q,D)] | P1 |
| 15 | "Two-stage" link and "recourse" | Stage 2 → orders for Stage 1; Stage 1 → per-product factor 1+setupShare written to `stage1_feedback` (Scheduler.cpp:942-959; Optimizer.cpp:492-509) | **Wrong claim**: no scenario-wise second-stage decisions, so this is hierarchical planning–scheduling with open-loop calibration | True two-stage SP / SAA (Birge & Louveaux 2011; Shapiro, Dentcheva & Ruszczyński 2021); integrated planning–scheduling (Maravelias & Sung 2009); simulation-optimisation loop (Amaran et al. 2016) | **P0** (terminology) / P2 (method) |
| 16 | SAA / out-of-sample | Fresh N scenarios (seed+9973) for the robust portfolio only; reports gap_expected and gap_cvar (Optimizer.cpp:918-945) | Correct and good, but incomplete | Mak–Morton–Wood (1999) optimality-gap CI; Kleywegt, Shapiro & Homem-de-Mello (2002) N-selection; OOS for all compared portfolios | P1 |
| 17 | Investment (NPV/IRR/payback) | ΔProfit = E[profit] of the robust portfolio (+N machines) − base. That figure is assumed to repeat every month for 60 months. NPV uses r/12 (nominal) but IRR is reported as (1+i)^12−1 (effective) (main.cpp:564-597). | Questionable plus a bug (B6) | Методические рекомендации ВК 477 (1999): ЧДД, ВНД, ИД, discounted payback; E[NPV] and P(NPV<0) from the same CRN scenarios; include O&M, labour for the added machines, ramp-up, salvage value and tax | P0 |
| 18 | Theory of Constraints | Bottleneck = max utilisation. "Next bottleneck" excludes the invested type even if it stays the bottleneck (main.cpp:576-581). Stage 2 has no labour constraint. | Questionable | Goldratt's five focusing steps with labour as a resource; shadow prices (LP duals) for capacity, which come free with #8 | P1 |
| 19 | KPIs | ≈20 KPIs. Several formulas disagree with the catalogue or with each other (B8-B10). Little's law holds as an identity in *orders*, while throughput is in *tonnes*. | Partly wrong | ISO 22400-2:2014 = ГОСТ Р ИСО 22400-2-2019 definitions (OEE, availability, utilisation efficiency); Hopp & Spearman, *Factory Physics* (WIP = TH·CT, Kingman VUT) | P0 |
| 20 | Forecast engine | EMD trend (linear envelopes) + up to 3 harmonics + residual distribution chosen by AIC, then **accumulated as random-walk innovations** (main.cpp:2209-2245, 2366-2506) | Questionable (B11-B13) | ETS/ARIMA/STL baselines (Hyndman & Athanasopoulos 2021); Bayesian structural TS / Prophet; foundation models Chronos (arXiv:2403.07815), TimesFM (arXiv:2310.10688); evaluation by CRPS/pinball and MASE (Gneiting & Raftery 2007; Hyndman & Koehler 2006) | P1 |
| 21 | Macro risk factors | Drift = 0.012·sanctions − 0.0018·(rate−8); price level × energy^0.32 · logistics^0.18; fx and demand × price 1:1. Code comment: «Коэффициенты усилены, чтобы движение ползунков давало ЗАМЕТНЫЙ эффект» (main.cpp:2292-2297). | **Unscientific**: tuned for UI effect, not estimated | Estimate from data (VAR/ARDL on macro series, pass-through regressions) or cite the source of every elasticity | P0 |
| 22 | MRP | LLC netting and FOQ lot sizing are correct. The lead-time offset uses processing hours **per unit**, not per lot (main.cpp:2987-2993, 3061). | Bug (B14) | Standard time-phased MRP (Orlicky; ГОСТ-style planning); offset = lot cycle time | P1 |
| 23 | Calibration | Compares t_norm against (end−start)/batches **of the simulated plan** and rescales the norms (main.cpp:3176-3247) | **Wrong** (B7): circular and divergent | Calibrate against actual/fact data (plan-fact) by MLE/Bayesian updating; ЕОС ИМ 8.11 means *external* data | P0 |
| 24 | Reproducibility | mt19937 with seed (good). But `std::normal/gamma/exponential_distribution` are implementation-defined, so libc++ (macOS) ≠ libstdc++ (Linux). | Partial | Portable samplers (own Box–Muller/Ziggurat, or PCG + Boost.Random); log seed + version per run | P2 |

---

## 2. Bug list (verified in code)

| ID | Location | Bug | Impact | Fix |
|---|---|---|---|---|
| B1 | Scheduler.cpp:317 | Consumer sublot k waits only for input sublot `k·L/N` (L = number of input sublots), i.e. the *first* of the input sublots it needs; it must wait for the *last*: `ceil((k+1)·L/N)−1` | Consumer starts before its inputs exist when L>N (different batch sizes, or the 16-cap); makespan optimistic | Fix the index; add a test |
| B2 | Scheduler.cpp:287-288 | Memo key `order#product` reuses the first expansion's quantity when the same semi is consumed twice in one order | Missing work in the plan | Key on (order, product, qty) or accumulate qty before expanding |
| B3 | Scheduler.cpp:648-659, 476-486 | The "supply" pseudo-job (lead time, no machine) is **assigned a worker**, who is blocked for the whole supplier lead time | Inflated labour use and cost, artificial delays | Skip worker assignment when `wcType==""` |
| B4 | Scheduler.cpp:248-258, 676-680, 529 | `'24x7'` machines return `any=false`, so they are not inserted and **fall back to the global shift calendar** instead of running round the clock | Wrong capacity for 24×7 assets (blast furnace!) | Represent 24×7 explicitly |
| B5 | Scheduler.cpp:930, 993-1000 | Reported MC KPIs (makespan_mean/cvar/worst, tardiness_cvar, breakdowns) come from the **rule before local search**, while the Gantt and deterministic KPIs come from the improved key | Risk KPIs do not belong to the displayed plan | Re-run MC on the final key |
| B6 | main.cpp:585 vs 595 | NPV discounts at r/12 (nominal), IRR reported as effective (1+i)^12−1 | IRR vs. hurdle rate is biased (NPV=0 at nominal 18% shows IRR 19.6%) | Use r_m=(1+r)^{1/12}−1 everywhere; also report discounted payback; IRR<0 is reported as 0 (main.cpp:592) |
| B7 | main.cpp:3189, 3232-3239 | Calibration takes the plan generated from the norms as "fact". Stretch over non-working calendar time and PERT-mean/mode asymmetry give a constant ratio k≠1, and each Apply multiplies norms by k again. | Norms drift geometrically; the calibration is circular | Calibrate only on recorded fact; exclude calendar gaps; compare like with like (mean vs mean) |
| B8 | kpiCatalog.ts:83-85, 90-92 | SETUP_SHARE = Σsetup over all machines / makespan; AVAIL = 1−(Σmaint+Σbreak)/makespan | Values can exceed 100% or fall below 0 with many machines; this is not "коэффициент готовности" | Divide by Σ machine fund; K_г = MTBF/(MTBF+MTTR) (ГОСТ 27.002) |
| B9 | Scheduler.cpp:868-878, 898; main.cpp:3290-3311 | Machine utilisation = busy/global working fund (ignores per-machine calendars; busy includes PM/repair downtime). Worker utilisation = busy/makespan (calendar time). /simulation/results uses (end−start)/makespan with whole-bin counting. | Three incompatible "utilisation" definitions feed one Analytics screen | One definition (ISO 22400: APT/PBT), per-resource fund |
| B10 | kpiCatalog.ts:68-74 vs Scheduler.cpp:902-922; main.cpp:3321 | THRU: catalogue says "партий/дн"; code gives tonnes/day (Scheduler) and orders/day (/simulation). WIP: catalogue says "партий, шт"; code gives the average number of *orders*. WAIT: catalogue says order-level; code is job-level and counts calendar gaps as processing. | Mislabelled KPIs; Little's law cannot be checked | Align units (sublots); verify L=λW numerically as a test |
| B11 | main.cpp:2411-2420 + 2489-2506 | The distribution is fitted to **level residuals** (series − trend − harmonics) but used as **random-walk increments** | Fan width misspecified (wrong at every horizon) | Fit to Δlog-prices if RW; or keep residuals stationary (AR(1)) |
| B12 | main.cpp:2330, 2482 | Forecast slope = historical trend slope + scenario inflation | Inflation double-counted (history is nominal) | Deflate the history or use one of the two |
| B13 | main.cpp:2495-2499 | "t" uses an independent χ² per product, so it is **not multivariate t** (README claims it is). "stable" ignores the common factor M (correlation lost); E[exp(stable)] = ∞, so the reported mean is meaningless. ν is fitted by moments, but AIC assumes MLE. | False claims, lost dependence | Shared mixing variable; stable via a copula on CMS draws; MLE for ν |
| B14 | main.cpp:2987-2993, 3061 | MRP offset = Σ op hours per unit, not per lot | Need-by dates far too late; "late" flags missed | Multiply by planned qty/batch (and divide by parallel machines) |
| B15 | Optimizer.cpp:189 vs Scheduler.cpp:294,309 | Stage 2 treats t_norm as **per unit**, Stage 1 as **per batch** (scaled by qty/batch_size) | Silent capacity mismatch ×batch_size (latent: seed has batch_size=1) | One convention, documented in НСИ |
| B16 | main.cpp:580 | "Next bottleneck" excludes the invested type even if it remains the max | Misleading TOC narrative | argmax over all types |
| B17 | Optimizer.cpp:116-119, 188 | Stage 2 capacity/cost uses only the **first** wc type; Stage 1 is flexible across all types. Stage 2 applies efficiency 0.85; Stage 1 does not. | Inconsistent capacity between stages | Allocate flexible capacity in the LP |

**Smaller issues:** population SD /N (Optimizer.cpp:304); synthetic due dates `Σwork·(0.45+0.55(k+1)/n)` when none are given (Scheduler.cpp:668-671), so demo OTD is an artefact and must be disclosed; "price of robustness" compares against an x_exp *not* bound by maxShare (Optimizer.cpp:804, 912), mixing risk aversion with the diversification constraint; Stage-2 price SD not scaled with horizon (Optimizer.cpp:547-549); `componentsOf` (BOM via parent_id) built but unused, cost goes via `operation_inputs` (Optimizer.cpp:110-112) although OPTIMIZATION.md §2 says BOM.

**Doc–code mismatches a reviewer will catch:** β-PERT (is lognormal+Pareto); stochastic demand D_p and normal raw-material cost (absent / lognormal+jump); Penalty(x,ω) for capacity (absent); Stage-2 local search (absent); «активное расписание» (semi-active); «мультивариативный-t» (no); "classical two-stage stochastic program with recourse" (no); OTD "from MC" (deterministic); `SchedulingMethod 'cp-sat'` in src/domain/planning.ts (not implemented).

---

## 3. Scientific-rigour gaps

1. **No tests, no benchmark harness.** There is no test directory in backend or src. For a scheduling contribution the minimum is:
   - JSSP: FT06/10/20 (Fisher & Thompson 1963), LA01-40 (Lawrence 1984), Taillard 1993 (EJOR 64:278-285; BKS tables maintained online).
   - FJSP: Brandimarte MK01-10 (1993), Hurink edata/rdata/vdata (1994).
   - Report the gap to BKS and to CP-SAT under a time limit, plus a trivial lower bound LB = max(longest chain, max_type Σwork / #machines). That bound also gives a per-plan optimality-gap KPI.
2. **No statistical inference.**
   - Rule ranking is by point estimates on CRN. Use paired tests (Wilcoxon/paired t on CRN differences) or ranking & selection (Kim & Nelson 2006; OCBA).
   - E, CVaR and makespan have no confidence intervals (bootstrap).
   - There is no MC convergence study (SE of CVaR vs N).
3. **No sensitivity analysis.** Results depend on α, λ, maxShare, β/market_corr, elasticity, tail_weight/tail_index, rework 1.5×, the 3% tie tolerance and the 0.5/0.001 tardiness weights. Needed: one-at-a-time tornado plus global Sobol indices (Saltelli et al. 2008), and the robust-vs-expected frontier as a function of α.
4. **Undocumented magic constants** (put them in a thesis table, justified or exposed as parameters): Pareto cap 8, rework +0.5·mean; λ=(0.5+1.5u)/MTBF, repair CV 0.6; raw-material CV 0.20, jump p=0.06, α=2, cap 2.5; t ν=5, Pareto α=2.3; fallback price CV 12%; price-multiplier clip [0.5,1.3]; candidate scales 0.5/0.7, 80 random mixes; 16-sublot cap, N≤40 for large plans; macro coefficients 0.012/0.0018/0.32/0.18.
5. **No model V&V** in the sense of ГОСТ Р 57700.37-2021 (адекватность, верификация, валидация): no deterministic sanity cases (single machine ⇒ Cmax = Σp), no Little's-law / Kingman-VUT cross-checks of simulated queues, no face validation with plant data.
6. **Forecast evaluation is a single origin** (one cut, k≤12, MAPE vs naive; main.cpp:2628-2658). Needed: rolling-origin CV (≥12 origins), MASE, CRPS/pinball, 80/95% coverage, Diebold–Mariano vs naive/ETS/ARIMA. EMD with linear envelopes on 24-36 monthly points has known end effects (Huang et al. 1998; CEEMDAN, Colominas et al. 2014); picking harmonics by amplitude without a significance test (Fisher's g) overfits.
7. **Forecast ↔ optimiser disconnect.** The optimiser never consumes the forecast fan. It uses a static single-period distribution (scenario mean/SD × volMul), so "единый движок" holds only for the forecast screen. A multi-period plan needs scenario trees or path-based SAA.
8. **Units and horizon.** The demand-to-horizon conversion uses a 360-day year (8640 h). Stage 2 capacity × efficiency vs Stage 1 without efficiency. Document both.

---

## 4. Terminology (ГОСТ / Russian scientific usage)

| In MAOS | Problem | Recommended |
|---|---|---|
| «цифровой двойник» | Without a live data link this is a *digital model* (Kritzinger et al. 2018, IFAC-PapersOnLine 51(11)); ГОСТ Р 57700.37-2021 requires adequacy, V&V and data exchange | «цифровая (имитационная) модель производства / прототип ЦД» |
| «двухстадийная стохастическая модель… рекурс» | Clashes with «двухэтапная задача стохастического программирования» (Юдин 1979; Ермольев 1976), which has scenario-wise recourse | «иерархическая двухуровневая модель планирования (объёмное → календарное)» |
| «устойчивое решение» | In Russian OR «устойчивость» = stability radius (Леонтьев, Гордеев) | «робастное решение»; «цена робастности» (Bertsimas & Sim 2004) |
| makespan / «длительность плана» | — | «длина расписания» (Танаев, Сотсков, Струсевич 1989), «длительность производственного цикла» |
| «проходка» | A mining term | «темп выпуска / пропускная способность» |
| «НЗП (шт)» | НЗП is a value (accounting) term | «задел (технологический/оборотный)», or НЗП in натуральных единицах explicitly |
| «техкарта» | ЕСТД terms | «технологический маршрут / маршрутная карта» (ГОСТ 3.1118-82, ГОСТ 3.1109-82) |
| «Готовность (availability)», MTBF | Wrong formula | «коэффициент готовности», «средняя наработка на отказ» (ГОСТ 27.002-2015) |
| NPV/IRR/payback | — | ЧДД, ВНД, ИД, простой/дисконтированный срок окупаемости (Метод. рекомендации ВК 477, 1999) |
| KPI catalogue «Palantir-grade» | Marketing tone | Reference ГОСТ Р ИСО 22400-2-2019 (≡ ISO 22400-2:2014) |
| «тяжелохвостные», «Монте-Карло» | Colloquial | «распределения с тяжёлыми хвостами», «метод статистических испытаний (Монте-Карло)» |
| CVaR | — | «условная стоимость под риском (CVaR, Expected Shortfall)», a coherent risk measure (Artzner et al. 1999; Acerbi & Tasche 2002) |

Also: the two numbering schemes "Стадия 1/2" (model stages) and "Стадии A-L" (roadmap) collide. Rename roadmap items to «этапы».

---

## 5. Prioritised methodology-upgrade plan

**P0 — must fix before the defence (≈2-3 weeks)**
1. Fix B1, B3, B4, B5, B6, B7, B8-B10, B14 and add regression tests (GoogleTest) with hand-checkable instances.
2. Stage 2: replace or augment candidate search with the **exact Rockafellar–Uryasev CVaR LP** (HiGHS, MIT licence, C++). Keep the heuristic pool as a baseline and report the gap between heuristic and exact CVaR. This becomes the strongest single result chapter, and capacity shadow prices then give an exact TOC/investment signal.
3. Rename the "two-stage stochastic program" to a hierarchical model, or implement real SAA two-stage (P2).
4. Remove or justify the UI-tuned macro coefficients (main.cpp:2294-2297); either estimate them from `macro_ts`/`ts_data` or mark them as expert assumptions with sources.
5. Investment: consistent monthly rate; ЧДД, ВНД and discounted payback per ВК 477; E[NPV], P(NPV<0) and a CI from the CRN scenarios; O&M and operator cost for the added machines.
6. A KPI definitions chapter aligned with ГОСТ Р ИСО 22400-2-2019, with a unit test asserting L=λW on generated plans.

**P1 — expected by a 2026 reviewer (≈3-4 weeks)**
7. **Benchmarks:** run the scheduler on FT/LA/Taillard (JSSP) and Brandimarte/Hurink (FJSP); compare rules, the improver and **OR-Tools CP-SAT** (time-limited) by %gap to BKS and LB; add a time-to-quality profile.
8. **Statistics:** bootstrap CIs for E/CVaR/Cmax; paired tests on CRN for rule and portfolio comparisons; a convergence plot of N vs SE; Mak–Morton–Wood optimality gap for the SAA solution.
9. **Sensitivity:** tornado plus Sobol over the ~10 key parameters; a robust-vs-expected frontier over α∈{0.01…0.5}.
10. Correct the distribution-family scaling (table row 12: σ mismatch), use exact t quantiles, avoid hard-clip point masses; split epistemic vs per-batch noise in unit cost (#13).
11. Forecast: rolling-origin evaluation with MASE/CRPS/coverage vs naive, ETS and ARIMA (and optionally Chronos/TimesFM zero-shot as a 2024-26 baseline); fix B11-B13; feed the forecast paths into Stage 2 (horizon-average price per path) so the "единый движок" claim becomes true.
12. Correlation: full matrix + Cholesky (PSD repair), optionally a t-copula for tail dependence (ROADMAP F3).
13. Demand: stochastic demand with expected sales E[min(q,D)]; constant-elasticity inverse demand; correct the "elasticity" term.

**P2 — differentiators / future work**
14. Wasserstein-DRO CVaR portfolio (tractable LP/SOCP reformulation, Mohajerin Esfahani & Kuhn 2018) with the radius chosen by OOS cross-validation; this directly answers "what if the price distributions are wrong".
15. True two-stage SAA: first stage = portfolio x, second stage = per-scenario overtime/outsourcing/lost-sales recourse; or a simulation-optimisation loop with Stage 1 as the oracle (Amaran et al. 2016).
16. Learning to dispatch (HGNN-PPO, Song et al. 2023) trained on the plant's own instance distribution, compared against CP-SAT and the rules on the same benchmarks.
17. Portable RNG samplers plus a per-run provenance record (seed, code version, data hash) for reproducibility.

---

## 6. Key references

- Rockafellar R.T., Uryasev S. (2000) J. of Risk 2(3):21-41; (2002) J. Banking & Finance 26:1443-1471.
- Artzner P. et al. (1999) Math. Finance 9(3); Acerbi C., Tasche D. (2002) J. Banking & Finance 26(7).
- Bertsimas D., Sim M. (2004) "The Price of Robustness", Oper. Res. 52(1).
- Mohajerin Esfahani P., Kuhn D. (2018) Math. Programming 171:115-166; Kuhn D., Shafiee S., Wiesemann W. (2025) "Distributionally Robust Optimization", Acta Numerica 34:579-804, arXiv:2411.02549.
- Kleywegt A., Shapiro A., Homem-de-Mello T. (2002) SIAM J. Optim. 12(2); Mak W.K., Morton D., Wood R.K. (1999) Oper. Res. Lett. 24; Shapiro, Dentcheva, Ruszczyński (2021) *Lectures on Stochastic Programming*, 3rd ed., SIAM; Birge J., Louveaux F. (2011) *Introduction to Stochastic Programming*, Springer.
- Юдин Д.Б. (1979) *Задачи и методы стохастического программирования*; Ермольев Ю.М. (1976) *Методы стохастического программирования*.
- Naderi B., Ruiz R., Roshanaei V. (2023) INFORMS J. Computing 35(4):817-843 (CP vs MIP for shop scheduling); Taillard E. (1993) EJOR 64:278-285; Brandimarte P. (1993) Annals OR 41; Giffler B., Thompson G. (1960) Oper. Res. 8(4).
- Танаев В.С., Сотсков Ю.Н., Струсевич В.А. (1989) *Теория расписаний. Многостадийные системы*.
- Zhang C. et al. (2020) NeurIPS, arXiv:2010.12367; Song W., Chen X., Li Q., Cao Z. (2023) IEEE TII 19(2):1600-1610; Corsini A. et al. (2024) NeurIPS, arXiv:2401.11849; Branke J. et al. (2016) IEEE TEVC 20(1).
- Trietsch D., Baker K. (1993) Oper. Res. 41(6); Chang J., Chiu H. (2005) IJPR 43(7) lot-streaming review.
- Keefer D., Verdini W. (1993) Management Science 39(9) (PERT approximations).
- Maravelias C., Sung C. (2009) Comput. Chem. Eng. 33(12) (planning–scheduling integration); Amaran S. et al. (2016) Annals OR 240 (simulation optimisation); Kim S.-H., Nelson B. (2006) Handbooks in OR&MS 13 (R&S).
- McNeil A., Frey R., Embrechts P. (2015) *Quantitative Risk Management*; Higham N. (2002) IMA J. Numer. Anal. 22 (nearest correlation matrix).
- Hyndman R., Athanasopoulos G. (2021) *FPP3*; Hyndman R., Koehler A. (2006) IJF 22(4) (MASE); Gneiting T., Raftery A. (2007) JASA 102 (CRPS); Diebold F., Mariano R. (1995) JBES 13; Huang N. et al. (1998) Proc. R. Soc. A 454 (EMD); Colominas M. et al. (2014) BSPC 14 (CEEMDAN); Ansari A. et al. (2024) Chronos, arXiv:2403.07815; Das A. et al. (2024) TimesFM, ICML, arXiv:2310.10688.
- Hopp W., Spearman M. *Factory Physics* (3rd ed.); Little J. (1961) Oper. Res. 9(3); Saltelli A. et al. (2008) *Global Sensitivity Analysis*.
- Kritzinger W. et al. (2018) IFAC-PapersOnLine 51(11):1016-1022.
- ГОСТ Р ИСО 22400-2-2019 (≡ ISO 22400-2:2014); ГОСТ Р 57700.37-2021; ГОСТ 27.002-2015; ГОСТ 3.1109-82; ГОСТ 3.1118-82; Методические рекомендации по оценке эффективности инвестиционных проектов (утв. Минэкономики, Минфином, Госстроем РФ 21.06.1999 № ВК 477).

Web-verified during this audit:
- [Kuhn et al., DRO, arXiv:2411.02549](https://arxiv.org/abs/2411.02549v1)
- [Naderi et al. 2023, IJOC](https://pubsonline.informs.org/doi/fpi/10.1287/ijoc.2023.1287)
- [Song et al. 2023, IEEE TII](https://ink.library.smu.edu.sg/sis_research/8197)
- [Corsini et al. 2024, arXiv:2401.11849](https://arxiv.org/abs/2401.11849v3)
- [ГОСТ Р ИСО 22400-2-2019](https://cn.gostinfo.ru/catalog/Details/?id=6472536)
- [ГОСТ Р 57700.37-2021](https://cn.gostinfo.ru/catalog/Details/?id=6869870)
- [ВК 477 (КонсультантПлюс подборка)](https://www.consultant.ru/law/podborki/diskontirovannyj_srok_okupaemosti/)
