#pragma once
#include <sqlite3.h>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <functional>
#include <stdexcept>
#include <mutex>

using json = nlohmann::json;
using Row  = std::vector<std::pair<std::string, std::string>>;

class Database {
public:
  explicit Database(const std::string& path);
  ~Database();

  Database(const Database&)            = delete;
  Database& operator=(const Database&) = delete;

  void init_schema();

  // Schema version (PRAGMA user_version) — drives idempotent migrations.
  int  user_version() const;
  void set_user_version(int v);

  // Execute a statement, swallowing errors. For guarded DDL such as
  // `ALTER TABLE ... ADD COLUMN` that is expected to fail if already applied.
  void exec_safe(const std::string& sql) noexcept;

  // Execute a statement that returns no rows (INSERT / UPDATE / DELETE / DDL).
  void exec(const std::string& sql);

  // Execute a prepared statement with positional ?-bindings.
  void exec(const std::string& sql, const std::vector<std::string>& params);

  // Query rows; callback receives column-name/value pairs.
  void query(const std::string& sql,
             const std::vector<std::string>& params,
             const std::function<void(const Row&)>& cb) const;

  // Query into a JSON array of objects.
  json query_json(const std::string& sql,
                  const std::vector<std::string>& params = {}) const;

  // Query a single row (throws if not found).
  json query_one(const std::string& sql,
                 const std::vector<std::string>& params = {}) const;

  sqlite3* handle() { return db_; }

  // Один общий sqlite3-хэндл обслуживает все потоки httplib. Рекурсивный мьютекс
  // сериализует доступ (предотвращает гонку/повреждение кучи) и позволяет
  // удерживать блокировку на всю транзакцию (BEGIN…COMMIT) из одного потока.
  std::recursive_mutex& mutex() const { return mtx_; }

private:
  sqlite3* db_ = nullptr;
  mutable std::recursive_mutex mtx_;

  sqlite3_stmt* prepare(const std::string& sql) const;
  void          bind(sqlite3_stmt* stmt, const std::vector<std::string>& params) const;
};
