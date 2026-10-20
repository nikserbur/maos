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
#include "Finance.h"
#include "Optimizer.h"
#include "PlanMath.h"
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
#include <array>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <functional>
#include <cstdint>
#include <cctype>
#include <chrono>
#include <mutex>
#include <filesystem>

using json = nlohmann::json;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

static std::string gen_uuid() {
  // thread_local: httplib обслуживает запросы пулом потоков — общий static mt19937
  // был data race (повреждение состояния → коллизии id).
  thread_local std::mt19937 rng(std::random_device{}());
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

/* ── Сессии (RBAC): токен → пользователь + права; истекают через 12 часов ── */
struct AuthSession {
  std::string login;
  std::unordered_set<std::string> perms;
  std::chrono::steady_clock::time_point expires;
};
static std::mutex g_sess_mtx;
static std::unordered_map<std::string, AuthSession> g_sessions;
// Актор текущего запроса (устанавливается pre-routing фильтром) — попадает в аудит.
static thread_local std::string g_actor;

static void audit(Database& db, const std::string& entity, const std::string& id,
                  const std::string& action, const json& payload = nullptr) {
  try {
    db.exec(
      "INSERT INTO actions(id,actor,entity_type,entity_id,action_type,payload) VALUES(?,?,?,?,?,?)",
      { gen_uuid(), g_actor.empty() ? "system" : g_actor,
        entity, id, action, payload.is_null() ? "" : payload.dump() }
    );
  } catch (...) {}  // audit must never crash the main flow
}

// Полная инициализация БД проекта: схема + идемпотентные миграции + посевы.
// Вызывается при старте и при переключении проекта (reopen). false = фатально.
static bool setup_database(Database& db);

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
  // Фолбэк: редактор техкарт шлёт только CSV ИМЁН в wc_types (без wc_type_ids) —
  // резолвим имена в ID, иначе operation_wc_types пуста и планировщик не находит
  // станков для операции (machine_id='' → план не проигрывается на схеме).
  {
    auto linked = db.query_one("SELECT COUNT(*) AS n FROM operation_wc_types WHERE operation_id=?", { opId });
    if (jstr(linked, "n") == "0" && body.contains("wc_types") && body["wc_types"].is_string()) {
      const std::string csv = body["wc_types"].get<std::string>();
      size_t pos = 0;
      while (pos <= csv.size()) {
        size_t comma = csv.find(',', pos);
        std::string name = csv.substr(pos, comma == std::string::npos ? std::string::npos : comma - pos);
        pos = (comma == std::string::npos) ? csv.size() + 1 : comma + 1;
        const size_t a = name.find_first_not_of(" \t");
        if (a == std::string::npos) continue;
        const size_t b = name.find_last_not_of(" \t");
        name = name.substr(a, b - a + 1);
        db.exec("INSERT OR IGNORE INTO operation_wc_types(operation_id,wc_type_id) "
                "SELECT ?, id FROM work_center_types WHERE name=?", { opId, name });
      }
    }
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

      // Мультипроектность: выбранный проект (файл БД) открывается ДО аутентификации —
      // пользователи живут в БД проекта. Несуществующее имя = НОВЫЙ проект
      // (авто-посев демо + миграции). Все сессии прежнего проекта сбрасываются.
      std::string reqDb = jstr(body, "db");
      if (!reqDb.empty()) {
        if (reqDb.find('/') != std::string::npos || reqDb.find('\\') != std::string::npos ||
            reqDb.find("..") != std::string::npos) { err(res, 400, "Недопустимое имя проекта"); return; }
        if (reqDb.size() < 3 || reqDb.substr(reqDb.size() - 3) != ".db") reqDb += ".db";
        if (reqDb != db.path()) {
          { std::lock_guard<std::mutex> lk(g_sess_mtx); g_sessions.clear(); }
          try { db.reopen(reqDb); } catch (std::exception& e) {
            err(res, 500, std::string("Не удалось открыть проект: ") + e.what()); return;
          }
          if (!setup_database(db)) { err(res, 500, "Инициализация проекта не удалась"); return; }
        }
      }

      // Единое сообщение об ошибке: не раскрываем, существует ли пользователь
      // (защита от user enumeration — требование «Пользователи и роли» §4).
      json user;
      try {
        user = db.query_one("SELECT * FROM users WHERE login=?", { login });
      } catch (...) { err(res, 401, "Неверный логин или пароль"); return; }

      if (jstr(user, "status") != "active") { err(res, 403, "Учётная запись заблокирована"); return; }
      // ВРЕМЕННАЯ блокировка перебора («Пользователи и роли»): после 5 неудачных
      // попыток — отказ на 5 минут (locked_until), затем вход снова доступен.
      const std::string lockedUntil = jstr(user, "locked_until");
      if (!lockedUntil.empty()) {
        try {
          auto row = db.query_one("SELECT (datetime('now') < ?) AS locked", { lockedUntil });
          if (jstr(row, "locked") == "1") {
            audit(db, "auth", jstr(user, "id"), "LOGIN_LOCKED");
            err(res, 423, "Учётная запись временно заблокирована (повторите через несколько минут)");
            return;
          }
        } catch (...) {}
      }
      if (!verify_password(password, jstr(user, "password_hash"))) {
        int failed = 0;
        try { failed = std::stoi(jstr(user, "failed_attempts")); } catch (...) {}
        if (failed + 1 >= 5)
          db.exec("UPDATE users SET failed_attempts=0, "
                  "locked_until=datetime('now','+5 minutes') WHERE id=?", { jstr(user, "id") });
        else
          db.exec("UPDATE users SET failed_attempts=failed_attempts+1 WHERE id=?",
                  { jstr(user, "id") });
        audit(db, "auth", jstr(user, "id"), "LOGIN_FAILED");
        err(res, 401, "Неверный логин или пароль");
        return;
      }
      db.exec("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?",
              { jstr(user, "id") });

      std::string roleName = "viewer", perms = "[]";
      std::string roleId = jstr(user, "role_id");
      if (!roleId.empty()) {
        try {
          auto role = db.query_one("SELECT * FROM roles WHERE id=?", { roleId });
          roleName = jstr(role, "name"); perms = jstr(role, "permissions");
        } catch (...) {}
      }
      // Сессионный токен регистрируется на сервере: pre-routing фильтр проверяет
      // его на каждом запросе (deny-by-default вместо декоративного RBAC).
      std::string token = gen_uuid() + gen_uuid();
      {
        AuthSession s; s.login = login;
        s.expires = std::chrono::steady_clock::now() + std::chrono::hours(12);
        try { for (auto& pm : json::parse(perms.empty() ? "[]" : perms))
                if (pm.is_string()) s.perms.insert(pm.get<std::string>()); } catch (...) {}
        std::lock_guard<std::mutex> lk(g_sess_mtx);
        g_sessions[token] = std::move(s);
      }
      g_actor = login;
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
      // Версионирование (ТЗ «Справочник техкарт» §3.3): новая техкарта изделия
      // становится действующей (is_default=1) с версией max+1; прежние версии
      // сохраняются в истории (is_default=0) — планировщик/MRP берут действующую.
      int version = 1;
      const std::string prodId = jstr(body, "product_id");
      if (!prodId.empty()) {
        try {
          auto row = db.query_one(
            "SELECT COALESCE(MAX(version),0) AS v FROM routings WHERE product_id=?", { prodId });
          version = (int)std::stod(jstr(row, "v")) + 1;
        } catch (...) {}
        db.exec("UPDATE routings SET is_default=0 WHERE product_id=?", { prodId });
      }
      db.exec(
        "INSERT INTO routings(id,name,product_id,version,is_default,effective_from) "
        "VALUES(?,?,NULLIF(?,?),?,1,datetime('now'))",
        { id, jstr(body, "name"), prodId, "", std::to_string(version) }
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
      // limit — параметром с клампом: конкатенация была SQL-инъекцией и
      // позволяла неограниченную выборку.
      int limit = 100;
      if (req.has_param("limit")) {
        try { limit = std::stoi(req.get_param_value("limit")); } catch (...) {}
      }
      limit = std::max(1, std::min(1000, limit));
      auto rows = db.query_json(
        "SELECT * FROM actions ORDER BY ts DESC LIMIT ?", { std::to_string(limit) }
      );
      ok(res, rows);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Полный KPI-блок плана (makespan/CVaR, сроки/OTD, загрузка, наладки, поломки,
  // ТО, себестоимость, flow-time, очереди, WIP, проходка) + загрузка по типам и
  // узкое место. Сохранён при построении расписания (plans.kpi_json).
  svr.Get("/api/analytics/kpi", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string want = req.has_param("plan_id") ? req.get_param_value("plan_id") : "";
      json plan;
      try {
        plan = want.empty()
          ? db.query_one(
              "SELECT id, created_at, kpi_json FROM plans pl WHERE kpi_json IS NOT NULL AND EXISTS("
              "  SELECT 1 FROM plan_tasks pt WHERE pt.plan_id=pl.id"
              "  AND pt.machine_id<>'supply' AND pt.machine_id<>'') ORDER BY pl.rowid DESC LIMIT 1")
          : db.query_one("SELECT id, created_at, kpi_json FROM plans WHERE id=?", { want });
      } catch (...) { ok(res, { {"plan_id", nullptr}, {"kpi", json::object()} }); return; }
      json bundle = json::object();
      const std::string kj = jstr(plan, "kpi_json");
      if (!kj.empty()) { try { bundle = json::parse(kj); } catch (...) {} }
      bundle["plan_id"] = jstr(plan, "id");
      bundle["created_at"] = jstr(plan, "created_at");
      ok(res, bundle);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Инвестпроект: докупка N станков типа T → прирост прибыли (через рыночную
  // модель + производительность) → окупаемость/NPV/IRR/ROI. Считается как разница
  // ДВУХ прогонов оптимизатора (база vs +N станков) — reuse всей модели, без записи в БД.
  svr.Post("/api/analytics/investment", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);
      const std::string wct = jstr(body, "wc_type_id");
      if (wct.empty()) { err(res, 400, "Не указан тип оборудования"); return; }
      auto bnum = [&](const char* k, double d) {
        return body.contains(k) && !jstr(body, k).empty() ? std::stod(jstr(body, k)) : d; };
      const int addN = std::max(1, std::min(50, (int)bnum("add_machines", 1)));
      const double capexPer = std::max(0.0, bnum("machine_capex", 0));
      double discAnnual = bnum("discount_rate", 0.18);          // годовая ставка дисконта
      if (discAnnual > 1.5) discAnnual /= 100.0;                // «18» → 0.18

      // Базовые параметры (как в /api/optimize): из сценария, если задан.
      maos::OptimizeParams base;
      base.scenarioId = jstr(body, "scenario_id");
      base.samples = std::max(200, std::min(4000, (int)bnum("samples", 800)));
      if (body.contains("horizon_hours") && !jstr(body, "horizon_hours").empty())
        base.horizonHours = std::stod(jstr(body, "horizon_hours"));
      if (!base.scenarioId.empty()) {
        try {
          auto sc = db.query_one("SELECT objective,alpha,max_share,volatility,demand FROM price_scenarios WHERE id=?", { base.scenarioId });
          if (!jstr(sc,"objective").empty())  base.objective  = jstr(sc,"objective");
          if (!jstr(sc,"alpha").empty())      base.alpha      = std::stod(jstr(sc,"alpha"));
          if (!jstr(sc,"max_share").empty())  base.maxShare   = std::stod(jstr(sc,"max_share"));
          if (!jstr(sc,"volatility").empty()) base.volatility = std::stod(jstr(sc,"volatility"));
          if (!jstr(sc,"demand").empty())     base.demand     = std::stod(jstr(sc,"demand"));
        } catch (...) {}
      }
      maos::OptimizeParams bonus = base;
      bonus.machineBonus[wct] = addN;

      json r0 = maos::run_optimization(db, base);
      json r1 = maos::run_optimization(db, bonus);
      if (r0.value("error_soft", false) || r1.value("error_soft", false)) {
        err(res, 400, "Нет товарных изделий — оценивать нечего"); return;
      }
      auto profitOf = [](const json& r) {
        return (r.contains("robust") && r["robust"].contains("metrics"))
             ? r["robust"]["metrics"].value("expected", 0.0) : 0.0; };
      auto utilOf = [](const json& r, const std::string& id) {
        if (r.contains("robust") && r["robust"].contains("resource_load"))
          for (auto& e : r["robust"]["resource_load"])
            if (jstr(e, "wc_type_id") == id) return e.value("utilization", 0.0);
        return 0.0; };

      const double p0 = profitOf(r0), p1 = profitOf(r1);
      const double dProfit = p1 - p0;                          // прирост прибыли ЗА ГОРИЗОНТ ПЛАНА
      // Горизонт ПЛАНА (месяцы) — из него получаем месячный денежный поток…
      double horizonH = r0.value("horizon_hours", 0.0);
      if (horizonH <= 0) horizonH = base.horizonHours > 0 ? base.horizonHours : 720;
      const double planMonths = std::max(1.0, horizonH / 720.0);
      const double dCFmonth = dProfit / planMonths;            // повторяется каждый месяц
      // …а окупаемость/NPV/IRR считаем на СРОК СЛУЖБЫ оборудования (не на горизонт плана!).
      const int lifeMonths = std::max(1, std::min(600, (int)bnum("life_months", 60)));  // по умолч. 5 лет
      const double capex = capexPer * addN;

      // B16: «следующее узкое место» = argmax загрузки по ВСЕМ типам в прогоне «+N»
      // (может остаться тем же типом — тогда докупка не снимает ограничение).
      const auto nb = maos::planmath::next_bottleneck(
        (r1.contains("robust") && r1["robust"].contains("resource_load"))
          ? r1["robust"]["resource_load"] : json::array());
      const std::string nbId = nb.first; const double nbU = nb.second;
      std::string nbName;
      if (!nbId.empty()) { try { nbName = jstr(db.query_one("SELECT name FROM work_center_types WHERE id=?", { nbId }), "name"); } catch (...) {} }

      // B6: ЧДД / ВНД / сроки окупаемости по месячному ΔCF за СРОК СЛУЖБЫ (lifeMonths).
      // Месячная ставка r_m = (1+r)^{1/12} − 1 (эффективная годовая r, ВК 477) — та же,
      // по которой ВНД пересчитывается в годовую, поэтому ЧДД(r = ВНД) = 0.
      namespace fin = maos::finance;
      const double rm = fin::monthly_rate(discAnnual);
      const double npv = fin::npv(capex, dCFmonth, lifeMonths, rm);
      const std::optional<double> irrM = fin::irr_monthly(capex, dCFmonth, lifeMonths);
      const json irrAnnualJ  = irrM ? json(fin::annual_effective(*irrM)) : json(nullptr);
      const json irrMonthlyJ = irrM ? json(*irrM) : json(nullptr);
      const std::optional<double> dpp = fin::discounted_payback_months(capex, dCFmonth, lifeMonths, rm);
      const double payback = dCFmonth > 1e-9 ? capex / dCFmonth : -1;   // мес; -1 = не окупается
      const double roi = capex > 0 ? (dCFmonth * lifeMonths - capex) / capex : 0;

      ok(res, {
        {"wc_type_id", wct}, {"add_machines", addN},
        {"capex", capex}, {"plan_months", planMonths}, {"life_months", lifeMonths},
        {"discount_annual", discAnnual},
        {"profit_before", p0}, {"profit_after", p1},
        {"delta_profit_horizon", dProfit}, {"delta_cf_month", dCFmonth},
        {"payback_months", payback}, {"npv", npv}, {"irr_annual", irrAnnualJ}, {"roi", roi},
        // Новые поля (B6): месячная ставка дисконта, месячная ВНД, дисконт. срок окупаемости.
        {"discount_monthly", rm}, {"irr_monthly", irrMonthlyJ},
        {"dpp_months", dpp ? json(*dpp) : json(nullptr)},      // null = не окупается за life_months
        {"util_before", utilOf(r0, wct)}, {"util_after", utilOf(r1, wct)},
        {"next_bottleneck", { {"wc_type_id", nbId}, {"wc_name", nbName}, {"utilization", nbU},
                              {"same_as_invested", !nbId.empty() && nbId == wct} }},
      });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // KPI по ВСЕМ построенным планам — ряд «во времени» (x=дата/номер, y=любой KPI).
  // Для настраиваемых графиков «Аналитики»: тянем kpi_json каждого плана разом.
  svr.Get("/api/analytics/kpi_series", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      auto rows = db.query_json(
        "SELECT id, created_at, kpi_json FROM plans pl WHERE kpi_json IS NOT NULL AND EXISTS("
        "  SELECT 1 FROM plan_tasks pt WHERE pt.plan_id=pl.id"
        "  AND pt.machine_id<>'supply' AND pt.machine_id<>'') ORDER BY pl.rowid ASC");
      json out = json::array();
      for (auto& r : rows) {
        json bundle = json::object();
        const std::string kj = jstr(r, "kpi_json");
        if (!kj.empty()) { try { bundle = json::parse(kj); } catch (...) {} }
        bundle["plan_id"] = jstr(r, "id");
        bundle["created_at"] = jstr(r, "created_at");
        out.push_back(bundle);   // каждая точка — полный KpiBundle (как /analytics/kpi)
      }
      ok(res, out);
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Настройки дашборда (закреплённые KPI + конфиг графиков) — KV в БД проекта.
  // Хранится в app_prefs (см. setup_database); привязано к выбранному проекту-БД.
  svr.Get("/api/prefs/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      json row;
      try { row = db.query_one("SELECT value FROM app_prefs WHERE key=?", { req.matches[1] }); }
      catch (...) { ok(res, { {"key", std::string(req.matches[1])}, {"value", nullptr} }); return; }
      const std::string v = jstr(row, "value");
      json parsed = nullptr;
      if (!v.empty()) { try { parsed = json::parse(v); } catch (...) { parsed = v; } }
      ok(res, { {"key", std::string(req.matches[1])}, {"value", parsed} });
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });
  svr.Put("/api/prefs/([^/]+)", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      // value может прийти строкой (уже JSON) или объектом — храним как текст.
      std::string val;
      if (body.contains("value"))
        val = body["value"].is_string() ? body["value"].get<std::string>() : body["value"].dump();
      db.exec("INSERT INTO app_prefs(key,value,updated_at) VALUES(?,?,datetime('now')) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
              { std::string(req.matches[1]), val });
      ok(res, { {"key", std::string(req.matches[1])}, {"ok", true} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
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

      // Строка операции + связи (operation_wc_types/operation_inputs) — атомарно:
      // обрыв между INSERT и link_operation оставлял операцию без связей.
      std::lock_guard<std::recursive_mutex> lk(db.mutex());
      db.exec("BEGIN");
      try {
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
      db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
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
      db.exec("BEGIN");
      try {
        if (!set_clause.empty()) {
          vals.push_back(id);
          db.exec("UPDATE operations SET " + set_clause + " WHERE id=?", vals);
        }
        if (body.contains("wc_type_ids") || body.contains("input_products"))
          link_operation(db, id, body);
        db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
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

  // ══ РАСШИРЕНИЕ НСИ до масштаба крупного холдинга (труба+прокат+машиностроение+
  //    литьё+ковка+сварка+термообработка+покрытия+сборка+ОТК+энерго+логистика).
  //    Идемпотентно (INSERT OR IGNORE); id/коды не пересекаются с базовыми;
  //    kind ∈ 11 бандл-моделей 3D. Операции ссылаются на типы по ИМЕНИ (как фронт). ══
  db.exec(R"SQL(
    INSERT OR IGNORE INTO work_center_types(id,name,group_name,kind,characteristics) VALUES
    ('wct-tpa-piercer',   'ТПА: прошивной стан',            'Трубопрокат',   'pileizer',    '[{"label":"Производительность","value":"38 т/ч"},{"label":"Ø гильзы","value":"60–426 мм"}]'),
    ('wct-tpa-reducer',   'Стан-редуктор (редукционный)',   'Трубопрокат',   'pileizer',    '[{"label":"Производительность","value":"42 т/ч"},{"label":"Клетей","value":"24"}]'),
    ('wct-tpa-sizing',    'Калибровочный стан',             'Трубопрокат',   'pileizer',    '[{"label":"Производительность","value":"40 т/ч"},{"label":"Допуск Ø","value":"±0.4 мм"}]'),
    ('wct-tpa-pilger',    'Пильгерстан',                    'Трубопрокат',   'pileizer',    '[{"label":"Производительность","value":"22 т/ч"},{"label":"Ходов/мин","value":"58"}]'),
    ('wct-cnc-lathe',     'Токарный обрабатывающий центр',  'Механообработка','pileizer',   '[{"label":"Шпиндель","value":"22 кВт"},{"label":"Ось Z","value":"1500 мм"}]'),
    ('wct-cnc-mill',      'Фрезерный станок с ЧПУ',         'Механообработка','pileizer',   '[{"label":"Шпиндель","value":"18 000 об/мин"},{"label":"Осей","value":"5"}]'),
    ('wct-cnc-bore',      'Расточной станок',               'Механообработка','pileizer',   '[{"label":"Ø расточки","value":"до 320 мм"},{"label":"Точность","value":"H7"}]'),
    ('wct-cnc-grind',     'Круглошлифовальный станок',      'Механообработка','pileizer',   '[{"label":"Ra","value":"0.2 мкм"},{"label":"Ø детали","value":"до 400 мм"}]'),
    ('wct-cnc-hob',       'Зубофрезерный станок',           'Механообработка','pileizer',   '[{"label":"Модуль","value":"до 12 мм"},{"label":"Ø колеса","value":"до 800 мм"}]'),
    ('wct-cnc-jig',       'Координатно-расточной станок',   'Механообработка','pileizer',   '[{"label":"Точность позиц.","value":"±2 мкм"},{"label":"Стол","value":"1000×630 мм"}]'),
    ('wct-foundry-imf',   'Индукционная плавильная печь',   'Литьё',         'finecleaning','[{"label":"Ёмкость","value":"6 т"},{"label":"Мощность","value":"4.5 МВт"}]'),
    ('wct-foundry-mold',  'Формовочная линия',              'Литьё',         'finecleaning','[{"label":"Производительность","value":"120 форм/ч"},{"label":"Опока","value":"800×700 мм"}]'),
    ('wct-foundry-sand',  'Землеприготовительный участок',  'Литьё',         'cleaningarea','[{"label":"Производительность","value":"60 т/ч"},{"label":"Регенерация","value":"92%"}]'),
    ('wct-forge-press',   'Ковочный пресс',                 'Кузнечно-прессовое','briquettes','[{"label":"Усилие","value":"3150 тс"},{"label":"Ход","value":"900 мм"}]'),
    ('wct-forge-hammer',  'Ковочный молот',                 'Кузнечно-прессовое','briquettes','[{"label":"Энергия удара","value":"80 кДж"},{"label":"Падающие части","value":"5 т"}]'),
    ('wct-stamp-press',   'Листоштамповочный пресс',        'Кузнечно-прессовое','briquettes','[{"label":"Усилие","value":"630 тс"},{"label":"Ходов/мин","value":"35"}]'),
    ('wct-weld-robot',    'Сварочный робот',                'Сварка',        'briquettes',  '[{"label":"Осей","value":"6"},{"label":"Скорость сварки","value":"1.2 м/мин"}]'),
    ('wct-weld-tesa',     'Стан сварки труб ТЭСА',          'Сварка',        'briquettes',  '[{"label":"Производительность","value":"45 м/мин"},{"label":"Ø трубы","value":"57–530 мм"}]'),
    ('wct-ht-quench',     'Закалочная печь',                'Термообработка','dryer',       '[{"label":"Температура","value":"950 °C"},{"label":"Садка","value":"3 т"}]'),
    ('wct-ht-temper',     'Отпускная печь',                 'Термообработка','boiler',      '[{"label":"Температура","value":"680 °C"},{"label":"Садка","value":"3 т"}]'),
    ('wct-ht-carb',       'Печь цементации',                'Термообработка','dryer',       '[{"label":"Глубина слоя","value":"0.8–1.5 мм"},{"label":"Температура","value":"930 °C"}]'),
    ('wct-ht-induction',  'Установка индукционной закалки',  'Термообработка','dryer',       '[{"label":"Частота","value":"8 кГц"},{"label":"Мощность","value":"250 кВт"}]'),
    ('wct-coat-galv',     'Линия горячего оцинкования',     'Покрытия',      'cleaningarea','[{"label":"Производительность","value":"32 т/ч"},{"label":"Толщина цинка","value":"55–85 мкм"}]'),
    ('wct-coat-electro',  'Гальванический участок',         'Покрытия',      'cleaningarea','[{"label":"Ванн","value":"12"},{"label":"Толщина покрытия","value":"6–20 мкм"}]'),
    ('wct-coat-shot',     'Дробеструйная камера',           'Покрытия',      'cleaningarea','[{"label":"Производительность","value":"18 т/ч"},{"label":"Sa","value":"2.5"}]'),
    ('wct-coat-paint',    'Окрасочная камера',              'Покрытия',      'cleaningarea','[{"label":"Расход ЛКМ","value":"12 л/ч"},{"label":"Сушка","value":"80 °C"}]'),
    ('wct-asm-conveyor',  'Сборочный конвейер',             'Сборка',        'briquettes',  '[{"label":"Такт","value":"6 мин"},{"label":"Постов","value":"14"}]'),
    ('wct-asm-stand',     'Стенд сборки узлов',             'Сборка',        'briquettes',  '[{"label":"Грузоподъёмность","value":"5 т"},{"label":"Постов","value":"4"}]'),
    ('wct-qc-cmm',        'Координатно-измерительная машина','ОТК/Лаборатория','marketing',  '[{"label":"Точность","value":"±1.8 мкм"},{"label":"Зона","value":"1200×800×600 мм"}]'),
    ('wct-qc-spectro',    'Оптико-эмиссионный спектрометр', 'ОТК/Лаборатория','marketing',  '[{"label":"Элементов","value":"до 30"},{"label":"Проб/ч","value":"25"}]'),
    ('wct-qc-ut',         'УЗК-дефектоскоп',                'ОТК/Лаборатория','marketing',  '[{"label":"Диапазон","value":"0.5–10 МГц"},{"label":"Толщина","value":"до 300 мм"}]'),
    ('wct-qc-tensile',    'Разрывная машина',               'ОТК/Лаборатория','marketing',  '[{"label":"Усилие","value":"600 кН"},{"label":"Точность","value":"класс 0.5"}]'),
    ('wct-tool-shop',     'Инструментальный участок',       'Инструмент/Ремонт','marketing', '[{"label":"Станков","value":"9"},{"label":"Загрузка","value":"63%"}]'),
    ('wct-maint-rmc',     'Ремонтно-механический цех (РМЦ)','Инструмент/Ремонт','marketing', '[{"label":"Бригад","value":"6"},{"label":"MTTR","value":"5.5 ч"}]'),
    ('wct-util-compress', 'Компрессорная станция',          'Энергетика',    'boiler',      '[{"label":"Давление","value":"8 бар"},{"label":"Производительность","value":"120 м³/мин"}]'),
    ('wct-util-oxygen',   'Кислородная станция',            'Энергетика',    'transformer', '[{"label":"Производительность O₂","value":"2 500 м³/ч"},{"label":"Чистота","value":"99.5%"}]'),
    ('wct-util-water',    'Водоподготовка',                 'Энергетика',    'boiler',      '[{"label":"Производительность","value":"180 м³/ч"},{"label":"Оборотный цикл","value":"94%"}]'),
    ('wct-log-gantry',    'Козловой кран',                  'Логистика',     'wirehouse',   '[{"label":"Грузоподъёмность","value":"32 т"},{"label":"Пролёт","value":"32 м"}]'),
    ('wct-log-asrs',      'Автоматизированный склад (АС/РС)','Логистика',    'sale',        '[{"label":"Ячеек","value":"4 800"},{"label":"Заполнение","value":"71%"}]')
  )SQL");

  db.exec(R"SQL(
    INSERT OR IGNORE INTO products(id,code,name,unit,purchased) VALUES
    ('prod-rebar',      'FIN-010', 'Арматура А500С',              'т', 0),
    ('prod-wirerod',    'FIN-011', 'Катанка Ø6.5 мм',             'т', 0),
    ('prod-crcoil',     'FIN-012', 'Рулон холоднокатаный',        'т', 0),
    ('prod-hrplate',    'FIN-013', 'Лист горячекатаный',          'т', 0),
    ('prod-pipe-sl',    'FIN-014', 'Труба бесшовная 108×6',       'т', 0),
    ('prod-pipe-ew',    'FIN-015', 'Труба электросварная 76×4',   'т', 0),
    ('prod-bloom',      'SF-010',  'Блюм (заготовка)',            'т', 0),
    ('prod-billet',     'SF-011',  'Заготовка непрерывнолитая',   'т', 0),
    ('prod-shaft',      'FIN-016', 'Вал приводной',               'шт', 0),
    ('prod-gear',       'FIN-017', 'Шестерня цилиндрическая',     'шт', 0),
    ('prod-gearbox',    'FIN-018', 'Корпус редуктора',            'шт', 0),
    ('prod-fastener',   'FIN-019', 'Метизы (болт М16)',           'т', 0),
    ('prod-forging',    'SF-012',  'Поковка черновая',            'т', 0),
    ('prod-casting',    'SF-013',  'Отливка чугунная (черновая)', 'т', 0)
  )SQL");

  db.exec(R"SQL(
    INSERT OR IGNORE INTO operations(id,code,name,op_type,wc_types,t_norm,t_opt,t_pess,inputs,outputs) VALUES
    ('opt-pierce',   'OP-110', 'Прошивка гильзы',            'machining', 'ТПА: прошивной стан',              25, 20, 40, 'Заготовка непрерывнолитая', 'Гильза трубная'),
    ('opt-reduce',   'OP-111', 'Редуцирование трубы',        'machining', 'Стан-редуктор (редукционный)',     18, 14, 30, 'Гильза трубная', 'Труба черновая'),
    ('opt-size',     'OP-112', 'Калибровка трубы',           'machining', 'Калибровочный стан',               15, 12, 26, 'Труба черновая', 'Труба бесшовная 108×6'),
    ('opt-utpipe',   'OP-113', 'УЗК контроль трубы',         'control',   'УЗК-дефектоскоп',                  12, 10, 22, 'Труба бесшовная 108×6', 'Труба бесшовная 108×6'),
    ('opt-crcoil',   'OP-120', 'Холодная прокатка рулона',   'machining', 'Обогащение и подготовка',          30, 24, 48, 'Рулон горячекатаный', 'Рулон холоднокатаный'),
    ('opt-anneal',   'OP-121', 'Отжиг рулона',               'heat',      'Отпускная печь',                   150, 120, 240, 'Рулон холоднокатаный', 'Рулон холоднокатаный'),
    ('opt-galv',     'OP-122', 'Горячее оцинкование',        'machining', 'Линия горячего оцинкования',       22, 18, 38, 'Рулон холоднокатаный', 'Рулон холоднокатаный'),
    ('opt-turn',     'OP-130', 'Токарная обработка вала',    'machining', 'Токарный обрабатывающий центр',    40, 32, 70, 'Поковка черновая', 'Вал приводной'),
    ('opt-hob',      'OP-131', 'Зубофрезерование',           'machining', 'Зубофрезерный станок',             55, 44, 95, 'Поковка черновая', 'Шестерня цилиндрическая'),
    ('opt-carb',     'OP-132', 'Цементация зубьев',          'heat',      'Печь цементации',                  360, 300, 540, 'Шестерня цилиндрическая', 'Шестерня цилиндрическая'),
    ('opt-grind',    'OP-133', 'Шлифование',                 'machining', 'Круглошлифовальный станок',        28, 22, 50, 'Шестерня цилиндрическая', 'Шестерня цилиндрическая'),
    ('opt-cmm',      'OP-134', 'Контроль на КИМ',            'control',   'Координатно-измерительная машина', 18, 14, 32, 'Шестерня цилиндрическая', 'Шестерня цилиндрическая'),
    ('opt-melt',     'OP-140', 'Индукционная плавка',        'heat',      'Индукционная плавильная печь',     70, 55, 120, 'Металлолом', 'Чугун жидкий'),
    ('opt-mold',     'OP-141', 'Формовка и заливка',         'machining', 'Формовочная линия',                35, 28, 60, 'Чугун жидкий', 'Отливка чугунная (черновая)'),
    ('opt-borehousing','OP-142','Расточка корпуса',          'machining', 'Расточной станок',                 50, 40, 90, 'Отливка чугунная (черновая)', 'Корпус редуктора'),
    ('opt-millface', 'OP-143', 'Фрезерование плоскостей',    'machining', 'Фрезерный станок с ЧПУ',           38, 30, 68, 'Отливка чугунная (черновая)', 'Корпус редуктора'),
    ('opt-forge',    'OP-150', 'Ковка на прессе',            'machining', 'Ковочный пресс',                   30, 24, 55, 'Блюм (заготовка)', 'Поковка черновая'),
    ('opt-quench',   'OP-151', 'Закалка',                    'heat',      'Закалочная печь',                  90, 70, 150, 'Поковка черновая', 'Поковка черновая'),
    ('opt-temper',   'OP-152', 'Отпуск',                     'heat',      'Отпускная печь',                   120, 95, 200, 'Поковка черновая', 'Поковка черновая')
  )SQL");

  db.exec(R"SQL(
    INSERT OR IGNORE INTO routings(id,name,product_id) VALUES
    ('route-pipe-sl', 'Производство бесшовной трубы',        'prod-pipe-sl'),
    ('route-crcoil',  'Производство х/к оцинкованного рулона','prod-crcoil'),
    ('route-gear',    'Механообработка шестерни',            'prod-gear'),
    ('route-gearbox', 'Литьё и обработка корпуса редуктора', 'prod-gearbox'),
    ('route-shaft',   'Изготовление приводного вала',        'prod-shaft')
  )SQL");

  db.exec(R"SQL(
    INSERT OR IGNORE INTO operations(id,routing_id,code,name,op_type,wc_types,order_no,t_norm,t_opt,t_pess,inputs,outputs) VALUES
    ('route-pipe-sl-10','route-pipe-sl','OP-110','Прошивка гильзы',        'machining','ТПА: прошивной стан',           10, 25, 20, 40, 'Заготовка непрерывнолитая','Гильза трубная'),
    ('route-pipe-sl-20','route-pipe-sl','OP-111','Редуцирование трубы',    'machining','Стан-редуктор (редукционный)',  20, 18, 14, 30, 'Гильза трубная','Труба черновая'),
    ('route-pipe-sl-30','route-pipe-sl','OP-112','Калибровка трубы',       'machining','Калибровочный стан',            30, 15, 12, 26, 'Труба черновая','Труба бесшовная 108×6'),
    ('route-pipe-sl-40','route-pipe-sl','OP-113','УЗК контроль трубы',     'control',  'УЗК-дефектоскоп',               40, 12, 10, 22, 'Труба бесшовная 108×6','Труба бесшовная 108×6'),
    ('route-crcoil-10','route-crcoil','OP-120','Холодная прокатка рулона', 'machining','Обогащение и подготовка',       10, 30, 24, 48, 'Рулон горячекатаный','Рулон холоднокатаный'),
    ('route-crcoil-20','route-crcoil','OP-121','Отжиг рулона',             'heat',     'Отпускная печь',                20, 150, 120, 240, 'Рулон холоднокатаный','Рулон холоднокатаный'),
    ('route-crcoil-30','route-crcoil','OP-122','Горячее оцинкование',      'machining','Линия горячего оцинкования',    30, 22, 18, 38, 'Рулон холоднокатаный','Рулон холоднокатаный'),
    ('route-crcoil-40','route-crcoil','OP-100','Контроль качества',        'control',  'Вспомогательные службы',        40, 20, 20, 20, '',''),
    ('route-gear-10','route-gear','OP-150','Ковка на прессе',              'machining','Ковочный пресс',                10, 30, 24, 55, 'Блюм (заготовка)','Поковка черновая'),
    ('route-gear-20','route-gear','OP-131','Зубофрезерование',             'machining','Зубофрезерный станок',          20, 55, 44, 95, 'Поковка черновая','Шестерня цилиндрическая'),
    ('route-gear-30','route-gear','OP-132','Цементация зубьев',            'heat',     'Печь цементации',               30, 360, 300, 540, 'Шестерня цилиндрическая','Шестерня цилиндрическая'),
    ('route-gear-40','route-gear','OP-133','Шлифование',                   'machining','Круглошлифовальный станок',     40, 28, 22, 50, 'Шестерня цилиндрическая','Шестерня цилиндрическая'),
    ('route-gear-50','route-gear','OP-134','Контроль на КИМ',              'control',  'Координатно-измерительная машина',50, 18, 14, 32, 'Шестерня цилиндрическая','Шестерня цилиндрическая'),
    ('route-gearbox-10','route-gearbox','OP-140','Индукционная плавка',    'heat',     'Индукционная плавильная печь',  10, 70, 55, 120, 'Металлолом','Чугун жидкий'),
    ('route-gearbox-20','route-gearbox','OP-141','Формовка и заливка',     'machining','Формовочная линия',             20, 35, 28, 60, 'Чугун жидкий','Отливка чугунная (черновая)'),
    ('route-gearbox-30','route-gearbox','OP-142','Расточка корпуса',       'machining','Расточной станок',              30, 50, 40, 90, 'Отливка чугунная (черновая)','Корпус редуктора'),
    ('route-gearbox-40','route-gearbox','OP-143','Фрезерование плоскостей','machining','Фрезерный станок с ЧПУ',        40, 38, 30, 68, 'Отливка чугунная (черновая)','Корпус редуктора'),
    ('route-gearbox-50','route-gearbox','OP-100','Контроль качества',      'control',  'Вспомогательные службы',        50, 20, 20, 20, '',''),
    ('route-shaft-10','route-shaft','OP-150','Ковка на прессе',            'machining','Ковочный пресс',                10, 30, 24, 55, 'Блюм (заготовка)','Поковка черновая'),
    ('route-shaft-20','route-shaft','OP-151','Закалка',                    'heat',     'Закалочная печь',               20, 90, 70, 150, 'Поковка черновая','Поковка черновая'),
    ('route-shaft-30','route-shaft','OP-152','Отпуск',                     'heat',     'Отпускная печь',                30, 120, 95, 200, 'Поковка черновая','Поковка черновая'),
    ('route-shaft-40','route-shaft','OP-130','Токарная обработка вала',    'machining','Токарный обрабатывающий центр', 40, 40, 32, 70, 'Поковка черновая','Вал приводной'),
    ('route-shaft-50','route-shaft','OP-134','Контроль на КИМ',            'control',  'Координатно-измерительная машина',50, 18, 14, 32, 'Вал приводной','Вал приводной')
  )SQL");

  db.exec("COMMIT");
}

// ── Демо-посев холдинга (3 завода + центральный склад) ──────────────────────
// Триггер: имя файла проекта (db.path()) содержит подстроку «холдинг», «3-завода»
// ИЛИ «холдинг-3» (регистронезависимо; поиск ведём по строчной копии). Такой
// проект открывается/создаётся через окно входа как обычно, но при ПУСТОЙ
// таблице org_units засевается структура холдинга: 3 завода + склад на мировой
// карте, у каждого завода — цеха на площадке со станками, плюс межзаводские
// «дороги» (flows на верхнем уровне). Всё идемпотентно (INSERT OR IGNORE) и с
// детерминированными id, поэтому повторный вход ничего не дублирует.
static bool holding_trigger(const std::string& dbPath) {
  std::string low = dbPath;
  for (auto& c : low) c = (char)std::tolower((unsigned char)c);
  // Русские подстроки в UTF-8 не трогает tolower(), но байтовый поиск точной
  // подстроки работает и так; латиница уже приведена к нижнему регистру.
  return low.find("холдинг") != std::string::npos ||
         low.find("холдинг-3") != std::string::npos ||
         low.find("3-завода") != std::string::npos;
}

// Засевает холдинг из 3 заводов + центрального склада. Вызывается только когда
// сработал holding_trigger() И org_units пуста (не трогаем существующие проекты).
static void seed_holding(Database& db) {
  // Заводы и склад — на МИРОВОЙ карте (parent_id = NULL), pos_x/pos_z = мировые
  // координаты. Треугольник вокруг начала координат, стороны ~80 ед.
  struct WorldUnit { std::string id, name, kind, unitType; double posX, posZ; };
  const std::vector<WorldUnit> world = {
    {"holding-factory-1", "Завод №1 — Металлургический", "briquettes",   "factory",   0,   -46},
    {"holding-factory-2", "Завод №2 — Трубопрокатный",   "pileizer",     "factory",  40,    23},
    {"holding-factory-3", "Завод №3 — Механосборочный",  "cleaningarea", "factory", -40,    23},
    // Центральный склад — в центроиде треугольника (равноудалён от заводов).
    {"holding-warehouse", "Центральный склад",           "wirehouse",    "warehouse", 0,     0},
  };

  // Цеха каждого завода — на его ПЛОЩАДКЕ (parent_id = <id завода>), pos_x/pos_z =
  // координаты площадки. У каждого цеха свой набор станков (переиспользуем типы РЦ
  // из seed_demo, они уже засеяны демо-посевом при инициализации проекта).
  struct ShopDef { std::string id, name, kind, factoryId; double posX, posZ; };
  struct ShopMach { std::string shopId, machId, name, wctId; double posX, posZ; };
  const std::vector<ShopDef> shops = {
    // Завод №1 — металлургический
    {"holding-shop-1a", "Плавильный цех",        "finecleaning", "holding-factory-1", -10,  -6},
    {"holding-shop-1b", "Литейный цех",          "briquettes",   "holding-factory-1",  10,  -6},
    {"holding-shop-1c", "Склад металлопроката",  "wirehouse",    "holding-factory-1",   0,   8},
    // Завод №2 — трубопрокатный
    {"holding-shop-2a", "Трубопрокатный цех",    "pileizer",     "holding-factory-2", -10,  -6},
    {"holding-shop-2b", "Термический цех",       "dryer",        "holding-factory-2",  10,  -6},
    // Завод №3 — механосборочный
    {"holding-shop-3a", "Механический цех",      "cleaningarea", "holding-factory-3", -10,  -6},
    {"holding-shop-3b", "Сборочный цех",         "marketing",    "holding-factory-3",  10,  -6},
    {"holding-shop-3c", "Цех контроля (ОТК)",    "marketing",    "holding-factory-3",   0,   8},
  };
  const std::vector<ShopMach> machs = {
    {"holding-shop-1a", "holding-mach-1a1", "Доменная печь ДП-2",        "wct-finecleaning", -4, 0},
    {"holding-shop-1a", "holding-mach-1a2", "Конвертер ККЦ-2",           "wct-briquettes",    4, 0},
    {"holding-shop-1b", "holding-mach-1b1", "МНЛЗ №2",                   "wct-pileizer",     -4, 0},
    {"holding-shop-1b", "holding-mach-1b2", "Разливочная машина",        "wct-briquettes",    4, 0},
    {"holding-shop-1c", "holding-mach-1c1", "Склад проката",             "wct-wirehouse",     0, 0},
    {"holding-shop-2a", "holding-mach-2a1", "Трубопрокатный стан ТПА-140","wct-pileizer",    -4, 0},
    {"holding-shop-2a", "holding-mach-2a2", "Стан-редуктор",             "wct-pileizer",      4, 0},
    {"holding-shop-2b", "holding-mach-2b1", "Печь термообработки",       "wct-dryer",        -4, 0},
    {"holding-shop-2b", "holding-mach-2b2", "Правильная машина",         "wct-cleaning",      4, 0},
    {"holding-shop-3a", "holding-mach-3a1", "Токарный обрабатывающий центр","wct-cleaning",  -4, 0},
    {"holding-shop-3a", "holding-mach-3a2", "Фрезерный центр ЧПУ",       "wct-cleaning",      4, 0},
    {"holding-shop-3b", "holding-mach-3b1", "Сборочная линия",           "wct-marketing",    -4, 0},
    {"holding-shop-3b", "holding-mach-3b2", "Стенд испытаний",           "wct-marketing",     4, 0},
    {"holding-shop-3c", "holding-mach-3c1", "Пост контроля (ОТК)",       "wct-marketing",     0, 0},
  };

  // Межзаводские «дороги» на верхнем уровне (parent_id = ''), эндпоинты —
  // 'shop:<org_unit_id>' завода/склада (переиспользуем существующую конвенцию).
  struct RoadDef { std::string from, to; };
  const std::vector<RoadDef> roads = {
    {"holding-warehouse", "holding-factory-1"},
    {"holding-warehouse", "holding-factory-2"},
    {"holding-warehouse", "holding-factory-3"},
    {"holding-factory-1", "holding-factory-2"},
    {"holding-factory-2", "holding-factory-3"},
    {"holding-factory-1", "holding-factory-3"},
  };

  db.exec("BEGIN");

  // Заводы + склад (мировая карта).
  for (auto& u : world)
    db.exec("INSERT OR IGNORE INTO org_units(id,name,parent_id,kind,pos_x,pos_z,unit_type) "
            "VALUES(?,?,NULL,?,?,?,?)",
            {u.id, u.name, u.kind, std::to_string(u.posX), std::to_string(u.posZ), u.unitType});

  // Цеха (площадки заводов).
  for (auto& s : shops)
    db.exec("INSERT OR IGNORE INTO org_units(id,name,parent_id,kind,pos_x,pos_z,unit_type) "
            "VALUES(?,?,?,?,?,?, 'shop')",
            {s.id, s.name, s.factoryId, s.kind, std::to_string(s.posX), std::to_string(s.posZ)});

  // Станки цехов (org_unit_id = id цеха, чтобы площадка была не пустой).
  for (auto& m : machs)
    db.exec("INSERT OR IGNORE INTO machines(id,name,wc_type_id,org_unit_id,status,pos_x,pos_z,rotation_y) "
            "VALUES(?,?,?,?,?,?,?,0)",
            {m.machId, m.name, m.wctId, m.shopId, "active",
             std::to_string(m.posX), std::to_string(m.posZ)});

  // Межзаводские дороги (верхний уровень мира).
  for (auto& r : roads)
    db.exec("INSERT OR IGNORE INTO flows(id,from_id,to_id,parent_id) VALUES(?,?,?,'')",
            {"holding-road-" + r.from + "-" + r.to,
             "shop:" + r.from, "shop:" + r.to});

  db.exec("COMMIT");
  std::cout << "Seeded holding: 3 factories + central warehouse ("
            << world.size() << " world units, " << shops.size() << " shops, "
            << machs.size() << " machines, " << roads.size() << " roads).\n";
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
  // Эта миграция ГРУППИРУЕТ станки демо-завода под 6 цехов верхнего уровня и
  // чистит межстаночные потоки. Для НЕ-демо БД (холдинг и пр.) демо-станков нет —
  // выполнять её нельзя: она бы создала фантомные цеха-станки (shop-*) и удалила
  // мировые дороги холдинга (DELETE ... parent_id=''). Пропускаем тело, но
  // помечаем версию, чтобы миграция не повторялась.
  {
    auto demo = db.query_one("SELECT COUNT(*) AS n FROM machines WHERE id='mach-blastfurnace'");
    if (demo["n"].get<std::string>() == "0") { db.set_user_version(8); return; }
  }
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

// v15: риск-факторы сценария (санкции/налоги/энергия/логистика/ключевая ставка).
static void migrate_v15(Database& db) {
  if (db.user_version() >= 15) return;
  std::cout << "Migrating schema → v15 (риск-факторы сценария)…\n";
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN sanctions  REAL");   // интенсивность 0..1
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN tax_change REAL");   // изм. налогов, п.п.
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN energy     REAL");   // цена энергии, ×
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN logistics  REAL");   // логистика, ×
  db.exec_safe("ALTER TABLE price_scenarios ADD COLUMN key_rate   REAL");   // ключевая ставка, %/год
  db.set_user_version(15);
  std::cout << "Migration v15 done.\n";
}

// v16: модель спроса — ёмкость рынка, эластичность цены, объём конкурентов.
static void migrate_v16(Database& db) {
  if (db.user_version() >= 16) return;
  std::cout << "Migrating schema → v16 (модель спроса: ёмкость рынка/эластичность/конкуренты)…\n";
  db.exec_safe("ALTER TABLE products ADD COLUMN market_capacity   REAL");  // ед., которые рынок выкупает по базе
  db.exec_safe("ALTER TABLE products ADD COLUMN price_elasticity  REAL");  // чувствительность цены к перепроизводству
  db.exec_safe("ALTER TABLE products ADD COLUMN competitor_supply REAL");  // объём конкурентов на рынке
  // Дефолты от demand_max: рынок = 1.2× нашего макс-спроса, конкуренты = 0.5×, эластичность 0.5.
  db.exec_safe("UPDATE products SET market_capacity   = demand_max * 1.2 WHERE (market_capacity   IS NULL OR market_capacity=0)   AND demand_max > 0");
  db.exec_safe("UPDATE products SET competitor_supply = demand_max * 0.5 WHERE (competitor_supply IS NULL OR competitor_supply=0) AND demand_max > 0");
  db.exec_safe("UPDATE products SET price_elasticity  = 0.5 WHERE price_elasticity IS NULL OR price_elasticity=0");
  db.set_user_version(16);
  std::cout << "Migration v16 done.\n";
}

// v17: усиливаем модель спроса, чтобы ПЕРЕпроизводство было невыгодным (внутренний
// оптимум объёма ниже потолка) — тогда objective/доли реально меняют решение.
// Оптимум выручки q* = cap·(1+e)/(2e) − competitor/2. При cap=demand_max, e=1.2,
// competitor=0.4·demand_max → q*≈0.72·demand_max (производить «всё» невыгодно).
static void migrate_v17(Database& db) {
  if (db.user_version() >= 17) return;
  std::cout << "Migrating schema → v17 (усиление модели спроса: внутренний оптимум объёма)…\n";
  db.exec_safe("UPDATE products SET market_capacity   = demand_max       WHERE demand_max > 0");
  db.exec_safe("UPDATE products SET competitor_supply = demand_max * 0.4 WHERE demand_max > 0");
  db.exec_safe("UPDATE products SET price_elasticity  = 1.2              WHERE demand_max > 0");
  db.set_user_version(17);
  std::cout << "Migration v17 done.\n";
}

// v18: КАЛИБРОВКА модели спроса — цена ≈ базовой при типовом (мощностно-ограниченном)
// выпуске ~0.3·demand_max, иначе прежние дефолты вздували цену до +60% (нереалистичная
// маржа/себестоимость). cap=0.8·dm, competitor=0.5·dm, e=0.4 ⇒ при q=0.3dm fill=1 ⇒ mul=1.
static void migrate_v18(Database& db) {
  if (db.user_version() >= 18) return;
  std::cout << "Migrating schema → v18 (калибровка модели спроса)…\n";
  db.exec_safe("UPDATE products SET market_capacity   = demand_max * 0.8 WHERE demand_max > 0");
  db.exec_safe("UPDATE products SET competitor_supply = demand_max * 0.5 WHERE demand_max > 0");
  db.exec_safe("UPDATE products SET price_elasticity  = 0.4              WHERE demand_max > 0");
  db.set_user_version(18);
  std::cout << "Migration v18 done.\n";
}

// v19: техкарты ИНФРАСТРУКТУРЫ — добавляем операции на типы оборуд., которые раньше не
// были задействованы (сырьё/энерго/электро/склад/отгрузка), иначе они вечно «простаивали».
static void migrate_v19(Database& db) {
  if (db.user_version() >= 19) return;
  std::cout << "Migrating schema → v19 (техкарты инфраструктуры)…\n";
  auto addOp = [&](const std::string& rid, const std::string& wc, const std::string& name, int ord, double t) {
    auto ex = db.query_one("SELECT COUNT(*) AS n FROM operations o JOIN operation_wc_types w ON w.operation_id=o.id "
                           "WHERE o.routing_id=? AND w.wc_type_id=?", { rid, wc });
    if (std::stoi(jstr(ex, "n")) > 0) return;                 // идемпотентность
    std::string oid = gen_uuid();
    db.exec("INSERT INTO operations(id,routing_id,code,name,op_type,order_no,t_opt,t_norm,t_pess,risk_coef) "
            "VALUES(?,?,?,?,?,?,?,?,?,0.03)",
            { oid, rid, "SUP", name, "support", std::to_string(ord),
              std::to_string(t * 0.9), std::to_string(t), std::to_string(t * 1.3) });
    db.exec("INSERT INTO operation_wc_types(operation_id,wc_type_id) VALUES(?,?)", { oid, wc });
  };
  // Склад + отгрузка — финальные операции КАЖДОГО товарного изделия.
  for (auto& r : db.query_json("SELECT rt.id AS rid FROM routings rt JOIN products p ON p.id=rt.product_id WHERE p.sellable=1")) {
    const std::string rid = jstr(r, "rid");
    addOp(rid, "wct-wirehouse", "Складирование готовой продукции", 90, 8.0);
    addOp(rid, "wct-sale",      "Отгрузка",                        95, 10.0);
  }
  // Сырьё/энерго/электро — в главную металлургическую цепочку (горячекатаный рулон).
  addOp("route-hrc", "wct-feedstock",   "Приёмка и подготовка сырья",  5, 12.0);
  addOp("route-hrc", "wct-boiler",      "Энергоснабжение (дутьё)",     25, 9.0);
  addOp("route-hrc", "wct-transformer", "Электроснабжение печей",      35, 7.0);
  db.set_user_version(19);
  std::cout << "Migration v19 done.\n";
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

  // Технологические связи «станок→станок», выведенные ИЗ ТЕХКАРТ: между
  // последовательными операциями изделия и между поставщиком BOM-входа и
  // потребителем. Даёт дорожки/дорожки-переходы там, где реально идёт поток по
  // операциям — а не только по вручную нарисованным flows.
  svr.Get("/api/scheme/process_flows", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      // Представитель типа РЦ — первый активный станок этого типа.
      std::unordered_map<std::string, std::string> repMachine;
      for (auto& m : db.query_json(
             "SELECT id, wc_type_id FROM machines WHERE status='active' "
             "AND wc_type_id IS NOT NULL AND wc_type_id<>'' ORDER BY rowid")) {
        const std::string wct = jstr(m, "wc_type_id");
        if (!repMachine.count(wct)) repMachine[wct] = jstr(m, "id");
      }
      // op → ведущий тип РЦ.
      std::unordered_map<std::string, std::string> opWct;
      for (auto& r : db.query_json(
             "SELECT operation_id, wc_type_id FROM operation_wc_types ORDER BY rowid"))
        opWct.emplace(jstr(r, "operation_id"), jstr(r, "wc_type_id"));
      auto opMachine = [&](const std::string& opId) -> std::string {
        auto it = opWct.find(opId); if (it == opWct.end()) return "";
        auto m = repMachine.find(it->second); return m == repMachine.end() ? "" : m->second;
      };
      // Операции изделия по порядку (действующая техкарта); + первый/последний станок.
      std::unordered_map<std::string, std::vector<std::string>> opsOfProduct;  // product → op_ids (по order_no)
      for (auto& o : db.query_json(
             "SELECT o.id AS op_id, r.product_id AS pid FROM routings r "
             "JOIN operations o ON o.routing_id=r.id "
             "WHERE r.product_id IS NOT NULL AND r.product_id<>'' AND COALESCE(r.is_default,1)=1 "
             "ORDER BY r.product_id, o.order_no, o.id"))
        opsOfProduct[jstr(o, "pid")].push_back(jstr(o, "op_id"));
      // Вход операции → изделия (для BOM-связей).
      std::unordered_map<std::string, std::vector<std::string>> inputsOfOp;
      for (auto& r : db.query_json("SELECT operation_id, product_id FROM operation_inputs"))
        inputsOfOp[jstr(r, "operation_id")].push_back(jstr(r, "product_id"));

      std::set<std::pair<std::string,std::string>> edges;
      for (auto& [pid, ops] : opsOfProduct) {
        // Последовательные операции изделия.
        for (size_t k = 0; k + 1 < ops.size(); ++k) {
          std::string a = opMachine(ops[k]), b = opMachine(ops[k + 1]);
          if (!a.empty() && !b.empty() && a != b) edges.insert({ a, b });
        }
        // BOM: последний станок изделия-входа → станок операции-потребителя.
        for (const std::string& op : ops) {
          auto iit = inputsOfOp.find(op); if (iit == inputsOfOp.end()) continue;
          std::string dst = opMachine(op); if (dst.empty()) continue;
          for (const std::string& inp : iit->second) {
            auto sit = opsOfProduct.find(inp);
            if (sit == opsOfProduct.end() || sit->second.empty()) continue;
            std::string src = opMachine(sit->second.back());
            if (!src.empty() && src != dst) edges.insert({ src, dst });
          }
        }
      }
      json arr = json::array();
      for (auto& [a, b] : edges) arr.push_back({ {"from_id", a}, {"to_id", b} });
      ok(res, arr);
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
      // Сценарий + распределения + оверрайды — атомарно (иначе обрыв оставляет
      // сценарий без стохастики, и оптимизация молча берёт фолбэк-нормаль).
      std::lock_guard<std::recursive_mutex> lk(db.mutex());
      db.exec("BEGIN");
      try {
      db.exec("INSERT INTO price_scenarios(id,name,description,horizon_hours,market_corr,objective,alpha,max_share,"
              "mode,inflation,fx,demand,volatility,months,plan_id,start_date,end_date,"
              "sanctions,tax_change,energy,logistics,key_rate) "
              "VALUES(?,?,?,?,?,?,?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),"
              "NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),"
              "NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''))",
              { id, jstr(body,"name"), jstr(body,"description"),
                jstr(body,"horizon_hours").empty() ? "720" : jstr(body,"horizon_hours"),
                jstr(body,"market_corr").empty() ? "0.5" : jstr(body,"market_corr"),
                jstr(body,"objective").empty() ? "cvar" : jstr(body,"objective"),
                jstr(body,"alpha").empty() ? "0.1" : jstr(body,"alpha"),
                jstr(body,"max_share").empty() ? "0.6" : jstr(body,"max_share"),
                jstr(body,"mode").empty() ? "stochastic" : jstr(body,"mode"),
                jstr(body,"inflation"), jstr(body,"fx"), jstr(body,"demand"),
                jstr(body,"volatility"), jstr(body,"months"),
                jstr(body,"plan_id"), jstr(body,"start_date"), jstr(body,"end_date"),
                jstr(body,"sanctions"), jstr(body,"tax_change"), jstr(body,"energy"),
                jstr(body,"logistics"), jstr(body,"key_rate") });
      writeDists(id, body);
      writeOverrides(id, body);
      db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
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
      std::lock_guard<std::recursive_mutex> lk(db.mutex());   // строка + dists/overrides атомарно
      db.exec("BEGIN");
      try {
      db.exec("UPDATE price_scenarios SET name=?, description=?, horizon_hours=?, market_corr=?, "
              "objective=?, alpha=?, max_share=?, "
              "mode=COALESCE(NULLIF(?,''),mode), inflation=COALESCE(NULLIF(?,''),inflation), "
              "fx=COALESCE(NULLIF(?,''),fx), demand=COALESCE(NULLIF(?,''),demand), "
              "volatility=COALESCE(NULLIF(?,''),volatility), months=COALESCE(NULLIF(?,''),months), "
              "plan_id=COALESCE(NULLIF(?,''),plan_id), start_date=COALESCE(NULLIF(?,''),start_date), "
              "end_date=COALESCE(NULLIF(?,''),end_date), "
              "sanctions=COALESCE(NULLIF(?,''),sanctions), tax_change=COALESCE(NULLIF(?,''),tax_change), "
              "energy=COALESCE(NULLIF(?,''),energy), logistics=COALESCE(NULLIF(?,''),logistics), "
              "key_rate=COALESCE(NULLIF(?,''),key_rate) WHERE id=?",
              { jstr(body,"name"), jstr(body,"description"),
                jstr(body,"horizon_hours").empty() ? "720" : jstr(body,"horizon_hours"),
                jstr(body,"market_corr").empty() ? "0.5" : jstr(body,"market_corr"),
                jstr(body,"objective").empty() ? "cvar" : jstr(body,"objective"),
                jstr(body,"alpha").empty() ? "0.1" : jstr(body,"alpha"),
                jstr(body,"max_share").empty() ? "0.6" : jstr(body,"max_share"),
                jstr(body,"mode"), jstr(body,"inflation"), jstr(body,"fx"),
                jstr(body,"demand"), jstr(body,"volatility"), jstr(body,"months"),
                jstr(body,"plan_id"), jstr(body,"start_date"), jstr(body,"end_date"),
                jstr(body,"sanctions"), jstr(body,"tax_change"), jstr(body,"energy"),
                jstr(body,"logistics"), jstr(body,"key_rate"), id });
      writeDists(id, body);
      writeOverrides(id, body);
      db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
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
      std::lock_guard<std::recursive_mutex> lk(db.mutex());   // копия из 3 INSERT — атомарно
      db.exec("BEGIN");
      try {
      db.exec("INSERT INTO price_scenarios"
              "(id,name,description,horizon_hours,market_corr,objective,alpha,max_share,mode,inflation,fx,demand,volatility,months,"
              "plan_id,start_date,end_date,sanctions,tax_change,energy,logistics,key_rate) "
              "SELECT ?, name || ' (копия)', description, horizon_hours, market_corr, objective, alpha, max_share,"
              "mode, inflation, fx, demand, volatility, months, plan_id, start_date, end_date,"
              "sanctions, tax_change, energy, logistics, key_rate "
              "FROM price_scenarios WHERE id=?", { nid, src });
      db.exec("INSERT INTO price_distributions"
              "(id,scenario_id,product_id,dist_type,mean,stddev,min_val,max_val,mode_val,beta) "
              "SELECT lower(hex(randomblob(8))), ?, product_id, dist_type, mean, stddev, min_val, max_val, mode_val, beta "
              "FROM price_distributions WHERE scenario_id=?", { nid, src });
      db.exec("INSERT INTO scenario_overrides(id,scenario_id,product_id,base_price,base_cost) "
              "SELECT lower(hex(randomblob(8))), ?, product_id, base_price, base_cost "
              "FROM scenario_overrides WHERE scenario_id=?", { nid, src });
      db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
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
          "VALUES(?,NULLIF(?,''),?,?,?,?,?,?,?)",   // пустой scenario_id → NULL (иначе нарушение FK)
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

// EMD (Empirical Mode Decomposition) с линейными огибающими: сифтингом извлекаем
// до 5 IMF (внутренних мод), возвращаем ОСТАТОК = данные-адаптивный тренд. Тогда
// res = ряд − тренд = сумма IMF (колебания) — их и продолжаем гармониками в прогнозе.
static std::vector<double> emd_trend(const std::vector<double>& y) {
  const int n = (int)y.size();
  std::vector<double> residue = y;
  auto interpEnv = [n](const std::vector<int>& idx, const std::vector<double>& val) {
    std::vector<double> env(n, 0.0);
    if (idx.empty()) return env;
    for (int t = 0; t < n; ++t) {
      if (t <= idx.front()) { env[t] = val.front(); continue; }
      if (t >= idx.back())  { env[t] = val.back();  continue; }
      int k = 0; while (k + 1 < (int)idx.size() && idx[k + 1] <= t) ++k;
      const double x0 = idx[k], x1 = idx[k + 1];
      env[t] = val[k] + (val[k + 1] - val[k]) * (t - x0) / (x1 - x0);
    }
    return env;
  };
  for (int imf = 0; imf < 5; ++imf) {
    std::vector<double> h = residue;
    int extrema = 0;
    for (int t = 1; t < n - 1; ++t)
      if ((h[t] > h[t - 1] && h[t] > h[t + 1]) || (h[t] < h[t - 1] && h[t] < h[t + 1])) ++extrema;
    if (extrema < 4) break;                       // остаток монотонен → это тренд
    for (int sift = 0; sift < 10; ++sift) {
      std::vector<int> mxi, mni; std::vector<double> mxv, mnv;
      for (int t = 1; t < n - 1; ++t) {
        if (h[t] > h[t - 1] && h[t] >= h[t + 1]) { mxi.push_back(t); mxv.push_back(h[t]); }
        if (h[t] < h[t - 1] && h[t] <= h[t + 1]) { mni.push_back(t); mnv.push_back(h[t]); }
      }
      if ((int)mxi.size() < 2 || (int)mni.size() < 2) break;
      const auto up = interpEnv(mxi, mxv), lo = interpEnv(mni, mnv);
      double sd = 0, norm = 0;
      for (int t = 0; t < n; ++t) { const double prev = h[t]; h[t] = prev - (up[t] + lo[t]) / 2; sd += (prev - h[t]) * (prev - h[t]); norm += prev * prev; }
      if (norm > 0 && sd / norm < 0.05) break;     // критерий остановки сифтинга
    }
    for (int t = 0; t < n; ++t) residue[t] -= h[t];
  }
  return residue;
}

/* ── Стадия E+: внешние условия и динамика цен по времени ─────────────────────
 * Прогноз цен изделий/сырья: тренд (EMD) + гармоники (SD) + случайный остаток. */
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
      // Риск-факторы сценария (по умолчанию нейтральны; перекрываются из сценария ниже).
      double sanctions = 0.0, taxChange = 0.0, energy = 1.0, logistics = 1.0, keyRate = 8.0;
      int runs     = std::max(200, std::min(20000, (int)getd("runs", 3000)));
      unsigned seed = (unsigned)getd("seed", 42);
      // Бэктест: прогноз по истории без последних k месяцев против факта.
      const int btK = std::max(0, std::min(12, (int)getd("backtest", 0)));

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
          sanctions = std::max(0.0, std::min(1.0, scd("sanctions", sanctions)));
          taxChange = scd("tax_change", taxChange);
          energy    = std::max(0.1, scd("energy", energy));
          logistics = std::max(0.1, scd("logistics", logistics));
          keyRate   = scd("key_rate", keyRate);
        } catch (...) {}
      }
      const bool deterministic = (mode == "deterministic");   // точечный прогноз (без разброса)

      // Риск-факторы → понятные макро-связи: дрейф, волатильность, уровень цен (cost-push).
      // Коэффициенты усилены, чтобы движение ползунков давало ЗАМЕТНЫЙ эффект на прогноз.
      const double riskDrift = 0.012 * sanctions - 0.0018 * (keyRate - 8.0);      // мес. лог-дрейф
      vol *= (1.0 + 1.6 * sanctions);                                             // санкции = неопределённость
      const double riskMacro = (1.0 + 1.0 * taxChange / 100.0)                    // налоги (полный passthrough)
                             * std::pow(energy, 0.32) * std::pow(logistics, 0.18); // энергия/логистика

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
      // Распределение цены из сценария → ФОРМА веера прогноза (тип + относит. разброс),
      // перекрывает авто-подбор по AIC. Иначе настройка распределения не влияла на график.
      std::unordered_map<std::string, std::pair<std::string, double>> fcDist;   // pid → (тип, отн.СКО)
      if (!scenarioId.empty()) {
        for (auto& dd : db.query_json(
               "SELECT product_id,dist_type,mean,stddev FROM price_distributions WHERE scenario_id=?", { scenarioId })) {
          const std::string opid = jstr(dd, "product_id"), dt = jstr(dd, "dist_type");
          const double mn = jstr(dd, "mean").empty() ? 0 : std::stod(jstr(dd, "mean"));
          const double sd = jstr(dd, "stddev").empty() ? 0 : std::stod(jstr(dd, "stddev"));
          if (!opid.empty() && !dt.empty() && mn > 0 && sd > 0)
            fcDist[opid] = { dt, std::max(0.005, std::min(0.6, sd / mn)) };
        }
      }

      auto rows = db.query_json(
        "SELECT id,name,base_price,base_cost,sellable,purchased FROM products "
        "WHERE sellable=1 OR purchased=1 ORDER BY sellable DESC, name");

      std::mt19937 rng(seed);
      std::normal_distribution<double> nd(0.0, 1.0);
      const double beta = std::sqrt(corr);   // дефолтная загрузка на общий фактор (нет данных)
      const double driftStep = std::log(1.0 + infl) + riskDrift;

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
                                double extraDrift, double macroMul, double loading,
                                const std::string& ovrType, double ovrRelSd) -> json {
        // Загрузка изделия на общий рыночный фактор (data-driven, из PCA-разложения корреляций).
        const double betaP = std::max(-0.999, std::min(0.999, loading));
        const double idioP = std::sqrt(std::max(0.0, 1.0 - betaP * betaP));
        std::vector<double> ly;
        for (double v : vals) if (v > 0) ly.push_back(std::log(v));
        const int Hn = (int)ly.size();
        const bool dd = Hn >= 5;

        // 1) ТРЕНД через EMD (данные-адаптивный остаток, следует форме ряда);
        //    res = ряд − тренд = сумма IMF (колебания). Наклон вперёд — МНК по тренду.
        double slp = 0.0;
        std::vector<double> res;
        if (dd) {
          const std::vector<double> trendVec = emd_trend(ly);
          for (int t = 0; t < Hn; ++t) res.push_back(ly[t] - trendVec[t]);
          double n = Hn, st = 0, sy = 0, stt = 0, sty = 0;
          for (int t = 0; t < Hn; ++t) { st += t; sy += trendVec[t]; stt += (double)t * t; sty += (double)t * trendVec[t]; }
          const double den = n * stt - st * st;
          slp = den != 0 ? (n * sty - st * sy) / den : 0.0;
        }

        // 1b) ГАРМОНИКИ (System Dynamics / EMD-подобное разложение): топ-3 синусоиды
        //     де-трендового ряда — их продолжаем в прогнозе (колебания), а распределение
        //     потом фитим к ОСТАВШЕМУСЯ нерегулярному остатку.
        std::vector<std::array<double, 3>> harm;   // {omega, A, B}
        if (dd) {
          std::vector<std::array<double, 3>> cand;
          // Кандидаты периодов: сезонные (12/6/3 мес) + промежуточные; фильтр по длине ряда.
          for (int P : { 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 24 }) {
            if (P > Hn / 2) continue;
            const double w = 2 * M_PI / P;
            double A = 0, B = 0;
            for (int t = 0; t < Hn; ++t) { A += res[t] * std::cos(w * t); B += res[t] * std::sin(w * t); }
            A *= 2.0 / Hn; B *= 2.0 / Hn;
            cand.push_back({ w, A, B });
          }
          std::sort(cand.begin(), cand.end(), [](const std::array<double, 3>& x, const std::array<double, 3>& y) {
            return x[1] * x[1] + x[2] * x[2] > y[1] * y[1] + y[2] * y[2];
          });
          // Число гармоник строго ограничено длиной ряда: на коротких историях
          // (< 16 точек) гармоники НЕ фитим вовсе — прежний минимум «3 гармоники»
          // (6 параметров) на 8-12 точках был переобучением, и осцилляции
          // in-sample шума экстраполировались в прогноз.
          const int K = Hn >= 24 ? std::min(3, Hn / 12) : (Hn >= 16 ? 1 : 0);
          for (int i = 0; i < (int)cand.size() && i < K; ++i) harm.push_back(cand[i]);
          for (int t = 0; t < Hn; ++t) {
            double h = 0; for (auto& c : harm) h += c[1] * std::cos(c[0] * t) + c[2] * std::sin(c[0] * t);
            res[t] -= h;
          }
        }
        auto harmAt = [&](double t) { double h = 0; for (auto& c : harm) h += c[1] * std::cos(c[0] * t) + c[2] * std::sin(c[0] * t); return h; };
        const double hNow = harmAt(dd ? (Hn - 1) : 0);

        // 2) РАСПРЕДЕЛЕНИЕ нерегулярного остатка по AIC. Базовая ширина 6%/мес — ниже
        //    масштабируется ползунком волатильности (см. volMul), при наличии истории σ из неё.
        constexpr double VOL_REF = 0.06;
        double mu = 0, sg = VOL_REF, aicN = 0, aicL = 0, aicT = 0, aicS = 0;
        std::string dist = "normal"; double lapB = VOL_REF / std::sqrt(2.0);
        double tNu = 40.0, tScale = VOL_REF, sAlpha = 2.0, sGamma = VOL_REF;
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
          // k=3 (μ + сеточные α, γ) — раньше 4−2ll недоштрафовывал stable на 2 ед. AIC.
          aicS = 6 - 2 * bestSLL;
          if (aicS < bestAic) { dist = "stable"; bestAic = aicS; }
        }

        // ВОЛАТИЛЬНОСТЬ (ползунок) = МУЛЬТИПЛИКАТОР подобранного распределения относительно
        // базовых 6%/мес. Раньше σ бралась только из истории и ползунок не влиял.
        const double volMul = std::max(0.2, std::min(6.0, vol / VOL_REF));
        sg *= volMul; lapB *= volMul; tScale *= volMul; sGamma *= volMul;

        // ПЕРЕОПРЕДЕЛЕНИЕ из настройки распределения сценария: тип задаёт ФОРМУ хвостов,
        // ovrRelSd — относит. разброс. Иначе настройка распределения не влияла на прогноз.
        if (!ovrType.empty() && ovrRelSd > 0) {
          const double s = ovrRelSd * volMul;
          if (ovrType == "t")            { dist = "t";      tScale = s; tNu = 5.0; }
          else if (ovrType == "pareto")  { dist = "stable"; sGamma = s; sAlpha = 1.6; }   // тяж. степ. хвост
          else if (ovrType == "lognormal") { dist = "normal"; sg = s; }
          else                             { dist = "normal"; sg = s; }                    // normal/uniform/triangular
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
          double cum = 0;   // НАКОПЛЕННЫЕ инновации: лог-цена — случайное блуждание
          for (int t = 1; t <= months; ++t) {
            double innov = 0;
            if (!deterministic) {
              const double z = betaP * M[r][t] + idioP * nd(rng);
              if (dist == "laplace")   innov = lapQ(Phi(z), lapB);
              else if (dist == "t")    innov = tScale * z / std::sqrt(gdist(rng) / tNu);
              else if (dist == "stable") {
                const double U = ud(rng), W = ed(rng);
                innov = sGamma * std::sin(sAlpha * U) / std::pow(std::cos(U), 1.0 / sAlpha)
                      * std::pow(std::cos((1 - sAlpha) * U) / W, (1 - sAlpha) / sAlpha);
              } else                   innov = sg * z;
            }
            // Random walk с дрейфом: месячные инновации СУММИРУЮТСЯ, веер растёт ~σ√t.
            // Раньше innov рисовался заново без накопления (stationary) — ширина
            // веера не зависела от горизонта, что занижало риск дальних месяцев.
            cum += innov;
            px[t][r] = std::exp(anchor + slopeFwd * t + (harmAt(Hn - 1 + t) - hNow) + cum) * macroMul;  // тренд + гармоники + Σостатков
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

        // Разложение прогноза median на горизонте: base × Πфакторов. Мультипликативно
        // (в лог-масштабе — слагаемые slopeFwd·t и ln(macroMul)), показываем как %-вклад:
        // историческая динамика ряда, инфляция, риск-дрейф (санкции/ставка), курс, спрос,
        // макро-множитель (энергия/логистика/налоги). Произведение (1+вклад) = итог/база.
        auto pctOf = [](double mult) { return mult - 1.0; };
        json contrib = {
          {"hist_trend", pctOf(std::exp(slp * months))},
          {"inflation",  pctOf(std::exp(std::log(1.0 + infl) * months))},
          {"risk_drift", pctOf(std::exp(riskDrift * months))},
          {"fx",         pctOf(fx)},
          {"demand",     pctOf(demand)},
          {"macro",      pctOf(riskMacro)},
          {"total",      p50.empty() ? 0.0 : (p50.back().get<double>() / std::max(1e-9, base) - 1.0)},
        };

        return json{
          {"base", base}, {"history", history}, {"trend", trend}, {"contrib", contrib},
          {"p10", p10}, {"p50", p50}, {"p90", p90}, {"mean", mean},
          {"fit", { {"data_driven", dd}, {"dist", dist}, {"n_obs", (int)res.size()},
                    {"mu", mu}, {"sigma", sg}, {"nu", tNu}, {"alpha", sAlpha},
                    {"trend_slope", slp}, {"residual", true},
                    {"aic_normal", aicN}, {"aic_laplace", aicL}, {"aic_t", aicT}, {"aic_stable", aicS} }},
        };
      };

      // Истории цен ВСЕХ изделий одним запросом (раньше ts_data читался дважды
      // на изделие: в PCA-блоке и в основном цикле прогноза).
      std::unordered_map<std::string, std::vector<double>> histCache;   // "pid|kind" → значения
      for (auto& row : db.query_json(
             "SELECT product_id, kind, value FROM ts_data ORDER BY month_idx"))
        histCache[jstr(row, "product_id") + "|" + jstr(row, "kind")].push_back(numOf(row));

      // DATA-DRIVEN ВЗАИМОСВЯЗИ (МГК/PCA): однофакторная модель из эмпирической корреляции
      // лог-доходностей историй. PC1 даёт ПЕР-ИЗДЕЛЬНЫЕ загрузки (кто с кем движется и знак),
      // market_corr — общая сила. Заменяет единый β=√corr для всех на структуру ИЗ ДАННЫХ.
      std::unordered_map<std::string, double> loadings;
      {
        std::vector<std::string> ids;
        std::vector<std::vector<double>> rets;
        for (auto& p : rows) {
          const std::string kind = jstr(p, "sellable") == "1" ? "price" : "cost";
          const auto& h = histCache[jstr(p, "id") + "|" + kind];
          std::vector<double> lv; for (double x : h) if (x > 0) lv.push_back(std::log(x));
          std::vector<double> r; for (size_t t = 1; t < lv.size(); ++t) r.push_back(lv[t] - lv[t - 1]);
          if ((int)r.size() >= 3) { ids.push_back(jstr(p, "id")); rets.push_back(std::move(r)); }
        }
        const int P = (int)ids.size();
        int L = P ? (int)rets[0].size() : 0;
        for (auto& r : rets) L = std::min(L, (int)r.size());
        if (P >= 2 && L >= 3) {
          std::vector<std::vector<double>> Z(P, std::vector<double>(L, 0.0));   // стандартизованные хвосты
          for (int i = 0; i < P; ++i) {
            const auto& r = rets[i]; const int off = (int)r.size() - L;
            double m = 0; for (int t = 0; t < L; ++t) m += r[off + t]; m /= L;
            double s = 0; for (int t = 0; t < L; ++t) s += (r[off + t] - m) * (r[off + t] - m);
            s = std::sqrt(s / std::max(1, L - 1)); if (s < 1e-9) s = 1.0;
            for (int t = 0; t < L; ++t) Z[i][t] = (r[off + t] - m) / s;
          }
          std::vector<std::vector<double>> C(P, std::vector<double>(P, 0.0));   // корреляц. матрица
          for (int i = 0; i < P; ++i)
            for (int j = i; j < P; ++j) {
              double s = 0; for (int t = 0; t < L; ++t) s += Z[i][t] * Z[j][t];
              C[i][j] = C[j][i] = s / std::max(1, L - 1);
            }
          std::vector<double> u(P, 1.0 / std::sqrt((double)P));                 // PC1 степенным методом
          for (int it = 0; it < 100; ++it) {
            std::vector<double> w(P, 0.0);
            for (int i = 0; i < P; ++i) { double s = 0; for (int j = 0; j < P; ++j) s += C[i][j] * u[j]; w[i] = s; }
            double nrm = 0; for (double x : w) nrm += x * x; nrm = std::sqrt(nrm);
            if (nrm < 1e-12) break;
            for (int i = 0; i < P; ++i) u[i] = w[i] / nrm;
          }
          double umax = 1e-6; for (double x : u) umax = std::max(umax, std::fabs(x));
          const double strength = std::sqrt(corr);                              // market_corr = общая сила
          for (int i = 0; i < P; ++i) loadings[ids[i]] = strength * u[i] / umax; // corr(i,j)=corr·u_i·u_j/umax²
        }
      }

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

        const std::vector<double>& vals = histCache[pid + "|" + kind];

        const double loading = loadings.count(pid) ? loadings[pid] : beta;
        const std::string ovrT = fcDist.count(pid) ? fcDist[pid].first : "";
        const double ovrSd = fcDist.count(pid) ? fcDist[pid].second : 0.0;
        json j = fanFromHistory(base, vals, driftStep, fx * demand * riskMacro, loading, ovrT, ovrSd);
        j["id"] = pid; j["name"] = jstr(p, "name"); j["role"] = sellable ? "product" : "raw";
        j["loading"] = loading;

        // ── Бэктест (rolling origin, один срез): прогноз по укороченной истории
        // против факта — MAPE по P50, pinball-loss по P10/P90, покрытие 80%-интервала,
        // и НАИВНЫЙ бенчмарк (последнее значение). Урок M-соревнований: сложная
        // модель обязана доказывать превосходство над наивной (skill < 1).
        if (btK > 0 && (int)vals.size() >= btK + 8) {
          const int Hn2 = (int)vals.size();
          std::vector<double> trunc(vals.begin(), vals.end() - btK);
          const double baseBt = trunc.back();
          if (baseBt > 0) {
            json bt = fanFromHistory(baseBt, trunc, driftStep, 1.0, loading, "", 0.0);
            double sm = 0, smN = 0, pb10 = 0, pb90 = 0; int cover = 0, cnt = 0;
            for (int h = 1; h <= btK; ++h) {
              const double a = vals[Hn2 - btK - 1 + h];
              if (a <= 0) continue;
              const double q50 = bt["p50"][h].get<double>();
              const double q10 = bt["p10"][h].get<double>();
              const double q90 = bt["p90"][h].get<double>();
              sm  += std::fabs(a - q50) / a;
              smN += std::fabs(a - baseBt) / a;                    // naive last value
              pb10 += std::max(0.10 * (a - q10), 0.90 * (q10 - a));
              pb90 += std::max(0.90 * (a - q90), 0.10 * (q90 - a));
              if (a >= q10 && a <= q90) ++cover;
              ++cnt;
            }
            if (cnt > 0) {
              const double mape = sm / cnt * 100.0, mapeN = smN / cnt * 100.0;
              j["backtest"] = {
                {"k", btK}, {"mape", mape}, {"mape_naive", mapeN},
                {"skill", mapeN > 1e-9 ? mape / mapeN : 1.0},      // <1 — лучше наивного
                {"pinball10", pb10 / cnt}, {"pinball90", pb90 / cnt},
                {"coverage80", (double)cover / cnt},
              };
            }
          }
        }
        products.push_back(j);
      }

      // Прогноз КЛЮЧЕВОЙ СТАВКИ тем же движком (канон: ставка и цены — единообразно).
      json rateJson = nullptr;
      {
        auto rh = db.query_json("SELECT value FROM macro_ts WHERE series='keyrate' ORDER BY month_idx");
        std::vector<double> rv; for (auto& row : rh) rv.push_back(numOf(row));
        if (rv.size() >= 5 && rv.back() > 0) {
          json j = fanFromHistory(rv.back(), rv, 0.0, 1.0, beta, "", 0.0);   // ставка: чистый исторический дрейф
          j["id"] = "keyrate"; j["name"] = "Ключевая ставка"; j["role"] = "rate";
          rateJson = j;
        }
      }

      json inflIdx = json::array();
      for (int t = 0; t <= months; ++t) inflIdx.push_back(std::pow(1.0 + infl, t) * 100.0);

      ok(res, {
        {"months", months}, {"inflation_monthly", infl}, {"fx", fx}, {"demand", demand},
        {"volatility", vol}, {"corr", corr}, {"mode", mode}, {"scenario_id", scenarioId},
        {"sanctions", sanctions}, {"tax_change", taxChange}, {"energy", energy},
        {"logistics", logistics}, {"key_rate", keyRate}, {"risk_macro", riskMacro},
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
      if (body.contains("volatility") && !jstr(body,"volatility").empty())
        pr.volatility = std::stod(jstr(body, "volatility"));
      if (body.contains("horizon_hours") && !jstr(body,"horizon_hours").empty())
        pr.horizonHours = std::stod(jstr(body, "horizon_hours"));
      if (body.contains("demand") && !jstr(body,"demand").empty())
        pr.demand = std::stod(jstr(body, "demand"));
      // Точная модель CVaR (HiGHS) рядом с эвристикой: compare_exact=true → объект "exact".
      if (body.contains("compare_exact")) {
        const std::string v = jstr(body, "compare_exact");
        pr.compareExact = (v == "true" || v == "1");
      }
      if (body.contains("exact_criterion")) pr.exactCriterion = jstr(body, "exact_criterion");
      if (body.contains("exact_segments") && !jstr(body,"exact_segments").empty())
        pr.exactSegments = (int)std::stod(jstr(body, "exact_segments"));

      // Сценарий несёт цель оптимизации (Стадия E): берём из него, если не задано в запросе.
      if (!pr.scenarioId.empty()) {
        try {
          auto sc = db.query_one("SELECT objective,alpha,max_share,volatility,demand FROM price_scenarios WHERE id=?", { pr.scenarioId });
          if (!body.contains("objective") && !jstr(sc,"objective").empty()) pr.objective = jstr(sc,"objective");
          if (!body.contains("alpha")     && !jstr(sc,"alpha").empty())     pr.alpha     = std::stod(jstr(sc,"alpha"));
          if (!body.contains("max_share") && !jstr(sc,"max_share").empty()) pr.maxShare  = std::stod(jstr(sc,"max_share"));
          if (!body.contains("volatility") && !jstr(sc,"volatility").empty()) pr.volatility = std::stod(jstr(sc,"volatility"));
          if (!body.contains("demand") && !jstr(sc,"demand").empty()) pr.demand = std::stod(jstr(sc,"demand"));
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

  // Сохранить устойчивое решение как именованный производственный план (виден в «Планах»).
  svr.Post("/api/optimize/save-plan", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = req.body.empty() ? json::object() : json::parse(req.body);
      const std::string runId = jstr(body, "run_id");
      std::string name = jstr(body, "plan_name");
      if (runId.empty()) { err(res, 400, "run_id required"); return; }
      if (name.empty()) name = "План из оптимизации";
      auto row = db.query_one("SELECT result_json,scenario_id FROM optimization_runs WHERE id=?", { runId });
      json result = json::parse(jstr(row, "result_json"));
      const json& robust = result.value("robust", json::object());

      // Горизонт плана = ГОРИЗОНТ ПРОГОНА (тот же, что задавал ёмкость/объёмы оптимизации),
      // а не фикс. 720ч. Берём из result_json (horizon_hours), затем сценарий, затем дефолт.
      double planHours = result.value("horizon_hours", 0.0);
      if (planHours <= 0) {
        int months = 12;
        const std::string scId = jstr(row, "scenario_id");
        if (!scId.empty()) {
          try {
            auto sc = db.query_one("SELECT months FROM price_scenarios WHERE id=?", { scId });
            if (!jstr(sc, "months").empty()) months = std::max(1, std::min(36, (int)std::stod(jstr(sc, "months"))));
          } catch (...) {}
        }
        planHours = months * 720.0;
      }
      if (body.contains("horizon_months") && !jstr(body, "horizon_months").empty())
        planHours = std::max(1.0, std::min(36.0, std::stod(jstr(body, "horizon_months")))) * 720.0;
      const int months = std::max(1, (int)std::lround(planHours / 720.0));
      const std::string dueStr = std::to_string(planHours);

      const std::string planId = gen_uuid();
      int n = 0;
      {
        // План + заказы — атомарно: обрыв посередине оставлял план с частью заказов.
        std::lock_guard<std::recursive_mutex> lk(db.mutex());
        db.exec("BEGIN");
        try {
          db.exec("INSERT INTO production_plans(id,name,description) VALUES(?,?,?)",
                  { planId, name, "Устойчивый портфель оптимизации, горизонт " + std::to_string(months) + " мес (run " + runId + ")" });
          for (auto& it : robust.value("items", json::array())) {
            const std::string pid = it.value("product_id", std::string());
            const double qty = it.value("qty", 0.0);
            if (pid.empty() || qty <= 0) continue;
            db.exec("INSERT INTO demand_orders(id,plan_id,product_id,quantity,due_hours,priority,status) "
                    "VALUES(?,?,?,?,?,?,'planned')",
                    { gen_uuid(), planId, pid, std::to_string(qty), dueStr, "5" });
            ++n;
          }
          db.exec("COMMIT");
        } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
      }
      audit(db, "production_plan", planId, "CREATE", { {"from_run", runId}, {"orders", n} });
      ok(res, { {"id", planId}, {"name", name}, {"orders", n} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Стадия 1: расписание (план исполнения) ──────────────────────────────── */

static void persist_schedule(Database& db, const std::string& planId, const json& result) {
  // Сохраняем полный KPI-блок плана (+ загрузка по типам, узкое место, очереди) —
  // чтобы «Аналитика» показывала все показатели без пересчёта расписания.
  json bundle = {
    {"kpi", result.value("kpi", json::object())},
    {"wc_load", result.value("wc_load", json::array())},
    {"machine_load", result.value("machine_load", json::array())},
    {"bottleneck", result.value("bottleneck", json::object())},
    {"queue_by_wc", result.value("queue_by_wc", json::array())},
  };
  db.exec("INSERT INTO plans(id,run_id,kpi_json) VALUES(?,NULLIF(?,''),?)",
          { planId, "", bundle.dump() });
  for (auto& g : result.value("gantt", json::array())) {
    // supply-джобы («Поставка сырья») не ссылаются на реальные записи НСИ, а пустые
    // FK должны быть NULL, не '' — иначе транзакция падала по FK (SQLITE_CONSTRAINT)
    // и план не сохранялся вовсе (симуляции нечего было проигрывать).
    const std::string mid = g.value("machine_id", std::string());
    if (mid.empty() || mid == "supply") continue;
    // load_hours = ПРОДУКТИВНОЕ время задачи (обработка, без наладки и ТО/ремонта) —
    // для единой загрузки в /simulation/results (B9).
    db.exec("INSERT INTO plan_tasks(id,plan_id,product_id,operation_id,wc_type_id,machine_id,"
            "worker_id,start_min,end_min,order_idx,qty,load_hours) "
            "VALUES(?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,?,?,?,?)",
            { gen_uuid(), planId, g.value("product_id", std::string()),
              g.value("op_id", std::string()), g.value("wc_type_id", std::string()),
              mid, g.value("worker_id", std::string()),
              std::to_string(g.value("start", 0.0) * 60.0), std::to_string(g.value("end", 0.0) * 60.0),
              std::to_string(g.value("order_idx", 0)),
              std::to_string(g.value("batches", 1.0)),        // партий в джобе
              std::to_string(g.value("proc_hours", 0.0)) });
  }
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
      if (body.contains("improve_iters") && !jstr(body, "improve_iters").empty())
        sp.improveIters = (int)std::stod(jstr(body, "improve_iters"));
      // Конструктор эвристики: custom_rule = [{criterion, weight}, …]
      if (body.contains("custom_rule") && body["custom_rule"].is_array())
        for (auto& c : body["custom_rule"]) {
          const std::string cn = jstr(c, "criterion");
          double w = 0; try { w = std::stod(jstr(c, "weight")); } catch (...) {}
          if (!cn.empty() && w != 0) sp.customRule.push_back({ cn, w });
        }
      // Ручные правки Ганта (drag&drop): [{job_idx, start_hours, machine_id?}, …]
      if (body.contains("pins") && body["pins"].is_array())
        for (auto& pn : body["pins"]) {
          maos::SchedPin sp2;
          sp2.jobIdx = pn.contains("job_idx") ? (int)std::stod(jstr(pn, "job_idx")) : -1;
          sp2.startHours = pn.contains("start_hours") ? std::stod(jstr(pn, "start_hours")) : 0;
          sp2.machineId = jstr(pn, "machine_id");
          if (sp2.jobIdx >= 0) sp.pins.push_back(sp2);
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

      // Программа: из тела / из реестра заказов (с due — для time-phased дат).
      struct PLine { std::string pid; double qty = 1, due = 0; };
      std::vector<PLine> program;
      if (body.contains("program") && body["program"].is_array())
        for (auto& o : body["program"])
          program.push_back({ jstr(o,"product_id"),
                              o.contains("qty") ? std::stod(jstr(o,"qty")) : 1,
                              o.contains("due_hours") && !jstr(o,"due_hours").empty()
                                ? std::stod(jstr(o,"due_hours")) : 0 });
      if (program.empty())
        for (auto& r : db.query_json(
               "SELECT product_id,quantity,due_hours FROM demand_orders WHERE status<>'done'"))
          program.push_back({ jstr(r,"product_id"), std::stod(jstr(r,"quantity")),
                              jstr(r,"due_hours").empty() ? 0 : std::stod(jstr(r,"due_hours")) });

      // BOM целиком двумя запросами (было N+1 по каждому уровню):
      // parent → [(child, qty)] через routings → operations → operation_inputs.
      std::unordered_map<std::string, std::vector<std::pair<std::string,double>>> bom;
      for (auto& r : db.query_json(
             "SELECT r.product_id AS parent, oi.product_id AS child, SUM(oi.qty) AS q "
             "FROM routings r "
             "JOIN operations o ON o.routing_id = r.id "
             "JOIN operation_inputs oi ON oi.operation_id = o.id "
             "WHERE r.product_id IS NOT NULL AND r.product_id <> '' "
             "AND COALESCE(r.is_default,1)=1 "                 // действующая версия техкарты
             "GROUP BY r.product_id, oi.product_id")) {
        double q = 1; try { q = std::stod(jstr(r,"q")); } catch (...) {}
        bom[jstr(r,"parent")].push_back({ jstr(r,"child"), q });
      }
      // B14: операции маршрута изделия (ч на ОДНУ ПАРТИЮ batch_size, как в Стадии 1) и
      // число параллельных станков (все допустимые типы операции) — для lead-time
      // offset по циклу ПАРТИИ ЗАПУСКА, а не по часам «на единицу».
      std::unordered_map<std::string, int> opMachines;     // операция → активных станков
      for (auto& r : db.query_json(
             "SELECT ow.operation_id AS op, COUNT(DISTINCT m.id) AS n FROM operation_wc_types ow "
             "JOIN machines m ON m.wc_type_id = ow.wc_type_id AND m.status='active' "
             "GROUP BY ow.operation_id")) {
        try { opMachines[jstr(r,"op")] = (int)std::stod(jstr(r,"n")); } catch (...) {}
      }
      std::unordered_map<std::string, std::vector<maos::planmath::OpLoad>> procOps;
      for (auto& r : db.query_json(
             "SELECT r.product_id AS pid, o.id AS op, "
             "((COALESCE(o.t_opt,o.t_norm)+4*o.t_norm+COALESCE(o.t_pess,o.t_norm))/6.0)/60.0 AS h "
             "FROM routings r JOIN operations o ON o.routing_id=r.id "
             "WHERE r.product_id IS NOT NULL AND r.product_id<>'' AND COALESCE(r.is_default,1)=1")) {
        maos::planmath::OpLoad ol;
        try { ol.hoursPerBatch = std::stod(jstr(r,"h")); } catch (...) { continue; }
        const auto mi = opMachines.find(jstr(r,"op"));
        ol.parallelMachines = mi != opMachines.end() ? std::max(1, mi->second) : 1;
        procOps[jstr(r,"pid")].push_back(ol);
      }
      struct PInfo {
        std::string name; bool purchased = false;
        double stock = 0, safety = 0, reorder = 0, lead = 0, cost = 0, batch = 1;
      };
      std::unordered_map<std::string, PInfo> pinfo;
      for (auto& p : db.query_json(
             "SELECT id,name,purchased,stock,safety_stock,reorder_point,"
             "lead_time_hours,base_cost,batch_size FROM products")) {
        PInfo pi; pi.name = jstr(p,"name");
        auto num = [&](const char* k, double def) {
          std::string s = jstr(p, k); if (s.empty()) return def;
          try { return std::stod(s); } catch (...) { return def; } };
        pi.purchased = num("purchased", 0) != 0;
        pi.stock = num("stock", 0); pi.safety = num("safety_stock", 0);
        pi.reorder = num("reorder_point", 0); pi.lead = num("lead_time_hours", 0);
        pi.cost = num("base_cost", 0); pi.batch = std::max(1.0, num("batch_size", 1));
        pinfo[jstr(p,"id")] = pi;
      }

      // Low-level codes (глубина позиции в BOM) — нетто-разузлование строго по
      // уровням: gross верхнего уровня неттуется об остаток, и вниз спускается
      // только ПЛАНОВЫЙ запуск (после lot sizing), а не полный брутто.
      // Иначе остатки полуфабрикатов не экономят сырьё (классическая ошибка MRP).
      std::unordered_map<std::string,int> llc;
      std::function<void(const std::string&, int, std::unordered_set<std::string>&)> mark =
        [&](const std::string& pid, int lvl, std::unordered_set<std::string>& vis) {
          if (lvl > 48 || vis.count(pid)) return;
          vis.insert(pid);
          auto it = llc.find(pid);
          if (it == llc.end() || it->second < lvl) llc[pid] = lvl;
          if (auto b = bom.find(pid); b != bom.end())
            for (auto& [child, q] : b->second) mark(child, lvl + 1, vis);
          vis.erase(pid);
        };
      for (auto& pl : program) { std::unordered_set<std::string> vis; mark(pl.pid, 0, vis); }

      std::vector<std::string> order;                       // позиции по возрастанию уровня
      for (auto& [pid, lvl] : llc) order.push_back(pid);
      std::sort(order.begin(), order.end(),
                [&](const std::string& a, const std::string& b) { return llc[a] < llc[b]; });

      std::unordered_map<std::string,double> gross, netQ, plannedQ, lotCycleH;
      // Time-phased: срок потребности позиции = min(срок родителя − цикл родителя).
      std::unordered_map<std::string,double> needBy;       // ч от «сейчас»; нет = срок неизвестен
      auto needMin = [&](const std::string& id, double v) {
        auto it = needBy.find(id);
        if (it == needBy.end() || v < it->second) needBy[id] = v;
      };
      for (auto& pl : program) {
        gross[pl.pid] += pl.qty;                           // независимая потребность
        if (pl.due > 0) needMin(pl.pid, pl.due);
      }
      for (const std::string& pid : order) {
        const PInfo pi = pinfo.count(pid) ? pinfo[pid] : PInfo{};
        double g = gross.count(pid) ? gross[pid] : 0;
        if (g <= 0) continue;
        // Нетто = брутто + страховой запас − остаток (классическое MRP-неттование,
        // применяется на КАЖДОМ уровне, включая готовую продукцию программы).
        double net = std::max(0.0, g + pi.safety - pi.stock);
        netQ[pid] = net;
        // Lot sizing: плановый запуск/заказ кратен партии (FOQ-кратность).
        double planned = net > 0 ? std::ceil(net / pi.batch) * pi.batch : 0;
        plannedQ[pid] = planned;
        if (planned > 0 && !pi.purchased)                  // спускаем только плановый запуск
          if (auto b = bom.find(pid); b != bom.end()) {
            // Компоненты нужны к старту обработки родителя: срок − цикл ПАРТИИ запуска
            // родителя (planned/batch партий, разнесённых по параллельным станкам).
            const auto po = procOps.find(pid);
            const double cyc = po != procOps.end()
              ? maos::planmath::lot_cycle_hours(po->second, planned, pi.batch) : 0.0;
            lotCycleH[pid] = cyc;
            const double childDue = needBy.count(pid) ? needBy[pid] - cyc : -1;
            for (auto& [child, q] : b->second) {
              gross[child] += planned * q;
              if (childDue >= 0) needMin(child, childDue);
            }
          }
      }

      json materials = json::array(); bool feasible = true;
      for (const std::string& pid : order) {
        if (!gross.count(pid) || gross[pid] <= 0) continue;
        if (!pinfo.count(pid)) continue;
        // Программные позиции (уровень 0) в сводку материалов не включаем.
        bool inProgram = false;
        for (auto& pl : program) if (pl.pid == pid) { inProgram = true; break; }
        if (inProgram) continue;
        const PInfo& pi = pinfo[pid];
        double net = netQ.count(pid) ? netQ[pid] : 0;
        if (pi.purchased && net > 0) feasible = false;
        json mrow = {
          {"product_id", pid}, {"name", pi.name}, {"purchased", pi.purchased},
          {"gross_req", gross[pid]}, {"on_hand", pi.stock}, {"safety_stock", pi.safety},
          {"net_req", net}, {"planned_qty", plannedQ.count(pid) ? plannedQ[pid] : 0},
          {"level", llc.count(pid) ? llc[pid] : 0},
          {"shortage", net > 0}, {"reorder", pi.stock < pi.reorder && pi.reorder > 0},
          {"lead_time_hours", pi.lead}, {"unit_cost", pi.cost},
        };
        // B14 (новое поле): цикл обработки партии запуска собственного изготовления, ч.
        if (lotCycleH.count(pid)) mrow["lot_cycle_hours"] = lotCycleH[pid];
        // Time-phased: когда нужен материал и когда РАЗМЕЩАТЬ заказ (нужен − lead).
        // place_by < 0 → заказ надо было разместить «вчера» (просрочен старт закупки).
        if (needBy.count(pid)) {
          const double nb = needBy[pid];
          mrow["need_by_hours"] = nb;
          if (pi.purchased && net > 0) {
            mrow["place_by_hours"] = nb - pi.lead;
            mrow["late"] = (nb - pi.lead) < 0;
          }
        }
        materials.push_back(mrow);
      }
      ok(res, { {"feasible", feasible}, {"materials", materials},
                {"n_orders", (int)program.size()} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── Имитационный режим: план для проигрывания в 3D + калибровка НСИ ──────── */

static void register_simulation(httplib::Server& svr, Database& db) {
  // Список построенных расписаний — выбор плана перед прогоном симуляции.
  svr.Get("/api/simulation/plans", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      // Только планы с реальными станочными задачами: чисто снабженческие
      // (MRP-закупки, machine_id пуст/supply) проигрывать на схеме нечем.
      ok(res, db.query_json(
        "SELECT pl.id, pl.created_at, COUNT(pt.id) AS n_tasks, "
        "       MAX(CAST(pt.end_min AS REAL))/60.0 AS makespan "
        "FROM plans pl JOIN plan_tasks pt ON pt.plan_id=pl.id "
        "  AND pt.machine_id<>'supply' AND pt.machine_id<>'' "
        "GROUP BY pl.id ORDER BY pl.rowid DESC LIMIT 40"));
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // План (лента задач) для проигрывания на 3D-схеме. ?plan_id — конкретный, иначе последний.
  svr.Get("/api/simulation/plan", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      json plan;
      const std::string want = req.has_param("plan_id") ? req.get_param_value("plan_id") : "";
      try {
        // По умолчанию — последний план, у которого ЕСТЬ станочные задачи
        // (иначе свежий MRP-план без операций «глушил» проигрывание).
        plan = want.empty()
          ? db.query_one(
              "SELECT id, created_at FROM plans pl WHERE EXISTS("
              "  SELECT 1 FROM plan_tasks pt WHERE pt.plan_id=pl.id"
              "  AND pt.machine_id<>'supply' AND pt.machine_id<>'') "
              "ORDER BY pl.rowid DESC LIMIT 1")
          : db.query_one("SELECT id, created_at FROM plans WHERE id=?", { want });
      }
      catch (...) { ok(res, { {"plan_id", nullptr}, {"tasks", json::array()}, {"makespan", 0} }); return; }
      const std::string planId = jstr(plan, "id");
      json tasks = json::array();
      double makespan = 0;
      for (auto& r : db.query_json(
             "SELECT pt.machine_id, pt.product_id, pt.operation_id, pt.order_idx, pt.worker_id, "
             "       pt.start_min, pt.end_min, "
             "       COALESCE(p.name, pt.product_id) AS product_name, "
             "       COALESCE(o.name, pt.operation_id) AS op_name, "
             "       (w.last_name || ' ' || w.first_name) AS worker_name "
             "FROM plan_tasks pt "
             "LEFT JOIN products p ON p.id = pt.product_id "
             "LEFT JOIN operations o ON o.id = pt.operation_id "
             "LEFT JOIN workers w ON w.id = pt.worker_id "
             "WHERE pt.plan_id = ? AND pt.machine_id <> 'supply' AND pt.machine_id <> ''",
             { planId })) {
        double st = 0, en = 0;
        try { st = std::stod(jstr(r, "start_min")) / 60.0; } catch (...) {}
        try { en = std::stod(jstr(r, "end_min")) / 60.0; } catch (...) {}
        makespan = std::max(makespan, en);
        int oi = 0; try { oi = (int)std::stod(jstr(r, "order_idx")); } catch (...) {}
        tasks.push_back({
          {"machine_id", jstr(r, "machine_id")}, {"product_id", jstr(r, "product_id")},
          {"product_name", jstr(r, "product_name")}, {"op_id", jstr(r, "operation_id")},
          {"op_name", jstr(r, "op_name")}, {"order_idx", oi},
          {"worker_id", jstr(r, "worker_id")}, {"worker_name", jstr(r, "worker_name")},
          {"start", st}, {"end", en},
        });
      }
      ok(res, { {"plan_id", planId}, {"created_at", jstr(plan, "created_at")},
                {"makespan", makespan}, {"tasks", tasks} });
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Калибровка НСИ (режим как в AnyLogic/ЕОС ИМ п.8.11): наблюдаемые в плане
  // длительности операций (обработка + наладки + ТО на станке) против норматива.
  svr.Get("/api/simulation/calibration", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      json plan = db.query_one(
        "SELECT id FROM plans pl WHERE EXISTS("
        "  SELECT 1 FROM plan_tasks pt WHERE pt.plan_id=pl.id"
        "  AND pt.machine_id<>'supply' AND pt.machine_id<>'') "
        "ORDER BY pl.rowid DESC LIMIT 1");
      const std::string planId = jstr(plan, "id");
      json rows = json::array();
      for (auto& r : db.query_json(
             "SELECT pt.operation_id AS op_id, COALESCE(o.name,'?') AS op_name, "
             "       COALESCE(p.name,'') AS product_name, "
             "       COALESCE(o.t_norm,0) AS t_norm, "
             "       AVG((CAST(pt.end_min AS REAL) - CAST(pt.start_min AS REAL)) / MAX(pt.qty, 0.001)) AS realized_mean, "
             "       COUNT(*) AS n "
             "FROM plan_tasks pt "
             "JOIN operations o ON o.id = pt.operation_id "
             "LEFT JOIN routings rt ON rt.id = o.routing_id "
             "LEFT JOIN products p ON p.id = rt.product_id "
             "WHERE pt.plan_id = ? AND pt.machine_id <> 'supply' "
             "GROUP BY pt.operation_id", { planId })) {
        double tn = 0, rm = 0; int n = 0;
        try { tn = std::stod(jstr(r, "t_norm")); } catch (...) {}
        try { rm = std::stod(jstr(r, "realized_mean")); } catch (...) {}
        try { n = (int)std::stod(jstr(r, "n")); } catch (...) {}
        if (tn <= 0 || rm <= 0) continue;
        rows.push_back({
          {"op_id", jstr(r, "op_id")}, {"op_name", jstr(r, "op_name")},
          {"product_name", jstr(r, "product_name")},
          {"t_norm", tn}, {"realized_mean", rm}, {"n", n},
          {"delta_pct", (rm - tn) / tn * 100.0},
        });
      }
      ok(res, { {"plan_id", planId}, {"rows", rows} });
    } catch (...) { ok(res, { {"plan_id", nullptr}, {"rows", json::array()} }); }
  });

  // Применение калибровки: новый t_norm; t_opt/t_pess масштабируются пропорционально,
  // нормы пары (time_norms) обновляются тем же коэффициентом.
  svr.Post("/api/simulation/calibrate", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      auto body = json::parse(req.body);
      if (!body.contains("items") || !body["items"].is_array()) { err(res, 400, "items required"); return; }
      int updated = 0;
      std::lock_guard<std::recursive_mutex> lk(db.mutex());
      db.exec("BEGIN");
      try {
        for (auto& it : body["items"]) {
          const std::string opId = jstr(it, "op_id");
          double tn = 0; try { tn = std::stod(jstr(it, "t_norm")); } catch (...) {}
          if (opId.empty() || tn <= 0) continue;
          json cur;
          try { cur = db.query_one("SELECT t_norm FROM operations WHERE id=?", { opId }); }
          catch (...) { continue; }
          double oldTn = 0; try { oldTn = std::stod(jstr(cur, "t_norm")); } catch (...) {}
          const double scale = oldTn > 0 ? tn / oldTn : 1.0;
          db.exec("UPDATE operations SET t_norm=?, "
                  "t_opt = MAX(1, ROUND(COALESCE(t_opt, t_norm) * ?)), "
                  "t_pess = MAX(1, ROUND(COALESCE(t_pess, t_norm) * ?)) WHERE id=?",
                  { std::to_string(tn), std::to_string(scale), std::to_string(scale), opId });
          db.exec("UPDATE time_norms SET t_norm=?, "
                  "t_opt = MAX(1, ROUND(COALESCE(t_opt, t_norm) * ?)), "
                  "t_pess = MAX(1, ROUND(COALESCE(t_pess, t_norm) * ?)) WHERE operation_id=?",
                  { std::to_string(tn), std::to_string(scale), std::to_string(scale), opId });
          ++updated;
        }
        db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
      audit(db, "nsi", "calibration", "CALIBRATE", { {"updated", updated} });
      ok(res, { {"updated", updated} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });

  // Аналитика прогона (как в имитационных пакетах): загрузка оборудования и число
  // занятых операторов ВО ВРЕМЕНИ, требуемое число операторов (пик), пропускная
  // способность, загрузка по станкам. Плюс рекомендация в НСИ по числу рабочих.
  svr.Get("/api/simulation/results", [&db](const httplib::Request& req, httplib::Response& res) {
    try {
      const std::string want = req.has_param("plan_id") ? req.get_param_value("plan_id") : "";
      json plan;
      try {
        plan = want.empty()
          ? db.query_one(
              "SELECT id FROM plans pl WHERE EXISTS("
              "  SELECT 1 FROM plan_tasks pt WHERE pt.plan_id=pl.id"
              "  AND pt.machine_id<>'supply' AND pt.machine_id<>'') "
              "ORDER BY pl.rowid DESC LIMIT 1")
          : db.query_one("SELECT id FROM plans WHERE id=?", { want });
      } catch (...) { ok(res, { {"plan_id", nullptr} }); return; }
      const std::string planId = jstr(plan, "id");

      // KPI-блок плана (Scheduler): календарный фонд каждого станка (machine_load[].fund_hours)
      // и темп выпуска в единицах продукции. В старых планах этих полей нет → legacy-формула.
      json bundle = json::object();
      try {
        const std::string kj = jstr(db.query_one("SELECT kpi_json FROM plans WHERE id=?", { planId }), "kpi_json");
        if (!kj.empty()) bundle = json::parse(kj);
      } catch (...) {}
      std::unordered_map<std::string,double> fundOf;   // станок → календарный фонд, ч
      if (bundle.contains("machine_load") && bundle["machine_load"].is_array())
        for (auto& e : bundle["machine_load"])
          if (e.is_object() && e.contains("fund_hours") && e["fund_hours"].is_number())
            fundOf[jstr(e, "machine_id")] = e["fund_hours"].get<double>();
      const bool unified = !fundOf.empty();

      struct T { std::string mid, wid; double s, e, load; int order; };
      std::vector<T> tasks;
      std::set<std::string> machineSet, workerSet;
      std::unordered_map<std::string,double> orderFin;
      double makespan = 0;
      for (auto& r : db.query_json(
             "SELECT machine_id, worker_id, start_min, end_min, order_idx, load_hours "
             "FROM plan_tasks WHERE plan_id=? AND machine_id<>'supply' AND machine_id<>''",
             { planId })) {
        T t; t.mid = jstr(r, "machine_id"); t.wid = jstr(r, "worker_id");
        try { t.s = std::stod(jstr(r, "start_min")) / 60.0; } catch (...) { t.s = 0; }
        try { t.e = std::stod(jstr(r, "end_min")) / 60.0; } catch (...) { t.e = 0; }
        try { t.load = std::stod(jstr(r, "load_hours")); } catch (...) { t.load = 0; }
        try { t.order = (int)std::stod(jstr(r, "order_idx")); } catch (...) { t.order = 0; }
        makespan = std::max(makespan, t.e);
        if (!t.mid.empty()) machineSet.insert(t.mid);
        if (!t.wid.empty()) workerSet.insert(t.wid);
        orderFin[std::to_string(t.order)] = std::max(orderFin[std::to_string(t.order)], t.e);
        tasks.push_back(t);
      }
      const int BK = 48;
      const double bw = std::max(1e-9, makespan / BK);
      std::vector<std::set<std::string>> busM(BK + 1), busW(BK + 1);
      std::vector<std::unordered_map<std::string,double>> occM(BK + 1);   // бин → станок → доля бина
      std::unordered_map<std::string,double> mBusy;   // станок → занятые часы
      for (const T& t : tasks) {
        int b0 = std::max(0, (int)std::floor(t.s / bw));
        int b1 = std::min(BK, (int)std::floor((t.e - 1e-9) / bw));
        for (int k = b0; k <= b1; ++k) {
          busM[k].insert(t.mid); if (!t.wid.empty()) busW[k].insert(t.wid);
          // Ряд занятости — ДОЛЯ бина, перекрытая задачей (раньше бин засчитывался целиком).
          const double ov = std::min(t.e, (k + 1) * bw) - std::max(t.s, k * bw);
          if (ov > 0) occM[k][t.mid] += ov / bw;
        }
        // B9: занятость = ПРОДУКТИВНОЕ время (обработка, plan_tasks.load_hours); для старых
        // планов без него — длительность интервала (включала наладку/ТО и нерабочие окна).
        mBusy[t.mid] += unified ? std::max(0.0, t.load) : std::max(0.0, t.e - t.s);
      }
      json util = json::array(), workers = json::array();
      int peakOps = 0; double sumOps = 0, sumUtil = 0; int nMach = (int)machineSet.size();
      for (int k = 0; k <= BK; ++k) {
        const int bm = (int)busM[k].size(), bw2 = (int)busW[k].size();
        peakOps = std::max(peakOps, bw2); sumOps += bw2;
        double occ = 0; for (auto& [mid, f] : occM[k]) occ += std::min(1.0, f);
        const double u = nMach > 0 ? occ / nMach : 0; sumUtil += u;
        util.push_back({ {"t", k * bw}, {"util", u}, {"busy", bm} });
        workers.push_back({ {"t", k * bw}, {"workers", bw2} });
      }
      // Загрузка по станкам (топ для столбиков): продуктивное время / календарный фонд станка.
      json perMachine = json::array();
      double sumBusy = 0;
      for (auto& [mid, h] : mBusy) {
        std::string nm = mid;
        try { auto mr = db.query_one("SELECT name FROM machines WHERE id=?", { mid }); nm = jstr(mr, "name"); } catch (...) {}
        const auto fi = fundOf.find(mid);
        const double fund = unified ? (fi != fundOf.end() ? fi->second : makespan) : makespan;
        sumBusy += h;
        perMachine.push_back({ {"machine_id", mid}, {"name", nm}, {"busy_hours", h},
                               {"utilization", fund > 0 ? h / fund : 0},
                               {"fund_hours", unified ? json(fund) : json(nullptr)} });
      }
      // Средняя загрузка — та же формула, что kpi.utilization: Σ продуктивного / Σ фонда
      // ВСЕХ станков плана (включая простаивающие).
      double sumFund = 0; for (auto& [mid, f] : fundOf) sumFund += f;
      const double avgUtil = unified ? (sumFund > 0 ? sumBusy / sumFund : 0)
                                     : ((BK + 1) > 0 ? sumUtil / (BK + 1) : 0);
      const int nOrders = (int)orderFin.size();
      const double days = std::max(1e-9, makespan / 24.0);
      const json kpiB = bundle.contains("kpi") && bundle["kpi"].is_object() ? bundle["kpi"] : json::object();
      ok(res, {
        {"plan_id", planId}, {"makespan", makespan},
        {"n_machines", nMach}, {"n_workers", (int)workerSet.size()},
        {"required_operators", peakOps},                     // пик одновременно занятых
        {"avg_operators", (BK + 1) > 0 ? sumOps / (BK + 1) : 0},
        {"avg_utilization", avgUtil},
        {"throughput_per_day", nOrders / days},              // legacy-имя: это ЗАКАЗОВ в сутки
        {"orders_per_day", nOrders / days},                  // B10: корректное имя той же величины
        {"units_per_day", kpiB.contains("throughput_per_day") && kpiB["throughput_per_day"].is_number()
                            ? kpiB["throughput_per_day"] : json(nullptr)},   // темп выпуска, ед. продукции/сут
        {"utilization_basis", unified ? "calendar_fund" : "makespan_legacy"},
        {"machine_fund_hours", unified ? json(sumFund) : json(nullptr)},
        {"n_orders", nOrders},
        {"util_series", util}, {"workers_series", workers}, {"per_machine", perMachine},
      });
    } catch (std::exception& e) { err(res, 500, e.what()); }
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
      db.exec("BEGIN");   // DELETE + INSERT'ы смен — атомарно (обрыв = пустой календарь)
      try {
        db.exec("DELETE FROM shifts WHERE schedule_id=?", { sid });
        if (body.contains("days") && body["days"].is_array())
          for (auto& d : body["days"]) {
            int dow = d.is_number() ? d.get<int>() : std::stoi(d.get<std::string>());
            db.exec("INSERT INTO shifts(id,schedule_id,day_of_week,start_min,end_min) VALUES(?,?,?,?,?)",
                    { gen_uuid(), sid, std::to_string(dow), std::to_string(sMin), std::to_string(eMin) });
          }
        db.exec("COMMIT");
      } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
      audit(db, "calendar", sid, "UPDATE", body);
      ok(res, { {"ok", true} });
    } catch (std::exception& e) { err(res, 400, e.what()); }
  });
}

/* ── main ────────────────────────────────────────────────────────────────── */

/* ── Инициализация БД проекта (старт + переключение) ─────────────────────── */
// Идемпотентный посев истории цен для изделий БЕЗ ts_data (новые проекты/изделия
// добавляются после разовой миграции v9). Ряд ~30 мес: экспон. тренд + сезонность
// + слабый AR-остаток, последняя точка = текущая base_price/base_cost — прогноз
// (EMD-тренд + гармоники + AIC-фит) получает содержательные данные вместо пустоты.
static void seed_missing_ts_data(Database& db) {
  json rows;
  try {
    rows = db.query_json(
      "SELECT p.id, p.base_price, p.base_cost, p.sellable, p.purchased "
      "FROM products p "
      "WHERE (p.sellable=1 OR p.purchased=1) "
      "AND NOT EXISTS (SELECT 1 FROM ts_data t WHERE t.product_id=p.id)");
  } catch (...) { return; }
  if (rows.empty()) return;

  const int N = 30;
  int seeded = 0;
  std::lock_guard<std::recursive_mutex> lk(db.mutex());
  db.exec("BEGIN");
  try {
    for (auto& p : rows) {
      const bool sellable = jstr(p, "sellable") == "1";
      const std::string kind = sellable ? "price" : "cost";
      const std::string bs = sellable ? jstr(p, "base_price") : jstr(p, "base_cost");
      const std::string pid = jstr(p, "id");
      if (bs.empty()) continue;
      double base = 0; try { base = std::stod(bs); } catch (...) {}
      if (base <= 0) continue;

      // Детерминированный seed по id изделия — стабильная история между рестартами.
      std::mt19937 rng((unsigned)(fnv1a(pid) & 0xFFFFFFFFu));
      std::normal_distribution<double> nd(0.0, 1.0);
      const double sigma  = sellable ? 0.040 : 0.055;    // мес. волатильность лог-остатка
      const double trend  = 0.004 + 0.004 * (double)((fnv1a(pid) >> 8) % 100) / 100.0; // 0.4–0.8%/мес
      const double seasAmp = 0.03 + 0.05 * (double)((fnv1a(pid) >> 16) % 100) / 100.0;  // сезонность
      const double seasPh  = (double)((fnv1a(pid) >> 24) % 12);
      // Строим лог-остаток вперёд (AR(1) с φ=0.5), затем центрируем на base в конце.
      std::vector<double> resid(N, 0.0);
      for (int t = 1; t < N; ++t) resid[t] = 0.5 * resid[t - 1] + sigma * nd(rng);
      std::vector<double> logv(N, 0.0);
      for (int t = 0; t < N; ++t) {
        const double seas = seasAmp * std::sin(2.0 * M_PI * ((t + seasPh) / 12.0));
        logv[t] = trend * t + seas + resid[t];
      }
      const double shift = std::log(base) - logv[N - 1];  // последняя точка = base
      std::ostringstream sql;
      sql << "INSERT OR IGNORE INTO ts_data(id,product_id,kind,month_idx,value) VALUES";
      for (int t = 0; t < N; ++t) {
        if (t) sql << ",";
        sql << "('" << pid << "#" << kind << "#" << t << "','" << pid << "','" << kind
            << "'," << t << "," << std::exp(logv[t] + shift) << ")";
      }
      db.exec(sql.str());
      ++seeded;
    }
    db.exec("COMMIT");
  } catch (...) { try { db.exec("ROLLBACK"); } catch (...) {} throw; }
  if (seeded > 0) std::cout << "Seeded price history for " << seeded << " products.\n";
}

static bool setup_database(Database& db) {
  db.init_schema();
  db.exec_safe("ALTER TABLE users ADD COLUMN locked_until TEXT");  // идемпотентно для старых БД
  // Версионирование техкарт (ТЗ «Справочник техкарт» §3.3): version + is_default.
  db.exec_safe("ALTER TABLE org_units ADD COLUMN kind TEXT");  // 3D-модель здания цеха
  db.exec_safe("ALTER TABLE org_units ADD COLUMN pos_x REAL"); // позиция цеха на площадке (X)
  db.exec_safe("ALTER TABLE org_units ADD COLUMN pos_z REAL"); // позиция цеха на площадке (Z)
  db.exec_safe("ALTER TABLE org_units ADD COLUMN unit_type TEXT"); // 'factory' | 'warehouse' | 'shop' (пусто = 'shop')
  db.exec_safe("ALTER TABLE plans ADD COLUMN kpi_json TEXT");  // KPI-блок плана для «Аналитики»
  // KV-настройки на уровне проекта-БД: дашборд «Аналитики» (закреплённые KPI + графики).
  db.exec_safe("CREATE TABLE IF NOT EXISTS app_prefs ("
               "key TEXT PRIMARY KEY, value TEXT, "
               "updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  // flows: from/to полиморфные (станок ИЛИ 'shop:<org_unit_id>') — старый FK на
  // machines молча ронял сохранение межцеховых дорог (SQLITE_CONSTRAINT глотался
  // фронтом). Перестраиваем таблицу без FK; висячие связи чистим на старте.
  try {
    auto fk = db.query_json("PRAGMA foreign_key_list(flows)");
    if (!fk.empty()) {
      db.exec("PRAGMA foreign_keys=OFF");
      db.exec("BEGIN");
      db.exec("CREATE TABLE flows_new("
              "id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, "
              "parent_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
      db.exec("INSERT INTO flows_new(id,from_id,to_id,parent_id,created_at) "
              "SELECT id,from_id,to_id,parent_id,created_at FROM flows");
      db.exec("DROP TABLE flows");
      db.exec("ALTER TABLE flows_new RENAME TO flows");
      db.exec("COMMIT");
      db.exec("PRAGMA foreign_keys=ON");
      std::cout << "Migrated flows: FK dropped (roads can link shops).\n";
    }
  } catch (std::exception& e) {
    try { db.exec("ROLLBACK"); } catch (...) {}
    std::cerr << "flows FK migration failed: " << e.what() << "\n";
  }
  // Чистка висячих связей (станок/цех удалён) — FK больше не каскадит.
  db.exec_safe("DELETE FROM flows WHERE "
               "(from_id NOT LIKE 'shop:%' AND from_id NOT IN (SELECT id FROM machines)) OR "
               "(to_id   NOT LIKE 'shop:%' AND to_id   NOT IN (SELECT id FROM machines)) OR "
               "(from_id LIKE 'shop:%' AND substr(from_id,6) NOT IN (SELECT id FROM org_units)) OR "
               "(to_id   LIKE 'shop:%' AND substr(to_id,6)   NOT IN (SELECT id FROM org_units))");
  db.exec_safe("ALTER TABLE routings ADD COLUMN version INTEGER DEFAULT 1");
  db.exec_safe("ALTER TABLE routings ADD COLUMN is_default INTEGER DEFAULT 1");
  db.exec_safe("ALTER TABLE routings ADD COLUMN effective_from TEXT");
  db.exec_safe("UPDATE routings SET version=1 WHERE version IS NULL");
  db.exec_safe("UPDATE routings SET is_default=1 WHERE is_default IS NULL");
  // Нормы «операция×тип»: посев из плоских норм операций (идемпотентно).
  db.exec_safe("INSERT OR IGNORE INTO time_norms(operation_id,wc_type_id,t_opt,t_norm,t_pess,setup_time) "
               "SELECT ow.operation_id, ow.wc_type_id, o.t_opt, o.t_norm, o.t_pess, o.setup_time "
               "FROM operation_wc_types ow JOIN operations o ON o.id=ow.operation_id");
  // Демо-посев компетенций (если пусто): каждый рабочий владеет ~60% типов РЦ со
  // сдвигом — есть специализация, но каждый тип покрыт несколькими рабочими.
  try {
    auto ws = db.query_json("SELECT id FROM workers WHERE skills IS NULL OR skills='' ORDER BY id");
    auto ts = db.query_json("SELECT name FROM work_center_types ORDER BY name");
    if (!ws.empty() && ts.size() >= 2) {
      const size_t T = ts.size(), COVER = (T * 3) / 5 + 1;
      for (size_t i = 0; i < ws.size(); ++i) {
        std::string sk;
        const size_t k0 = (i * T) / ws.size();
        for (size_t k = 0; k < COVER && k < T; ++k) {
          if (!sk.empty()) sk += ", ";
          sk += jstr(ts[(k0 + k) % T], "name");
        }
        db.exec("UPDATE workers SET skills=? WHERE id=?", { sk, jstr(ws[i], "id") });
      }
      std::cout << "Seeded worker skills (" << ws.size() << ").\n";
    }
  } catch (std::exception& e) { std::cerr << "skills seed: " << e.what() << "\n"; }
  // Тарифные ставки по разряду (если не заданы): 350 + 100·разряд ₽/ч.
  db.exec_safe("UPDATE workers SET cost_per_hour = 350 + 100*CAST(COALESCE(NULLIF(grade,''),'4') AS INTEGER) "
               "WHERE cost_per_hour IS NULL OR cost_per_hour='' OR cost_per_hour='0' OR cost_per_hour=0");
  // Надёжность/обслуживание оборудования (параметры ТИПА, как и остальной паспорт):
  // MTBF при полной загрузке, средний ремонт, интервал ТО по наработке, длительность ТО.
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN mtbf_hours REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN repair_hours REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN mtbm_hours REAL DEFAULT 0");
  db.exec_safe("ALTER TABLE work_center_types ADD COLUMN maintenance_hours REAL DEFAULT 0");
  // Демо-дефолты (только для незаполненных): наработка на отказ 350ч, ремонт 6ч,
  // ТО каждые 160ч наработки по 4ч.
  db.exec_safe("UPDATE work_center_types SET mtbf_hours=350, repair_hours=6, "
               "mtbm_hours=160, maintenance_hours=4 "
               "WHERE (mtbf_hours IS NULL OR mtbf_hours=0) AND hour_rate > 0");
  // Миграция plans: run_id был NOT NULL + FK — план из /api/schedule (без прогона
  // оптимизации) вообще не мог сохраниться, и симуляции нечего было проигрывать.
  try {
    auto ti = db.query_json("SELECT \"notnull\" AS nn FROM pragma_table_info('plans') WHERE name='run_id'");
    if (!ti.empty() && jstr(ti[0], "nn") == "1") {
      std::lock_guard<std::recursive_mutex> lk(db.mutex());
      db.exec("PRAGMA foreign_keys=OFF");
      db.exec("BEGIN");
      try {
        db.exec("CREATE TABLE plans_new (id TEXT PRIMARY KEY, "
                "run_id TEXT REFERENCES optimization_runs(id) ON DELETE SET NULL, "
                "created_at TEXT NOT NULL DEFAULT (datetime('now')))");
        db.exec("INSERT INTO plans_new SELECT id, NULLIF(run_id,''), created_at FROM plans");
        db.exec("DROP TABLE plans");
        db.exec("ALTER TABLE plans_new RENAME TO plans");
        db.exec("COMMIT");
        std::cout << "Migrated plans.run_id -> nullable.\n";
      } catch (std::exception& e) {
        try { db.exec("ROLLBACK"); } catch (...) {}
        std::cerr << "plans migration failed: " << e.what() << "\n";
      }
      db.exec("PRAGMA foreign_keys=ON");
    }
  } catch (...) {}
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

  // Демо-холдинг: если имя проекта помечено как холдинг (см. holding_trigger)
  // и оргструктура ещё пуста — засеваем 3 завода + центральный склад. Типы РЦ
  // уже засеяны demo-посевом выше, поэтому станки цехов ссылаются на реальные wct.
  try {
    if (holding_trigger(db.path())) {
      auto ou = db.query_one("SELECT COUNT(*) AS n FROM org_units");
      if (ou["n"].get<std::string>() == "0") {
        // Холдинг НЕ использует демо-завод из seed_demo: удаляем его станки/дороги
        // (типы РЦ и изделия ОСТАВЛЯЕМ — на них по FK ссылаются станки цехов холдинга),
        // иначе migrate вывел бы из имён демо-станков лишние «цеха» → фантомный
        // завод «Предприятие» на мировой карте.
        db.exec("DELETE FROM flows");
        db.exec("DELETE FROM machines");
        seed_holding(db);
      }
    }
  } catch (std::exception& e) {
    try { db.exec("ROLLBACK"); } catch (...) {}
    std::cerr << "Holding seed failed: " << e.what() << "\n";
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
    migrate_v15(db);
    migrate_v16(db);
    migrate_v17(db);
    migrate_v18(db);
    migrate_v19(db);
  } catch (std::exception& e) {
    std::cerr << "FATAL: migration failed: " << e.what() << "\n"
              << "Отказ старта с частично мигрированной БД (повтор при перезапуске).\n";
    return false;
  }
  seed_missing_ts_data(db);   // история цен для новых изделий (прогноз ОТ данных)
  return true;
}

int main(int argc, char* argv[]) {
  std::string db_path = "maos.db";
  if (argc > 1) db_path = argv[1];

  std::cout << "MAOS backend starting...\n";
  std::cout << "Database: " << db_path << "\n";

  Database db(db_path);
  if (!setup_database(db)) return 1;

  httplib::Server svr;

  // CORS pre-flight
  svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
    cors(res);
  });

  // ── RBAC-фильтр (deny-by-default): все /api/* требуют действующий Bearer-токен;
  // мутации — соответствующее право роли. Раньше токен не проверялся нигде.
  svr.set_pre_routing_handler([&db](const httplib::Request& req, httplib::Response& res)
                                -> httplib::Server::HandlerResponse {
    using HR = httplib::Server::HandlerResponse;
    g_actor.clear();                                  // не наследовать актора прошлого запроса
    const std::string& path = req.path;
    if (req.method == "OPTIONS" || path.rfind("/api/", 0) != 0) return HR::Unhandled;
    if (path == "/api/auth/login" || path == "/api/health") return HR::Unhandled;
    if (path == "/api/projects" && req.method == "GET") return HR::Unhandled;  // список для окна входа

    std::string auth = req.get_header_value("Authorization");
    std::string token = auth.rfind("Bearer ", 0) == 0 ? auth.substr(7) : "";
    AuthSession s; bool valid = false;
    {
      std::lock_guard<std::mutex> lk(g_sess_mtx);
      auto it = g_sessions.find(token);
      if (it != g_sessions.end()) {
        if (std::chrono::steady_clock::now() < it->second.expires) { s = it->second; valid = true; }
        else g_sessions.erase(it);                    // истёкшую сессию убираем
      }
    }
    if (!valid) { err(res, 401, "Требуется вход (токен отсутствует или истёк)"); return HR::Handled; }
    g_actor = s.login;

    // Карта прав: чтение доступно любому вошедшему (READ), мутации — по зонам.
    std::string need;
    if (req.method != "GET") {
      auto starts = [&](const char* p) { return path.rfind(p, 0) == 0; };
      if (starts("/api/users") || starts("/api/roles")) need = "MANAGE_USERS";
      else if (starts("/api/optimize") || starts("/api/schedule") ||
               starts("/api/forecast") || starts("/api/mrp")) need = "RUN_OPTIMIZE";
      else if (starts("/api/demand_orders") || starts("/api/production_plans") ||
               starts("/api/scenarios") || starts("/api/calendar")) need = "WRITE_PLAN";
      else need = "EDIT_NSI";                          // НСИ и прочие мутации
    }
    if (!need.empty() && !s.perms.count(need)) {
      audit(db, "auth", s.login, "REJECTED", { {"path", path}, {"need", need} });
      err(res, 403, "Недостаточно прав: требуется " + need);
      return HR::Handled;
    }
    return HR::Unhandled;
  });

  // Health
  svr.Get("/api/health", [&db](const httplib::Request&, httplib::Response& res) {
    cors(res);
    ok(res, { {"status", "ok"}, {"version", "0.62.0"}, {"project", db.path()} });
  });

  // Мультипроектность: список проектов (*.db в рабочей папке) + текущий.
  // Открытие/создание — через окно входа (POST /api/auth/login, поле db).
  svr.Get("/api/projects", [&db](const httplib::Request&, httplib::Response& res) {
    try {
      json arr = json::array();
      for (auto& e : std::filesystem::directory_iterator(".")) {
        if (!e.is_regular_file()) continue;
        const std::string p = e.path().filename().string();
        if (p.size() > 3 && p.substr(p.size() - 3) == ".db") arr.push_back(p);
      }
      ok(res, { {"projects", arr}, {"current", db.path()} });
    } catch (std::exception& e) { err(res, 500, e.what()); }
  });

  // Auth
  register_auth(svr, db);

  // NSI registries (simple CRUD)
  register_crud(svr, db, {
    "work_center_types", "work_center_type",
    { "name", "group_name", "kind", "characteristics", "description", "interchangeable",
      "hour_rate", "efficiency",
      // Надёжность/ТО — входы симуляции поломок и планового обслуживания:
      "mtbf_hours", "repair_hours", "mtbm_hours", "maintenance_hours" }
  });

  register_crud(svr, db, {
    "machines", "machine",
    { "name", "wc_type_id", "org_unit", "org_unit_id", "inv_no", "serial_no",
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
      // Модель спроса/конкуренции: ёмкость рынка (выше — продать НЕЛЬЗЯ),
      // эластичность цены по насыщению, предложение конкурентов:
      "market_capacity", "price_elasticity", "competitor_supply",
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

  // Оргструктура (подразделения/цеха) — для выпадающих списков.
  // kind — выбранная пользователем 3D-модель здания цеха на схеме.
  register_crud(svr, db, {
    "org_units", "org_unit", { "name", "parent_id", "kind", "pos_x", "pos_z", "unit_type" }
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

  // Имитационный режим (3D-плеер плана + калибровка НСИ)
  register_simulation(svr, db);

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
