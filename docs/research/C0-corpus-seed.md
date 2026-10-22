# C0 — Стартовый корпус источников для методологии V2 (к проверке и аннотированию агентом C)

Назначение: «учебный набор» для агента-рецензента и образец строгости. Каждый пункт — что берём из источника.
Агент C проверяет существование/ссылку, аннотирует, добавляет пропущенное. Локальные материалы — первыми.

## A. Локально (образец строгости, читать целиком)
- `/Users/nburakov/Downloads/RJMF_package_20261021 (2)/research/Research_note.md` — статья для «Деньги и кредит»: паспорт параметров (табл. 1: наблюдение/оценка/калибровка/норматив), CRN на 50 000 ID, три NPV участников, финансовый водопад, обученный генератор (VAR→SVD→HMM→блоки), CRPS-валидация, цена инфляции λ, границы результата.
- `.../research/Methodology_and_reproduction.md` — формулы «буквально как в коде», порядок операций внутри периода, события остановки, дефолт/LGD, тождественное разложение NPV, воспроизводимость (SHA256-манифест).
- `.../reviewer_response/Reviewer_response.md` — 32 замечания рецензентов → как закрывать: формат «цитата → изменение → результат и оговорки → место».
- `.../research/cbr_solver.py`, `transmission.py`, `satellite.py`, `build_kernels.py` — код генератора и передаточных ядер (кандидат на перенос в `rl/macro/`).
- `/Users/nburakov/Codes/maos/docs/research/A2-methodology-audit.md` — аудит v0.58 (24 метода, 17 багов); `A4-rl-plant-science.md` — ~45 ссылок по RL/MARL/маскированию/лагранжианам; `B2-exact-vs-heuristic.md` — отчёт с числами (образец отчёта).
- `docs/OPTIMIZATION.md`, `docs/SCHEDULING.md`, `docs/RL-METHODOLOGY-PROPOSAL.md` (§8 — принятые решения), `docs/ANALYTICS.md`.

## B. Банк России / «Деньги и кредит» / российская нормативка
- Бураков Н.С. (2026) Стохастическое моделирование денежно-кредитной политики: модульная архитектура для анализа экстремальных сценариев. IJPS № 3-1, с. 47–66 — модульность «динамика / хвосты / режимы».
- Нелюбина (2024), Орлов & Шарафутдинов (2024) — квартальные прогнозные модели Банка России (ДИП/ДДКП), «Деньги и кредит»; уравнения как сценарные ядра.
- Банк России — КПМ, «Основные направления ДКП», ряды ключевой ставки/курса/инфляции (cbr.ru, публичные ряды 2013–2026).
- Методические рекомендации по оценке эффективности инвестиционных проектов (ВК 477, 1999) — ЧДД/ВНД/ИД, дисконтирование эффективной ставкой.
- ГОСТ Р ИСО 22400-2-2019 (KPI производства: OEE, APT/PBT), ГОСТ 27.002-2015 (надёжность: MTBF/MTTR, K_г).
- Положение Банка России 590-П (резервы на возможные потери по ссудам) — категории качества, PD/LGD-логика для «игры с банком».

## C. Операции ↔ финансы (MIT / Harvard / Chicago / INSEAD — ядро новизны)
- Birge J.R. (2015) OM Forum — Operations and Finance Interactions. M&SOM 17(1) — карта связок.
- Buzacott J.A., Zhang R.Q. (2004) Inventory Management with Asset-Based Financing. Management Science 50(9) — кредитная линия под запасы, ставка как функция риска.
- Kouvelis P., Zhao W. (2012) Financing the Newsvendor: Supplier vs. Bank, and the Structure of Optimal Trade Credit Contracts. Operations Research 60(3) — Штакельберг банк/поставщик.
- Xu X., Birge J.R. (2004) Joint Production and Financing Decisions: Modeling and Analysis (SSRN) — производство и финансирование в одной задаче.
- Chod J. (2017) Inventory, Risk Shifting, and Trade Credit. Management Science 63(10).
- Protopappa-Sieke M., Seifert R.W. (2010) Interrelating operational and financial performance measurements in inventory control. EJOR 204(2) — оборотный капитал, DSO/DPO в модели запасов.
- Tanrisever F., Cetinay H., Reindorp M., Fransoo J. (2012) Value of Reverse Factoring in Multi-stage Supply Chains (SSRN) — логистическое/финансовое плечо.
- Gelsomino L.M. et al. (2016) Supply chain finance: a literature review. IJPDLM 46(4).
- Cachon G., Lariviere M. (2005) Supply chain coordination with revenue-sharing contracts. Mgmt Sci 51(1); Lariviere & Porteus (2001) Selling to the Newsvendor. M&SOM 3(4).
- Graves S.C., Willems S.P. (2000) Optimizing strategic safety stock placement in supply chains. M&SOM 2(1) — MIT.
- Sterman J.D. (1989) Modeling managerial behavior: misperceptions of feedback… (beer game). Mgmt Sci 35(3) — MIT, динамика запасов/поставок.
- Hopp W., Spearman M. Factory Physics (3rd ed.) — закон Литтла, VUT/Кингман, вариабельность.
- RiskMetrics Group (1999) CorporateMetrics Technical Document — Cash-Flow-at-Risk (CFaR); Stein, Usher, LaGattuta, Youngen (2001) A Comparables Approach to Measuring CFaR. J. Applied Corporate Finance.
- Froot K., Scharfstein D., Stein J. (1993) Risk Management: Coordinating Corporate Investment and Financing Policies. J. Finance 48(5) — Harvard/MIT: зачем предприятию хеджировать/держать ликвидность.
- Gabaix X. (2011) The Granular Origins of Aggregate Fluctuations. Econometrica — тяжёлые хвосты на микроуровне.

