# MAOS — требования и прослеживаемость

Этот документ сводит **все документы ТЗ** (папка `Диплом MAOS/` — разделы
«Требования» и «Общие разделы») к модели сущностей, схеме БД, окну входа и
**матрице прослеживаемости** «документ → этап плана → код». Цель — чтобы ни одно
требование не потерялось и на каждое была ссылка в плане
([ROADMAP.md](ROADMAP.md)). Архитектура — [ARCHITECTURE.md](ARCHITECTURE.md).
Фундаментальная модель работы (как всё устроено) — [CONCEPT.md](CONCEPT.md).

Источник: `…/Документы/SynapDesk/Учеба/Диплом MAOS/{Требования, Общие разделы}/`.

## 1. Модель сущностей (до объектов)

Ядро (из «Модель данных и хранение»; поля — из доменных справочников):

| Сущность (таблица) | Ключевые поля | Источник (ТЗ) |
|---|---|---|
| **Изделие/ДСЕ** `product` | id, name, parentId↺, quantity, batchSize, isPurchased, okpdCode, unitId, type | Справочник изделий |
| **Техкарта** `routing` | routingId, assembly→product, isDefault, version, effectiveDate | Справочник техкарт |
| **Операция** `operation` | id, name, order, typeOperation (Single/Contractor), workCenterTypes[], requiresWorkerSkills[], setupRequired, splittable | Техкарты; Доступные операции |
| **Тип оборудования** `work_center_type` | id, name, group, interchangeable | Тип оборудования |
| **Рабочий центр/станок** `machine` | id, name, workCenterType→, orgUnitId→, scheduleId→, status, efficiency, initialWorkingHours | Перечень оборудования |
| **Паспорт ЕО** (расш. `machine`) | vendor, invNumber, techNumber, dateInstall, serviceLife, cost, serviceCost, techPlaceId, parentId↺ + `machinery_log` | Справочник и хранение станков |
| **Подразделение** `org_unit` | id, name, parentId↺ | Модель данных |
| **Рабочий** `worker` | id, firstName, lastName, orgUnitId→, position, grade, scheduleId→, status, costPerHour | Справочник рабочих |
| **Навык** `skill` / `worker_skill` | workerId→, skillId→, level | Справочник рабочих |
| **Расписание** `schedule` / `shift` / `calendar_exception` | id, pattern; scheduleId, dayOfWeek, startTime, endTime, breaks[], efficiency; date, type, appliesTo, override | Расписания и календари |
| **Норма времени** `time_norm` | operation→, workCenterType→, min/likely/max, setupTime, contractor; machineRate, laborRate, setupCost; scrapRate, reworkTime/Cost, reliability | Время выполнения операции |
| **Программа** `demand_order` | assembly→, plannedFinishDate, quantity, priority, releaseDate | Производственный план |
| **План/Работа** `plan` / `plan_task` | operationId→, productOrderId→, machineId→, workerId→, start, end, batchId, status | Производственный план |
| **Запас** `stock` / `stock_move` | itemId→, locationId→, kind, onHand, safetyStock, reorderPoint, leadTime; date, delta, reason, refId, stockAtEnd | Требования к запасам |
| **Граф схемы** `graph`/`graph_node`/`node_class`/`connector`/`graph_edge` | parentId↺, level, classId→, stockAtEnd; from/to | Модель данных; 3D-граф |
| **Сценарий** `scenario` | id, name, beginDate, endDate, mode, objectiveWeights, method, dataVersion, overrides | Сценарии моделирования |
| **Показатель** `indicator`/`ts_info`/`ts_data` | (product, indicator, unit, location, scenario); date, value | Модель данных |
| **Роль/Право** `role`/`role_permission` | role(id,name), permission[] | Пользователи, роли, окно входа |
| **Пользователь** (= `worker`) | isSystemUser, login, passwordHash (Argon2id), roleId→, status, failedAttempts, lockedUntil | Пользователи, роли, окно входа |
| **Сессия** `session` | userId→, startedAt, lastActivityAt, expiresAt, vaultId | Пользователи, роли, окно входа |

Связи (ER, из «Модель данных»): `product` (BOM ↺) ─< `routing` ─< `operation`
─< `time_norm` >─ `work_center_type` ─< `machine`; `operation` requires `skill`;
`worker` has `skill`; `demand_order` >─ `product`; `plan` ─< `plan_task` >─
(`operation`,`machine`,`worker`); `stock_move` >─ `plan_task`; `graph_node` ↺
(`parentId`, `classId`); `ts_info` ─< `ts_data(date,value)`.

## 2. Хранение (БД)

