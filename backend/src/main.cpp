/**
 * MAOS backend — локальный HTTP-сервер на 127.0.0.1:8080
 *
 * Сборка:
 *   cd backend && mkdir -p build && cd build
 *   cmake .. -DCMAKE_BUILD_TYPE=Release
 *   cmake --build . -j$(nproc)
 *   ./maos_server [path/to/maos.db]
 */
#include "Database.h"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <sstream>
#include <random>

using json = nlohmann::json;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

static std::string gen_uuid() {
  static std::mt19937 rng(std::random_device{}());
  std::uniform_int_distribution<uint32_t> d(0, 0xFFFFFFFF);
  std::ostringstream ss;
  ss << std::hex << d(rng) << d(rng) << d(rng) << d(rng);
  return ss.str();
}

static void cors(httplib::Response& res) {
  res.set_header("Access-Control-Allow-Origin",  "*");
  res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

static void ok(httplib::Response& res, const json& data) {
  cors(res);
  json body = { {"data", data}, {"error", nullptr} };
  res.set_content(body.dump(), "application/json");
}

static void err(httplib::Response& res, int status, const std::string& msg) {
  cors(res);
  json body = { {"data", nullptr}, {"error", msg} };
  res.status = status;
  res.set_content(body.dump(), "application/json");
}

static void audit(Database& db, const std::string& entity, const std::string& id,
                  const std::string& action, const json& payload = nullptr) {
  try {
    db.exec(
      "INSERT INTO actions(id,entity_type,entity_id,action_type,payload) VALUES(?,?,?,?,?)",
      { gen_uuid(), entity, id, action, payload.is_null() ? "" : payload.dump() }
    );
  } catch (...) {}  // audit must never crash the main flow
}

/* ── Generic CRUD factory ────────────────────────────────────────────────── */

struct CrudConfig {
  std::string table;
  std::string entity;                    // for audit log
  std::vector<std::string> columns;      // writable columns (no id, no created_at)
};

// Extract string from JSON safely
static std::string jstr(const json& j, const std::string& key) {
  if (!j.contains(key)) return "";
  if (j[key].is_string()) return j[key].get<std::string>();
  return j[key].dump();  // arrays / numbers → their JSON string
}

static void register_crud(httplib::Server& svr, Database& db, const CrudConfig& cfg) {
  const std::string base = "/api/" + cfg.table;

  // GET /api/<table>  — list all
  svr.Get(base, [&db, cfg](const httplib::Request&, httplib::Response& res) {
    try {
      auto rows = db.query_json("SELECT * FROM " + cfg.table + " ORDER BY created_at DESC");
      ok(res, rows);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // GET /api/<table>/:id
  svr.Get(base + "/([^/]+)", [&db, cfg](const httplib::Request& req, httplib::Response& res) {
    try {
      auto row = db.query_one("SELECT * FROM " + cfg.table + " WHERE id=?", { req.matches[1] });
      ok(res, row);
    } catch (...) { err(res, 404, "not found"); }
  });

  // POST /api/<table>  — create
  svr.Post(base, [&db, cfg](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string id = gen_uuid();

      // Build INSERT
      std::string cols = "id", holders = "?";
      std::vector<std::string> vals = { id };
      for (auto& col : cfg.columns) {
        cols     += ", " + col;
        holders  += ", ?";
        vals.push_back(jstr(body, col));
      }
      db.exec("INSERT INTO " + cfg.table + "(" + cols + ") VALUES(" + holders + ")", vals);
      audit(db, cfg.entity, id, "CREATE", body);

      auto row = db.query_one("SELECT * FROM " + cfg.table + " WHERE id=?", { id });
      res.status = 201;
      ok(res, row);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // PUT /api/<table>/:id  — update
  svr.Put(base + "/([^/]+)", [&db, cfg](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      auto body = json::parse(req.body);

      std::string set_clause;
      std::vector<std::string> vals;
      for (auto& col : cfg.columns) {
        if (!body.contains(col)) continue;
        if (!set_clause.empty()) set_clause += ", ";
        set_clause += col + "=?";
        vals.push_back(jstr(body, col));
      }
      if (set_clause.empty()) { err(res, 400, "no fields to update"); return; }
      vals.push_back(id);
      db.exec("UPDATE " + cfg.table + " SET " + set_clause + " WHERE id=?", vals);
      audit(db, cfg.entity, id, "UPDATE", body);

      auto row = db.query_one("SELECT * FROM " + cfg.table + " WHERE id=?", { id });
      ok(res, row);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // DELETE /api/<table>/:id
  svr.Delete(base + "/([^/]+)", [&db, cfg](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      db.exec("DELETE FROM " + cfg.table + " WHERE id=?", { id });
      audit(db, cfg.entity, id, "DELETE");
      ok(res, json::object());
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Auth ────────────────────────────────────────────────────────────────── */

static const char* DEMO_PASSWORD = "maos2025";

static void register_auth(httplib::Server& svr, Database& db) {
  svr.Post("/api/auth/login", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string password = jstr(body, "password");
      if (password != DEMO_PASSWORD) {
        err(res, 401, "Неверный пароль");
        return;
      }
      // In production: verify against SQLCipher key / RBAC table
      std::string token = gen_uuid();  // placeholder session token
      audit(db, "auth", "", "LOGIN");
      ok(res, { {"token", token}, {"role", "admin"} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Routing + nested operations ─────────────────────────────────────────── */

static void register_routing_routes(httplib::Server& svr, Database& db) {
  // List routings with their operations
  svr.Get("/api/routings", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      auto rows = db.query_json("SELECT * FROM routings ORDER BY created_at DESC");
      ok(res, rows);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Create routing + batch upsert operations in one transaction
  svr.Post("/api/routings", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string id = gen_uuid();

      db.exec("BEGIN");
      db.exec(
        "INSERT INTO routings(id,name,product_id) VALUES(?,?,NULLIF(?,?))",
        { id, jstr(body, "name"), jstr(body, "product_id"), "" }
      );

      if (body.contains("operations") && body["operations"].is_array()) {
        for (auto& op : body["operations"]) {
          std::string op_id = gen_uuid();
          db.exec(
            "INSERT INTO operations("
            "  id, routing_id, code, name, op_type, wc_types, order_no,"
            "  setup_required, t_norm, t_opt, t_pess, cost, risk_coef,"
            "  controls, mechanisms, inputs, outputs"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            {
              op_id, id,
              jstr(op, "code"),   jstr(op, "name"),   jstr(op, "op_type"),
              jstr(op, "wc_types"), jstr(op, "order_no"),
              jstr(op, "setup_required"),
              jstr(op, "t_norm"), jstr(op, "t_opt"),  jstr(op, "t_pess"),
              jstr(op, "cost"),   jstr(op, "risk_coef"),
              jstr(op, "controls"), jstr(op, "mechanisms"),
              jstr(op, "inputs"),   jstr(op, "outputs"),
            }
          );
        }
      }
      db.exec("COMMIT");
      audit(db, "routing", id, "CREATE", body);

      // Return routing with nested operations
      auto routing = db.query_one("SELECT * FROM routings WHERE id=?", { id });
      routing["operations"] = db.query_json(
        "SELECT * FROM operations WHERE routing_id=? ORDER BY order_no", { id }
      );
      res.status = 201;
      ok(res, routing);
    } catch (std::exception& e) {
      try { db.exec("ROLLBACK"); } catch (...) {}
      err(res, 400, e.what());
    }
  });

  // Get single routing with operations
  svr.Get("/api/routings/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      auto routing = db.query_one("SELECT * FROM routings WHERE id=?", { id });
      routing["operations"] = db.query_json(
        "SELECT * FROM operations WHERE routing_id=? ORDER BY order_no", { id }
      );
      ok(res, routing);
    } catch (...) { err(res, 404, "not found"); }
  });

  // Delete routing (cascades to operations via FK)
  svr.Delete("/api/routings/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      db.exec("DELETE FROM routings WHERE id=?", { id });
      audit(db, "routing", id, "DELETE");
      ok(res, json::object());
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Analytics / Action log ──────────────────────────────────────────────── */

static void register_analytics(httplib::Server& svr, Database& db) {
  svr.Get("/api/actions", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      std::string limit = "100";
      if (req.has_param("limit")) limit = req.get_param_value("limit");
      auto rows = db.query_json(
        "SELECT * FROM actions ORDER BY ts DESC LIMIT " + limit, {}
      );
      ok(res, rows);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });
}

/* ── Standalone operations (routing_id nullable) ─────────────────────────── */

static void register_operation_routes(httplib::Server& svr, Database& db) {
  // POST /api/operations — create standalone NSI operation (routing_id optional)
  svr.Post("/api/operations", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string id = gen_uuid();
      std::string rid = jstr(body, "routing_id");

      // Two paths: with or without routing_id (can't bind NULL via text API)
      if (rid.empty()) {
        db.exec(
          "INSERT INTO operations("
          "  id, code, name, op_type, wc_types, order_no,"
          "  setup_required, t_norm, t_opt, t_pess, cost, risk_coef,"
          "  controls, mechanisms, inputs, outputs"
          ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          {
            id,
            jstr(body, "code"),   jstr(body, "name"),   jstr(body, "op_type"),
            jstr(body, "wc_types"), jstr(body, "order_no"),
            jstr(body, "setup_required"),
            jstr(body, "t_norm"), jstr(body, "t_opt"),  jstr(body, "t_pess"),
            jstr(body, "cost"),   jstr(body, "risk_coef"),
            jstr(body, "controls"), jstr(body, "mechanisms"),
            jstr(body, "inputs"),   jstr(body, "outputs"),
          }
        );
      } else {
        db.exec(
          "INSERT INTO operations("
          "  id, routing_id, code, name, op_type, wc_types, order_no,"
          "  setup_required, t_norm, t_opt, t_pess, cost, risk_coef,"
          "  controls, mechanisms, inputs, outputs"
          ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          {
            id, rid,
            jstr(body, "code"),   jstr(body, "name"),   jstr(body, "op_type"),
            jstr(body, "wc_types"), jstr(body, "order_no"),
            jstr(body, "setup_required"),
            jstr(body, "t_norm"), jstr(body, "t_opt"),  jstr(body, "t_pess"),
            jstr(body, "cost"),   jstr(body, "risk_coef"),
            jstr(body, "controls"), jstr(body, "mechanisms"),
            jstr(body, "inputs"),   jstr(body, "outputs"),
          }
        );
      }
      audit(db, "operation", id, "CREATE", body);
      auto row = db.query_one("SELECT * FROM operations WHERE id=?", { id });
      res.status = 201;
      ok(res, row);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Demo seed ───────────────────────────────────────────────────────────── */

// Маппинг узел сцены → запись «Оборудование». Узлы сцены имеют детерминированные
// id (oreyard, converter…), машины создаются как mach-{nodeId} — фронт линкует
// узлы автоматически по этому правилу.
struct MachDef { std::string nodeId, machId, name, wctId, orgUnit; };

static const std::vector<MachDef>& seed_machines() {
  static const std::vector<MachDef> machs = {
    {"scrapyard",    "mach-scrapyard",    "Скрапный двор",                 "wct-feedstock",    "Сырьевой цех"},
    {"oreyard",      "mach-oreyard",      "Рудный двор",                   "wct-feedstock",    "Сырьевой цех"},
    {"cokeyard",     "mach-cokeyard",     "Коксовый двор",                 "wct-feedstock",    "Сырьевой цех"},
    {"crushing",     "mach-crushing",     "Дробильно-обогатительный цех",  "wct-cleaning",     "ДОЦ"},
    {"screening",    "mach-screening",    "Отделение грохочения",          "wct-cleaning",     "ДОЦ"},
    {"sinter",       "mach-sinter",       "Аглофабрика №1",                "wct-dryer",        "Аглоцех"},
    {"chp",          "mach-chp",          "ТЭЦ — энергоблок",              "wct-boiler",       "Энергоцех"},
    {"gasclean",     "mach-gasclean",     "Газоочистка доменного цеха",    "wct-finecleaning", "Доменный цех"},
    {"blastfurnace", "mach-blastfurnace", "Доменная печь №1",              "wct-finecleaning", "Доменный цех"},
    {"hotblast",     "mach-hotblast",     "Воздухонагреватели (дутьё)",    "wct-boiler",       "Доменный цех"},
    {"converter",    "mach-converter",    "Кислородный конвертер №1",      "wct-briquettes",   "ККЦ"},
    {"eaf",          "mach-eaf",          "Электродуговая печь ЭДП-100",   "wct-briquettes",   "ЭСПЦ"},
    {"ladle",        "mach-ladle",        "Установка ковш-печь УКП-1",     "wct-finecleaning", "ККЦ"},
    {"ccm",          "mach-ccm",          "МНЛЗ №1 (слябовая)",            "wct-pileizer",     "ССЦ"},
    {"rolling",      "mach-rolling",      "Прокатный стан 2000 (горячий)", "wct-pileizer",     "ПЦ"},
    {"coldrolling",  "mach-coldrolling",  "Прокатный стан 1700 (холодный)","wct-cleaning",     "ПЦ"},
    {"heattreat",    "mach-heattreat",    "Термическое отделение",         "wct-finecleaning", "ПЦ"},
    {"substation",   "mach-substation",   "Главная подстанция 110 кВ",     "wct-transformer",  "Энергоцех"},
    {"substation2",  "mach-substation2",  "Подстанция ПС-2 (35 кВ)",       "wct-transformer",  "Энергоцех"},
    {"warehouse",    "mach-warehouse",    "Склад готовой продукции",       "wct-wirehouse",    "Склад"},
    {"slabyard",     "mach-slabyard",     "Склад слябов и заготовок",      "wct-wirehouse",    "ССЦ"},
    {"maintenance",  "mach-maintenance",  "Ремонтно-механический цех",     "wct-marketing",    "РМЦ"},
    {"lab",          "mach-lab",          "Центральная лаборатория (ОТК)", "wct-marketing",    "ОТК"},
    {"shipping",     "mach-shipping",     "Отгрузка — железная дорога",    "wct-sale",         "Отгрузка"},
    {"shipping2",    "mach-shipping2",    "Отгрузка — автотранспорт",      "wct-sale",         "Отгрузка"},
    {"sales",        "mach-sales",        "Служба сбыта и маркетинга",     "wct-marketing",    "Сбыт"},
  };
  return machs;
}

// Идемпотентный посев всех реестров (INSERT OR IGNORE по детерминированным id).
static void seed_demo(Database& db) {
  struct WctDef { std::string id, name, group, kind; };
  const std::vector<WctDef> wcts = {
    {"wct-feedstock",    "Сырьевой двор",           "Сырьё",       "feedstock"},
    {"wct-cleaning",     "Обогащение и подготовка", "Переработка", "cleaningarea"},
    {"wct-dryer",        "Аглофабрика / Сушка",     "Термическое", "dryer"},
    {"wct-boiler",       "Энергетика и дутьё",      "Энергетика",  "boiler"},
    {"wct-finecleaning", "Плавильные агрегаты",     "Плавка",      "finecleaning"},
    {"wct-briquettes",   "Сталеплавильное",         "Плавка",      "briquettes"},
    {"wct-pileizer",     "Прокатное производство",  "Прокат",      "pileizer"},
    {"wct-transformer",  "Электроснабжение",        "Энергетика",  "transformer"},
    {"wct-wirehouse",    "Складское хозяйство",     "Хранение",    "wirehouse"},
    {"wct-sale",         "Отгрузка",                "Логистика",   "sale"},
    {"wct-marketing",    "Вспомогательные службы",  "Сервис",      "marketing"},
  };

  // Изделия / материалы (BOM): purchased=1 — покупное сырьё.
  struct ProdDef {
    std::string id, code, name, unit, parentId; double qtyInParent; int purchased;
  };
  const std::vector<ProdDef> prods = {
    {"prod-ore",    "RAW-001", "Железная руда",          "т", "",          0,   1},
    {"prod-coke",   "RAW-002", "Кокс",                   "т", "",          0,   1},
    {"prod-flux",   "RAW-003", "Флюс (известняк)",       "т", "",          0,   1},
    {"prod-scrap",  "RAW-004", "Металлолом",             "т", "",          0,   1},
    {"prod-sinter", "SF-001",  "Агломерат",              "т", "prod-iron", 1.6, 0},
    {"prod-iron",   "SF-002",  "Чугун передельный",      "т", "prod-steel", 0.9, 0},
    {"prod-steel",  "SF-003",  "Сталь жидкая",           "т", "prod-slab", 1.1, 0},
    {"prod-slab",   "SF-004",  "Сляб (заготовка)",       "т", "prod-hrc",  1.05, 0},
    {"prod-hrc",    "FIN-001", "Рулон горячекатаный",    "т", "prod-crc",  1.08, 0},
    {"prod-crc",    "FIN-002", "Лист холоднокатаный",    "т", "",          0,   0},
  };

  // Операции-шаблоны НСИ (routing_id = NULL). wc_types — имена типов (как фильтрует фронт).
  struct OpTemplate {
    std::string id, code, name, opType, wcTypes; int tNorm; std::string inputs, outputs;
  };
  const std::vector<OpTemplate> opTemplates = {
    {"opt-crush",   "OP-010", "Дробление и обогащение руды", "machining", "Обогащение и подготовка", 45,  "Железная руда", "Концентрат"},
    {"opt-sinter",  "OP-020", "Агломерация",                 "heat",      "Аглофабрика / Сушка",     90,  "Концентрат, Флюс (известняк)", "Агломерат"},
    {"opt-blast",   "OP-030", "Доменная плавка",             "heat",      "Плавильные агрегаты",     240, "Агломерат, Кокс", "Чугун передельный"},
    {"opt-bof",     "OP-040", "Конвертерная плавка",         "heat",      "Сталеплавильное",         40,  "Чугун передельный, Металлолом", "Сталь жидкая"},
    {"opt-eaf",     "OP-041", "Электроплавка (ЭДП)",         "heat",      "Сталеплавильное",         75,  "Металлолом", "Сталь жидкая"},
    {"opt-ladle",   "OP-050", "Внепечная обработка стали",   "heat",      "Плавильные агрегаты",     35,  "Сталь жидкая", "Сталь жидкая"},
    {"opt-cast",    "OP-060", "Непрерывная разливка",        "machining", "Прокатное производство",  55,  "Сталь жидкая", "Сляб (заготовка)"},
    {"opt-hotroll", "OP-070", "Горячая прокатка",            "machining", "Прокатное производство",  30,  "Сляб (заготовка)", "Рулон горячекатаный"},
    {"opt-coldroll","OP-080", "Холодная прокатка",           "machining", "Обогащение и подготовка", 28,  "Рулон горячекатаный", "Лист холоднокатаный"},
    {"opt-heat",    "OP-090", "Термообработка (отжиг)",      "heat",      "Плавильные агрегаты",     120, "Лист холоднокатаный", "Лист холоднокатаный"},
    {"opt-qc",      "OP-100", "Контроль качества",           "control",   "Вспомогательные службы",  20,  "", ""},
  };

  // Техкарты: routing + операции-шаги (берут параметры из шаблонов).
  struct RoutingDef {
    std::string id, name, productId;
    std::vector<std::string> opTemplateIds;  // последовательность шаблонов
  };
  const std::vector<RoutingDef> routings = {
    {"route-hrc", "Производство горячекатаного рулона", "prod-hrc",
      {"opt-sinter", "opt-blast", "opt-bof", "opt-ladle", "opt-cast", "opt-hotroll", "opt-qc"}},
    {"route-crc", "Производство холоднокатаного листа", "prod-crc",
      {"opt-coldroll", "opt-heat", "opt-qc"}},
  };

  db.exec("BEGIN");

  for (auto& w : wcts)
    db.exec("INSERT OR IGNORE INTO work_center_types(id,name,group_name,kind) VALUES(?,?,?,?)",
            {w.id, w.name, w.group, w.kind});

  for (auto& m : seed_machines())
    db.exec("INSERT OR IGNORE INTO machines(id,name,wc_type_id,org_unit,status) VALUES(?,?,?,?,?)",
            {m.machId, m.name, m.wctId, m.orgUnit, "active"});

  // Изделия: сначала без parent (избегаем FK-порядка), потом проставляем parent_id.
  for (auto& p : prods)
    db.exec("INSERT OR IGNORE INTO products(id,code,name,unit,purchased) VALUES(?,?,?,?,?)",
            {p.id, p.code, p.name, p.unit, std::to_string(p.purchased)});
  for (auto& p : prods)
    if (!p.parentId.empty())
      db.exec("UPDATE products SET parent_id=?, qty_in_parent=? WHERE id=?",
              {p.parentId, std::to_string(p.qtyInParent), p.id});

  // Шаблоны операций (routing_id = NULL).
  for (auto& o : opTemplates)
    db.exec("INSERT OR IGNORE INTO operations(id,code,name,op_type,wc_types,t_norm,t_opt,t_pess,inputs,outputs) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            {o.id, o.code, o.name, o.opType, o.wcTypes,
             std::to_string(o.tNorm), std::to_string(o.tNorm), std::to_string(o.tNorm),
             o.inputs, o.outputs});

  // Техкарты + их шаги (копии шаблонов, привязанные к routing_id).
  for (auto& r : routings) {
    db.exec("INSERT OR IGNORE INTO routings(id,name,product_id) VALUES(?,?,?)",
            {r.id, r.name, r.productId});
    int order = 10;
    for (auto& tplId : r.opTemplateIds) {
      const OpTemplate* tpl = nullptr;
      for (auto& o : opTemplates) if (o.id == tplId) { tpl = &o; break; }
      if (!tpl) continue;
      std::string stepId = r.id + "-" + tplId;
      db.exec("INSERT OR IGNORE INTO operations(id,routing_id,code,name,op_type,wc_types,order_no,"
              "t_norm,t_opt,t_pess,inputs,outputs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              {stepId, r.id, tpl->code, tpl->name, tpl->opType, tpl->wcTypes,
               std::to_string(order),
               std::to_string(tpl->tNorm), std::to_string(tpl->tNorm), std::to_string(tpl->tNorm),
               tpl->inputs, tpl->outputs});
      order += 10;
    }
  }

  db.exec("COMMIT");
}

static void register_demo_seed(httplib::Server& svr, Database& db) {
  svr.Post("/api/demo/seed", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      seed_demo(db);
      json mapping = json::array();
      for (auto& m : seed_machines())
        mapping.push_back({{"nodeId", m.nodeId}, {"machineId", m.machId}});
      ok(res, mapping);
    } catch (std::exception& e) {
      try { db.exec("ROLLBACK"); } catch (...) {}
      err(res, 400, e.what());
    }
  });

  // Маппинг узел→машина без посева (для авто-линковки на фронте).
  svr.Get("/api/demo/mapping", [](const httplib::Request&, httplib::Response& res) {
    json mapping = json::array();
    for (auto& m : seed_machines())
      mapping.push_back({{"nodeId", m.nodeId}, {"machineId", m.machId}});
    ok(res, mapping);
  });
}

/* ── main ────────────────────────────────────────────────────────────────── */

int main(int argc, char* argv[]) {
  std::string db_path = "maos.db";
  if (argc > 1) db_path = argv[1];

  std::cout << "MAOS backend starting...\n";
  std::cout << "Database: " << db_path << "\n";

  Database db(db_path);
  db.init_schema();
  std::cout << "Schema ready.\n";

  // Авто-посев демо-данных при пустой базе: реестры и схема должны быть
  // согласованы — нельзя иметь объекты на схеме без записей в НСИ.
  try {
    auto cnt = db.query_one("SELECT COUNT(*) AS n FROM work_center_types");
    if (cnt["n"].get<std::string>() == "0") {
      seed_demo(db);
      std::cout << "Demo data seeded (empty DB).\n";
    }
  } catch (std::exception& e) {
    std::cerr << "Seed check failed: " << e.what() << "\n";
  }

  httplib::Server svr;

  // CORS pre-flight
  svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
    cors(res);
  });

  // Health
  svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
    cors(res);
    ok(res, { {"status", "ok"}, {"version", "0.1-demo"} });
  });

  // Auth
  register_auth(svr, db);

  // NSI registries (simple CRUD)
  register_crud(svr, db, {
    "work_center_types", "work_center_type",
    { "name", "group_name", "kind", "description", "interchangeable" }
  });

  register_crud(svr, db, {
    "machines", "machine",
    { "name", "wc_type_id", "org_unit", "inv_no", "serial_no",
      "year_made", "schedule", "status" }
  });

  register_crud(svr, db, {
    "products", "product",
    { "code", "name", "unit", "parent_id", "qty_in_parent",
      "batch_size", "stock", "purchased" }
  });

  register_crud(svr, db, {
    "workers", "worker",
    { "tab_no", "last_name", "first_name", "middle_name",
      "org_unit", "position", "grade", "skills" }
  });

  // Custom POST for operations (NULLIF routing_id) — must precede generic CRUD
  register_operation_routes(svr, db);

  register_crud(svr, db, {
    "operations", "operation",
    { "routing_id", "code", "name", "op_type", "wc_types", "order_no",
      "setup_required", "t_norm", "t_opt", "t_pess", "cost", "risk_coef",
      "controls", "mechanisms", "inputs", "outputs" }
  });

  // Routings (complex — nested ops, transactional)
  register_routing_routes(svr, db);

  // Demo seed
  register_demo_seed(svr, db);

  // Audit / analytics
  register_analytics(svr, db);

  std::cout << "Listening on http://127.0.0.1:8080\n";
  svr.listen("127.0.0.1", 8080);
  return 0;
}