## D. Стохастическая и робастная оптимизация
- Rockafellar R.T., Uryasev S. (2000; 2002) CVaR — J. Risk 2(3); J. Banking & Finance 26(7).
- Bertsimas D., Sim M. (2004) The Price of Robustness. Operations Research 52(1) — MIT.
- Bertsimas D., Brown D.B., Caramanis C. (2011) Theory and Applications of Robust Optimization. SIAM Review 53(3).
- Ben-Tal A., El Ghaoui L., Nemirovski A. (2009) Robust Optimization. Princeton.
- Birge J.R., Louveaux F. (2011) Introduction to Stochastic Programming (2nd ed.); Shapiro, Dentcheva, Ruszczyński (2021) Lectures on Stochastic Programming (3rd ed.).
- Kuhn D., Shafiee S., Wiesemann W. (2025) Distributionally Robust Optimization. Acta Numerica (arXiv:2411.02549); Mohajerin Esfahani & Kuhn (2018) Wasserstein DRO. Math. Prog. 171.
- Mak W.-K., Morton D., Wood R.K. (1999) Monte Carlo bounding techniques… Oper. Res. Letters 24 — ДИ оптимального зазора SAA; Kleywegt, Shapiro, Homem-de-Mello (2002) SAA. SIAM J. Optim. 12(2).
- McNeil A., Frey R., Embrechts P. (2015) Quantitative Risk Management (2nd ed.) — копулы, хвостовая зависимость, EVT.
- Kim S.-H., Nelson B.L. (2006) Selecting the best system (ranking & selection), Handbooks in OR/MS 13.

## E. RL / MARL / игры (дополнение к A4)
- Zheng S. et al. (2022) The AI Economist: taxation policy design via two-level deep MARL. Science Advances 8(18) — двухуровневое обучение, куррикулум.
- Chen M. et al. (2021/2023) Deep Reinforcement Learning in a Monetary Model. Bank of England SWP 1033 — RL-агенты в макромодели (ЦБ).
- Hinterlang N., Tänzer A. (2021) Optimal monetary policy using RL. Bundesbank DP 51/2021.
- Gijsbrechts J., Boute R., Van Mieghem J., Zhang D. (2022) Can Deep RL Improve Inventory Management? M&SOM 24(3).
- Oroojlooyjadid A. et al. (2022) A Deep Q-Network for the Beer Game. M&SOM 24(1).
- Andriotis C., Papakonstantinou K. (2019) Managing engineering systems with large state and action spaces through deep RL (DCMAC). Reliability Eng. & Syst. Safety 191 — RL для ремонтов/ТО.
- Yu C. et al. (2022) MAPPO. NeurIPS D&B; Stooke, Achiam, Abbeel (2020) PID Lagrangian. ICML; Huang & Ontañón (2022) action masking. FLAIRS.
- Roughgarden T. (2005) Selfish Routing and the Price of Anarchy. MIT Press; Koutsoupias & Papadimitriou (1999).
- Lasry J.-M., Lions P.-L. (2007) Mean field games. Japan J. Math 2; Carmona R., Delarue F. (2018) Probabilistic Theory of MFG.
- Dempe S. (2002) Foundations of Bilevel Programming — Штакельберг/двухуровневые задачи.
- Tassel, Gebser, Schekotihin (2023) End-to-End RL for JSSP based on CP (ICAPS); Zhang et al. (2020) L2D (NeurIPS) — честные сравнения RL vs CP.

## F. Прогноз и валидация
- Gneiting T., Raftery A. (2007) Strictly proper scoring rules (CRPS). JASA 102(477).
- Hyndman R., Koehler A. (2006) Another look at measures of forecast accuracy (MASE). IJF 22(4); Hyndman & Athanasopoulos (2021) FPP3.
- Ansari A.F. et al. (2024) Chronos (arXiv:2403.07815); Das A. et al. (2024) TimesFM (arXiv:2310.10688).
- Hamilton J.D. (1989) A new approach to the economic analysis of nonstationary time series (режимы, HMM). Econometrica 57(2).
- Politis D., Romano J. (1994) The Stationary Bootstrap. JASA 89 — блочный бутстреп остатков.
- Keefer D., Verdini W. (1993) Better estimation of PERT activity time parameters. Mgmt Sci 39(9).

## G. Планирование/расписание (эталоны)
- Naderi B., Ruiz R., Roshanaei V. (2023) Mixed-integer programming vs constraint programming for shop scheduling. INFORMS J. Computing 35(4).
- Brandimarte P. (1993) Routing and scheduling in a flexible job shop by tabu search. Annals of OR 41; Taillard E. (1993) Benchmarks for basic scheduling problems. EJOR 64.
- Bean J.C. (1994) random keys; Gonçalves & Resende (2011) BRKGA. J. Heuristics 17 — уже используется в v0.63.
- Maravelias C., Sung C. (2009) Integration of production planning and scheduling. Comput. Chem. Eng. 33.
- Amaran S. et al. (2016) Simulation optimization: a review. Annals of OR 240.