- **OLTP — SQLite** (один файл `.db`, WAL, `FOREIGN KEY ON`, индексы по
  orgUnit/type/status/parentId/dates; транзакции; `PRAGMA user_version` +
  миграции). Опц. **SQLCipher** (AES-256) — ключ из пароля через KDF.
- **OLAP — ClickHouse** (опц.): временные ряды KPI, наработки, запасов; тяжёлые
  агрегаты для дашбордов; ETL SQLite→ClickHouse, материализованные роллапы.
- Идентификаторы — UUID/коды; аудит — `created_at/updated_at/version` + журнал;
  сценарии — параметризация по `scenarioId` без копирования базы.
- Источник: «Модель данных и хранение», «Справочник и хранение станков»,
  «Нефункциональные требования».

## 3. Окно входа и доступ (RBAC)

Из «Требования к пользователям, ролям и окну входа» (рабочий = пользователь):

- **Окно входа (vault):** выбор/создание файла `.db`, поля `логин`+`пароль`,
  офлайн-аутентификация по `passwordHash` (Argon2id), при шифровании — KDF→ключ
  SQLCipher (без пароля база не открывается), bootstrap первого `Admin`, защита
  от перебора (`failedAttempts`/`lockedUntil`), сессия + автоблокировка, аудит входов.
- **Роли:** Viewer / Planner / Technologist / Admin; права атомарные
  (`READ_*`, `EDIT_NSI`, `WRITE_PLAN`, `RUN_OPTIMIZE`, `COMMIT_PLAN`,
  `IMPORT/EXPORT_DATA`, `USE_AGENT_READ/WRITE`, `MANAGE_USERS/SECURITY`).
- **Принципы:** deny-by-default, least privilege, единая проверка прав в
  `IActionHandler`; MENTAT исполняет инструменты строго в правах пользователя.

## 4. Матрица прослеживаемости (документ → этап → код)

Этапы — из [ROADMAP.md](ROADMAP.md). Код: ✅ есть · 🟡 частично · ⬜ план.

| Документ ТЗ | Этап плана | Код |
|---|---|---|
| Архитектура_Palantir_для_MAOS | Этапы 4, 9; ARCHITECTURE.md | ⬜ |
| План реализации MAOS | вся дорожная карта | 🟡 |
| Модель данных и хранение | Этап 3 (НСИ), БД-бэкенд C++ | 🟡 `src/domain/*` |
| Справочник изделий | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Справочник техкарт | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Доступные операции | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Тип оборудования | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Перечень оборудования | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Справочник и хранение станков | Этап 3 (НСИ) + БД | 🟡 `src/domain/nsi.ts` |
| Справочник рабочих | Этап 3 (НСИ) + Этап 8 (RBAC) | 🟡 `src/domain/nsi.ts`,`security.ts` |
| Время выполнения операции | Этап 3 + Этап 5/6 (нормы) | 🟡 `src/domain/nsi.ts` |
| Расписания и календари | Этап 3 (НСИ) | 🟡 `src/domain/nsi.ts` |
| Требования к запасам | Этап 3 + Этап 5 (план) | 🟡 `src/domain/inventory.ts` |
| Производственный план | Этап 5 (планировщик) | 🟡 `backend/src/Optimizer.*`, `features/plan/*` (портфель→загрузка) |
| Требования к оптимизации | Этап 6 (оптимизация) | ✅ робастная стохастика — `backend/src/Optimizer.*`, [OPTIMIZATION.md](OPTIMIZATION.md) |
| Требования эвристики | Этап 6 (оптимизация) | 🟡 генерация кандидатов + локальный поиск (Optimizer.cpp) |
| Сценарии моделирования | Этап 7 (сценарии/аналитика) | ✅ внешние условия (цены) — `features/scenarios/*`, БД `price_scenarios` |
| Импорт и экспорт данных | Этап 3 (импорт ТЗ) | ⬜ |
| Пользователи, роли, окно входа | Этап 8 (RBAC, окно входа) | 🟡 `src/domain/security.ts` |
| Требования к UI, дизайн-система Palantir | Этап 1 (оболочка) | ✅ `src/shell/*` |
| Нефункциональные требования | сквозные (перф/безопасность/поставка) | 🟡 |
| 3D-граф (Модель данных, §граф) | Этап 2 (редактор + иерархия) | 🟡 `src/features/plant-scene/*` |

## 5. Пробелы, которые закрывает этот заход

- Сущности и поля выведены «до объектов» (раздел 1) и заведены как типы
  предметной области — `src/domain/*.ts` (контракт с C++-ядром).
- Описание БД (SQLite + ClickHouse) — раздел 2, со ссылками на ТЗ.
- Окно входа и RBAC — раздел 3 и Этап 8 плана (ранее не было явно).
- Каждый документ ТЗ привязан к этапу плана — раздел 4.
