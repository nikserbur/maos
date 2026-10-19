# A3: Competitor teardown. Palantir and the APS/MES/twin market compared with MAOS v0.58

Research date: 2026-10-18. Sources: public docs, vendor blogs, analyst notes and press. Treat vendor numbers as claims. Where public material is thin I say so. I scored MAOS from the feature list in the brief and did not check those scores against the code.

---

## 1. Palantir in depth

### 1.1 The Ontology (the core MAOS borrows from)
- **Semantic layer.** An *object type* is a schema for a real-world entity or event, with properties, a primary key and backing datasets. A *link type* is a relationship between object types, with cardinality. An *interface* is an abstract shape that many object types can implement. The docs' own example is "Manufacturing Plant" implementing `Facility` ([LLM platform summary](https://palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm/), [core concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts)).
- **Kinetic layer.** An *action type* is a typed set of edits to objects, properties and links. It carries parameters, rules, *submission criteria* (who may run it, and when) and side effects such as notifications and webhooks. A *function* is server-side TypeScript or Python that reads the Ontology, computes, and may edit. Functions back actions and derived columns ([summary](https://palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm/)).
- **Models are Ontology citizens.** ML and optimization models are wrapped as "Modeling Objectives" and called live through *Functions on models*, or run in batch ([models in the Ontology](https://palantir.com/docs/foundry/manage-models/models-in-the-ontology/)). Palantir does not ship its own optimizer. The customer brings the math.

### 1.2 How Palantir models a plant
- **Vertex** is a toolkit for "cause and effect across the digital twin". Its four goals are transparency, alerting, simulation and optimization ([Vertex overview](https://www.palantir.com/docs/foundry/vertex/overview)). Vertex has object-backed *system graphs* and point-and-click *process-flow diagrams* (beta) for material processing, equipment tuning and production. Graphs are styled by properties and metrics ([use cases](https://palantir.com/docs/foundry/vertex/example-use-cases/)). Other parts are a time scrubber, related time series and thresholds ([time series](https://palantir.com/docs/foundry/vertex/explore-time-series/)). The visual language is 2D graphs. I found no public sign of native 3D.
- **Machinery** (announced 2025-02) is process mining over object event logs. It covers states and transitions, expected paths compared with real variants, and performance metrics to find bottlenecks. It is also positioned as the orchestration surface for multi-agent AIP workflows "with real-time human intervention" ([Machinery](https://www.palantir.com/docs/foundry/process-mining/overview/), [2025-02 announcements](https://palantir.com/docs/foundry/announcements/2025-02/)).

### 1.3 How Palantir simulates scenarios
- **Vertex scenarios.** A model works like a job with declared inputs and outputs. You give it time-series inputs plus overrides, and it returns calculated time series that you compare with measured values. Models can be *chained*, so one model's output feeds the next, to show end-to-end impact ([scenarios overview](https://palantir.com/docs/foundry/vertex/scenarios-overview/)).
- **Ontology Scenarios (beta).** A scenario is an *isolated fork* of the Ontology, produced by applying actions. Functions read and write inside the fork. You compare several scenarios side by side, then **merge to main through an action** that has its own submission criteria. Scenarios auto-rebase every 10 minutes and expire after 31 days. Submission criteria can be **looser inside a scenario**, so planners or agents can experiment without rights to change live data ([Ontology scenarios](https://palantir.com/docs/foundry/ontology/overview-ontology-scenario/), [Workshop scenarios](https://www.palantir.com/docs/foundry/workshop/scenarios-overview)).

### 1.4 Scheduling (Dynamic Scheduling, the most directly copyable piece)
This is the Workshop "Scheduling Gantt" widget ([concepts](https://palantir.com/docs/foundry/dynamic-scheduling/scheduling-concepts/), [widget](https://www.palantir.com/docs/foundry/dynamic-scheduling/scheduling-gantt-chart-widget/), [validation rules](https://palantir.com/docs/foundry/dynamic-scheduling/scheduling-validation-rules/)):
- *Schedule objects* (tasks with start, end or duration) appear as **pucks**. *Resource objects* appear as rows.
- Allocation modes: Allocate, No-overlap, Resource-only, Time-only, Swap, Swap-with-downstream, Snap-to-previous. Snap intervals are configurable. Shift+drag creates a new object.
- A **suggestion function** highlights the valid drop zones when you pick up a puck. "Enforce suggestions" restricts the drop, and Shift overrides it.
- **Search functions** run on right-click. They find free slots or candidate tasks, and they respect the active scenario.
- **Validation rules** are functions re-run after every edit. You can toggle them, filter to violators, and see status on each puck card.
- **Review changes** lists the remaining violations before commit. There is also a change log and function-backed colouring with a legend.

Notable: the solver is not built in. Palantir provides the interaction contract (suggest, search, validate, review, commit) and the customer provides the logic.

### 1.5 AI agents in the decision loop
- **AIP Logic** is a no-code LLM function builder. A debugger shows the chain of thought. Edits can be applied automatically or **staged for human review** ([Logic](https://www.palantir.com/docs/foundry/logic/overview/), [getting started](https://palantir.com/docs/foundry/logic/getting-started/)).
- **AIP Automate** fires on time or data conditions. It produces *proposals* with an "Agent decision log". Accepting one runs the action ([Automate integration (JP)](https://palantir.com/docs/jp/foundry/logic/aip-logic-integration-automate/)).
- **AIP Chatbot Studio** (formerly Agent Studio) builds chatbots whose tools are *actions, object queries and functions*. **AIP Evals** runs test suites and model comparisons designed around LLM non-determinism. **Palantir MCP** exposes Ontology context to external agents ([AIP features](https://palantir.com/docs/foundry/aip/aip-features/)).
- **The pattern:** the LLM never writes directly. It calls governed Actions, usually inside a scenario or as a staged proposal. A human approves, and Evals measure quality.

### 1.6 Warp Speed (the manufacturing OS)
The first cohort (Dec 2024) was Anduril, L3Harris, Panasonic Energy and Shield AI. Uses were dynamic production scheduling, engineering change management and visual quality inspection. It connects to ERP, MES, PLM and PLCs ([SDxCentral](https://www.sdxcentral.com/news/palantir-launches-inaugural-warp-speed-cohort-to-boost-us-manufacturing/), [Benzinga](https://www.benzinga.com/24/12/42443206/palantirs-warp-speed-launches-to-accelerate-us-manufacturing-with-advanced-ai-integration)). Later deals:
- Lear: five-year global deal ([Supply Chain Dive](https://supplychaindive.com/news/lear-corp-palantir-technologies-ai-software-partnership-five-year/760396)).
- US Navy ShipOS: $448M over two years, Dec 2025 ([The Register](https://www.theregister.com/2025/12/10/palantir_navy_448_million_contract/)).
- Ursa Major: an "Ontology-driven MES" whose manufacturing orders are synced to MRP to show bottlenecks ([Ursa Major](https://ursamajor.com/media/blog/how-ursa-major-and-palantir-are-solving-manufacturing-challenges-at-hypersonic-speeds/)).

Warp Speed is Foundry and AIP packaged for factories, not a separate engine.

### 1.7 Visual language
Blueprint is "optimized for building complex, data-dense web interfaces for desktop applications", and explicitly not mobile-first. It is on v6 with light and dark themes and packages for core, table, select, datetime, icons and colors ([GitHub](https://github.com/palantir/blueprint)). A third-party guide reports a `bp6` namespace with `--bp-` semantic tokens ([OpenDesign](https://open-design.ai/design-system/palantir-blueprint/)). The look: dark, dense, grey-on-slate, with small intent-coloured accents, inspector panels and keyboard-first omnibars.

### 1.8 What MAOS should copy, and where it can beat Palantir

| Copy | Beat |
|---|---|
| Action types with params, validation and submission criteria. Every write goes through them and is audited | **Native stochastic and robust optimization**: CVaR, heavy tails, correlated prices. Palantir's public docs show no such engine; it is all bring-your-own |
| Scenario as a fork made of deltas, compared side by side and merged through an action | **Formula transparency**: Palantir lineage is dataset/pipeline-level and its Logic debugger covers LLM steps. I found no public first-class "explain this KPI formula" view. MAOS already has a KPI formula registry |
| Gantt contract: suggest, search, validate, review, commit | **3D plant = registry.** Vertex is 2D graphs |
| Agents that only propose Actions, with staged edits, a decision log and evals | **Domain depth out of the box**: lot-streaming, TOC-based NPV/IRR, routings in IDEF0. Palantir needs forward-deployed engineers to build these |
| Interfaces (`Facility`, `Resource`) for polymorphic workflows | **Single-box, offline, sovereign deployment** (SQLite per project) |

---

## 2. APS, MES and digital-twin competitors

- **Siemens Opcenter APS (ex-Preactor).**
  - Leader in the IDC MarketScape APS 2025.
  - Finite-capacity scheduling with custom algorithms, plus AI scheduling via genetic algorithms, Monte Carlo tree search and "autonomous scheduling". Also CO₂ modelling and GenAI help ([Siemens blog](https://blogs.sw.siemens.com/opcenter/siemens-recognized-as-a-leader-in-aps-idc-marketscape-spotlight-on-opcenter-advanced-planning-scheduling/)).
  - Release 2510 added an MES alerts window inside APS ([2510](https://blogs.sw.siemens.com/opcenter/whats-new-in-opcenter-aps-2510/)).
  - In Apr 2026, Insights Hub + Opcenter agents were announced on an industrial knowledge graph, with an agent manager and copilots. Siemens itself warns that too many agents confuse operators ([blog](https://blogs.sw.siemens.com/opcenter/ai-shaping-the-future-of-autonomous-operations/)).
  - Eigen Engineering Agent, Hannover Messe 2026 ([Counterpoint](https://counterpointresearch.com/en/reports/siemens-eigen-the-industrial-engineering-agent)).
- **Tecnomatix Plant Simulation.**
  - Stochastic discrete-event simulation (DES) with a **Bottleneck Analyzer + Sankey diagram**, an Experiment Manager and a genetic-algorithm wizard ([help](https://docs.plm.automation.siemens.com/content/plant_sim_help/15/plant_sim_all_in_one_html/en_US/tecnomatix_plant_simulation_help/objects_reference_help/tools/tools.html), [Wikipedia](https://en.wikipedia.org/wiki/Plant_Simulation)).
  - A copilot writes SimTalk. Automated Simulation Models Generation (ASMG) builds models from natural language ([LLM post](https://blogs.sw.siemens.com/tecnomatix/ai-llms-siemens-plant-simulation/)).
  - No official reinforcement-learning (RL) or Gym interface. Only third-party COM wrappers exist ([plantsim PyPI](https://pypi.org/project/plantsim/0.0.1/)).
- **DELMIA Quintiq / Ortems.**
  - Quintiq uses math and constraint programming plus graph optimization in a proprietary modelling language, positioned as a "virtual twin" of the supply chain ([3DS](https://www.3ds.com/products/delmia/quintiq), [TriMech](https://enterprise.trimech.com/uki/delmia-quintiq/)).
  - GenAI plays a minor role in the core in 2025–26 ([KI-Syndikat](https://www.ki-syndikat.de/tools/delmia-quintiq/)). There are Aura/Leo/Marie "Virtual Companions" on 3DEXPERIENCE.
  - Ortems: almost no public news.
- **Asprova.** A very fast finite-capacity engine. v17 adds machine learning, an OpenAI-based chatbot and autonomous breakdown of incoming orders. Implementations take months ([Aimtec](https://insights.aimtecglobal.com/en/asprova-aps-a-proven-conductor-in-a-new-tuxedo-plans-production-down-to-the-second/), [rfp.wiki](https://www.rfp.wiki/vendors/asprova)).
- **Kinaxis Maestro.**
  - Concurrent planning on one data model, with over 250k scenarios a month across 400+ customers.
  - NVIDIA cuOpt (Mar 2026) brings near-interactive optimization ([BusinessWire](https://www.businesswire.com/news/home/20260316257284/en/Kinaxis-Advances-Large-Scale-Supply-Chain-Optimization-with-NVIDIA-AI)).
  - Maestro Agents (2025) are bounded, overseen and explainability-first ([Logistics Viewpoints](https://logisticsviewpoints.com/2026/10/01/kinaxis-concurrent-planning-continuous-response/)).
  - Reviewers report a "very high barrier to entry" ([SoftwareReviews](https://softwarereviews.com/products/kinaxis-rapidresponse)).
- **o9 Solutions.** An Enterprise Knowledge Graph (EKG) plus composite LLM agents (2024). In Mar 2026 o9 launched the APEX operating model on a "neuro-symbolic" EKG ([o9 news](https://o9solutions.com/news/o9-enhances-its-digital-brain-platform-with-generative-ai-powered-composite-agents-to-execute-complex-cross-functional-planning), [o9 AI info](https://o9solutions.com/ai-info)). It claims "explainable, auditable reasoning". Users report a complex interface ([airframe](https://www.airframe.ai/product/o9solutions-com/analysis)).
- **Probabilistic reality check.** Lokad's Nov 2025 map rates Kinaxis, o9 and Blue Yonder as "marketing-level" probabilistic, and SAP IBP and ToolsGroup as "semi-genuine". Lokad is a competitor, so allow for bias ([Lokad](https://www.lokad.com/blog/2025/12/5/the-state-of-probabilistic-forecasting-in-supply-chain/)). **Simio RPS** is the closest analogue to MAOS. It runs a deterministic schedule, then reruns it with variation for a risk analysis ([Simio](https://www.simio.com/advanced-planning-scheduling?hsLang=en)). That is risk *evaluation*, not risk-*optimized* decisions.
- **PlanetTogether.** An AVEVA *partner* listing, not an acquisition ([AVEVA](https://www.aveva.com/en/products/planettogether-aps/), [2021 partnership](https://arabianreseller.com/2021/04/29/aveva-and-planettogether-announce-strategic-partnership/)). Features:
  - Objective **sliders** (batching vs priority vs ship date).
  - Policy "experiments" showing their effect on inventory, on-time delivery (OTD) and cash.
  - **Expedite impact analysis**: which orders an expedite hurts, and by how much.
  - Its AI claims are mostly marketing ([Lokad review](https://lokad.com/review-of-planettogether-com)).
- **AVEVA.** CONNECT plus Flows (via the Crosser acquisition: 800+ connectors). A knowledge graph with an **agentic twin builder** that maps sources onto a standard model is due Q1 2027. MCP is under consideration ([AVEVA World 2026](https://www.aveva.com/en/about/news/press-releases/2026/aveva-announces-new-capabilities-to-embed-ai-across-industrial-organizations-and-data-infrastructure-at-aveva-world-2026/), [IT Brief](https://itbrief.com.au/story/aveva-unveils-ai-data-updates-across-industrial-suite)).
- **Cognite.**
  - Cognite Data Fusion (CDF) is an industrial knowledge graph, with Atlas AI as a low-code agent workbench ([docs](https://docs.cognite.com/cdf/atlas_ai)).
  - Atlas customers grew about 700% YoY, and ARR bookings grew 36% (Jan 2026) ([Cognite](https://www.cognite.com/en/company/newsroom/cognite-s-moonshot-and-ai-drive-record-breaking-year)).
  - **Industrial Canvas**: drag P&IDs, time series and 3D into an annotated "storyboard" ([Canvas](https://www.cognite.com/en/industrial-canvas)).
- **Tulip.**
  - Composable AI Agents (Oct 2025) for quality checks, **rescheduling tasks** and rework ([Tulip](https://tulip.co/press/tulip-unveils-composable-ai-agents-at-operations-calling/)).
  - 2026: Projects, an Authoring Agent that drafts apps from SOPs, and Factory Playback with vision-language models (VLMs) ([Verdantix](https://www.verdantix.com/insights/blog/tulip-s-operations-calling-2026-highlights-the-next-step-for-frontline-ai)).
  - Shown in a Cognite→Tulip agent-to-agent demo ([IoT Analytics](https://iot-analytics.com/mid-2026-industrial-ai-pulse-check-is-this-the-year-of-agentic-ai/)).
- **Seeq.** Seeq Intelligence (Mar 2026) includes Agent Q and build-your-own agents ([Seeq](https://www.automation.com/article/seeq-intelligence-bridging-industrial-ai-human-expertise-smarter-operational-decisions)). It is the **gold standard for formula transparency**:
  - Item Properties shows the formula and its parameters.
  - *Item Usages* shows what depends on an item.
  - "Duplicate to Formula" copies it into an editor.
  - A Part 11 audit trail records before/after state including dependencies ([Item properties](https://support.seeq.com/latest/cloud/item-properties), [audit trail](https://support.seeq.com/kb/R58/cloud/seeq-audit-trail)).
- **Russia.**
  - **Market.** APS was ₽591M in 2025 against ₽12.85B for MES. There are "no clear leaders or standards", many plants still plan in Excel, and regulation requires critical infrastructure to move to Russian software by 2030 ([ITWeek, Dec 2025](https://www.itweek.ru/themes/detail.php?ID=234023)). Western APS vendors suspended operations ([Adeptik](https://rfrit.ru/media/documents/Adeptik_APS_AP.pdf)).
  - **1С:ERP.** Two-level planning: an inter-shop graph ("APS") plus operation-level MES dispatching ([1C 2015](https://files.1c.ru/bf/2015/section4/17_25_APS%20MES%20функционал%20в%201С%20ERP%20(Кислов,%201С).pdf)). Integrators bolt an external APS onto 1С:ERP УХ behind the 1C UI, because 1C "lacks flexible visualisation and real-time performance" ([Infostart](https://infostart.ru/pm/2319809/)). An Apr 2026 webinar covered math optimization in 1С:ERP with the O2 library ([Infostart](https://infostart.ru/journal/news/mir-1s/umnoe-planirovanie-proizvodstva-v-1s-erp-na-osnove-matematicheskoy-optimizatsii-detali-na-besplatnom_2652655/)).
  - **Vendors.** Adeptik APS AP (₽62.5M grant from RFRIT, Russia's IT development fund) and БИА.APS (now «Биатех»; integrates with 1C and SAP) ([workspace.ru](https://workspace.ru/blog/aps-sistema-chto-eto-chem-otlichaetsya-ot-erp-i-mes-i-kogda-proizvodstvu-ona-deystvitelno-nuzhna/)). RaytecAPS ([raytec.pro](https://raytec.pro/upload/raytecaps/ver%201.4/%D0%98%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8F%20%D0%BE%20%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B5%20RaytecAPS%20(%D0%B2%D0%B5%D1%80.1.4).pdf)).
  - **Zyfra.** ZIIoT platform, Production Scheduling, and Z SPM refinery planning ([Z SPM](https://idpsupport.zyfra.com/wp-content/uploads/2025/03/20240722-Z-SPM.-Продуктовая-презентация-002.pdf), [Soware](https://soware.ru/products/zyfra-production-scheduling)).
  - **ИндаСофт** is a MES integrator since 1996 (OSIsoft, GE, MPDV). I found no APS product ([IndaSoft 2025](https://indusoft.ru/upload/iblock/4e1/g4hc6s6b542aycywikdil1l75pdar1eu/company-indusoft-site-2025(2).pdf)).
  - **Галактика.** No public APS module found. Quantum.ERP targets process industries ([T-Bank](https://secrets.tbank.ru/blogi-kompanij/kak-vnedrit-erp-na-proizvodstve/)).
  - **«Фобос».** No APS product of that name found.
  - **Unverified lead:** a CNews item (Jan 2026) on «Экспанта» building a unified APS contour after buying «Алгоритм1».

---

## 3. Feature matrix

Legend: ● strong, ◐ partial or claimed, ○ absent or not found, ? unknown. Siem = Opcenter APS + Plant Simulation + Insights Hub. RU = 1C / Adeptik / БИА / Zyfra.

| Capability | Palantir | Siem | DELMIA | Asprova | Kinaxis | o9 | PlanetT | AVEVA | Cognite | Tulip | Seeq | RU | **MAOS** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Plant modelling (equipment, routing, BOM) | ◐ generic ontology | ● | ● | ● | ◐ network | ◐ | ● | ● | ● asset KG | ◐ stations | ◐ asset tree | ◐ | **●** 3D = registry, IDEF0 |
| Finite-capacity scheduling algorithms | ◐ widget, BYO logic | ● GA/MCTS | ● MP/CP | ● | ◐ | ◐ | ● | ◐ via partner | ○ | ◐ agent reschedules | ○ | ◐ | ◐ lot-streaming. Gap: validation/suggestions |
| Stochastic / robust optimization | ○ BYO models | ◐ DES stochastic, APS deterministic | ? | ○ | ◐ quantiles | ◐ | ○ | ○ | ○ | ○ | ○ | ◐ Adeptik demand variability | **●** CVaR, heavy tails, correlations. **Differentiator** |
| What-if scenarios | ● fork/compare/merge | ● Experiment Mgr | ● | ◐ | ● 250k/mo | ● | ● policy experiments | ◐ | ◐ | ○ | ◐ | ◐ | ◐ compare only. **Gap: fork/merge, deltas** |
| KPI explainability | ◐ lineage, decision log | ◐ bottleneck + Sankey | ? | ◐ | ◐ scorecards | ◐ claimed | ◐ expedite impact | ? | ◐ | ◐ | ● formula, usages, audit | ○ | ● formula registry. **Gap: drill-down to rows, audit** |
| AI agents / copilots | ● Logic, Automate, Evals | ● copilots, Eigen | ◐ companions | ◐ chatbot | ● Maestro Agents | ● composite | ◐ | ◐ 2027 | ● Atlas | ● | ● Agent Q | ○ | ◐ node builder. **Gap: action-gated proposals, evals** |
| RL / learning | ○ | ◐ AI scheduling, no RL API | ◐ ML forecast | ◐ ML | ◐ | ◐ learns from planners | ◐ claimed | ○ | ○ | ○ | ◐ | ○ | ○ **Gap / thesis opportunity** |
| 3D / visual twin | ◐ 2D graphs | ● | ● | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | ○ | **●** r3f scheme + map. **Differentiator** |
| Ontology / data integration | ● | ● digital thread | ● | ◐ | ● | ● EKG | ◐ | ● 800 connectors | ● | ◐ | ◐ | ◐ 1C native | ◐ SQLite, no connectors. **Gap** |
| UX quality (subjective, from reviews) | ● dense, steep | ◐ | ◐ | ◐ months to train | ◐ steep | ◐ complex | ◐ | ◐ | ● | ● no-code | ● | ○ Excel-era | ◐ Blueprint-like. Needs onboarding |

**MAOS differentiators:**
- Stochastic and robust portfolio optimization combined with scheduling.
- A transparent KPI formula registry.
- TOC-based investment NPV/IRR.
- 3D scheme as the system of record.
- Offline, sovereign packaging.

**MAOS gaps:**
- Governed action layer and audit log.
- Scenario fork/merge.
- Gantt validation and suggestion contract.
- Drill-down lineage.
- Agent proposals with evals.
- Connectors and import mapping.
- Reinforcement learning (RL).

---

## 4. UX patterns worth stealing

1. **"How was this computed?" (KPI drill-down).** Combine Seeq's *Formula + parameters + Item Usages + audit trail* with Palantir's "Explore data lineage" from an object view ([learning](https://palantir.com/docs/foundry/learning-application-ontology-01/06)). For MAOS, every KPI tile gets an **ƒ** popover:
   - The rendered formula, with each variable bound to its live value.
   - Click a variable to see the filtered source objects (machines, ops, lots).
   - A "used by" list showing downstream KPIs, NPV and the optimizer objective.
   - Version history.
   - For stochastic KPIs, show the distribution (P10/P50/P90, CVaR) rather than a single point.
2. **Bottleneck → flow explanation.** Plant Simulation pairs its Bottleneck Analyzer with a Sankey. MAOS already has both, so link them: click the bottleneck and the Sankey highlights the constrained flow, with the TOC "drum" marked.
3. **Scenario compare.**
   - Palantir: a fork made of deltas, side-by-side comparison, merge through a guarded action, a TTL, and auto-rebase.
   - Kinaxis: scorecards against corporate metrics.
   - PlanetTogether: objective sliders and "who gets hurt" expedite lists.

   For MAOS: a scenario stores only the changes to objects. The compare view shows (a) the diff of changed objects, (b) KPI deltas with confidence bands, and (c) a "Promote to baseline" action.
4. **Schedule editing.** Copy Palantir's contract:
   - Drop-zone highlighting from a suggestion function.
   - Right-click "find slot".
   - Validation rules re-run on each drag, with a violations filter.
   - A *Review changes* modal before commit.
   - A change log.
   - Colour-by-function with a legend.
5. **Agent in the loop.**
   - Copy from Palantir: an Automate-style **proposal inbox** where each card shows the decision log, proposed actions and a scenario preview, with Accept or Reject.
   - Copy from Palantir: staged edits and eval suites.
   - Follow Siemens' lesson: a single orchestrator in front of the operator ([Siemens](https://blogs.sw.siemens.com/opcenter/ai-shaping-the-future-of-autonomous-operations/)).
6. **Onboarding.**
   - Palantir bootcamps go from "zero to use case in 1–5 days" ([Palantir blog](https://blog.palantir.com/deploying-full-spectrum-ai-in-days-how-aip-bootcamps-work-21829ec8d560)).
   - Tulip's Authoring Agent drafts apps from SOPs.
   - AVEVA's agentic twin builder maps source data onto a model.

   For MAOS: a seeded demo plant, a guided 10-minute tour, and "import Excel/1C → AI proposes the ontology mapping → review → commit".
7. **Abstract system diagrams.**
   - Vertex: object-backed process-flow graphs styled by metrics, with a timeline scrubber and thresholds.
   - Machinery: expected path compared with actual variants.
   - Cognite Canvas: a storyboard mixing diagrams, time series and 3D.

   For MAOS: an auto-derived **2D system graph** (from the 3D scheme plus routings), toggled 3D ↔ 2D ↔ Sankey, with a time scrubber driven by the scheduler.

---

## 5. Positioning recommendation

1. **Category: "glass-box stochastic APS twin".** Be the only tool where uncertainty is first-class: every plan carries a distribution, CVaR and P(on-time). Incumbents are mostly deterministic, with "probabilistic" as a label (Lokad's critique). Simio RPS only *evaluates* risk after scheduling. MAOS *optimizes* under it.
2. **Make transparency the brand.** Pair Seeq-grade formula lineage with manufacturing economics: TOC throughput, NPV/IRR and the CVaR objective. "Every number clickable to its formula and its rows" is a defensible thesis claim and a demo moment.
3. **Copy Palantir's kinetic layer, not its scale.** Minimal versions of each:
   - An `action_types` table with params and validation, through which every write passes and is audited.
   - Scenarios stored as deltas, with merge.
   - The Gantt suggest/validate/review contract.

   This turns MAOS from dashboards into an operational system.
4. **Agents only through Actions, inside scenarios, with evals.** The thesis can measure an LLM agent against the stochastic optimizer, and against the two combined, on the same scenarios. That is a contribution few vendors publish.
5. **Keep 3D as the hook, but add the 2D graph for analysis.** The 3D-as-registry beats Palantir's 2D and APS tables for comprehension. Analysts still need the abstract view.
6. **Go-to-market: Russian mid-size discrete manufacturing.** APS there is a ₽591M market with no leaders. Plants plan in Excel, Western vendors have left, and the 2030 critical-infrastructure rule is coming. Ship as an "APS-контур для 1С:ERP" (the proven integration pattern), on-prem and offline-capable (SQLite) for sovereignty.
7. **Don't compete on** connector breadth (AVEVA, Cognite), enterprise supply-chain planning (Kinaxis, o9) or DES fidelity (Plant Simulation). Import from them instead (CSV, 1C OData, OPC later).
8. **Priority gaps, in order:**
   1. Action layer and audit log.
   2. Scenario fork/merge.
   3. KPI drill-down to rows.
   4. Gantt validation and suggestions.
   5. Proposal inbox and evals.
   6. Import mapping.
   7. RL as an optional thesis extension. Benchmark it against GA/MCTS, which Siemens markets.
