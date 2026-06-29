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
#include "Optimizer.h"
#include "Scheduler.h"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <sstream>
#include <random>
#include <algorithm>
#include <cmath>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <cstdint>

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

// Заполнить operation_inputs из JSON-массива входов техкарты [{productId|product_id, qty}, …]
// (формат редактора техкарт). Агрегирует дубли по изделию, пропускает несуществующие.
// Удаление существующих строк — на вызывающей стороне.
static void insert_op_inputs_json(Database& db, const std::string& opId, const std::string& jsonStr) {
  if (jsonStr.empty()) return;
  json arr;
  try { arr = json::parse(jsonStr); } catch (...) { return; }
  if (!arr.is_array()) return;
  std::unordered_map<std::string, double> agg;
  for (auto& in : arr) {
    std::string pid = in.contains("productId") ? in.value("productId", std::string())
                                               : in.value("product_id", std::string());
    if (pid.empty()) continue;
    double qty = 1.0;
    if (in.contains("qty")) {
      if (in["qty"].is_number()) qty = in["qty"].get<double>();
      else if (in["qty"].is_string()) { try { qty = std::stod(in["qty"].get<std::string>()); } catch (...) {} }
    }
    agg[pid] += qty;
  }
  for (auto& [pid, qty] : agg)
    db.exec("INSERT OR IGNORE INTO operation_inputs(operation_id,product_id,qty) "
            "SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE id=?)",
            { opId, pid, std::to_string(qty), pid });
}

// Записать связи операции по ID (operation_wc_types, operation_inputs) из тела:
//   wc_type_ids: ["id1","id2"]              — допустимые типы оборудования
//   input_products: [{product_id, qty}, …]  | ["pid", …]
//   inputs: "[{productId,qty},…]" (JSON-строка из редактора техкарт)
// Реестры связаны по ID — это основа расчёта себестоимости/мощности.
static void link_operation(Database& db, const std::string& opId, const json& body) {
  db.exec("DELETE FROM operation_wc_types WHERE operation_id=?", { opId });
  db.exec("DELETE FROM operation_inputs   WHERE operation_id=?", { opId });
  if (body.contains("wc_type_ids") && body["wc_type_ids"].is_array())
    for (auto& w : body["wc_type_ids"]) {
      if (!w.is_string() || w.get<std::string>().empty()) continue;
      db.exec("INSERT OR IGNORE INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,?)",
              { opId, w.get<std::string>() });
    }
  if (body.contains("input_products") && body["input_products"].is_array())
    for (auto& in : body["input_products"]) {
      std::string pid; std::string qty = "1";
      if (in.is_string()) pid = in.get<std::string>();
      else if (in.is_object()) { pid = jstr(in, "product_id"); if (in.contains("qty")) qty = jstr(in, "qty"); }
      if (pid.empty()) continue;
      db.exec("INSERT OR IGNORE INTO operation_inputs(operation_id,product_id,qty) VALUES(?,?,?)",
              { opId, pid, qty });
    }
  // Входы из редактора техкарт (JSON-строка inputs) — основной путь для UI.
  if (body.contains("inputs") && body["inputs"].is_string())
    insert_op_inputs_json(db, opId, body["inputs"].get<std::string>());
}

