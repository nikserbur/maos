# src/domain — типы предметной области

Типизированный **контракт фронтенда с C++-ядром** (DTO/вью-модели). Зеркалит
доменные сущности из ТЗ. Это типы (без рантайма) — данные приходят/уходят на
локальный C++-бэкенд (см. [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)).

| Файл | Сущности | Документы ТЗ |
|---|---|---|
| `nsi.ts` | Product, Routing, Operation, WorkCenterType, Machine, OrgUnit, Worker, Skill, Schedule, Shift, CalendarException, TimeNorm | Справочники изделий/техкарт/операций/оборудования/рабочих; Время операции; Расписания |
| `inventory.ts` | StockItem, StockMove | Требования к запасам |
| `planning.ts` | DemandOrder, Scenario, ObjectiveWeights, Plan, PlanTask, PlanKpi, DispatchRule | Производственный план; Оптимизация; Эвристики; Сценарии |
| `graph.ts` | SchemeGraph, GraphNode, NodeClass, GraphEdge | Модель данных (§граф); 3D-граф |
| `security.ts` | Permission, Role, UserAccount, Session | Пользователи, роли, окно входа |

Полная прослеживаемость и схема БД — [../docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md).
