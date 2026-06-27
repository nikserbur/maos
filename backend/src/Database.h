#pragma once
#include <sqlite3.h>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <functional>
#include <stdexcept>

using json = nlohmann::json;
using Row  = std::vector<std::pair<std::string, std::string>>;

class Database {
public:
  explicit Database(const std::string& path);
  ~Database();

  Database(const Database&)            = delete;
  Database& operator=(const Database&) = delete;

  void init_schema();

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

private:
  sqlite3* db_ = nullptr;

  sqlite3_stmt* prepare(const std::string& sql) const;
  void          bind(sqlite3_stmt* stmt, const std::vector<std::string>& params) const;
};