// Демо-KDF: солёный FNV-1a (не криптостойкий, но не план-текст). Формат "salt$hex".
static uint64_t fnv1a(const std::string& s) {
  uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; }
  return h;
}
static std::string hash_password(const std::string& pw) {
  std::string salt = gen_uuid().substr(0, 8);
  std::ostringstream ss; ss << salt << "$" << std::hex << fnv1a(salt + ":" + pw);
  return ss.str();
}
static bool verify_password(const std::string& pw, const std::string& stored) {
  auto pos = stored.find('$');
  if (pos == std::string::npos) return false;
  std::string salt = stored.substr(0, pos);
  std::ostringstream ss; ss << std::hex << fnv1a(salt + ":" + pw);
  return ss.str() == stored.substr(pos + 1);
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

      // Build INSERT. Для FK-колонок (…_id) пустую строку превращаем в NULL —
      // иначе '' нарушает внешний ключ (SQLITE_CONSTRAINT, код 19).
      std::string cols = "id", holders = "?";
      std::vector<std::string> vals = { id };
      for (auto& col : cfg.columns) {
        bool fk = col.size() >= 3 && col.compare(col.size() - 3, 3, "_id") == 0;
        cols     += ", " + col;
        holders  += fk ? ", NULLIF(?, '')" : ", ?";
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
        bool fk = col.size() >= 3 && col.compare(col.size() - 3, 3, "_id") == 0;
        if (!set_clause.empty()) set_clause += ", ";
        set_clause += col + (fk ? "=NULLIF(?, '')" : "=?");
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
// Аутентификация против реестра пользователей (RBAC), не против константы.
// Логин по умолчанию: admin / maos2025 (хеш засеян миграцией).

static void register_auth(httplib::Server& svr, Database& db) {
  svr.Post("/api/auth/login", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string login    = jstr(body, "login");
      std::string password = jstr(body, "password");
      if (login.empty()) login = "admin";  // окно входа по умолчанию

      json user;
      try {
        user = db.query_one("SELECT * FROM users WHERE login=?", { login });
      } catch (...) { err(res, 401, "Пользователь не найден"); return; }

      if (jstr(user, "status") != "active") { err(res, 403, "Учётная запись заблокирована"); return; }
      if (!verify_password(password, jstr(user, "password_hash"))) {
        db.exec_safe("UPDATE users SET failed_attempts=failed_attempts+1 WHERE id='"
                     + jstr(user, "id") + "'");
        err(res, 401, "Неверный логин или пароль");
        return;
      }
      db.exec_safe("UPDATE users SET failed_attempts=0 WHERE id='" + jstr(user, "id") + "'");

      std::string roleName = "viewer", perms = "[]";
      std::string roleId = jstr(user, "role_id");
      if (!roleId.empty()) {
        try {
          auto role = db.query_one("SELECT * FROM roles WHERE id=?", { roleId });
          roleName = jstr(role, "name"); perms = jstr(role, "permissions");
        } catch (...) {}
      }
      std::string token = gen_uuid();  // локальный сессионный токен
      audit(db, "auth", jstr(user, "id"), "LOGIN");
      ok(res, { {"token", token}, {"login", login}, {"role", roleName},
                {"permissions", json::parse(perms.empty() ? "[]" : perms)} });
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

      std::lock_guard<std::recursive_mutex> lk(db.mutex());  // атомарная транзакция
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
          link_operation(db, op_id, op);  // связи шага по ID (типы оборуд., входы)
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
      link_operation(db, id, body);
      audit(db, "operation", id, "CREATE", body);
      auto row = db.query_one("SELECT * FROM operations WHERE id=?", { id });
      res.status = 201;
      ok(res, row);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // PUT /api/operations/:id — обновление + ПЕРЕсвязывание join-таблиц по ID.
  // Должен предшествовать generic CRUD, иначе связи operation_wc_types/
  // operation_inputs останутся устаревшими (capacity/cost берутся из них).
  svr.Put("/api/operations/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      auto body = json::parse(req.body);
      static const std::vector<std::string> cols = {
        "routing_id","code","name","op_type","wc_types","order_no","setup_required",
        "setup_cost","labor_rate","t_norm","t_opt","t_pess","cost","risk_coef",
        "controls","mechanisms","inputs","outputs" };
      std::string set_clause; std::vector<std::string> vals;
      for (auto& col : cols) {
        if (!body.contains(col)) continue;
        if (!set_clause.empty()) set_clause += ", ";
        set_clause += col + "=?";
        vals.push_back(jstr(body, col));
      }
      std::lock_guard<std::recursive_mutex> lk(db.mutex());  // строка + связи атомарно
      if (!set_clause.empty()) {
        vals.push_back(id);
        db.exec("UPDATE operations SET " + set_clause + " WHERE id=?", vals);
      }
      if (body.contains("wc_type_ids") || body.contains("input_products"))
        link_operation(db, id, body);
      audit(db, "operation", id, "UPDATE", body);
      auto row = db.query_one("SELECT * FROM operations WHERE id=?", { id });
      ok(res, row);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Demo seed ───────────────────────────────────────────────────────────── */

// Маппинг узел сцены → запись «Оборудование». Узлы сцены имеют детерминированные
// id (oreyard, converter…), машины создаются как mach-{nodeId} — фронт линкует
// узлы автоматически по этому правилу.
struct MachDef {
  std::string nodeId, machId, name, wctId, orgUnit, subtitle, parentId;
  double posX, posZ, rotY;
};

// PI / -PI/2 для совпадения с прежней раскладкой схемы.
static constexpr double R_PI   = 3.14159265;
static constexpr double R_NEG  = -1.5707963;

static const std::vector<MachDef>& seed_machines() {
  static const std::vector<MachDef> machs = {
    //  node          machId               name                              wctId               orgUnit         subtitle                       parent  posX  posZ  rotY
    {"scrapyard",    "mach-scrapyard",    "Скрапный двор",                 "wct-feedstock",    "Сырьевой цех", "Металлолом и скрап",          "", -24, -8,  0},
    {"oreyard",      "mach-oreyard",      "Рудный двор",                   "wct-feedstock",    "Сырьевой цех", "Приём руды, кокса, флюсов",   "", -21,  0,  0},
    {"cokeyard",     "mach-cokeyard",     "Коксовый двор",                 "wct-feedstock",    "Сырьевой цех", "Хранение и подготовка кокса", "", -24,  8,  0},
    {"crushing",     "mach-crushing",     "Дробильно-обогатительный цех",  "wct-cleaning",     "ДОЦ",          "Подготовка шихты",            "", -14,  0,  R_NEG},
    {"screening",    "mach-screening",    "Отделение грохочения",          "wct-cleaning",     "ДОЦ",          "Сортировка по фракциям",      "", -14, -8,  R_NEG},
    {"sinter",       "mach-sinter",       "Аглофабрика №1",                "wct-dryer",        "Аглоцех",      "Производство агломерата",     "",  -7,  0,  R_PI},
    {"chp",          "mach-chp",          "ТЭЦ — энергоблок",              "wct-boiler",       "Энергоцех",    "Пар и электроэнергия",        "",  -7, 10,  R_PI},
    {"gasclean",     "mach-gasclean",     "Газоочистка доменного цеха",    "wct-finecleaning", "Доменный цех", "Доменный газ и пыль",         "",  -7,-10,  R_PI},
    {"blastfurnace", "mach-blastfurnace", "Доменная печь №1",              "wct-finecleaning", "Доменный цех", "Выплавка чугуна",             "",   0,  0,  0},
    {"hotblast",     "mach-hotblast",     "Воздухонагреватели (дутьё)",    "wct-boiler",       "Доменный цех", "Горячее дутьё",               "",   0,-10,  0},
    {"converter",    "mach-converter",    "Кислородный конвертер №1",      "wct-briquettes",   "ККЦ",          "Выплавка стали",              "",   8, -5,  0},
    {"eaf",          "mach-eaf",          "Электродуговая печь ЭДП-100",   "wct-briquettes",   "ЭСПЦ",         "Выплавка из лома",            "",   8,  5,  0},
    {"ladle",        "mach-ladle",        "Установка ковш-печь УКП-1",     "wct-finecleaning", "ККЦ",          "Внепечная обработка",         "",   8,-14,  0},
    {"ccm",          "mach-ccm",          "МНЛЗ №1 (слябовая)",            "wct-pileizer",     "ССЦ",          "Непрерывная разливка",        "",  16, -8,  0},
    {"rolling",      "mach-rolling",      "Прокатный стан 2000 (горячий)", "wct-pileizer",     "ПЦ",           "Горячий прокат",              "",  16,  4,  0},
    {"coldrolling",  "mach-coldrolling",  "Прокатный стан 1700 (холодный)","wct-cleaning",     "ПЦ",           "Тонкий лист",                 "",  16, 14,  0},
    {"heattreat",    "mach-heattreat",    "Термическое отделение",         "wct-finecleaning", "ПЦ",           "Нормализация и отпуск",       "",  16,-18,  0},
    {"substation",   "mach-substation",   "Главная подстанция 110 кВ",     "wct-transformer",  "Энергоцех",    "Электроснабжение 110 кВ",     "",   1, 12,  0},
    {"substation2",  "mach-substation2",  "Подстанция ПС-2 (35 кВ)",       "wct-transformer",  "Энергоцех",    "Питание сталеплавильного",    "",   8,-22,  0},
    {"warehouse",    "mach-warehouse",    "Склад готовой продукции",       "wct-wirehouse",    "Склад",        "Готовая продукция",           "",  24,  4,  0},
    {"slabyard",     "mach-slabyard",     "Склад слябов и заготовок",      "wct-wirehouse",    "ССЦ",          "Промежуточный склад",         "",  24, -6,  0},
    {"maintenance",  "mach-maintenance",  "Ремонтно-механический цех",     "wct-marketing",    "РМЦ",          "Обслуживание и ремонт",       "",   0,-22,  0},
    {"lab",          "mach-lab",          "Центральная лаборатория (ОТК)", "wct-marketing",    "ОТК",          "Анализы и сертификация",      "", -14,-18,  0},
    {"shipping",     "mach-shipping",     "Отгрузка — железная дорога",    "wct-sale",         "Отгрузка",     "Выполнение заказов",          "",  31, -5,  R_NEG},
    {"shipping2",    "mach-shipping2",    "Отгрузка — автотранспорт",      "wct-sale",         "Отгрузка",     "Мелкие партии",               "",  31,  6,  R_NEG},
    {"sales",        "mach-sales",        "Служба сбыта и маркетинга",     "wct-marketing",    "Сбыт",         "Спрос и план продаж",         "",  31, 16,  R_NEG},

    // Drill-down: внутренняя подсхема конвертера (parent = mach-converter)
    {"conv-charge",  "mach-conv-charge",  "Завалка",                       "wct-feedstock",    "ККЦ",          "Лом и чугун",     "mach-converter", -8, 0, 0},
    {"conv-vessel",  "mach-conv-vessel",  "Конвертер",                     "wct-finecleaning", "ККЦ",          "Кислородная продувка", "mach-converter", 0, 0, 0},
    {"conv-cast",    "mach-conv-cast",    "Разливка",                      "wct-pileizer",     "ККЦ",          "Ковш / МНЛЗ",     "mach-converter",  8, 0, 0},
  };
  return machs;
}

// Связи схемы: верхний уровень + подсхема конвертера. parentId — уровень иерархии.
struct FlowDef { std::string from, to, parent; };
static const std::vector<FlowDef>& seed_flows() {
  static const std::vector<FlowDef> flows = {
    {"mach-scrapyard",    "mach-eaf",          ""},
    {"mach-oreyard",      "mach-crushing",     ""},
    {"mach-cokeyard",     "mach-sinter",       ""},
    {"mach-crushing",     "mach-sinter",       ""},
    {"mach-crushing",     "mach-screening",    ""},
    {"mach-screening",    "mach-sinter",       ""},
    {"mach-sinter",       "mach-blastfurnace", ""},
    {"mach-chp",          "mach-sinter",       ""},
    {"mach-chp",          "mach-blastfurnace", ""},
    {"mach-gasclean",     "mach-chp",          ""},
    {"mach-hotblast",     "mach-blastfurnace", ""},
    {"mach-blastfurnace", "mach-gasclean",     ""},
    {"mach-blastfurnace", "mach-hotblast",     ""},
    {"mach-blastfurnace", "mach-converter",    ""},
    {"mach-blastfurnace", "mach-eaf",          ""},
    {"mach-converter",    "mach-ladle",        ""},
    {"mach-eaf",          "mach-ladle",        ""},
    {"mach-ladle",        "mach-ccm",          ""},
    {"mach-ccm",          "mach-rolling",      ""},
    {"mach-ccm",          "mach-heattreat",    ""},
    {"mach-heattreat",    "mach-rolling",      ""},
    {"mach-rolling",      "mach-coldrolling",  ""},
    {"mach-rolling",      "mach-warehouse",    ""},
    {"mach-coldrolling",  "mach-warehouse",    ""},
    {"mach-ccm",          "mach-slabyard",     ""},
    {"mach-slabyard",     "mach-rolling",      ""},
    {"mach-warehouse",    "mach-shipping",     ""},
    {"mach-warehouse",    "mach-shipping2",    ""},
    {"mach-substation",   "mach-converter",    ""},
    {"mach-substation",   "mach-sinter",       ""},
    {"mach-substation2",  "mach-eaf",          ""},
    {"mach-substation2",  "mach-ladle",        ""},
    {"mach-shipping",     "mach-sales",        ""},
    {"mach-shipping2",    "mach-sales",        ""},
    // Подсхема конвертера
    {"mach-conv-charge",  "mach-conv-vessel",  "mach-converter"},
    {"mach-conv-vessel",  "mach-conv-cast",    "mach-converter"},
  };
  return flows;
}

// Идемпотентный посев всех реестров (INSERT OR IGNORE по детерминированным id).
static void seed_demo(Database& db) {
  // Фиксированные характеристики типа (JSON [{label,value}]) — выводятся на схеме.
  struct WctDef { std::string id, name, group, kind, characteristics; };
  const std::vector<WctDef> wcts = {
    {"wct-feedstock",    "Сырьевой двор",           "Сырьё",       "feedstock",
      R"([{"label":"Ёмкость хранения","value":"12 000 т"},{"label":"Подача","value":"120 т/ч"}])"},
    {"wct-cleaning",     "Обогащение и подготовка", "Переработка", "cleaningarea",
      R"([{"label":"Производительность","value":"95 т/ч"},{"label":"КПД","value":"92%"}])"},
    {"wct-dryer",        "Аглофабрика / Сушка",     "Термическое", "dryer",
      R"([{"label":"Выпуск","value":"80 т/ч"},{"label":"Температура","value":"1300 °C"}])"},
    {"wct-boiler",       "Энергетика и дутьё",      "Энергетика",  "boiler",
      R"([{"label":"Мощность","value":"18 МВт"},{"label":"КПД","value":"41%"}])"},
    {"wct-finecleaning", "Плавильные агрегаты",     "Плавка",      "finecleaning",
      R"([{"label":"Выпуск","value":"65 т/ч"},{"label":"Температура","value":"1500 °C"}])"},
    {"wct-briquettes",   "Сталеплавильное",         "Плавка",      "briquettes",
      R"([{"label":"Производительность","value":"55 т/ч"},{"label":"Цикл плавки","value":"40 мин"}])"},
    {"wct-pileizer",     "Прокатное производство",  "Прокат",      "pileizer",
      R"([{"label":"Производительность","value":"48 т/ч"},{"label":"Загрузка","value":"79%"}])"},
    {"wct-transformer",  "Электроснабжение",        "Энергетика",  "transformer",
      R"([{"label":"Нагрузка","value":"16 МВт"},{"label":"Резерв","value":"4 МВт"}])"},
    {"wct-wirehouse",    "Складское хозяйство",     "Хранение",    "wirehouse",
      R"([{"label":"Заполнение","value":"61%"},{"label":"Остаток","value":"5 200 т"}])"},
    {"wct-sale",         "Отгрузка",                "Логистика",   "sale",
      R"([{"label":"Отгрузка","value":"1 150 т/сут"},{"label":"Заказов","value":"9"}])"},
    {"wct-marketing",    "Вспомогательные службы",  "Сервис",      "marketing",
      R"([{"label":"Загрузка","value":"55%"}])"},
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
    db.exec("INSERT OR IGNORE INTO work_center_types(id,name,group_name,kind,characteristics) "
            "VALUES(?,?,?,?,?)",
            {w.id, w.name, w.group, w.kind, w.characteristics});

  // Машины (= узлы схемы): сначала без parent, затем проставляем parent_machine_id.
  for (auto& m : seed_machines())
    db.exec("INSERT OR IGNORE INTO machines(id,name,wc_type_id,org_unit,status,"
            "subtitle,pos_x,pos_z,rotation_y) VALUES(?,?,?,?,?,?,?,?,?)",
            {m.machId, m.name, m.wctId, m.orgUnit, "active", m.subtitle,
             std::to_string(m.posX), std::to_string(m.posZ), std::to_string(m.rotY)});
  for (auto& m : seed_machines())
    if (!m.parentId.empty())
      db.exec("UPDATE machines SET parent_machine_id=? WHERE id=?", {m.parentId, m.machId});

  // Связи схемы (flows).
  for (auto& f : seed_flows())
    db.exec("INSERT OR IGNORE INTO flows(id,from_id,to_id,parent_id) VALUES(?,?,?,?)",
            {"flow-" + f.from + "-" + f.to, f.from, f.to, f.parent});

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

/* ── Миграция: связи реестров + экономика + RBAC + сценарии ──────────────── */

static std::vector<std::string> split_trim(const std::string& s, char sep) {
  std::vector<std::string> out; std::string cur; std::istringstream ss(s);
  while (std::getline(ss, cur, sep)) {
    size_t a = cur.find_first_not_of(" \t\r\n");
    size_t b = cur.find_last_not_of(" \t\r\n");
    if (a != std::string::npos) out.push_back(cur.substr(a, b - a + 1));
  }
  return out;
}

// Доводит существующую БД до целевой схемы и связывает реестры. Идемпотентно,
// выполняется один раз (PRAGMA user_version). Существующие данные сохраняются.
static void migrate(Database& db) {
  if (db.user_version() >= 1) return;
  std::cout << "Migrating schema → v1 (linking registries)…\n";

  // 1) Новые колонки на существующих таблицах (guarded — повторно безопасно).
  db.exec_safe("ALTER TABLE products ADD COLUMN sellable INTEGER NOT NULL DEFAULT 0");
  db.exec_safe("ALTER TABLE products ADD COLUMN base_cost REAL NOT NULL DEFAULT 0");
  db.exec_safe("ALTER TABLE products ADD COLUMN base_price REAL NOT NULL DEFAULT 0");
  db.exec_safe("ALTER TABLE products ADD COLUMN demand_max REAL NOT NULL DEFAULT 0");
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN hour_rate REAL NOT NULL DEFAULT 0");
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN efficiency REAL NOT NULL DEFAULT 0.85");
  db.exec_safe("ALTER TABLE machines ADD COLUMN org_unit_id TEXT");
  db.exec_safe("ALTER TABLE operations ADD COLUMN template_id TEXT");
  db.exec_safe("ALTER TABLE operations ADD COLUMN setup_cost REAL");
  db.exec_safe("ALTER TABLE operations ADD COLUMN labor_rate REAL");
  db.exec_safe("ALTER TABLE workers ADD COLUMN org_unit_id TEXT");
  db.exec_safe("ALTER TABLE workers ADD COLUMN cost_per_hour REAL NOT NULL DEFAULT 0");

  db.exec("BEGIN");
  try {

  // 2) Backfill связей операция↔тип оборудования (имя → ID).
  std::unordered_map<std::string, std::string> wctByName, prodByName;
  for (auto& t : db.query_json("SELECT id,name FROM work_center_types"))
    wctByName[jstr(t, "name")] = jstr(t, "id");
  for (auto& p : db.query_json("SELECT id,name FROM products"))
    prodByName[jstr(p, "name")] = jstr(p, "id");

  for (auto& o : db.query_json("SELECT id,wc_types,inputs FROM operations")) {
    std::string opId = jstr(o, "id");
    for (auto& nm : split_trim(jstr(o, "wc_types"), ',')) {
      auto it = wctByName.find(nm);
      if (it != wctByName.end())
        db.exec("INSERT OR IGNORE INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,?)",
                { opId, it->second });
    }
    for (auto& nm : split_trim(jstr(o, "inputs"), ',')) {
      auto it = prodByName.find(nm);
      if (it != prodByName.end())
        db.exec("INSERT OR IGNORE INTO operation_inputs(operation_id,product_id,qty) VALUES(?,?,?)",
                { opId, it->second, "1" });
    }
  }

  // 3) Экономика типов оборудования (ставка машино-часа).
  const std::vector<std::pair<std::string, double>> rates = {
    {"wct-feedstock",100},{"wct-cleaning",300},{"wct-dryer",400},{"wct-boiler",250},
    {"wct-finecleaning",800},{"wct-briquettes",700},{"wct-pileizer",500},
    {"wct-transformer",80},{"wct-wirehouse",60},{"wct-sale",120},{"wct-marketing",150},
  };
  for (auto& [id, r] : rates)
    db.exec("UPDATE work_center_types SET hour_rate=? WHERE id=? AND hour_rate=0",
            { std::to_string(r), id });

  // 4) Экономика изделий: закупка сырья, товарные позиции, спрос, ориентир цены.
  const std::vector<std::pair<std::string, double>> buyCost = {
    {"prod-ore",4000},{"prod-coke",12000},{"prod-flux",1500},{"prod-scrap",9000},
  };
  for (auto& [id, c] : buyCost)
    db.exec("UPDATE products SET base_cost=? WHERE id=? AND base_cost=0",
            { std::to_string(c), id });
  // prod-hrc (Рулон горячекатаный), prod-crc (Лист холоднокатаный) — товарные.
  db.exec_safe("UPDATE products SET sellable=1, base_price=90000, demand_max=4000 "
               "WHERE id='prod-hrc'");
  db.exec_safe("UPDATE products SET sellable=1, base_price=120000, demand_max=2500 "
               "WHERE id='prod-crc'");

  // 5) Оргструктура из имён цехов (machines.org_unit → org_units).
  for (auto& r : db.query_json(
         "SELECT DISTINCT org_unit FROM machines WHERE org_unit IS NOT NULL AND org_unit<>''")) {
    std::string nm = jstr(r, "org_unit");
    std::string id = "ou-" + std::to_string(fnv1a(nm) % 1000000ULL);
    db.exec("INSERT OR IGNORE INTO org_units(id,name) VALUES(?,?)", { id, nm });
    db.exec("UPDATE machines SET org_unit_id=? WHERE org_unit=? AND (org_unit_id IS NULL OR org_unit_id='')",
            { id, nm });
  }

  // 6) Сценарии внешних условий (цены) — базовый рынок и ценовой кризис.
  auto seedScenario = [&](const std::string& id, const std::string& name,
                          const std::string& desc, double hrcMean, double hrcStd,
                          double crcMean, double crcStd) {
    db.exec("INSERT OR IGNORE INTO price_scenarios(id,name,description,horizon_hours) VALUES(?,?,?,?)",
            { id, name, desc, "720" });
    auto dist = [&](const std::string& pid, double mean, double sd) {
      db.exec("INSERT OR IGNORE INTO price_distributions"
              "(id,scenario_id,product_id,dist_type,mean,stddev,min_val,max_val) "
              "VALUES(?,?,?,?,?,?,?,?)",
              { id + "-" + pid, id, pid, "normal", std::to_string(mean), std::to_string(sd),
                std::to_string(mean - 3*sd), std::to_string(mean + 3*sd) });
    };
    dist("prod-hrc", hrcMean, hrcStd);
    dist("prod-crc", crcMean, crcStd);
  };
  seedScenario("scen-base",   "Базовый рынок",
               "Умеренная волатильность цен на прокат.", 90000, 9000, 120000, 24000);
  seedScenario("scen-crisis", "Ценовой кризис",
               "Падение средних цен и рост разброса (downturn).", 72000, 18000, 95000, 38000);

  // 7) RBAC: роли + пользователь admin (вместо хардкод-пароля).
  db.exec("INSERT OR IGNORE INTO roles(id,name,permissions) VALUES('role-admin','Администратор',?)",
          { R"(["READ","EDIT_NSI","WRITE_PLAN","RUN_OPTIMIZE","MANAGE_USERS"])" });
  db.exec("INSERT OR IGNORE INTO roles(id,name,permissions) VALUES('role-planner','Планировщик',?)",
          { R"(["READ","WRITE_PLAN","RUN_OPTIMIZE"])" });
  db.exec("INSERT OR IGNORE INTO roles(id,name,permissions) VALUES('role-viewer','Наблюдатель',?)",
          { R"(["READ"])" });
  db.exec("INSERT OR IGNORE INTO users(id,login,password_hash,role_id,status) VALUES(?,?,?,?,?)",
          { "user-admin", "admin", hash_password("maos2025"), "role-admin", "active" });

  // 8) 3D-схема как сохранённый агрегат.
  db.exec("INSERT OR IGNORE INTO scheme_meta(id,name) VALUES('default','Схема предприятия')");

  } catch (...) {
    try { db.exec("ROLLBACK"); } catch (...) {}
    throw;  // не помечаем версию — миграция повторится при следующем старте
  }

  db.exec("COMMIT");
  db.set_user_version(1);
  std::cout << "Migration v1 done.\n";
}

// v2: десятки товарных изделий + взаимосвязь цен (корреляция). Линейка готовой
// продукции, разделяющая верхний передел (узкое место) → реальная задача
// портфеля рисков. Идемпотентно (INSERT OR IGNORE), данные сохраняются.
static void migrate_v2(Database& db) {
  if (db.user_version() >= 2) return;
  std::cout << "Migrating schema → v2 (product line + price correlation)…\n";
  db.exec_safe("ALTER TABLE price_scenarios   ADD COLUMN market_corr REAL NOT NULL DEFAULT 0.5");
  db.exec_safe("ALTER TABLE price_distributions ADD COLUMN beta REAL NOT NULL DEFAULT 0.7");

  struct Sku { std::string id, code, name, parent; double qty, price, demand, beta;
               std::string wct; int finMin; std::string op; };
  const std::vector<Sku> skus = {
    // готовая продукция из горячекатаного (prod-hrc) — товарная, commodity-like
    {"fin-s235","RL-S235","Рулон S235JR",        "prod-hrc",1.02, 88000,1500,0.85,"wct-pileizer",25,"Правка и порезка S235"},
    {"fin-s355","RL-S355","Рулон S355",          "prod-hrc",1.02, 96000,1100,0.88,"wct-pileizer",28,"Правка и порезка S355"},
    {"fin-pkl", "RL-PKL", "Рулон травленый",      "prod-hrc",1.03,104000, 700,0.70,"wct-cleaning", 35,"Травление"},
    {"fin-prof","PR-GNT", "Профиль гнутый",       "prod-hrc",1.05,112000, 600,0.82,"wct-pileizer",40,"Профилирование"},
    {"fin-pipe","TR-SV57","Труба сварная Ø57",    "prod-hrc",1.06,118000, 550,0.92,"wct-pileizer",50,"Формовка и сварка"},
    {"fin-reb", "AR-A500","Арматура A500C",       "prod-hrc",1.04, 76000,2200,0.90,"wct-pileizer",20,"Прокатка арматуры"},
    // готовая продукция из холоднокатаного (prod-crc) — премиальная, менее коррелир.
    {"fin-galv","LS-OC",  "Лист оцинкованный",    "prod-crc",1.02,142000, 900,0.62,"wct-cleaning", 30,"Цинкование"},
    {"fin-pnt", "LS-OK",  "Лист окрашенный",      "prod-crc",1.03,168000, 500,0.50,"wct-cleaning", 45,"Окраска"},
    {"fin-tin", "LS-JE",  "Жесть электролит.",    "prod-crc",1.04,182000, 380,0.45,"wct-cleaning", 55,"Лужение"},
    {"fin-cold","LS-XK",  "Лист х/к калибр.",     "prod-crc",1.01,124000,1000,0.90,"wct-cleaning", 22,"Калибровка"},
  };

  db.exec("BEGIN");
  try {
    for (auto& s : skus) {
      // Товарное изделие — верхний уровень (parent_id пуст). Связь с верхним
      // переделом — через ВХОД операции (operation_inputs), а не BOM-дерево:
      // один полуфабрикат (hrc/crc) питает много изделий — это DAG.
      db.exec("INSERT OR IGNORE INTO products(id,code,name,unit,"
              "purchased,sellable,base_price,demand_max) VALUES(?,?,?,?,0,1,?,?)",
              { s.id, s.code, s.name, "т",
                std::to_string(s.price), std::to_string(s.demand) });
      std::string rid = "route-" + s.id, oid = "op-" + s.id;
      db.exec("INSERT OR IGNORE INTO routings(id,name,product_id) VALUES(?,?,?)",
              { rid, std::string("Финиш: ") + s.name, s.id });
      db.exec("INSERT OR IGNORE INTO operations(id,routing_id,code,name,op_type,order_no,"
              "t_norm,t_opt,t_pess,risk_coef) VALUES(?,?,?,?,?,10,?,?,?,0.06)",
              { oid, rid, std::string("OPF-") + s.code, s.op, "finishing",
                std::to_string(s.finMin), std::to_string(s.finMin), std::to_string(s.finMin) });
      db.exec("INSERT OR IGNORE INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,?)",
              { oid, s.wct });
      // Вход финишной операции = полуфабрикат верхнего передела (qty на единицу).
      db.exec("INSERT OR IGNORE INTO operation_inputs(operation_id,product_id,qty) VALUES(?,?,?)",
              { oid, s.parent, std::to_string(s.qty) });
    }

    // Взаимосвязь цен по сценариям (общий рыночный фактор).
    db.exec_safe("UPDATE price_scenarios SET market_corr=0.45 WHERE id='scen-base'");
    db.exec_safe("UPDATE price_scenarios SET market_corr=0.80 WHERE id='scen-crisis'");

    auto clamp01 = [](double v){ return std::min(0.97, std::max(0.05, v)); };
    struct Scn { std::string id; double mult, sd, betaBump; };
    const std::vector<Scn> scns = { {"scen-base",1.0,0.13,1.0}, {"scen-crisis",0.82,0.30,1.15} };
    for (auto& sc : scns) {
      for (auto& s : skus) {
        double mean = s.price * sc.mult, sd = mean * sc.sd;
        db.exec("INSERT OR IGNORE INTO price_distributions"
                "(id,scenario_id,product_id,dist_type,mean,stddev,min_val,max_val,beta) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                { sc.id + "-" + s.id, sc.id, s.id, "normal",
                  std::to_string(mean), std::to_string(sd),
                  std::to_string(mean - 3*sd), std::to_string(mean + 3*sd),
                  std::to_string(clamp01(s.beta * sc.betaBump)) });
      }
      // beta на исходные hrc/crc (commodity).
      db.exec_safe("UPDATE price_distributions SET beta=" + std::to_string(clamp01(0.90*sc.betaBump)) +
                   " WHERE scenario_id='" + sc.id + "' AND product_id='prod-hrc'");
      db.exec_safe("UPDATE price_distributions SET beta=" + std::to_string(clamp01(0.85*sc.betaBump)) +
                   " WHERE scenario_id='" + sc.id + "' AND product_id='prod-crc'");
    }
  } catch (...) {
    try { db.exec("ROLLBACK"); } catch (...) {}
    throw;
  }
  db.exec("COMMIT");
  db.set_user_version(2);
  std::cout << "Migration v2 done (" << skus.size() << " finished SKUs).\n";
}

// v3: Стадия 1 (расписание) — тяжёлый хвост у операций, поля Ганта в plan_tasks,
// рабочие-операторы (для планов по рабочим). Идемпотентно, данные сохраняются.
static void migrate_v3(Database& db) {
  if (db.user_version() >= 3) return;
  std::cout << "Migrating schema → v3 (scheduling: heavy tail + workers)…\n";
  // Колонки добавляем NULLABLE с DEFAULT: ALTER ADD COLUMN NOT NULL не переписывает
  // существующие строки физически (integrity_check ругается на «NULL»), хотя SELECT
  // отдаёт дефолт. Ниже материализуем значения явным UPDATE.
  db.exec_safe("ALTER TABLE operations  ADD COLUMN setup_time  REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE operations  ADD COLUMN tail_weight REAL DEFAULT 0.08");
  db.exec_safe("ALTER TABLE operations  ADD COLUMN tail_index  REAL DEFAULT 2.5");
  db.exec_safe("ALTER TABLE plan_tasks  ADD COLUMN machine_id  TEXT");
  db.exec_safe("ALTER TABLE plan_tasks  ADD COLUMN worker_id   TEXT");
  db.exec_safe("ALTER TABLE plan_tasks  ADD COLUMN start_min   REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE plan_tasks  ADD COLUMN end_min     REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE plan_tasks  ADD COLUMN order_idx   INTEGER DEFAULT 0");
  // Материализация (физически записать дефолты, чтобы integrity_check был чист).
  db.exec_safe("UPDATE operations SET tail_weight=COALESCE(tail_weight,0.08), "
               "tail_index=COALESCE(tail_index,2.5), setup_time=COALESCE(setup_time,0)");
  db.exec_safe("UPDATE plan_tasks SET start_min=COALESCE(start_min,0), "
               "end_min=COALESCE(end_min,0), order_idx=COALESCE(order_idx,0)");

  db.exec("BEGIN");
  try {
    // Рабочие-операторы (dual-resource, планы по рабочим). Наладочные операции
    // тяжелее по хвосту — у некоторых типов поднимем вероятность хвоста.
    struct W { std::string id, tab, last, first, unit, pos; int grade; };
    const std::vector<W> workers = {
      {"wk-01","T-101","Иванов","Сергей",  "Доменный цех","Горновой",6},
      {"wk-02","T-102","Петров","Андрей",  "ККЦ",         "Сталевар",6},
      {"wk-03","T-103","Сидоров","Дмитрий","ЭСПЦ",        "Сталевар",5},
      {"wk-04","T-104","Кузнецов","Игорь", "ПЦ",          "Вальцовщик",5},
      {"wk-05","T-105","Смирнов","Алексей","ПЦ",          "Вальцовщик",4},
      {"wk-06","T-106","Попов","Николай",  "ДОЦ",         "Оператор",4},
      {"wk-07","T-107","Лебедев","Павел",  "ОТК",         "Контролёр",5},
      {"wk-08","T-108","Козлов","Виктор",  "Энергоцех",   "Энергетик",6},
    };
    for (auto& w : workers)
      db.exec("INSERT OR IGNORE INTO workers(id,tab_no,last_name,first_name,org_unit,position,grade) "
              "VALUES(?,?,?,?,?,?,?)",
              { w.id, w.tab, w.last, w.first, w.unit, w.pos, std::to_string(w.grade) });
    // Чуть тяжелее хвост у плавильных/наладочных операций (риск длинных задержек).
    db.exec_safe("UPDATE operations SET tail_weight=0.14, tail_index=2.0 WHERE op_type='heat'");
    db.exec_safe("UPDATE operations SET setup_time=15 WHERE setup_required=1");
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(3);
  std::cout << "Migration v3 done.\n";
}

// v4: производственная программа (заказы) — вход Стадии 1. Демо-заказы.
static void migrate_v4(Database& db) {
  if (db.user_version() >= 4) return;
  std::cout << "Migrating schema → v4 (demand orders)…\n";
  db.exec("BEGIN");
  try {
    struct Ord { std::string id, product; double qty, due; int prio; };
    const std::vector<Ord> orders = {
      {"do-1","fin-reb", 180, 120, 3}, {"do-2","fin-galv",120, 90, 4},
      {"do-3","fin-cold",150, 150, 5}, {"do-4","fin-s235",160, 110, 4},
      {"do-5","fin-pnt",  90, 80, 2},  {"do-6","prod-hrc",100, 100, 5},
    };
    for (auto& o : orders)
      if (!db.query_json("SELECT id FROM products WHERE id=?", { o.product }).empty())
        db.exec("INSERT OR IGNORE INTO demand_orders(id,product_id,quantity,due_hours,priority) "
                "VALUES(?,?,?,?,?)",
                { o.id, o.product, std::to_string(o.qty), std::to_string(o.due), std::to_string(o.prio) });
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(4);
  std::cout << "Migration v4 done.\n";
}

// v5: расписания/смены — рабочий календарь по умолчанию (двусменный 5/2, 06–22).
static void migrate_v5(Database& db) {
  if (db.user_version() >= 5) return;
  std::cout << "Migrating schema → v5 (schedules & calendars)…\n";
  db.exec("BEGIN");
  try {
    db.exec("INSERT OR IGNORE INTO schedules(id,name,pattern,is_default) "
            "VALUES('sch-default','Двусменный 5/2','Пн–Пт 06:00–22:00',1)");
    for (int dow = 1; dow <= 5; ++dow)      // Пн–Пт, 06:00–22:00 (360–1320 мин)
      db.exec("INSERT OR IGNORE INTO shifts(id,schedule_id,day_of_week,start_min,end_min) "
              "VALUES(?,?,?,?,?)",
              { "sh-" + std::to_string(dow), "sch-default", std::to_string(dow), "360", "1320" });
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(5);
  std::cout << "Migration v5 done.\n";
}

// v6: запасы/MRP — поля запаса у изделий + начальные остатки сырья.
static void migrate_v6(Database& db) {
  if (db.user_version() >= 6) return;
  std::cout << "Migrating schema → v6 (inventory / MRP)…\n";
  db.exec_safe("ALTER TABLE products ADD COLUMN safety_stock    REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE products ADD COLUMN reorder_point   REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE products ADD COLUMN lead_time_hours REAL DEFAULT 0");
  db.exec_safe("UPDATE products SET safety_stock=COALESCE(safety_stock,0), "
               "reorder_point=COALESCE(reorder_point,0), lead_time_hours=COALESCE(lead_time_hours,0)");
  db.exec("BEGIN");
  try {
    // Начальные остатки + параметры закупки покупного сырья.
    struct S { std::string id; double stock, safety, reorder, lead; };
    const std::vector<S> raws = {
      {"prod-ore",  5000, 1000, 2000, 48}, {"prod-coke", 1800,  500, 1000, 72},
      {"prod-flux", 2000,  300,  600, 24}, {"prod-scrap",1500,  800, 1500, 36},
    };
    for (auto& r : raws)
      db.exec("UPDATE products SET stock=?, safety_stock=?, reorder_point=?, lead_time_hours=? WHERE id=?",
              { std::to_string(r.stock), std::to_string(r.safety), std::to_string(r.reorder),
                std::to_string(r.lead), r.id });
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(6);
  std::cout << "Migration v6 done.\n";
}

// v7: производственные планы (именованные программы) + привязка заказов к плану.
static void migrate_v7(Database& db) {
  if (db.user_version() >= 7) return;
  std::cout << "Migrating schema → v7 (production plans)…\n";
  db.exec_safe("ALTER TABLE demand_orders ADD COLUMN plan_id TEXT");
  db.exec("BEGIN");
  try {
    db.exec("INSERT OR IGNORE INTO production_plans(id,name,description) "
            "VALUES('plan-default','Текущий план','Демо-программа заказов')");
    db.exec("UPDATE demand_orders SET plan_id='plan-default' WHERE plan_id IS NULL OR plan_id=''");
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(7);
  std::cout << "Migration v7 done.\n";
}

// v8: глобальные ЦЕХА. Раньше верхний уровень схемы = 27 отдельных станков
// (выглядели как частокол одинаковых зданий). Теперь верхний уровень = 6 цехов,
// а все станки переезжают ВНУТРЬ соответствующего цеха (parent_machine_id).
// Внутрицеховые потоки сохраняются (привязываются к цеху), межцеховые — заменяются
// технологической цепочкой между цехами. Данные не теряются.
static void migrate_v8(Database& db) {
  if (db.user_version() >= 8) return;
  std::cout << "Migrating schema → v8 (глобальные цеха: станки внутрь)…\n";
  db.exec("BEGIN");
  try {
    // 1. Шесть цехов верхнего уровня (тип задаёт силуэт здания).
    db.exec(
      "INSERT OR IGNORE INTO machines(id,name,wc_type_id,status,pos_x,pos_z) VALUES"
      "('shop-raw','Сырьевой цех','wct-feedstock','active',-30,-13),"
      "('shop-iron','Аглодоменный цех','wct-dryer','active',0,-13),"
      "('shop-steel','Сталеплавильный цех','wct-briquettes','active',30,-13),"
      "('shop-roll','Прокатный цех','wct-pileizer','active',30,13),"
      "('shop-energy','Энергоцех','wct-boiler','active',0,13),"
      "('shop-logistics','Склад и сбыт','wct-wirehouse','active',-30,13)");

    // 2. Станки — внутрь цехов.
    db.exec("UPDATE machines SET parent_machine_id='shop-raw' WHERE id IN "
            "('mach-oreyard','mach-cokeyard','mach-scrapyard','mach-crushing','mach-screening')");
    db.exec("UPDATE machines SET parent_machine_id='shop-iron' WHERE id IN "
            "('mach-sinter','mach-blastfurnace','mach-hotblast','mach-gasclean','mach-ladle')");
    db.exec("UPDATE machines SET parent_machine_id='shop-steel' WHERE id IN "
            "('mach-converter','mach-eaf','mach-ccm')");
    db.exec("UPDATE machines SET parent_machine_id='shop-roll' WHERE id IN "
            "('mach-rolling','mach-coldrolling','mach-heattreat','mach-slabyard')");
    db.exec("UPDATE machines SET parent_machine_id='shop-energy' WHERE id IN "
            "('mach-chp','mach-substation','mach-substation2')");
    db.exec("UPDATE machines SET parent_machine_id='shop-logistics' WHERE id IN "
            "('mach-warehouse','mach-shipping','mach-shipping2','mach-sales','mach-maintenance','mach-lab','1c18904f3e71819bd3a2d1b86827a21')");

    // 3. Внутрицеховые потоки → принадлежат цеху (видны при заходе внутрь).
    auto intra = [&](const char* shop, const std::string& ids) {
      db.exec("UPDATE flows SET parent_id='" + std::string(shop) +
              "' WHERE (parent_id IS NULL OR parent_id='') AND from_id IN (" + ids +
              ") AND to_id IN (" + ids + ")");
    };
    intra("shop-raw", "'mach-oreyard','mach-cokeyard','mach-scrapyard','mach-crushing','mach-screening'");
    intra("shop-iron", "'mach-sinter','mach-blastfurnace','mach-hotblast','mach-gasclean','mach-ladle'");
    intra("shop-steel", "'mach-converter','mach-eaf','mach-ccm'");
    intra("shop-roll", "'mach-rolling','mach-coldrolling','mach-heattreat','mach-slabyard'");
    intra("shop-energy", "'mach-chp','mach-substation','mach-substation2'");
    intra("shop-logistics", "'mach-warehouse','mach-shipping','mach-shipping2','mach-sales','mach-maintenance','mach-lab','1c18904f3e71819bd3a2d1b86827a21'");

    // Остаток верхнего уровня — межцеховые потоки между станками: убираем.
    db.exec("DELETE FROM flows WHERE parent_id IS NULL OR parent_id=''");

    // 4. Технологическая цепочка между цехами (верхний уровень).
    db.exec(
      "INSERT OR IGNORE INTO flows(id,from_id,to_id,parent_id) VALUES"
      "('flow-ws-1','shop-raw','shop-iron',''),"
      "('flow-ws-2','shop-iron','shop-steel',''),"
      "('flow-ws-3','shop-steel','shop-roll',''),"
      "('flow-ws-4','shop-roll','shop-logistics',''),"
      "('flow-ws-5','shop-energy','shop-iron',''),"
      "('flow-ws-6','shop-energy','shop-steel','')");
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(8);
  std::cout << "Migration v8 done.\n";
}

// v9 (Стадия F0): историческая БД цен `ts_data` — предпосылка прогноза ОТ истории
// и подбора распределений. Сид: ~30 помесячных точек на изделие/сырьё как
// лог-нормальное блуждание с дрейфом, последняя точка = текущая base_price/base_cost
// (чтобы μ/σ из лог-доходностей восстанавливались для проверки). Реальный ETL — позже.
static void migrate_v9(Database& db) {
  if (db.user_version() >= 9) return;
  std::cout << "Migrating schema → v9 (история цен ts_data)…\n";
  db.exec("CREATE TABLE IF NOT EXISTS ts_data ("
          "  id TEXT PRIMARY KEY,"
          "  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,"
          "  kind TEXT NOT NULL,"               // 'price' | 'cost'
          "  month_idx INTEGER NOT NULL,"       // 0 = старейшая … N-1 = последняя
          "  value REAL NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_ts_data_pid ON ts_data(product_id, kind, month_idx)");

  auto rows = db.query_json(
    "SELECT id,base_price,base_cost,sellable,purchased FROM products "
    "WHERE sellable=1 OR purchased=1");
  const int N = 30;
  std::mt19937 rng(1234567u);
  std::normal_distribution<double> nd(0.0, 1.0);
  db.exec("BEGIN");
  try {
    for (auto& p : rows) {
      const bool sellable = jstr(p, "sellable") == "1";
      const std::string kind = sellable ? "price" : "cost";
      const std::string bs = sellable ? jstr(p, "base_price") : jstr(p, "base_cost");
      if (bs.empty()) continue;
      double base = std::stod(bs);
      if (base <= 0) continue;
      const std::string pid = jstr(p, "id");

      // лог-доходности r[t] ~ N(drift, sigma); идём НАЗАД от base (последняя точка)
      const double drift = 0.006, sigma = sellable ? 0.045 : 0.055;
      std::vector<double> logv(N, 0.0);
      logv[N - 1] = std::log(base);
      for (int t = N - 1; t > 0; --t) {
        double r = drift + sigma * nd(rng);
        logv[t - 1] = logv[t] - r;
      }
      std::ostringstream sql;
      sql << "INSERT OR IGNORE INTO ts_data(id,product_id,kind,month_idx,value) VALUES";
      for (int t = 0; t < N; ++t) {
        if (t) sql << ",";
        sql << "('" << pid << "#" << kind << "#" << t << "','" << pid << "','" << kind
            << "'," << t << "," << std::exp(logv[t]) << ")";
      }
      db.exec(sql.str());
    }
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(9);
  std::cout << "Migration v9 done.\n";
}

// v10 (Стадия F): макро-ряды `macro_ts` (ключевая ставка и пр.) — внешнее условие,
// прогнозируемое ТЕМ ЖЕ движком, что и цены (канон из CB_models_stohastic). Сид:
// ~30 помесячных точек ключевой ставки как лог-нормальное блуждание, последняя = текущая.
static void migrate_v10(Database& db) {
  if (db.user_version() >= 10) return;
  std::cout << "Migrating schema → v10 (макро-ряды macro_ts: ключевая ставка)…\n";
  db.exec("CREATE TABLE IF NOT EXISTS macro_ts ("
          "  id TEXT PRIMARY KEY,"
          "  series TEXT NOT NULL,"            // 'keyrate' | 'inflation' | …
          "  month_idx INTEGER NOT NULL,"
          "  value REAL NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_macro_ts ON macro_ts(series, month_idx)");

  const int N = 30;
  const double last = 21.0;                    // текущая ключевая ставка, %
  const double drift = 0.004, sigma = 0.05;
  std::mt19937 rng(987654u);
  std::normal_distribution<double> nd(0.0, 1.0);
  std::vector<double> logv(N, 0.0);
  logv[N - 1] = std::log(last);
  for (int t = N - 1; t > 0; --t) logv[t - 1] = logv[t] - (drift + sigma * nd(rng));
  std::ostringstream sql;
  sql << "INSERT OR IGNORE INTO macro_ts(id,series,month_idx,value) VALUES";
  for (int t = 0; t < N; ++t) {
    if (t) sql << ",";
    sql << "('keyrate#" << t << "','keyrate'," << t << "," << std::exp(logv[t]) << ")";
  }
  db.exec("BEGIN");
  try { db.exec(sql.str()); }
  catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(10);
  std::cout << "Migration v10 done.\n";
}

// v11 (Стадия E): сценарий несёт и ЦЕЛЬ ОПТИМИЗАЦИИ (objective/alpha/max_share), а не
// только цены — чтобы сценарии реально различались в робастном решении и сравнивались.
static void migrate_v11(Database& db) {
  if (db.user_version() >= 11) return;
  std::cout << "Migrating schema → v11 (сценарий: цель оптимизации)…\n";
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN objective TEXT");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN alpha REAL");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN max_share REAL");
  db.set_user_version(11);
  std::cout << "Migration v11 done.\n";
}

// v12 (Стадия E): сценарий несёт параметры ПРОГНОЗА цен (макрофакторы) и РЕЖИМ
// (стохастический ↔ детерминированный) — один сценарий гоняет и цены, и оптимизацию.
static void migrate_v12(Database& db) {
  if (db.user_version() >= 12) return;
  std::cout << "Migrating schema → v12 (сценарий: прогноз + режим)…\n";
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN mode TEXT");        // stochastic | deterministic
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN inflation REAL");   // мес. инфляция (доля)
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN fx REAL");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN demand REAL");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN volatility REAL");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN months INTEGER");
  db.exec("UPDATE price_scenarios SET mode=COALESCE(mode,'stochastic')");
  db.set_user_version(12);
  std::cout << "Migration v12 done.\n";
}

// v13 (Стадия E, финал): сценарий → ПЛАН (Стадия 1), даты периода и ТОЧЕЧНЫЕ
// оверрайды цены/себестоимости отдельных изделий (без копии всего сценария).
static void migrate_v13(Database& db) {
  if (db.user_version() >= 13) return;
  std::cout << "Migrating schema → v13 (сценарий: оверрайды + план + даты)…\n";
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN plan_id TEXT");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN start_date TEXT");
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN end_date TEXT");
  db.exec("CREATE TABLE IF NOT EXISTS scenario_overrides ("
          "  id TEXT PRIMARY KEY,"
          "  scenario_id TEXT NOT NULL REFERENCES price_scenarios(id) ON DELETE CASCADE,"
          "  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,"
          "  base_price REAL, base_cost REAL)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_scen_ovr ON scenario_overrides(scenario_id)");
  db.set_user_version(13);
  std::cout << "Migration v13 done.\n";
}

// v14: бэкфилл входов техкарт. Редактор сохранял входы в JSON operations.inputs, а
// движок читает operation_inputs — связи терялись. Разбираем JSON в таблицу для всех
// операций, у которых inputs — JSON-массив (операции НСИ с пустым inputs не трогаем).
static void migrate_v14(Database& db) {
  if (db.user_version() >= 14) return;
  std::cout << "Migrating schema → v14 (бэкфилл входов техкарт → operation_inputs)…\n";
  db.exec("BEGIN");
  try {
    for (auto& o : db.query_json("SELECT id,inputs FROM operations WHERE inputs LIKE '[%'")) {
      const std::string opId = jstr(o, "id");
      db.exec("DELETE FROM operation_inputs WHERE operation_id=?", { opId });
      insert_op_inputs_json(db, opId, jstr(o, "inputs"));
    }
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  db.exec("COMMIT");
  db.set_user_version(14);
  std::cout << "Migration v14 done.\n";
}

/* ── 3D-схема как единый сохранённый агрегат ─────────────────────────────── */

static void register_scheme(httplib::Server& svr, Database& db) {
  svr.Get("/api/scheme", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      json meta;
      try { meta = db.query_one("SELECT * FROM scheme_meta WHERE id='default'"); }
      catch (...) { meta = { {"id","default"}, {"name","Схема предприятия"}, {"ground_size","80"} }; }
      json out = {
        {"meta",  meta},
        {"nodes", db.query_json("SELECT * FROM machines")},
        {"edges", db.query_json("SELECT * FROM flows")},
        {"types", db.query_json("SELECT * FROM work_center_types")},
      };
      ok(res, out);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });
}

/* ── Сценарии внешних условий (стохастика цен) ───────────────────────────── */

static void register_scenarios(httplib::Server& svr, Database& db) {
  svr.Get("/api/scenarios", [&db](const httplib::Request&, httplib::Response& res) {
    try { ok(res, db.query_json("SELECT * FROM price_scenarios ORDER BY created_at")); }
    catch (std::exception& e) { err(res, 500, e.what()); }
  });

  svr.Get("/api/scenarios/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { req.matches[1] });
      sc["distributions"] = db.query_json(
        "SELECT * FROM price_distributions WHERE scenario_id=?", { std::string(req.matches[1]) });
      sc["overrides"] = db.query_json(
        "SELECT * FROM scenario_overrides WHERE scenario_id=?", { std::string(req.matches[1]) });
      ok(res, sc);
    } catch (...) { err(res, 404, "not found"); }
  });

  // Точечные оверрайды цены/себестоимости изделий в сценарии (без копии всего сценария).
  auto writeOverrides = [&db](const std::string& sid, const json& body) {
    if (!body.contains("overrides") || !body["overrides"].is_array()) return;
    db.exec("DELETE FROM scenario_overrides WHERE scenario_id=?", { sid });
    for (auto& o : body["overrides"]) {
      const std::string pid = jstr(o, "product_id");
      if (pid.empty()) continue;
      db.exec("INSERT INTO scenario_overrides(id,scenario_id,product_id,base_price,base_cost) "
              "VALUES(?,?,?,NULLIF(?,''),NULLIF(?,''))",
              { gen_uuid(), sid, pid, jstr(o, "base_price"), jstr(o, "base_cost") });
    }
  };

  auto writeDists = [&db](const std::string& sid, const json& body) {
    if (!body.contains("distributions") || !body["distributions"].is_array()) return;
    db.exec("DELETE FROM price_distributions WHERE scenario_id=?", { sid });
    for (auto& d : body["distributions"]) {
      db.exec("INSERT INTO price_distributions"
              "(id,scenario_id,product_id,dist_type,mean,stddev,min_val,max_val,mode_val,beta) "
              "VALUES(?,?,?,?,?,?,?,?,?,?)",
              { gen_uuid(), sid, jstr(d,"product_id"),
                jstr(d,"dist_type").empty() ? "normal" : jstr(d,"dist_type"),
                jstr(d,"mean"), jstr(d,"stddev"), jstr(d,"min_val"),
                jstr(d,"max_val"), jstr(d,"mode_val"),
                jstr(d,"beta").empty() ? "0.7" : jstr(d,"beta") });
    }
  };

  svr.Post("/api/scenarios", [&db, writeDists, writeOverrides](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      std::string id = gen_uuid();
      db.exec("INSERT INTO price_scenarios(id,name,description,horizon_hours,market_corr,objective,alpha,max_share,"
              "mode,inflation,fx,demand,volatility,months,plan_id,start_date,end_date) "
              "VALUES(?,?,?,?,?,?,?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),"
              "NULLIF(?,''),NULLIF(?,''),NULLIF(?,''))",
              { id, jstr(body,"name"), jstr(body,"description"),
                jstr(body,"horizon_hours").empty() ? "720" : jstr(body,"horizon_hours"),
                jstr(body,"market_corr").empty() ? "0.5" : jstr(body,"market_corr"),
                jstr(body,"objective").empty() ? "cvar" : jstr(body,"objective"),
                jstr(body,"alpha").empty() ? "0.1" : jstr(body,"alpha"),
                jstr(body,"max_share").empty() ? "0.6" : jstr(body,"max_share"),
                jstr(body,"mode").empty() ? "stochastic" : jstr(body,"mode"),
                jstr(body,"inflation"), jstr(body,"fx"), jstr(body,"demand"),
                jstr(body,"volatility"), jstr(body,"months"),
                jstr(body,"plan_id"), jstr(body,"start_date"), jstr(body,"end_date") });
      writeDists(id, body);
      writeOverrides(id, body);
      audit(db, "scenario", id, "CREATE", body);
      auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { id });
      sc["distributions"] = db.query_json("SELECT * FROM price_distributions WHERE scenario_id=?", { id });
      sc["overrides"] = db.query_json("SELECT * FROM scenario_overrides WHERE scenario_id=?", { id });
      res.status = 201; ok(res, sc);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  svr.Put("/api/scenarios/([^/]+)", [&db, writeDists, writeOverrides](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string id = req.matches[1];
      auto body = json::parse(req.body);
      db.exec("UPDATE price_scenarios SET name=?, description=?, horizon_hours=?, market_corr=?, "
              "objective=?, alpha=?, max_share=?, "
              "mode=COALESCE(NULLIF(?,''),mode), inflation=COALESCE(NULLIF(?,''),inflation), "
              "fx=COALESCE(NULLIF(?,''),fx), demand=COALESCE(NULLIF(?,''),demand), "
              "volatility=COALESCE(NULLIF(?,''),volatility), months=COALESCE(NULLIF(?,''),months), "
              "plan_id=COALESCE(NULLIF(?,''),plan_id), start_date=COALESCE(NULLIF(?,''),start_date), "
              "end_date=COALESCE(NULLIF(?,''),end_date) WHERE id=?",
              { jstr(body,"name"), jstr(body,"description"),
                jstr(body,"horizon_hours").empty() ? "720" : jstr(body,"horizon_hours"),
                jstr(body,"market_corr").empty() ? "0.5" : jstr(body,"market_corr"),
                jstr(body,"objective").empty() ? "cvar" : jstr(body,"objective"),
                jstr(body,"alpha").empty() ? "0.1" : jstr(body,"alpha"),
                jstr(body,"max_share").empty() ? "0.6" : jstr(body,"max_share"),
                jstr(body,"mode"), jstr(body,"inflation"), jstr(body,"fx"),
                jstr(body,"demand"), jstr(body,"volatility"), jstr(body,"months"),
                jstr(body,"plan_id"), jstr(body,"start_date"), jstr(body,"end_date"), id });
      writeDists(id, body);
      writeOverrides(id, body);
      audit(db, "scenario", id, "UPDATE", body);
      auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { id });
      sc["distributions"] = db.query_json("SELECT * FROM price_distributions WHERE scenario_id=?", { id });
      sc["overrides"] = db.query_json("SELECT * FROM scenario_overrides WHERE scenario_id=?", { id });
      ok(res, sc);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // Клонирование сценария: копия параметров + распределений (Стадия E).
  svr.Post("/api/scenarios/([^/]+)/clone", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string src = req.matches[1];
      const std::string nid = gen_uuid();
      db.exec("INSERT INTO price_scenarios"
              "(id,name,description,horizon_hours,market_corr,objective,alpha,max_share,mode,inflation,fx,demand,volatility,months,"
              "plan_id,start_date,end_date) "
              "SELECT ?, name || ' (копия)', description, horizon_hours, market_corr, objective, alpha, max_share,"
              "mode, inflation, fx, demand, volatility, months, plan_id, start_date, end_date "
              "FROM price_scenarios WHERE id=?", { nid, src });
      db.exec("INSERT INTO price_distributions"
              "(id,scenario_id,product_id,dist_type,mean,stddev,min_val,max_val,mode_val,beta) "
              "SELECT lower(hex(randomblob(8))), ?, product_id, dist_type, mean, stddev, min_val, max_val, mode_val, beta "
              "FROM price_distributions WHERE scenario_id=?", { nid, src });
      db.exec("INSERT INTO scenario_overrides(id,scenario_id,product_id,base_price,base_cost) "
              "SELECT lower(hex(randomblob(8))), ?, product_id, base_price, base_cost "
              "FROM scenario_overrides WHERE scenario_id=?", { nid, src });
      audit(db, "scenario", nid, "CLONE", { {"from", src} });
      auto out = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { nid });
      out["distributions"] = db.query_json("SELECT * FROM price_distributions WHERE scenario_id=?", { nid });
      out["overrides"] = db.query_json("SELECT * FROM scenario_overrides WHERE scenario_id=?", { nid });
      res.status = 201; ok(res, out);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  svr.Delete("/api/scenarios/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      db.exec("DELETE FROM price_scenarios WHERE id=?", { std::string(req.matches[1]) });
      audit(db, "scenario", req.matches[1], "DELETE");
      ok(res, json::object());
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Оптимизация (робастная, стохастическая) ─────────────────────────────── */

static void persist_run(Database& db, const std::string& runId, const maos::OptimizeParams& pr,
                        const json& result) {
  db.exec("INSERT INTO optimization_runs"
          "(id,scenario_id,objective,samples,alpha,lambda,seed,status,result_json) "
          "VALUES(?,?,?,?,?,?,?,?,?)",
          { runId, pr.scenarioId, pr.objective, std::to_string(pr.samples),
            std::to_string(pr.alpha), std::to_string(pr.lambda), std::to_string(pr.seed),
            "done", result.dump() });

  auto savePortfolio = [&](const std::string& kind, const json& pf) {
    if (!pf.is_object()) return;
    std::string pfId = gen_uuid();
    const json& mt = pf.value("metrics", json::object());
    db.exec("INSERT INTO portfolios(id,run_id,kind,exp_profit,cvar,worst_case,std_dev,p_loss) "
            "VALUES(?,?,?,?,?,?,?,?)",
            { pfId, runId, kind,
              std::to_string(mt.value("expected", 0.0)), std::to_string(mt.value("cvar", 0.0)),
              std::to_string(mt.value("worst_case", 0.0)), std::to_string(mt.value("std", 0.0)),
              std::to_string(mt.value("p_loss", 0.0)) });
    for (auto& it : pf.value("items", json::array()))
      db.exec("INSERT OR IGNORE INTO portfolio_items(portfolio_id,product_id,qty) VALUES(?,?,?)",
              { pfId, it.value("product_id", std::string()),
                std::to_string(it.value("qty", 0.0)) });
  };
  savePortfolio("robust",   result.value("robust", json::object()));
  savePortfolio("expected", result.value("expected", json::object()));

  // План производства (загрузка ресурсов робастного портфеля).
  std::string planId = gen_uuid();
  db.exec("INSERT INTO plans(id,run_id) VALUES(?,?)", { planId, runId });
  const json& robust = result.value("robust", json::object());
  for (auto& l : robust.value("resource_load", json::array()))
    db.exec("INSERT INTO plan_tasks(id,plan_id,wc_type_id,load_hours) VALUES(?,?,?,?)",
            { gen_uuid(), planId, l.value("wc_type_id", std::string()),
              std::to_string(l.value("load_hours", 0.0)) });
}

/* ── Стадия E+: внешние условия и динамика цен по времени ─────────────────────
 * Прогноз цен изделий/сырья на горизонт в МЕСЯЦАХ под действием макрофакторов:
 *   - inflation (мес. инфляция, дрейф вверх),
 *   - fx (курс, множитель экспортных цен),
 *   - demand (индекс спроса),
 * как коррелированное лог-нормальное блуждание (общий рыночный шок + идиосинкр.).
 * Возвращает веер P10/P50/P90 + среднее по месяцам — для графиков цен во времени. */
static void register_forecast(httplib::Server& svr, Database& db) {
  svr.Post("/api/forecast", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);
      auto getd = [&](const char* k, double d) {
        return body.contains(k) && !jstr(body, k).empty() ? std::stod(jstr(body, k)) : d;
      };
      int months   = std::max(1, std::min(36, (int)getd("months", 6)));
      double infl  = getd("inflation", 0.01);            // в месяц, доля (0.01 = +1%/мес)
      double fx    = getd("fx", 1.0);
      double demand = getd("demand", 1.0);
      double vol   = std::max(0.0, getd("volatility", 0.05));   // мес. волатильность цены
      double corr  = std::max(0.0, std::min(1.0, getd("corr", 0.5)));
      int runs     = std::max(200, std::min(20000, (int)getd("runs", 3000)));
      unsigned seed = (unsigned)getd("seed", 42);

      // Стадия E: сценарий задаёт параметры прогноза и режим (если не заданы в запросе).
      std::string mode = "stochastic";
      const std::string scenarioId = jstr(body, "scenario_id");
      if (!scenarioId.empty()) {
        try {
          auto sc = db.query_one("SELECT * FROM price_scenarios WHERE id=?", { scenarioId });
          auto scd = [&](const char* k, double cur) { std::string s = jstr(sc, k); return s.empty() ? cur : std::stod(s); };
          if (!body.contains("months")     && !jstr(sc,"months").empty())      months = std::max(1, std::min(36, (int)scd("months", months)));
          if (!body.contains("inflation")  && !jstr(sc,"inflation").empty())   infl   = scd("inflation", infl);
          if (!body.contains("fx")         && !jstr(sc,"fx").empty())          fx     = scd("fx", fx);
          if (!body.contains("demand")     && !jstr(sc,"demand").empty())      demand = scd("demand", demand);
          if (!body.contains("volatility") && !jstr(sc,"volatility").empty())  vol    = scd("volatility", vol);
          if (!body.contains("corr")       && !jstr(sc,"market_corr").empty()) corr   = std::max(0.0, std::min(1.0, scd("market_corr", corr)));
          if (!jstr(sc,"mode").empty()) mode = jstr(sc, "mode");
        } catch (...) {}
      }
      const bool deterministic = (mode == "deterministic");   // точечный прогноз (без разброса)

      // Точечные оверрайды цены/себестоимости из сценария (Стадия E).
      std::unordered_map<std::string, double> fcOvrPrice, fcOvrCost;
      if (!scenarioId.empty()) {
        for (auto& o : db.query_json(
               "SELECT product_id,base_price,base_cost FROM scenario_overrides WHERE scenario_id=?", { scenarioId })) {
          const std::string opid = jstr(o, "product_id"), bp = jstr(o, "base_price"), bc = jstr(o, "base_cost");
          if (!bp.empty()) fcOvrPrice[opid] = std::stod(bp);
          if (!bc.empty()) fcOvrCost[opid] = std::stod(bc);
        }
      }

      auto rows = db.query_json(
        "SELECT id,name,base_price,base_cost,sellable,purchased FROM products "
        "WHERE sellable=1 OR purchased=1 ORDER BY sellable DESC, name");

      std::mt19937 rng(seed);
      std::normal_distribution<double> nd(0.0, 1.0);
      const double beta = std::sqrt(corr), idio = std::sqrt(std::max(0.0, 1.0 - corr));
      const double driftStep = std::log(1.0 + infl);

      // Общий рыночный шок по (прогон, месяц) — обеспечивает корреляцию всех цен.
      std::vector<std::vector<double>> M(runs, std::vector<double>(months + 1, 0.0));
      for (int r = 0; r < runs; ++r)
        for (int t = 1; t <= months; ++t) M[r][t] = nd(rng);

      // Стандартная нормаль CDF и квантиль Лапласа — для гауссовой копулы с выбранным
      // распределением маргинала (нормаль | Лаплас с тяжёлыми хвостами).
      auto Phi = [](double z) { return 0.5 * std::erfc(-z / std::sqrt(2.0)); };
      auto lapQ = [](double u, double b) {
        return u < 0.5 ? b * std::log(2.0 * u) : -b * std::log(2.0 * (1.0 - u));
      };
      auto numOf = [](const json& row) -> double {
        if (!row.contains("value") || row["value"].is_null()) return 0.0;
        if (row["value"].is_number()) return row["value"].get<double>();
        if (row["value"].is_string()) { try { return std::stod(row["value"].get<std::string>()); } catch (...) { return 0.0; } }
        return 0.0;
      };

      // КАНОНИЧЕСКИЙ движок прогноза (как в эталонной методике):
      //   1) строим ТРЕНД (МНК-регрессия лог-цены по времени);
      //   2) подбираем РАСПРЕДЕЛЕНИЕ к ОСТАТКАМ (не-тренду) по AIC: нормаль/Лаплас/t/α-stable;
      //   3) прогноз = экстраполяция тренда + случайный остаток из подобранного распределения
      //      (Монте-Карло, общий рыночный фактор → корреляция, веер P10/P50/P90).
      auto fanFromHistory = [&](double base, const std::vector<double>& vals,
                                double extraDrift, double macroMul) -> json {
        std::vector<double> ly;
        for (double v : vals) if (v > 0) ly.push_back(std::log(v));
        const int Hn = (int)ly.size();
        const bool dd = Hn >= 5;

        // 1) ТРЕНД: lvl + slp*t (t=0..Hn-1); остатки res_t = ly_t − тренд.
        double lvl = std::log(base), slp = 0.0;
        std::vector<double> res;
        if (dd) {
          double n = Hn, st = 0, sy = 0, stt = 0, sty = 0;
          for (int t = 0; t < Hn; ++t) { st += t; sy += ly[t]; stt += (double)t * t; sty += (double)t * ly[t]; }
          const double den = n * stt - st * st;
          slp = den != 0 ? (n * sty - st * sy) / den : 0.0;
          lvl = (sy - slp * st) / n;
          for (int t = 0; t < Hn; ++t) res.push_back(ly[t] - (lvl + slp * t));
        }

        // 2) РАСПРЕДЕЛЕНИЕ остатков по AIC.
        double mu = 0, sg = vol, aicN = 0, aicL = 0, aicT = 0, aicS = 0;
        std::string dist = "normal"; double lapB = vol / std::sqrt(2.0);
        double tNu = 40.0, tScale = vol, sAlpha = 2.0, sGamma = vol;
        if (dd) {
          double s = 0; for (double r : res) s += r; mu = s / res.size();
          double v2 = 0; for (double r : res) v2 += (r - mu) * (r - mu);
          sg = std::max(1e-4, std::sqrt(v2 / res.size()));
          std::vector<double> sr = res; std::sort(sr.begin(), sr.end());
          double med = sr[sr.size() / 2], mad = 0, m4 = 0;
          for (double r : res) { mad += std::fabs(r - med); double d = r - mu; m4 += d * d * d * d; }
          mad = std::max(1e-4, mad / res.size()); m4 /= res.size();
          const double exKurt = sg > 1e-9 ? m4 / (sg * sg * sg * sg) - 3.0 : 0.0;
          tNu = exKurt > 0.05 ? std::min(40.0, std::max(3.0, 6.0 / exKurt + 4.0)) : 40.0;
          tScale = sg / std::sqrt(tNu / (tNu - 2.0));
          double llN = 0, llL = 0, llT = 0;
          const double tc = std::lgamma((tNu + 1) / 2.0) - std::lgamma(tNu / 2.0)
                          - 0.5 * std::log(tNu * M_PI) - std::log(tScale);
          for (double r : res) {
            llN += -0.5 * std::log(2 * M_PI * sg * sg) - (r - mu) * (r - mu) / (2 * sg * sg);
            llL += -std::log(2 * mad) - std::fabs(r - med) / mad;
            const double zt = (r - mu) / tScale;
            llT += tc - (tNu + 1) / 2.0 * std::log(1 + zt * zt / tNu);
          }
          aicN = 4 - 2 * llN; aicL = 4 - 2 * llL; aicT = 6 - 2 * llT;
          double bestAic = aicN;
          if (aicL < bestAic) { dist = "laplace"; lapB = mad; bestAic = aicL; }
          if (aicT < bestAic) { dist = "t"; bestAic = aicT; }
          const double q1 = sr[(size_t)std::round(0.25 * (res.size() - 1))];
          const double q3 = sr[(size_t)std::round(0.75 * (res.size() - 1))];
          const double gam0 = std::max(1e-4, (q3 - q1) / 2.0);
          auto stableLL = [&](double a, double g) {
            double ll = 0;
            for (double r : res) {
              double xn = (r - mu) / g, integ = 0;
              for (int j = 0; j < 160; ++j) { double u = (j + 0.5) * 0.15; integ += std::exp(-std::pow(u, a)) * std::cos(u * xn) * 0.15; }
              ll += std::log(std::max(integ / (M_PI * g), 1e-12));
            }
            return ll;
          };
          double bestSLL = -1e18;
          for (double a : { 1.3, 1.5, 1.7, 1.9 })
            for (double gm : { 0.7, 1.0, 1.4 }) {
              double g = gam0 * gm, ll = stableLL(a, g);
              if (ll > bestSLL) { bestSLL = ll; sAlpha = a; sGamma = g; }
            }
          aicS = 4 - 2 * bestSLL;
          if (aicS < bestAic) { dist = "stable"; bestAic = aicS; }
        }

        // 3) ПРОГНОЗ = тренд (наклон истории + макро-дрейф) + остаток из распределения.
        //    Якорь — последнее ФАКТ. значение (непрерывность с историей), наклон — из тренда.
        const double anchor = std::log(base);
        const double slopeFwd = slp + extraDrift;                // наклон тренда + макро-инфляция
        std::gamma_distribution<double> gdist(tNu / 2.0, 2.0);
        std::uniform_real_distribution<double> ud(-M_PI / 2 + 1e-6, M_PI / 2 - 1e-6);
        std::exponential_distribution<double> ed(1.0);
        std::vector<std::vector<double>> px(months + 1, std::vector<double>(runs, 0.0));
        for (int r = 0; r < runs; ++r) {
          px[0][r] = std::exp(anchor) * macroMul;
          for (int t = 1; t <= months; ++t) {
            double innov = 0;
            if (!deterministic) {
              const double z = beta * M[r][t] + idio * nd(rng);
              if (dist == "laplace")   innov = lapQ(Phi(z), lapB);
              else if (dist == "t")    innov = tScale * z / std::sqrt(gdist(rng) / tNu);
              else if (dist == "stable") {
                const double U = ud(rng), W = ed(rng);
                innov = sGamma * std::sin(sAlpha * U) / std::pow(std::cos(U), 1.0 / sAlpha)
                      * std::pow(std::cos((1 - sAlpha) * U) / W, (1 - sAlpha) / sAlpha);
              } else                   innov = sg * z;
            }
            px[t][r] = std::exp(anchor + slopeFwd * t + innov) * macroMul;  // тренд + остаток
          }
        }
        json p10 = json::array(), p50 = json::array(), p90 = json::array(), mean = json::array();
        for (int t = 0; t <= months; ++t) {
          auto& col = px[t];
          std::sort(col.begin(), col.end());
          auto q = [&](double f) { return col[(size_t)std::round(f * (runs - 1))]; };
          double s = 0; for (double v : col) s += v;
          p10.push_back(q(0.10)); p50.push_back(q(0.50)); p90.push_back(q(0.90));
          mean.push_back(s / runs);
        }
        json history = json::array();
        int hk = std::min((int)vals.size(), 12);
        for (int i = (int)vals.size() - hk; i < (int)vals.size(); ++i)
          if (i >= 0) history.push_back(vals[i] * macroMul);
        json trend = json::array();
        for (int t = 0; t <= months; ++t) trend.push_back(std::exp(anchor + slopeFwd * t) * macroMul);

        return json{
          {"base", base}, {"history", history}, {"trend", trend},
          {"p10", p10}, {"p50", p50}, {"p90", p90}, {"mean", mean},
          {"fit", { {"data_driven", dd}, {"dist", dist}, {"n_obs", (int)res.size()},
                    {"mu", mu}, {"sigma", sg}, {"nu", tNu}, {"alpha", sAlpha},
                    {"trend_slope", slp}, {"residual", true},
                    {"aic_normal", aicN}, {"aic_laplace", aicL}, {"aic_t", aicT}, {"aic_stable", aicS} }},
        };
      };

      json products = json::array();
      for (auto& p : rows) {
        const bool sellable = jstr(p, "sellable") == "1";
        const std::string kind = sellable ? "price" : "cost";
        const std::string bs = sellable ? jstr(p, "base_price") : jstr(p, "base_cost");
        if (bs.empty()) continue;
        double base = std::stod(bs);
        if (base <= 0) continue;
        const std::string pid = jstr(p, "id");
        if (sellable && fcOvrPrice.count(pid)) base = fcOvrPrice[pid];
        else if (!sellable && fcOvrCost.count(pid)) base = fcOvrCost[pid];

        auto hist = db.query_json(
          "SELECT value FROM ts_data WHERE product_id=? AND kind=? ORDER BY month_idx", { pid, kind });
        std::vector<double> vals; for (auto& row : hist) vals.push_back(numOf(row));

        json j = fanFromHistory(base, vals, driftStep, fx * demand);   // цены: история+инфляция, fx·demand
        j["id"] = pid; j["name"] = jstr(p, "name"); j["role"] = sellable ? "product" : "raw";
        products.push_back(j);
      }

      // Прогноз КЛЮЧЕВОЙ СТАВКИ тем же движком (канон: ставка и цены — единообразно).
      json rateJson = nullptr;
      {
        auto rh = db.query_json("SELECT value FROM macro_ts WHERE series='keyrate' ORDER BY month_idx");
        std::vector<double> rv; for (auto& row : rh) rv.push_back(numOf(row));
        if (rv.size() >= 5 && rv.back() > 0) {
          json j = fanFromHistory(rv.back(), rv, 0.0, 1.0);   // ставка: чистый исторический дрейф
          j["id"] = "keyrate"; j["name"] = "Ключевая ставка"; j["role"] = "rate";
          rateJson = j;
        }
      }

      json inflIdx = json::array();
      for (int t = 0; t <= months; ++t) inflIdx.push_back(std::pow(1.0 + infl, t) * 100.0);

      ok(res, {
        {"months", months}, {"inflation_monthly", infl}, {"fx", fx}, {"demand", demand},
        {"volatility", vol}, {"corr", corr}, {"mode", mode}, {"scenario_id", scenarioId},
        {"inflation_index", inflIdx}, {"rate", rateJson}, {"products", products},
      });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

static void register_optimize(httplib::Server& svr, Database& db) {
  svr.Post("/api/optimize", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);
      maos::OptimizeParams pr;
      pr.scenarioId = jstr(body, "scenario_id");
      if (!jstr(body, "objective").empty()) pr.objective = jstr(body, "objective");
      if (body.contains("samples")) pr.samples = (int)std::stod(jstr(body, "samples"));
      if (body.contains("alpha"))   pr.alpha   = std::stod(jstr(body, "alpha"));
      if (body.contains("lambda"))  pr.lambda  = std::stod(jstr(body, "lambda"));
      if (body.contains("seed"))    pr.seed    = (unsigned)std::stod(jstr(body, "seed"));
      if (body.contains("max_share") && !jstr(body,"max_share").empty())
        pr.maxShare = std::stod(jstr(body, "max_share"));
      if (body.contains("horizon_hours") && !jstr(body,"horizon_hours").empty())
        pr.horizonHours = std::stod(jstr(body, "horizon_hours"));

      // Сценарий несёт цель оптимизации (Стадия E): берём из него, если не задано в запросе.
      if (!pr.scenarioId.empty()) {
        try {
          auto sc = db.query_one("SELECT objective,alpha,max_share FROM price_scenarios WHERE id=?", { pr.scenarioId });
          if (!body.contains("objective") && !jstr(sc,"objective").empty()) pr.objective = jstr(sc,"objective");
          if (!body.contains("alpha")     && !jstr(sc,"alpha").empty())     pr.alpha     = std::stod(jstr(sc,"alpha"));
          if (!body.contains("max_share") && !jstr(sc,"max_share").empty()) pr.maxShare  = std::stod(jstr(sc,"max_share"));
        } catch (...) {}
      }

      json result = maos::run_optimization(db, pr);
      if (result.value("error_soft", false)) { ok(res, result); return; }

      std::string runId = gen_uuid();
      bool persisted = false;
      {
        // Держим блокировку на всю транзакцию — иначе другой поток вклинится
        // между BEGIN и COMMIT на общем хэндле.
        std::lock_guard<std::recursive_mutex> lk(db.mutex());
        db.exec("BEGIN");
        try { persist_run(db, runId, pr, result); db.exec("COMMIT"); persisted = true; }
        catch (std::exception& pe) {
          try { db.exec("ROLLBACK"); } catch (...) {}
          std::cerr << "persist_run failed: " << pe.what() << "\n";
        }
      }
      if (persisted) {
        result["run_id"] = runId;
        audit(db, "optimization", runId, "RUN", { {"objective", pr.objective} });
      } else {
        result["persist_error"] = true;  // результат верный, но не сохранён
      }
      ok(res, result);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  svr.Get("/api/optimize/runs", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      ok(res, db.query_json(
        "SELECT id,scenario_id,objective,samples,alpha,created_at "
        "FROM optimization_runs ORDER BY created_at DESC LIMIT 50"));
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  svr.Get("/api/optimize/runs/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto row = db.query_one("SELECT result_json FROM optimization_runs WHERE id=?", { req.matches[1] });
      ok(res, json::parse(jstr(row, "result_json")));
    } catch (...) { err(res, 404, "not found"); }
  });
}

/* ── Стадия 1: расписание (план исполнения) ──────────────────────────────── */

static void persist_schedule(Database& db, const std::string& planId, const json& result) {
  db.exec("INSERT INTO plans(id,run_id) VALUES(?,?)", { planId, "" });
  for (auto& g : result.value("gantt", json::array()))
    db.exec("INSERT INTO plan_tasks(id,plan_id,product_id,operation_id,wc_type_id,machine_id,"
            "worker_id,start_min,end_min,order_idx) VALUES(?,?,?,?,?,?,?,?,?,?)",
            { gen_uuid(), planId, g.value("product_id", std::string()),
              g.value("op_id", std::string()), g.value("wc_type_id", std::string()),
              g.value("machine_id", std::string()), "",
              std::to_string(g.value("start", 0.0) * 60.0), std::to_string(g.value("end", 0.0) * 60.0),
              std::to_string(g.value("order_idx", 0)) });
}

static void register_schedule(httplib::Server& svr, Database& db) {
  svr.Post("/api/schedule", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);
      maos::ScheduleParams sp;
      sp.runId = jstr(body, "run_id");
      if (!jstr(body, "rule").empty()) sp.rule = jstr(body, "rule");
      if (body.contains("w_time")) sp.wTime = std::stod(jstr(body, "w_time"));
      if (body.contains("w_cost")) sp.wCost = std::stod(jstr(body, "w_cost"));
      if (body.contains("w_risk")) sp.wRisk = std::stod(jstr(body, "w_risk"));
      if (body.contains("samples")) sp.samples = (int)std::stod(jstr(body, "samples"));
      if (body.contains("alpha")) sp.alpha = std::stod(jstr(body, "alpha"));
      if (body.contains("tail_weight") && !jstr(body,"tail_weight").empty())
        sp.tailWeight = std::stod(jstr(body, "tail_weight"));
      if (body.contains("use_calendar")) {
        std::string uc = jstr(body, "use_calendar");
        sp.useCalendar = !(uc == "0" || uc == "false");
      }
      if (body.contains("program") && body["program"].is_array())
        for (auto& o : body["program"]) {
          maos::OrderLine ol; ol.productId = jstr(o, "product_id");
          ol.qty = o.contains("qty") ? std::stod(jstr(o,"qty")) : 1;
          ol.dueHours = o.contains("due_hours") ? std::stod(jstr(o,"due_hours")) : 0;
          if (!ol.productId.empty()) sp.program.push_back(ol);
        }

      // Стадия E: сценарий привязан к ПЛАНУ → программа из заказов этого плана.
      if (sp.program.empty() && !jstr(body, "scenario_id").empty()) {
        try {
          auto sc = db.query_one("SELECT plan_id FROM price_scenarios WHERE id=?", { jstr(body, "scenario_id") });
          const std::string planId = jstr(sc, "plan_id");
          if (!planId.empty())
            for (auto& o : db.query_json(
                   "SELECT product_id,quantity,due_hours FROM demand_orders WHERE plan_id=?", { planId })) {
              maos::OrderLine ol; ol.productId = jstr(o, "product_id");
              ol.qty = std::stod(jstr(o, "quantity").empty() ? "1" : jstr(o, "quantity"));
              ol.dueHours = std::stod(jstr(o, "due_hours").empty() ? "0" : jstr(o, "due_hours"));
              if (!ol.productId.empty()) sp.program.push_back(ol);
            }
        } catch (...) {}
      }

      json result = maos::run_schedule(db, sp);
      if (result.value("error_soft", false)) { ok(res, result); return; }

      std::string planId = gen_uuid();
      {
        std::lock_guard<std::recursive_mutex> lk(db.mutex());
        db.exec("BEGIN");
        try { persist_schedule(db, planId, result); db.exec("COMMIT"); }
        catch (std::exception& e) { try { db.exec("ROLLBACK"); } catch (...) {}
          std::cerr << "persist_schedule failed: " << e.what() << "\n"; }
      }
      result["plan_id"] = planId;
      audit(db, "schedule", planId, "RUN", { {"rule", result.value("rule", std::string())} });
      ok(res, result);
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Администрирование: пользователи, роли (Стадия D) ─────────────────────── */

static void register_admin(httplib::Server& svr, Database& db) {
  // Пользователи — без хеша пароля; с именем роли.
  svr.Get("/api/users", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      auto rows = db.query_json(
        "SELECT u.id, u.login, u.status, u.failed_attempts, u.role_id, "
        "       r.name AS role_name, r.permissions AS permissions, u.created_at "
        "FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.created_at");
      ok(res, rows);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });
  // Роли с правами.
  svr.Get("/api/roles", [&db](const httplib::Request&, httplib::Response& res) {
    try { ok(res, db.query_json("SELECT * FROM roles ORDER BY id")); }
    catch (std::exception& e) { err(res, 500, e.what()); }
  });
}

/* ── MRP: разузлование программы → потребность в материалах (Стадия C) ────── */

static void register_mrp(httplib::Server& svr, Database& db) {
  svr.Post("/api/mrp", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);

      // Программа: из тела / из реестра заказов.
      std::vector<std::pair<std::string,double>> program;
      if (body.contains("program") && body["program"].is_array())
        for (auto& o : body["program"])
          program.push_back({ jstr(o,"product_id"),
                              o.contains("qty") ? std::stod(jstr(o,"qty")) : 1 });
      if (program.empty())
        for (auto& r : db.query_json("SELECT product_id,quantity FROM demand_orders WHERE status<>'done'"))
          program.push_back({ jstr(r,"product_id"), std::stod(jstr(r,"quantity")) });

      // Кэш техкарт/входов/изделий.
      std::unordered_map<std::string, std::vector<std::pair<std::string,double>>> inputsByProduct;
      auto chainInputs = [&](const std::string& pid) -> std::vector<std::pair<std::string,double>>& {
        auto it = inputsByProduct.find(pid);
        if (it != inputsByProduct.end()) return it->second;
        std::vector<std::pair<std::string,double>> v;
        for (auto& r : db.query_json("SELECT id FROM routings WHERE product_id=?", { pid }))
          for (auto& o : db.query_json("SELECT id FROM operations WHERE routing_id=?", { jstr(r,"id") }))
            for (auto& in : db.query_json("SELECT product_id,qty FROM operation_inputs WHERE operation_id=?", { jstr(o,"id") }))
              v.push_back({ jstr(in,"product_id"), std::stod(jstr(in,"qty")) });
        return inputsByProduct[pid] = v;
      };

      // Рекурсивное разузлование: накапливаем потребность по изделиям.
      std::unordered_map<std::string,double> need;
      std::function<void(const std::string&, double, std::unordered_set<std::string>&, int)> explode =
        [&](const std::string& pid, double mult, std::unordered_set<std::string>& vis, int depth) {
          if (depth > 48 || vis.count(pid)) return;
          vis.insert(pid);
          for (auto& [q, qty] : chainInputs(pid)) {
            need[q] += mult * qty;
            explode(q, mult * qty, vis, depth + 1);   // произвести/закупить вход
          }
          vis.erase(pid);
        };
      for (auto& [pid, qty] : program) { std::unordered_set<std::string> vis; explode(pid, qty, vis, 0); }

      // Сводка по материалам (акцент на покупном сырье).
      json materials = json::array(); bool feasible = true;
      for (auto& [pid, gross] : need) {
        json p;
        try { p = db.query_one("SELECT * FROM products WHERE id=?", { pid }); } catch (...) { continue; }
        bool purchased = std::stod(jstr(p,"purchased").empty()?"0":jstr(p,"purchased")) != 0;
        double onHand = std::stod(jstr(p,"stock").empty()?"0":jstr(p,"stock"));
        double safety = std::stod(jstr(p,"safety_stock").empty()?"0":jstr(p,"safety_stock"));
        double reorder= std::stod(jstr(p,"reorder_point").empty()?"0":jstr(p,"reorder_point"));
        double lead   = std::stod(jstr(p,"lead_time_hours").empty()?"0":jstr(p,"lead_time_hours"));
        double net = std::max(0.0, gross + safety - onHand);   // нетто с учётом страх. запаса
        if (purchased && net > 0) feasible = false;
        materials.push_back({
          {"product_id", pid}, {"name", jstr(p,"name")}, {"purchased", purchased},
          {"gross_req", gross}, {"on_hand", onHand}, {"safety_stock", safety},
          {"net_req", net}, {"shortage", net > 0}, {"reorder", onHand < reorder && reorder > 0},
          {"lead_time_hours", lead}, {"unit_cost", std::stod(jstr(p,"base_cost").empty()?"0":jstr(p,"base_cost"))},
        });
      }
      ok(res, { {"feasible", feasible}, {"materials", materials},
                {"n_orders", (int)program.size()} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Рабочий календарь (смены по умолчанию) ──────────────────────────────── */

static void register_calendar(httplib::Server& svr, Database& db) {
  // GET — окно работы по умолчанию (выводим из смен: единое start/end + рабочие дни).
  svr.Get("/api/calendar", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      auto sch = db.query_json("SELECT id,name FROM schedules WHERE is_default=1 LIMIT 1");
      if (sch.empty()) { ok(res, { {"enabled", false} }); return; }
      std::string sid = jstr(sch[0], "id");
      auto shifts = db.query_json("SELECT day_of_week,start_min,end_min FROM shifts WHERE schedule_id=? ORDER BY day_of_week", { sid });
      json days = json::array(); double sMin = 360, eMin = 1320;
      for (auto& s : shifts) {
        days.push_back(std::stoi(jstr(s, "day_of_week")));
        sMin = std::stod(jstr(s, "start_min")); eMin = std::stod(jstr(s, "end_min"));
      }
      ok(res, { {"schedule_id", sid}, {"name", jstr(sch[0], "name")}, {"enabled", !shifts.empty()},
                {"start_hour", sMin / 60.0}, {"end_hour", eMin / 60.0}, {"days", days} });
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // PUT — заменить смены окна работы (start_hour, end_hour, days[1..7]).
  svr.Put("/api/calendar", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      auto sch = db.query_json("SELECT id FROM schedules WHERE is_default=1 LIMIT 1");
      std::string sid = sch.empty() ? "" : jstr(sch[0], "id");
      if (sid.empty()) { sid = "sch-default";
        db.exec("INSERT OR IGNORE INTO schedules(id,name,is_default) VALUES(?, 'Рабочий календарь', 1)", { sid }); }
      int sMin = (int)(std::stod(jstr(body, "start_hour").empty() ? "6" : jstr(body, "start_hour")) * 60);
      int eMin = (int)(std::stod(jstr(body, "end_hour").empty() ? "22" : jstr(body, "end_hour")) * 60);
      std::lock_guard<std::recursive_mutex> lk(db.mutex());
      db.exec("DELETE FROM shifts WHERE schedule_id=?", { sid });
      if (body.contains("days") && body["days"].is_array())
        for (auto& d : body["days"]) {
          int dow = d.is_number() ? d.get<int>() : std::stoi(d.get<std::string>());
          db.exec("INSERT INTO shifts(id,schedule_id,day_of_week,start_min,end_min) VALUES(?,?,?,?,?)",
                  { gen_uuid(), sid, std::to_string(dow), std::to_string(sMin), std::to_string(eMin) });
        }
      audit(db, "calendar", sid, "UPDATE", body);
      ok(res, { {"ok", true} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
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

  // Миграция: связать реестры по ID, завести экономику/сценарии/RBAC. Идемпотентно,
  // существующие данные сохраняются (PRAGMA user_version). Данные-часть — в
  // транзакции с откатом; при ошибке НЕ стартуем с полу-мигрированной БД.
  try {
    migrate(db);
    migrate_v2(db);
    migrate_v3(db);
    migrate_v4(db);
    migrate_v5(db);
    migrate_v6(db);
    migrate_v7(db);
    migrate_v8(db);
    migrate_v9(db);
    migrate_v10(db);
    migrate_v11(db);
    migrate_v12(db);
    migrate_v13(db);
    migrate_v14(db);
  } catch (std::exception& e) {
    std::cerr << "FATAL: migration failed: " << e.what() << "\n"
              << "Отказ старта с частично мигрированной БД (повтор при перезапуске).\n";
    return 1;
  }

  httplib::Server svr;

  // CORS pre-flight
  svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
    cors(res);
  });

  // Health
  svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
    cors(res);
    ok(res, { {"status", "ok"}, {"version", "0.19.0"} });
  });

  // Auth
  register_auth(svr, db);

  // NSI registries (simple CRUD)
  register_crud(svr, db, {
    "work_center_types", "work_center_type",
    { "name", "group_name", "kind", "characteristics", "description", "interchangeable" }
  });

  register_crud(svr, db, {
    "machines", "machine",
    { "name", "wc_type_id", "org_unit", "inv_no", "serial_no",
      "year_made", "schedule", "status",
      "subtitle", "pos_x", "pos_z", "rotation_y", "parent_machine_id" }
  });

  register_crud(svr, db, {
    "flows", "flow",
    { "from_id", "to_id", "parent_id" }
  });

  register_crud(svr, db, {
    "products", "product",
    { "code", "name", "unit", "parent_id", "qty_in_parent",
      "batch_size", "stock", "purchased",
      // Экономика внешних условий — иначе товарные позиции невидимы оптимизатору:
      "sellable", "base_cost", "base_price", "demand_max",
      // Запасы / MRP:
      "safety_stock", "reorder_point", "lead_time_hours" }
  });

  register_crud(svr, db, {
    "workers", "worker",
    { "tab_no", "last_name", "first_name", "middle_name",
      "org_unit", "org_unit_id", "position", "grade", "cost_per_hour", "skills" }
  });

  // Производственная программа (заказы) — вход Стадии 1
  register_crud(svr, db, {
    "demand_orders", "demand_order",
    { "plan_id", "product_id", "quantity", "due_hours", "release_hours", "priority", "status" }
  });

  // Именованные производственные планы (программы заказов)
  register_crud(svr, db, {
    "production_plans", "production_plan", { "name", "description" }
  });

  // Оргструктура (подразделения/цеха) — для выпадающих списков
  register_crud(svr, db, {
    "org_units", "org_unit", { "name", "parent_id" }
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

  // 3D-схема как сохранённый агрегат
  register_scheme(svr, db);

  // Сценарии внешних условий (стохастика цен)
  register_scenarios(svr, db);

  // Устойчивая стохастическая оптимизация (Стадия 2)
  register_optimize(svr, db);
  register_forecast(svr, db);

  // Расписание производства (Стадия 1)
  register_schedule(svr, db);

  // Рабочий календарь (смены)
  register_calendar(svr, db);

  // MRP — потребность в материалах из программы (Стадия C)
  register_mrp(svr, db);

  // Администрирование — пользователи, роли (Стадия D)
  register_admin(svr, db);

  // Demo seed
  register_demo_seed(svr, db);

  // Audit / analytics
  register_analytics(svr, db);

  std::cout << "Listening on http://127.0.0.1:8080\n";
  svr.listen("127.0.0.1", 8080);
  return 0;
}
