# A4 — A "learning economy" scaled down to one plant: RL / MARL / mean-field inside MAOS

Research brief, 2026-10-18. Grounded in `backend/src/Scheduler.cpp`, `backend/src/Optimizer.cpp`, `docs/SCHEDULING.md`, `docs/OPTIMIZATION.md` (read-only). arXiv ids were checked against their abstract pages. "(journal)" entries were checked through publisher or repository pages.

## 0. Bottom line

1. The macro programme maps onto one plant cleanly:

   | Macro idea | Plant equivalent |
   |---|---|
   | Agents | Machine / wc-type dispatchers |
   | Sectors | Shop managers (цех) |
   | Planner | Plant planner setting internal transfer prices and bonuses (AI Economist style) |
   | "Equations and balances" | The MAOS discrete-event simulator |
   | Common noise | Plant-wide shocks. MAOS already has one: the market factor `M` in the Optimizer's copula. |

2. **Enforce material balance with the simulator and action masks, not with PINN losses.** PINN-style terms only help where we *learn* a surrogate, such as a planner world model. Even there, prefer a hard projection layer.
3. **Mean-field means parameter sharing plus a pooled peer state per wc type.** A plant has K≈1–10 machines per type, so asymptotic MFG claims are weak. The interesting quantity is the **price of anarchy** between a mean-field game and mean-field control: how much the shop KPIs/bonuses destroy.
4. **Best inefficiency lens:** compare the planner's learned transfer prices with the LP shadow prices of the Stage-2 capacity constraints. Validate every claim by intervention in the simulator, using common random numbers (CRN).
5. **Where RL does not pay:**
   - static deterministic plant-size schedules, where CP-SAT wins
   - the Stage-2 portfolio, where a CVaR LP/MILP is exact

   **Where it does:** online re-dispatch under heavy tails, breakdowns and shocks, and the bilevel incentive study.

---

## 1. Literature map

### 1.1 Learning to dispatch (JSSP/FJSP), self-improvement
| Work | Takeaway |
|---|---|
| Zhang, Song, Cao, Zhang, Tan, Xu — *Learning to Dispatch for JSSP via DRL* (L2D), NeurIPS 2020, arXiv:2010.12367 | GNN on the disjunctive graph, PPO, size-agnostic. The template for a step-level dispatcher. |
| Song, Chen, Li, Cao — *FJSP via GNN and DRL*, IEEE TII 19(2) 2023 (journal) | Heterogeneous graph, composite (op, machine) action. Exactly MAOS's FJSP decision. |
| Wang, Wang, Sun, Deng, Chen — *FJSP via Dual Attention Network RL*, arXiv:2305.05119 | Attention instead of message passing. Exports to ONNX more easily. |
| Zhang, Cao, Song, Wu, Zhang — *DRL Guided Improvement Heuristic for JSSP*, ICLR 2024, arXiv:2211.10936 | Learned improvement moves. The analogue of MAOS's `improveIters` hill-climb. |
| Tassel, Gebser, Schekotihin — *End-to-End RL for JSSP Based on CP*, ICAPS 2023, arXiv:2306.05747 | RL beats a CP solver only on *very large* instances at equal time. The honest RL-vs-CP reference. |
| Corsini et al. — *Self-Labeling the JSSP* (SLIM), NeurIPS 2024, arXiv:2401.11849 | Sample K schedules, imitate the best. Self-improvement without an exact solver. |
| Pirnay, Grimm — *Self-Improvement for Neural CO*, TMLR 2024, arXiv:2403.15180 | A provably improving self-labelling loop. |
| Laterre et al. — *Ranked Reward: Self-Play RL for CO*, NeurIPS-W 2018, arXiv:1807.01672 | Single-player self-play: reward = beating your own recent percentile. |
| Tang, Zakwan, Balta, Lygeros, Rupenyan — *DRL for FJSP with Random Job Arrivals*, arXiv:2605.22773 (2026) | PPO *selects among dispatching rules*. Beats every single rule and is competitive with MIP. Validates our MVP. |
| Lassoued et al. — *Policy-Based DRL Hyperheuristics for JSSP*, arXiv:2601.11189 (2026) | A rule-selection policy with action filtering and commitment. Interpretable decisions. |
| Smit et al. — *GNNs for JSSP: A Survey*, Computers & OR, arXiv:2406.14096 | A current architecture map. |
| Berto et al. — *RL4CO*, KDD 2025, arXiv:2306.17100 | TorchRL-based. The repo ships `jssp`, `fjsp`, `ffsp` and `smtwtp` envs. |
| Reijnen et al. — *Job Shop Scheduling Benchmark*, arXiv:2308.12794 | One harness for heuristics, exact methods and DRL over Taillard, Brandimarte and others. |

