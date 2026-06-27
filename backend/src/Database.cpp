#include "Database.h"
#include <fstream>
#include <sstream>
#include <filesystem>

static void check(int rc, const char* op) {
  if (rc != SQLITE_OK && rc != SQLITE_DONE && rc != SQLITE_ROW)
    throw std::runtime_error(std::string(op) + ": " + std::to_string(rc));
}

Database::Database(const std::string& path) {
  check(sqlite3_open(path.c_str(), &db_), "sqlite3_open");
  exec("PRAGMA journal_mode = WAL");
  exec("PRAGMA foreign_keys = ON");
}

Database::~Database() {
  if (db_) sqlite3_close(db_);
}

void Database::init_schema() {
  // Try to read schema.sql from the directory of the executable
  std::string sql_path = "schema.sql";
  std::ifstream f(sql_path);
  if (!f.is_open()) {
    // Fallback: same dir as the working directory
    throw std::runtime_error("schema.sql not found. Run the server from the build directory.");
  }
  std::ostringstream ss;
  ss << f.rdbuf();
  char* errmsg = nullptr;
  int rc = sqlite3_exec(db_, ss.str().c_str(), nullptr, nullptr, &errmsg);
  if (rc != SQLITE_OK) {
    std::string msg = errmsg ? errmsg : "unknown";
    sqlite3_free(errmsg);
    throw std::runtime_error("schema init failed: " + msg);
  }
}

sqlite3_stmt* Database::prepare(const std::string& sql) const {
  sqlite3_stmt* stmt = nullptr;
  check(sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr), "prepare");
  return stmt;
}

void Database::bind(sqlite3_stmt* stmt, const std::vector<std::string>& params) const {
  for (int i = 0; i < (int)params.size(); ++i) {
    check(sqlite3_bind_text(stmt, i + 1, params[i].c_str(), -1, SQLITE_TRANSIENT), "bind");
  }
}

void Database::exec(const std::string& sql) {
  char* errmsg = nullptr;
  int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &errmsg);
  if (rc != SQLITE_OK) {
    std::string msg = errmsg ? errmsg : "unknown";
    sqlite3_free(errmsg);
    throw std::runtime_error("exec failed: " + msg);
  }
}

void Database::exec(const std::string& sql, const std::vector<std::string>& params) {
  auto* stmt = prepare(sql);
  bind(stmt, params);
  int rc = sqlite3_step(stmt);
  sqlite3_finalize(stmt);
  if (rc != SQLITE_DONE && rc != SQLITE_ROW)
    throw std::runtime_error("exec(params) step: " + std::to_string(rc));
}

void Database::query(const std::string& sql,
                     const std::vector<std::string>& params,
                     const std::function<void(const Row&)>& cb) const {
  auto* stmt = prepare(sql);
  bind(stmt, params);
  int cols = sqlite3_column_count(stmt);
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    Row row;
    for (int i = 0; i < cols; ++i) {
      const char* name = sqlite3_column_name(stmt, i);
      const char* val  = reinterpret_cast<const char*>(sqlite3_column_text(stmt, i));
      row.emplace_back(name ? name : "", val ? val : "");
    }
    cb(row);
  }
  sqlite3_finalize(stmt);
}

json Database::query_json(const std::string& sql,
                          const std::vector<std::string>& params) const {
  json arr = json::array();
  query(sql, params, [&](const Row& row) {
    json obj = json::object();
    for (auto& [k, v] : row) obj[k] = v;
    arr.push_back(obj);
  });
  return arr;
}

json Database::query_one(const std::string& sql,
                         const std::vector<std::string>& params) const {
  json result;
  bool found = false;
  query(sql, params, [&](const Row& row) {
    if (found) return;
    result = json::object();
    for (auto& [k, v] : row) result[k] = v;
    found = true;
  });
  if (!found) throw std::runtime_error("not found");
  return result;
}
