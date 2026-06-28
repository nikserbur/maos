-- MAOS SQLite schema — полная целевая схема (для пустой БД).
-- Существующие БД доводятся до этой схемы миграциями (Database::migrate()).
-- Все связи реестров — настоящие (FOREIGN KEY по ID), не по именам.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Оргструктура (подразделение → цех) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_units (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES org_units(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Типы оборудования ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_center_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  group_name      TEXT,
  kind            TEXT NOT NULL DEFAULT '',  -- ObjectKind: 3D-вид на схеме
  characteristics TEXT,                      -- JSON [{label,value}] фикс. характеристики типа
  description     TEXT,
  interchangeable INTEGER NOT NULL DEFAULT 0,
  hour_rate       REAL    NOT NULL DEFAULT 0,    -- ставка машино-часа (себестоимость)
  efficiency      REAL    NOT NULL DEFAULT 0.85, -- коэф. готовности (фонд мощности)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Единицы оборудования = узлы 3D-схемы ───────────────────────────────────
CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  wc_type_id  TEXT REFERENCES work_center_types(id) ON DELETE SET NULL,
  org_unit    TEXT,                                            -- legacy: имя цеха
  org_unit_id TEXT REFERENCES org_units(id) ON DELETE SET NULL,
  inv_no      TEXT,
  serial_no   TEXT,
  year_made   INTEGER,
  schedule    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | maintenance | decommissioned
  -- Раскладка на 3D-схеме (справочник оборудования и схема — единая сущность):
  subtitle          TEXT,
  pos_x             REAL NOT NULL DEFAULT 0,
  pos_z             REAL NOT NULL DEFAULT 0,
  rotation_y        REAL NOT NULL DEFAULT 0,
  parent_machine_id TEXT REFERENCES machines(id) ON DELETE CASCADE,  -- drill-down
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Физические связи на схеме (конвейеры, трубопроводы, кабели) ────────────
CREATE TABLE IF NOT EXISTS flows (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  parent_id  TEXT,   -- уровень иерархии (NULL = верхний)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 3D-схема как сохранённый агрегат (мета: камера/масштаб/версия) ─────────
CREATE TABLE IF NOT EXISTS scheme_meta (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  name        TEXT NOT NULL DEFAULT 'Схема предприятия',
  ground_size REAL NOT NULL DEFAULT 80,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Изделия / материалы (BOM-узлы) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'шт',
  parent_id       TEXT REFERENCES products(id) ON DELETE SET NULL,
  qty_in_parent   REAL NOT NULL DEFAULT 1,
  batch_size      REAL NOT NULL DEFAULT 1,
  stock           REAL NOT NULL DEFAULT 0,
  purchased       INTEGER NOT NULL DEFAULT 0,
  -- Экономика внешних условий / робастной оптимизации:
  sellable        INTEGER NOT NULL DEFAULT 0,   -- товарная (продаваемая) позиция
  base_cost       REAL NOT NULL DEFAULT 0,      -- цена закупки (для purchased)
  base_price      REAL NOT NULL DEFAULT 0,      -- ориентир цены реализации (mean по умолчанию)
  demand_max      REAL NOT NULL DEFAULT 0,      -- верхняя граница спроса/сбыта на горизонте
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Техкарты (маршруты) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routings (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  product_id  TEXT REFERENCES products(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Операции (шаблоны НСИ и шаги маршрута) ────────────────────────────────
CREATE TABLE IF NOT EXISTS operations (
  id             TEXT PRIMARY KEY,
  routing_id     TEXT REFERENCES routings(id) ON DELETE CASCADE,  -- NULL = шаблон НСИ
  template_id    TEXT REFERENCES operations(id) ON DELETE SET NULL, -- шаг ← шаблон НСИ
  code           TEXT,
  name           TEXT NOT NULL,
  op_type        TEXT,
  wc_types       TEXT,          -- legacy: имена типов (мигрировано в operation_wc_types)
  order_no       INTEGER NOT NULL DEFAULT 10,
  setup_required INTEGER NOT NULL DEFAULT 0,
  setup_cost     REAL,
  labor_rate     REAL,
  t_norm         REAL,
  t_opt          REAL,
  t_pess         REAL,
  cost           REAL,
  risk_coef      REAL NOT NULL DEFAULT 0.05,
  controls       TEXT,          -- JSON array of IDEF0 C-arrows
  mechanisms     TEXT,          -- JSON array of IDEF0 M-arrows
  inputs         TEXT,          -- legacy: имена входов (мигрировано в operation_inputs)
  outputs        TEXT,          -- JSON array of IDEF0 O-arrow labels
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Связь операция → допустимый тип оборудования (по ID) ───────────────────
CREATE TABLE IF NOT EXISTS operation_wc_types (
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  wc_type_id   TEXT NOT NULL REFERENCES work_center_types(id) ON DELETE CASCADE,
  PRIMARY KEY (operation_id, wc_type_id)
);

-- ── Связь операция → входное изделие (по ID, с количеством) ────────────────
CREATE TABLE IF NOT EXISTS operation_inputs (
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty          REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (operation_id, product_id)
);

-- ── Рабочие ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id          TEXT PRIMARY KEY,
  tab_no      TEXT NOT NULL UNIQUE,
  last_name   TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  middle_name TEXT,
  org_unit    TEXT,
  org_unit_id TEXT REFERENCES org_units(id) ON DELETE SET NULL,
  position    TEXT,
  grade       INTEGER NOT NULL DEFAULT 3,
  cost_per_hour REAL NOT NULL DEFAULT 0,
  skills      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Сценарии внешних условий (стохастика цен) ──────────────────────────────
CREATE TABLE IF NOT EXISTS price_scenarios (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  horizon_hours REAL NOT NULL DEFAULT 720,   -- фонд времени горизонта (≈ месяц)
  market_corr   REAL NOT NULL DEFAULT 0.5,   -- взаимосвязь цен (общий рыночный фактор)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Распределение цены продукта в сценарии (внешнее условие) ───────────────
CREATE TABLE IF NOT EXISTS price_distributions (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES price_scenarios(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  dist_type   TEXT NOT NULL DEFAULT 'normal', -- normal | lognormal | triangular | uniform
  mean        REAL NOT NULL DEFAULT 0,
  stddev      REAL NOT NULL DEFAULT 0,
  min_val     REAL,
  max_val     REAL,
  mode_val    REAL,                            -- для triangular
  beta        REAL NOT NULL DEFAULT 0.7,       -- загрузка на рыночный фактор (корреляция)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Прогон оптимизации (результат + робастные метрики) ─────────────────────
CREATE TABLE IF NOT EXISTS optimization_runs (
  id           TEXT PRIMARY KEY,
  scenario_id  TEXT REFERENCES price_scenarios(id) ON DELETE SET NULL,
  objective    TEXT NOT NULL DEFAULT 'cvar',  -- cvar | worstcase | meanvariance | minregret
  samples      INTEGER NOT NULL DEFAULT 2000,
  alpha        REAL NOT NULL DEFAULT 0.10,
  lambda       REAL NOT NULL DEFAULT 1.0,
  seed         INTEGER NOT NULL DEFAULT 42,
  status       TEXT NOT NULL DEFAULT 'done',
  result_json  TEXT,                           -- полный результат (метрики, гистограмма, кандидаты)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Портфель (итог выбора) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'robust',   -- robust | expected
  exp_profit REAL, cvar REAL, worst_case REAL, std_dev REAL, p_loss REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty          REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (portfolio_id, product_id)
);

-- ── План производства из портфеля (загрузка ресурсов) ──────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  product_id   TEXT REFERENCES products(id) ON DELETE SET NULL,
  operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL,
  wc_type_id   TEXT REFERENCES work_center_types(id) ON DELETE SET NULL,
  load_hours   REAL NOT NULL DEFAULT 0,
  qty          REAL NOT NULL DEFAULT 0
);

-- ── Роли / пользователи (выход из тестового режима) ────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  permissions TEXT                              -- JSON массив прав
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                  -- salted FNV-хеш (демо-KDF), не план-текст
  role_id       TEXT REFERENCES roles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Action layer (event sourcing / audit log) ─────────────────────────────
CREATE TABLE IF NOT EXISTS actions (
  id           TEXT PRIMARY KEY,
  ts           TEXT NOT NULL DEFAULT (datetime('now')),
  actor        TEXT NOT NULL DEFAULT 'system',
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  action_type  TEXT NOT NULL,  -- CREATE | UPDATE | DELETE
  payload      TEXT            -- JSON snapshot
);

CREATE INDEX IF NOT EXISTS idx_actions_entity   ON actions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_actions_ts        ON actions (ts);
CREATE INDEX IF NOT EXISTS idx_machines_wctype   ON machines (wc_type_id);
CREATE INDEX IF NOT EXISTS idx_operations_routing ON operations (routing_id);
CREATE INDEX IF NOT EXISTS idx_opwct_op          ON operation_wc_types (operation_id);
CREATE INDEX IF NOT EXISTS idx_opin_op           ON operation_inputs (operation_id);
CREATE INDEX IF NOT EXISTS idx_pricedist_scen    ON price_distributions (scenario_id);
CREATE INDEX IF NOT EXISTS idx_portfitems_pf     ON portfolio_items (portfolio_id);