### 1.2 MARL on the shop floor, hierarchical RL
| Work | Takeaway |
|---|---|
| Xu, Gu, Zhang, Gen, Ohwada — *MARL for Flexible Shop Scheduling: a Survey*, Frontiers in Ind. Eng. 2025 (journal) | Job/machine agents, CTDE, QMIX/VDN, hierarchies. Open problems: credit assignment, sparse reward, scale. |
| Jang, Klabjan, Liu, Patel et al. — *Scalable MARL for Factory-wide Dynamic Scheduling*, arXiv:2409.13571 | Leader–follower MARL (Intel-affiliated) with a rule-based safety "conversion". A blueprint for manager → machine agents. |
| Stöckermann et al. — *Scalability of RL for Dispatching in Semiconductor Fabs*, arXiv:2505.11135 | ES scales better than policy gradient on real fab data, giving ≤4% tardiness gain. **Which bottleneck tools the agents control is crucial.** |
| Liu, Piplani, Toro — IJPR 60(13) 2022 · Chang et al. — Machines 10(12) 2022 (journal) | Hierarchical DDQN (routing vs sequencing; goal selector plus dispatcher) for dynamic FJSP. |
| Yu et al. — *Surprising Effectiveness of PPO in Cooperative MARL* (MAPPO), NeurIPS D&B 2022, arXiv:2103.01955 | Shared-parameter PPO with a centralised critic is a strong default. |

### 1.3 Constraints: masking, Lagrangian, projection, physics-informed
| Work | Takeaway |
|---|---|
| Huang, Ontañón — *Invalid Action Masking in Policy Gradient*, FLAIRS 2022, arXiv:2006.14171 | Masking is a valid policy gradient and far better than penalties. |
| Achiam et al. — *CPO*, ICML 2017, arXiv:1705.10528 · Stooke, Achiam, Abbeel — *PID Lagrangian*, ICML 2020, arXiv:2007.03964 | CMDP solvers. The PID multiplier removes oscillation. Our choice for soft constraints. |
| Agrawal et al. — *Differentiable Convex Optimization Layers*, NeurIPS 2019, arXiv:1910.12430 · Dalal et al. — *Safety layer*, arXiv:1801.08757 · Donti, Rolnick, Kolter — *DC3*, ICLR 2021, arXiv:2104.12225 | Exact or cheap projection onto feasible polyhedra inside a network |
| Chen, Constante Flores, Li — *PINNs with Hard Linear Equality Constraints* (KKT-hPINN), arXiv:2402.07251 | A KKT projection layer enforces **mass balances exactly** in process surrogates |
| Banerjee, Nguyen, Fookes, Raissi — *Survey on Physics Informed RL*, ESWA 287 (2025), arXiv:2309.01909 | Physics enters via state, reward, learned model, constraints or architecture |
| Tamar, Glassner, Mannor — *Optimizing the CVaR via Sampling*, AAAI 2015, arXiv:1404.3862 | A CVaR policy gradient that matches MAOS's CVaR objectives |

