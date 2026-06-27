-- MAOS SQLite schema
-- Run once via Database::init_schema()

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Типы оборудования ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_center_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  group_name      TEXT,
  kind            TEXT NOT NULL DEFAULT '',  -- ObjectKind: 3D-вид на схеме
  description     TEXT,
  interchangeable INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Единицы оборудования ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  wc_type_id  TEXT REFERENCES work_center_types(id) ON DELETE SET NULL,
  org_unit    TEXT,
  inv_no      TEXT,
  serial_no   TEXT,
  year_made   INTEGER,
  schedule    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | maintenance | decommissioned
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Техкарты (маршруты) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routings (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  product_id  TEXT REFERENCES products(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Операции (шаги маршрута) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operations (
  id             TEXT PRIMARY KEY,
  routing_id     TEXT REFERENCES routings(id) ON DELETE CASCADE,  -- NULL = шаблон НСИ
  code           TEXT,
  name           TEXT NOT NULL,
  op_type        TEXT,
  wc_types       TEXT,          -- JSON array of strings
  order_no       INTEGER NOT NULL DEFAULT 10,
  setup_required INTEGER NOT NULL DEFAULT 0,
  t_norm         REAL,
  t_opt          REAL,
  t_pess         REAL,
  cost           REAL,
  risk_coef      REAL NOT NULL DEFAULT 0.05,
  controls       TEXT,          -- JSON array of IDEF0 C-arrows (standards, docs)
  mechanisms     TEXT,          -- JSON array of IDEF0 M-arrows (equipment, workers)
  inputs         TEXT,          -- JSON array of IDEF0 I-arrow labels
  outputs        TEXT,          -- JSON array of IDEF0 O-arrow labels
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Рабочие ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id          TEXT PRIMARY KEY,
  tab_no      TEXT NOT NULL UNIQUE,
  last_name   TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  middle_name TEXT,
  org_unit    TEXT,
  position    TEXT,
  grade       INTEGER NOT NULL DEFAULT 3,
  skills      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE INDEX IF NOT EXISTS idx_actions_entity
  ON actions (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_actions_ts
  ON actions (ts);
