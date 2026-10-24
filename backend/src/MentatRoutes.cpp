// MENTAT-API: вопрос модели (ask), статус подключения, запись аудита и маршруты /api/mentat/*.
// Ответ модели сервер не меняет и не дополняет — проверку верности по графу делает фронтенд (verify/).
#include "Database.h"
#include "Mentat.h"
#include <httplib.h>
#include <algorithm>
#include <chrono>

namespace maos::mentat {
namespace {

json envelope(const json& data, const json& error) { return { {"data", data}, {"error", error} }; }

void reply(httplib::Response& res, int status, const json& data, const std::string& error = "") {
  res.set_header("Access-Control-Allow-Origin", "*");
  res.status = status;
  res.set_content(envelope(error.empty() ? data : json(nullptr), error.empty() ? json(nullptr) : json(error)).dump(), "application/json");
}

json load_prefs(Database& db) {
  try {
    const json row = db.query_one("SELECT value FROM app_prefs WHERE key=?", { kPrefsKey });
    const std::string v = row.value("value", "");
    return v.empty() ? json::object() : json::parse(v);
  } catch (...) {
    return json::object();  // нет записи / повреждена — как не задано
  }
}

std::string str_field(const json& body, const char* k) {
  return body.contains(k) && body.at(k).is_string() ? body.at(k).get<std::string>() : "";
}

}  // namespace

AskResult ask(const Config& c, const std::vector<std::string>& allowed, const json& body, const Transport& transport) {
  if (c.base_url.empty()) return { 503, nullptr, kNotConnected };
  if (const auto why = config_problem(c, allowed); !why.empty()) return { 503, nullptr, std::string(kNotConnected) + ": " + why };
  if (const auto why = validate_ask(body); !why.empty()) return { 400, nullptr, "Запрос MENTAT: " + why };
  const auto url = parse_url(c.base_url);
  const auto t0 = std::chrono::steady_clock::now();
  const HttpReply r = transport("POST", *url, chat_path(c, *url), build_payload(c, body.at("messages")).dump(), c);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
  if (r.status == 0) return { 502, nullptr, "Локальная модель не отвечает (" + r.error + ")" };
  if (!r.error.empty()) return { 502, nullptr, "Локальная модель: " + r.error };
  if (r.status != 200) return { 502, nullptr, "Локальная модель вернула HTTP " + std::to_string(r.status) };
  json parsed;
  try { parsed = json::parse(r.body); } catch (...) { return { 502, nullptr, "Ответ модели — не JSON" }; }
  const auto text = parse_answer(c.flavour, parsed);
  if (!text) return { 502, nullptr, "В ответе модели нет текста (вид API: " + c.flavour + ")" };
  return { 200, { {"text", *text}, {"model", c.model}, {"flavour", c.flavour}, {"ms", ms},
                  {"prompt_version", str_field(body, "prompt_version")} }, "" };
}

json status_json(const Config& c, const std::vector<std::string>& allowed, const json& stored, bool probe,
                 const Transport& transport) {
  const std::string problem = config_problem(c, allowed);
  json s = {
    {"configured", problem.empty()}, {"source", c.source.empty() ? json(nullptr) : json(c.source)},
    {"base_url", c.base_url}, {"model", c.model}, {"flavour", c.flavour}, {"reachable", nullptr},
    {"error", c.base_url.empty() ? "" : problem}, {"models", json::array()},
    {"settings", normalize_settings(stored)}, {"env_locked", c.env_locked},
  };
  if (!probe || !problem.empty()) return s;
  const auto url = parse_url(c.base_url);
  const HttpReply r = transport("GET", *url, models_path(c, *url), "", c);
  s["reachable"] = r.status == 200;
  if (r.status == 0) { s["error"] = "модель не отвечает (" + r.error + ")"; return s; }
  if (r.status != 200) { s["error"] = "сервер модели вернул HTTP " + std::to_string(r.status); return s; }
  try {
    const auto models = parse_models(c.flavour, json::parse(r.body));
    s["models"] = models;
    if (!models.empty() && std::find(models.begin(), models.end(), c.model) == models.end())
      s["error"] = "модель «" + c.model + "» не найдена на сервере модели";
  } catch (...) { s["error"] = "список моделей — не JSON"; }
  return s;
}

json audit_payload(const json& body, const Config& c, const AskResult& r) {
  json ctx = body.is_object() && body.contains("context") && body.at("context").is_object() ? body.at("context") : json::object();
  json p = {
    {"template_id", str_field(body, "template_id")}, {"prompt_version", str_field(body, "prompt_version")},
    {"asked", str_field(body, "asked")},
    {"question", body.is_object() && body.contains("messages") ? question_of(body.at("messages")) : ""},
    {"context_nodes", ctx.value("nodes", 0)}, {"context_tokens", ctx.value("tokens", 0)},
    {"model", c.model}, {"flavour", c.flavour}, {"status", r.status},
  };
  if (r.status == 200) {
    p["ms"] = r.data.value("ms", 0);
    const std::string text = r.data.value("text", "");
    p["answer_chars"] = text.size();
    if (c.audit_answers) p["answer"] = text;
  } else {
    p["error"] = r.error;
  }
  return p;
}

void register_routes(httplib::Server& svr, Database& db, AuditFn audit) {
  svr.Get("/api/mentat/status", [&db](const httplib::Request& req, httplib::Response& res) {
    const Env env = read_env();
    const json stored = load_prefs(db);
    const bool probe = req.has_param("probe") && req.get_param_value("probe") == "1";
    reply(res, 200, status_json(resolve_config(stored, env), allowed_hosts(env), stored, probe, http_transport));
  });

  svr.Put("/api/mentat/settings", [&db, audit](const httplib::Request& req, httplib::Response& res) {
    if (req.body.size() > 16 * 1024) { reply(res, 413, nullptr, "Настройки MENTAT: слишком большой запрос"); return; }
    json raw;
    try { raw = json::parse(req.body); } catch (...) { reply(res, 400, nullptr, "Настройки MENTAT: тело — не JSON"); return; }
    const json s = normalize_settings(raw);
    const Env env = read_env();
    const std::string url = s["base_url"].get<std::string>();
    if (!url.empty()) {
      if (const auto why = validate_base_url(url, allowed_hosts(env)); !why.empty()) { reply(res, 400, nullptr, why); return; }
    }
    try {
      db.exec("INSERT INTO app_prefs(key,value,updated_at) VALUES(?,?,datetime('now')) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')", { kPrefsKey, s.dump() });
    } catch (std::exception& e) { reply(res, 500, nullptr, e.what()); return; }
    audit("mentat", "settings", "UPDATE", s);
    reply(res, 200, status_json(resolve_config(s, env), allowed_hosts(env), s, false, http_transport));
  });

  svr.Post("/api/mentat/ask", [&db, audit](const httplib::Request& req, httplib::Response& res) {
    if (req.body.size() > kMaxBodyBytes) { reply(res, 413, nullptr, "Запрос MENTAT больше лимита"); return; }
    json body;
    try { body = json::parse(req.body); } catch (...) { reply(res, 400, nullptr, "Запрос MENTAT: тело — не JSON"); return; }
    const Env env = read_env();
    const Config cfg = resolve_config(load_prefs(db), env);
    const AskResult r = ask(cfg, allowed_hosts(env), body, http_transport);
    audit("mentat", str_field(body, "template_id"), r.status == 200 ? "ASK" : "ASK_FAILED", audit_payload(body, cfg, r));
    reply(res, r.status, r.data, r.error);
  });
}

}  // namespace maos::mentat