### 1.4 Mean field, common noise, mechanism design
| Work | Takeaway |
|---|---|
| Yang et al. — *Mean Field MARL*, ICML 2018, arXiv:1802.05438 | Q(s,a,ā) with the mean neighbour action. The parameter-sharing pattern. |
| Carmona, Laurière, Tan — *Model-Free Mean-Field RL*, arXiv:1910.12802 | Cooperative mean-field **control with common noise**. Fits machines owned by one plant. |
| Laurière et al. — *Learning in MFGs: A Survey*, arXiv:2205.12944 | Fictitious play, OMD and deep MFG solvers |
| Wu, Laurière, Geist, Pietquin, Mehta — *Population-aware OMD for MFGs with Common Noise*, CDC 2025, arXiv:2509.03030 | Policies conditioned on the population and the common noise |
| Zheng, Trott, Srinivasa, Parkes, Socher — *The AI Economist*, arXiv:2108.02755 | Two-level RL: the planner shapes agent rewards. Curriculum plus entropy annealing. Agents game the tax. |
| Gerstgrasser, Parkes — *Oracles & Followers: Stackelberg in Deep MARL*, arXiv:2210.11942 | Stackelberg as MARL with contextual followers |
| Ivanov, Dütting, Talgam-Cohen, Wang, Parkes — *Principal-Agent RL with Contracts*, arXiv:2407.18074 · Yang et al. — *LIO*, NeurIPS 2020, arXiv:2006.06051 | A formal version of "planner bonuses" |
| Chen, Cont, Joseph, Kumhof, Pan, Xiong, Zhou — *Deep RL in a Monetary Model*, BoE Staff WP 1,142 (Sep 2025); arXiv:2104.09368 | DRL **households** in DSGE. They find all equilibria, but learning is slow and unstable without early stopping. |

### 1.5 Interpretability, PBT, LLM/agentic, evaluation, tooling
| Work | Takeaway |
|---|---|
| Jaderberg et al. — *Population Based Training*, arXiv:1711.09846 | Exploit/explore over hyperparameters and reward weights |
| Bastani, Pu, Solar-Lezama — *VIPER*, arXiv:1805.08328 | Distil a DNN policy into a decision tree |
| Hu, Zhang, Baier — *Scheduling That Speaks* (ProRL), arXiv:2605.18454 (2026) | Policies as editable DSL programs, competitive at ~100 episodes. Close to MAOS's `CUSTOM` constructor. |
| Ye et al. — *ReEvo*, NeurIPS 2024, arXiv:2402.01145 | An LLM evolves heuristic code. A cheap outer loop for `CUSTOM` rules. |
| Abgaryan, Cazenave, Harutyunyan — *Starjob*, arXiv:2503.01877 | An LoRA-tuned 8B LLM beats PDRs and L2D on JSSP. Still far from CP-SAT. |
| Zhao et al. — *LLM-based Multi-Agent Manufacturing System*, Adv. Eng. Inf. 69 (2026), arXiv:2405.16887 | LLM agents negotiate machine assignment with no simulator training |
| Shi et al. — *Automated Constraint Specification for Job Scheduling*, IEEE T-ASE, arXiv:2510.02679 | LLMs turn factory data into constraints. Useful for building the НСИ. |
| Bahrpeyma, Reichelt — *MARL-Centred Reference Architecture for LLM Augmentation*, arXiv:2608.07148 (Aug 2026) | MARL for fast control; LLMs for interpretation, reward design and supervision |
| Agarwal et al. — *Deep RL at the Edge of the Statistical Precipice* (rliable), NeurIPS 2021, arXiv:2108.13264 | IQM, bootstrap CIs and performance profiles |
| TorchRL arXiv:2306.00577 · BenchMARL arXiv:2312.01472 · JaxMARL arXiv:2311.10090 · Gymnasium arXiv:2407.17032 | Tooling (§3) |

Sim-to-real for scheduling is mostly journal work, such as the digital-twin RL "Digital Model Playground" (Discover IoT 2024). Real deployments are rare, and the strongest evidence comes from semiconductor fabs. Use domain randomisation (Tobin et al., arXiv:1703.06907) over MAOS's stochastic parameters.

---

## 2. Single-plant formulation for MAOS

### 2.1 What MAOS already gives
**`simulate()` does list scheduling over the `Expander` DAG:**
- The DAG covers routings, BOM inputs with batch-k ↔ batch-k transfer-batch coupling (lot streaming, ≤16 batches) and a supply-lead op when stock is short.
- The machine is the least-loaded one across *all* allowed `wcTypes` (FJSP). The worker is the least-busy *eligible* one.
- It models setups on product change, maintenance by usage, and breakdowns with λ=(1/MTBF)(0.5+1.5·util) and lognormal repair. Calendars apply per machine.

**`sample_dur`:** PERT→lognormal durations plus a Pareto tail mixture plus a rework Bernoulli. `durMC`/`brng` give CRN across rules.

**Baselines and score:** 7 rules, a `CUSTOM` linear rule over {duration, due, rem, inputs, setup} and key-perturbation hill-climbing. The score is `wTime·E[mk] + wRisk·(CVaR−E) + wCost·setupMin + 0.5·E[tard]`.

**`Optimizer`:**
- z_s = β_s·M + √(1−β_s²)·ε_s. This is already common noise.
- Σ_p x_p·hpu_{p,w} ≤ Cap_w
- a CVaR objective
- the `machineBonus` what-if

### 2.2 Agents
| Level | Macro analogue | MAOS agent | Clock | Action |
|---|---|---|---|---|
| L0 | firm | **machine dispatcher**, policy θ_w shared per wc type | its machine goes idle | ready op from its eligible queue, or WAIT (optionally also the worker) |
| L1 | sector | **shop manager** per цех / wc group | shift | rule/weight vector for its machines, WIP cap, overtime |
| L2 | planner | **plant planner** | day/period | transfer price π_w ≥ 0 per machine-hour of type w, order bonus b_k, release plan |

**State.**
- L0 sees: per queued op (mean duration, slack = due − now − rem, setup-needed flag, nInputs, BOM depth), its own `lastProd`, usage since maintenance, breakdown flag, the peer mean field μ_w and the common shock z_t.
- L1 sees: WIP/queue histograms, utilisation and backlog.
- L2 sees: WIP and finished goods by product, the gap between backlog and portfolio x_p, z_t and the price regime.

**Rewards.**
- **Cooperative variant:** r = −Δ(makespan LB) − c_T·Δ(tardiness estimate) − c_S·setup_min − c_E·energy_cost. Energy is an exogenous tariff × machine-hours (ТЭБ as cost only). Dense L2D-style deltas aid credit assignment. Risk enters at episode level through a CVaR policy gradient (re-weight the worst α of episodes under CRN).
- **Incentive (AI Economist) variant:**
  - L1 maximises its own KPI: value of ops completed at internal prices − π_w·busy hours − setup cost + Σ b_k·[order k handed on time].
  - L2 maximises the true plant objective: CVaR_α of profit (on-time revenue − cost − tardiness penalty) over common-noise scenarios.
  - This is a Stackelberg game with a slower planner clock.

### 2.3 Material balance and capacity
For each product p, including semi-finished goods:

  I_p(t) = I_p(0) + Σ_{completed ops producing p, ≤t} q_out − Σ_{started ops consuming p, ≤t} q_in·qty_in ≥ 0

Add disjunctive machine capacity, worker eligibility, calendars and, at Stage 2, Σ_p x_p·hpu_{p,w} ≤ Cap_w.

| Constraint | Mechanism | Why |
|---|---|---|
| Precedence, BOM inputs, stock ≥ 0, one op per machine, eligible worker, calendar | **By construction plus action mask:** an op is selectable only if its inputs exist, its predecessors are done, the type is allowed and a worker is free | Exact and cheap. The simulator *is* the conservation law. |
| WIP caps, energy budget, CVaR(tardiness) ≤ τ, Stage-2 commitments | **CMDP + PID-Lagrangian** | Soft aggregates. The multipliers λ are readable "constraint prices". |
| Planner's continuous plan (capacity hours or releases with BOM flow A·y = b) | **Projection layer**: y − Aᵀ(AAᵀ)⁻¹(Ay − b) plus a clip, or cvxpylayers / DC3 when inequalities bind. Prices via softplus. | Flow continuity of the plan, differentiable |
| Learned surrogate (neural MC-KPI emulator or flow model used to pre-train L2) | **KKT-hPINN hard layer**, or residual ‖A·ŷ − b‖² | The only place arXiv:2309.01909 adds value |

### 2.4 Common noise
Idiosyncratic noise already exists: durations, tails, rework, per-machine breakdowns. Add one plant-wide z_t:
- a demand shock (rush orders or due-date pull-in)
- the market regime M, made dynamic as OU/jump-diffusion on M(t) (the friend's SDE angle)
- shared supply delay (`supplyLead`)
- an energy tariff spike or curtailment window
- absenteeism (shrinks the skill matrix)

Keep CRN across policies, as `durMC` already does. Make policies noise- and population-aware (z_t and μ_w in the observation, following Wu et al. 2025). Report CVaR *conditional* on shocks.

### 2.5 Mean-field reduction
For a type w with K_w identical machines:
- One shared θ_w.
- The observation is the local state plus μ_w: a histogram of peers' remaining busy time, the share set up for each product family, and broken/maintenance shares. Add the mean peer action ā (Yang 2018).
- Permutation-invariant pooling (DeepSets/attention), so one network serves any K_w, including `machineBonus` what-ifs without retraining.

Two solution concepts:
- **MFC** (cooperative, Carmona–Laurière–Tan): the right model for one owner.
- **MFG** (Nash): the incentive variant.

**PoA = J_MFG / J_MFC** quantifies the cost of the KPI/bonus system. It is a clean thesis metric. With K_w≈1–10 the O(1/√K) error is real, so present mean field as architecture and analysis, not as an asymptotic theorem.

### 2.6 Recursive self-improvement (gated)
1. **Self-labelling / expert iteration** (SLIM, Pirnay & Grimm): sample K=32 rollouts, evaluate under CRN, imitate the best, and add a PPO term.
2. **Improvement layer:** apply the existing hill-climb or a learned improver to π's schedule. Improved schedules become labels, closing the loop.
3. **PBT** over learning rate, entropy, c_T/c_S and PID gains.
4. **Curriculum:** size, tail weight, MTBF and shock intensity grow when the champion's win-rate exceeds 60%.
5. **League:** the planner trains against snapshots of past shop agents. AI Economist two-phase scheme: agents without a planner first, then co-adaptation with entropy annealing.
6. **Optional LLM outer loop** (ReEvo-style) proposing `CUSTOM` programs or reward terms.
7. **Gate:** a challenger is promoted only if its held-out IQM gain has a paired-bootstrap 95% CI excluding 0 and no multiplier diverges. Without the gate, "self-improvement" means drift and the agent exploiting simulator artefacts, such as the 16-batch cap or the >4000-job single-batch guard.

### 2.7 Reading policies to expose hidden inefficiencies
Read behaviour and gradients, not raw weights.

| Probe | Signal | Inefficiency |
|---|---|---|
| Planner π_w vs **LP duals** y_w of the Stage-2 capacity rows (LP relaxation via HiGHS/GLOP) vs utilisation | High π_w at mid utilisation | A **phantom bottleneck**: losses from sequencing, setups or BOM synchronisation. Fix with SMED or batching, not machines. |
| ∂V/∂(queue at w), ∂V/∂K_w (critic gradients, integrated gradients) | Marginal value of WIP or of a machine | A **shifting bottleneck**. Cross-check `machineBonus` ROI. |
| Lagrange multipliers | Shadow price of WIP/energy/CVaR limits | Over-tight caps that cost throughput |
| Rule heat-map (type × shift × shock), VIPER tree, linear fit to `CUSTOM` weights | E.g. MWKR only at one type, only under shocks | A shock-sensitive chain. Gives a shippable interpretable rule. |
| WAIT frequency (non-delay violations) | Deliberate idling despite a queue | Downstream blocking or starvation. Buffer sizing. |
| Incentive variant: op-length mix per shop, PoA | Cherry-picking short ops, WIP hoarding | A **KPI-design flaw** (the AI Economist's "tax gaming") |
| Counterfactual credit (COMA / Shapley over machines) | Whose decisions move the KPI | Where automation or attention pays |

Every finding becomes a simulator A/B test under CRN, with a CI on the KPI delta. For example: "−30% setup at w" vs "+1 machine at w".

---

## 3. Engineering architecture

```
MAOS DB ─export─► instance.json (Model+Jobs+calendars+shock params; frozen, versioned)
                       │
      ┌────────────────▼─────────────────┐
      │ C++ SimEnv (new, beside simulate)│ reset(seed,inst) / step(a) / mask / obs
      │ event-driven, CRN RNG streams    │
      └──────┬──────────────────┬────────┘
   pybind11 (in-process, µs)    └─ HTTP /api/rl/* (UI train/eval buttons, remote eval)
             │
 Gymnasium (single) / PettingZoo ParallelEnv (MARL) → MaskablePPO | RL4CO | BenchMARL
             │ torch.onnx.export (padded sets + mask input, dynamic axes)
             ▼
 ONNX Runtime C++ in Scheduler: rule "RL" beside EDD/SPT/… → Gantt, KPIs, rule comparison
```

**The key refactor.**
- Today's `simulate()` is a *serial* schedule-generation scheme: it pops ops in key order and appends them at machine-free time. Ops are placed out of time order, so "plant state at time t" is undefined.
- Machine agents acting at idle events need an **event-driven (Giffler–Thompson / non-delay) stepper**. The `ready.top()` pop becomes the op action; the least-loaded `consider()` loop becomes the machine action.
- Build `SimEnv` as a new class reusing `Model`, `Job`, `Expander`, `sample_dur`, calendars and the breakdown logic. Leave `simulate()` untouched.
- GoogleTest equivalence: (a) a fixed rule in the stepper matches the serial result where the semantics coincide; (b) the serial-vs-event KPI gap is reported for every rule, as a finding in itself.

**pybind11, not HTTP, for training.** At 10⁶–10⁷ decisions, ~1 ms of HTTP per step costs hours of pure overhead. Vectorise N C++ envs in a thread pool; rule evaluation already uses `std::thread`.

| Stack | Pros | Cons | Use |
|---|---|---|---|
| sb3-contrib MaskablePPO / CleanRL | Minimal, masking built in | Single-agent, weak GNN support | Phase 1 |
| RL4CO (TorchRL) | FJSP/JSSP/FFSP envs, attention models | TensorDict-native, so the C++ env needs an adapter | Phase 2 benchmarks |
| BenchMARL (TorchRL) | MAPPO/IPPO/QMIX/MASAC, reproducible configs | Young | Phase 3 (recommended) |
| RLlib (Ray) | Hierarchical multi-agent, PBT via Tune | Heavy on a laptop, API churn | Only for large PBT |
| JaxMARL | 10–1000× faster *if the env is JAX* | C++ env: no jit, no gain | Skip |

**ONNX.** Prefer attention over padded candidate sets to scatter-based GNNs, which export poorly. Pass the mask as an input. Use ONNX Runtime C++ (Homebrew build on macOS). Inference should be ≪1 ms per decision. Fall back to the best rule on load error.

**Baselines:**
- the 7 rules plus `CUSTOM` plus hill-climb
- **ATC/COVERT** (to add)
- **OR-Tools CP-SAT** FJSP: optional intervals for machine choice, `NoOverlap`, worker cumulative constraints, setup gaps. Solve on means, then evaluate in the MC simulator. Use a scenario variant on small instances to bound the value of stochastic information.
- a GA over priority keys

**Evaluation:**
- Public benchmarks: Taillard (JSSP) and Brandimarte mk01–10 / Hurink (FJSP) via the Reijnen harness, reported as gap to best-known.
- MAOS instances: deterministic and stochastic (tails, MTBF, shocks).
- ≥5 training seeds × ≥200 CRN evaluation scenarios.
- Metrics: E[mk], E[tard], CVaR₀.₁, OTD and wall-time, as IQM with bootstrap 95% CIs and performance profiles (rliable).
- Paired Wilcoxon test against the best rule. CP-SAT time-matched at 1/10/60 s.
- Generalisation splits: larger instances, unseen mixes, shifted tails.

**Laptop budget** (Apple Silicon CPU/MPS, order-of-magnitude; measure in Phase 0):

| Run | Estimate |
|---|---|
| MaskablePPO with MLP | 2–5 M decisions ≈ 1–3 h |
| Attention FJSP dispatcher | overnight |
| MAPPO on 4–8 agent groups | 6–12 h |
| PBT, population 4–8 | 1–2 nights |
| Bilevel planner | days, so pre-train it on a learned surrogate with a KKT-hPINN layer |

---

## 4. Roadmap and risks

| Phase | Time | Deliverable |
|---|---|---|
| 0 Infra | days 1–4 | Instance export; event-driven `SimEnv` with masks plus equivalence tests; pybind11 module; Gymnasium env; baseline harness (rules, ATC, CP-SAT small) |
| 1 MVP-a | days 5–10 | **Rule-selection hyper-heuristic** (7 rules or `CUSTOM` presets per wc type per event), MaskablePPO with CRN, tails and breakdowns. CIs vs the best fixed rule. VIPER tree plus rule heat-map. |
| 2 MVP-b | days 11–18 | Direct (op, machine) attention dispatcher; Brandimarte/Taillard; ONNX → rule "RL" in `/api/schedule`; UI comparison. **MVP ≈ 2.5–3 weeks.** |
| 3 MARL | +3–4 wk | Machine agents with mean-field pooling, MAPPO (BenchMARL); PID-Lagrangian WIP/energy/CVaR; common-noise shocks; serial vs event analysis |
| 4 Bilevel | +3–4 wk | Planner prices and bonuses (AI Economist curriculum); learned prices vs LP duals; PoA (MFG vs MFC); gaming detection |
| 5 Thesis | +2–3 wk | Gated self-improvement loop (self-labelling + PBT + league); intervention-validated inefficiency case studies; write-up |

**Where RL is not worth it, and the risks:**
- **Static deterministic FJSP of plant size** (≤ a few thousand ops): CP-SAT matches or beats RL and gives optimality gaps. Tassel 2023 needed very large instances for RL to win.
- **Stage 2:** a Rockafellar–Uryasev CVaR LP/MILP over scenarios is exact and explainable. Replace candidate generation with it before considering RL.
- **Simulator exploitation:** batch caps, the job guard and the util-dependent breakdowns invite reward hacking. Mitigate with domain randomisation, the gate, and audits of WAIT behaviour.
- **Bilevel non-stationarity and multiple equilibria:** both the AI Economist and BoE WP 1,142 report slow, fragile learning. Use seeds × equilibrium reporting, early stopping and a fixed-planner ablation.
- **Small-K mean-field error and interpretability illusions:** interventions are mandatory.
- **Scope creep:** "thousands of agents" does not apply to one plant. Keep the contribution to:
  - robust online dispatch under heavy tails and common noise
  - the PoA price-of-incentives metric
  - learned-price vs LP-dual diagnostics

RL pays for millisecond reactive re-dispatch under breakdowns and shocks, for generalisation across product mixes without re-solving, and for CVaR-shaped behaviour where exact stochastic models are intractable.

---

## 5. The friend's three links at plant scale

1. **AI Economist (arXiv:2108.02755).**
   - *Reusable:* the two-level structure (the planner tunes agents' reward parameters on a slower clock); the training recipe (agents pre-trained alone, then joint training with entropy and curriculum annealing); and the lesson that agents game the mechanism, which becomes MAOS's KPI-gaming detector.
   - *Not reusable:* the gather–trade–build gridworld code. MAOS's simulator is the environment.
2. **BoE Staff WP 1,142 (2025; arXiv:2104.09368).**
   - *Correction:* the DRL agent is the **household** (bounded rationality in a DSGE model under given monetary/fiscal regimes), not an RL central bank.
   - *Reusable:* only warnings. DRL finds all equilibria, including unstable ones, so equilibrium selection must be reported. Learning is slow and fragile, so early stopping is needed. There is no model or code to port.
3. **PIRL survey (arXiv:2309.01909, ESWA 2025).**
   - *Reusable:* the taxonomy for where physics enters the pipeline.
   - At plant scale, material balance and flow continuity are already exact in the discrete-event simulator. PINN ideas apply only to learned surrogates: the planner world model and MC-KPI emulators. There, use hard linear-equality layers (KKT-hPINN, arXiv:2402.07251), not soft residuals.
   - If a continuous line (galvanizing or rolling mass flow) is modelled later, a PINN mass-transfer model could become a sub-model inside the simulator.
