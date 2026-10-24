// MENTAT-API: проверка адреса и запроса, сборка тела для OpenAI-совместимого API / Ollama, разбор ответа,
// аудит. Маршруты — в MentatRoutes.cpp. Все функции здесь чистые (кроме read_env и http_transport).
#include "Mentat.h"
#include <httplib.h>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>

namespace maos::mentat {
namespace {

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
  return s;
}

std::string trim(const std::string& s) {
  const auto b = s.find_first_not_of(" \t\r\n");
  if (b == std::string::npos) return "";
  return s.substr(b, s.find_last_not_of(" \t\r\n") - b + 1);
}

bool fail(std::string* why, const std::string& msg) {
  if (why) *why = msg;
  return false;
}

double num_or(const json& o, const char* k, double dflt) {
  if (!o.is_object() || !o.contains(k)) return dflt;
  const auto& v = o.at(k);
  if (v.is_number()) return v.get<double>();
  if (v.is_string()) { try { return std::stod(v.get<std::string>()); } catch (...) {} }
  return dflt;
}

std::string str_or(const json& o, const char* k) {
  return o.is_object() && o.contains(k) && o.at(k).is_string() ? trim(o.at(k).get<std::string>()) : "";
}

bool valid_host_chars(const std::string& h) {
  return !h.empty() && std::all_of(h.begin(), h.end(), [](unsigned char c) { return std::isalnum(c) || c == '.' || c == '-'; });
}

}  // namespace

std::optional<Url> parse_url(const std::string& raw, std::string* why) {
  const std::string s = trim(raw);
  const auto sep = s.find("://");
  if (sep == std::string::npos) { fail(why, "адрес должен начинаться с http://"); return std::nullopt; }
  Url u;
  u.scheme = lower(s.substr(0, sep));
  if (u.scheme != "http" && u.scheme != "https") { fail(why, "допустимы только http:// и https://"); return std::nullopt; }
  std::string rest = s.substr(sep + 3);
  if (rest.find_first_of("?#") != std::string::npos) { fail(why, "адрес без параметров запроса и якоря"); return std::nullopt; }
  const auto slash = rest.find('/');
  std::string auth = rest.substr(0, slash);
  u.path = slash == std::string::npos ? "" : rest.substr(slash);
  while (!u.path.empty() && u.path.back() == '/') u.path.pop_back();
  if (auth.find('@') != std::string::npos) { fail(why, "логин и пароль в адресе запрещены (ключ — MAOS_LLM_API_KEY)"); return std::nullopt; }
  std::string port;
  if (!auth.empty() && auth[0] == '[') {
    const auto close = auth.find(']');
    if (close == std::string::npos) { fail(why, "незакрытый IPv6-адрес"); return std::nullopt; }
    u.host = lower(auth.substr(1, close - 1));
    if (u.host.empty() || u.host.find_first_not_of("0123456789abcdef:") != std::string::npos) { fail(why, "неверный IPv6-адрес"); return std::nullopt; }
    const std::string tail = auth.substr(close + 1);
    if (!tail.empty()) {
      if (tail[0] != ':') { fail(why, "неверный адрес"); return std::nullopt; }
      port = tail.substr(1);
    }
  } else {
    const auto colon = auth.find(':');
    u.host = lower(auth.substr(0, colon));
    if (colon != std::string::npos) port = auth.substr(colon + 1);
    if (!valid_host_chars(u.host)) { fail(why, "неверное имя хоста"); return std::nullopt; }
  }
  if (port.empty()) u.port = u.scheme == "https" ? 443 : 80;
  else {
    if (port.size() > 5 || port.find_first_not_of("0123456789") != std::string::npos) { fail(why, "неверный порт"); return std::nullopt; }
    u.port = std::stoi(port);
    if (u.port < 1 || u.port > 65535) { fail(why, "порт вне 1…65535"); return std::nullopt; }
  }
  return u;
}

bool is_loopback_host(const std::string& raw) {
  std::string h = lower(raw);
  if (h.size() > 1 && h.front() == '[' && h.back() == ']') h = h.substr(1, h.size() - 2);
  if (h == "localhost" || h == "::1") return true;
  if (h.size() > 10 && h.compare(h.size() - 10, 10, ".localhost") == 0) return true;
  if (h.rfind("127.", 0) != 0) return false;
  int parts = 0;
  std::size_t i = 0;
  while (i <= h.size()) {
    const auto dot = h.find('.', i);
    const std::string oct = h.substr(i, dot == std::string::npos ? std::string::npos : dot - i);
    if (oct.empty() || oct.size() > 3 || oct.find_first_not_of("0123456789") != std::string::npos || std::stoi(oct) > 255) return false;
    ++parts;
    if (dot == std::string::npos) break;
    i = dot + 1;
  }
  return parts == 4;
}

std::vector<std::string> parse_host_list(const std::string& csv) {
  std::vector<std::string> out;
  std::size_t i = 0;
  while (i <= csv.size()) {
    const auto comma = csv.find(',', i);
    const std::string h = lower(trim(csv.substr(i, comma == std::string::npos ? std::string::npos : comma - i)));
    if (!h.empty()) out.push_back(h);
    if (comma == std::string::npos) break;
    i = comma + 1;
  }
  return out;
}

std::string validate_base_url(const std::string& url, const std::vector<std::string>& allowed) {
  std::string why;
  const auto u = parse_url(url, &why);
  if (!u) return "Адрес модели: " + why;
  if (u->scheme == "https") return "Адрес модели: поддерживается только http:// (локальная модель; TLS — через обратный прокси вне MAOS)";
  if (is_loopback_host(u->host)) return "";
  if (std::find(allowed.begin(), allowed.end(), u->host) != allowed.end()) return "";
  return "Хост " + u->host + " не локальный и не перечислен в MAOS_LLM_ALLOWED_HOSTS";
}

Env read_env() {
  auto get = [](const char* k) { const char* v = std::getenv(k); return v ? trim(v) : std::string(); };
  return { get("MAOS_LLM_URL"), get("MAOS_LLM_MODEL"), get("MAOS_LLM_FLAVOUR"), get("MAOS_LLM_API_KEY"), get("MAOS_LLM_ALLOWED_HOSTS") };
}

json normalize_settings(const json& raw) {
  auto clampd = [](double v, double lo, double hi) { return std::min(hi, std::max(lo, v)); };
  std::string url = str_or(raw, "base_url");
  while (!url.empty() && url.back() == '/') url.pop_back();
  const bool ollama = str_or(raw, "flavour") == "ollama";
  const bool examples = !(raw.is_object() && raw.contains("with_examples") && raw.at("with_examples") == false);
  const bool audit = raw.is_object() && raw.contains("audit_answers") && raw.at("audit_answers") == true;
  return {
    {"base_url", url}, {"model", str_or(raw, "model")}, {"flavour", ollama ? "ollama" : "openai"},
    {"temperature", clampd(num_or(raw, "temperature", 0.1), 0.0, 1.0)},
    {"max_tokens", (int)std::lround(clampd(num_or(raw, "max_tokens", 800), 64, 4096))},
    {"timeout_s", (int)std::lround(clampd(num_or(raw, "timeout_s", 120), 5, 600))},
    {"context_tokens", (int)std::lround(clampd(num_or(raw, "context_tokens", 3000), 500, 12000))},
    {"with_examples", examples}, {"audit_answers", audit},
  };
}

Config resolve_config(const json& prefs, const Env& env) {
  const json s = normalize_settings(prefs);
  Config c;
  c.temperature = s["temperature"].get<double>();
  c.max_tokens = s["max_tokens"].get<int>();
  c.timeout_s = s["timeout_s"].get<int>();
  c.audit_answers = s["audit_answers"].get<bool>();
  c.api_key = env.api_key;
  if (!env.url.empty()) {
    c.base_url = env.url;
    while (!c.base_url.empty() && c.base_url.back() == '/') c.base_url.pop_back();
    c.model = env.model.empty() ? s["model"].get<std::string>() : env.model;
    c.flavour = !env.flavour.empty() ? (lower(env.flavour) == "ollama" ? "ollama" : "openai") : s["flavour"].get<std::string>();
    c.source = "env";
    c.env_locked = true;
  } else if (!s["base_url"].get<std::string>().empty()) {
    c.base_url = s["base_url"].get<std::string>();
    c.model = s["model"].get<std::string>();
    c.flavour = s["flavour"].get<std::string>();
    c.source = "prefs";
  }
  return c;
}

std::vector<std::string> allowed_hosts(const Env& env) {
  auto out = parse_host_list(env.allowed_hosts);
  if (const auto u = parse_url(env.url)) out.push_back(u->host);
  return out;
}

std::string config_problem(const Config& c, const std::vector<std::string>& allowed) {
  if (c.base_url.empty()) return "адрес модели не задан";
  if (const auto why = validate_base_url(c.base_url, allowed); !why.empty()) return why;
  if (c.model.empty()) return "не задано имя модели";
  return "";
}

std::string chat_path(const Config& c, const Url& u) {
  if (c.flavour == "ollama") return u.path + "/api/chat";
  const bool v1 = u.path.size() >= 3 && u.path.compare(u.path.size() - 3, 3, "/v1") == 0;
  return u.path + (v1 ? "/chat/completions" : "/v1/chat/completions");
}

std::string models_path(const Config& c, const Url& u) {
  if (c.flavour == "ollama") return u.path + "/api/tags";
  const bool v1 = u.path.size() >= 3 && u.path.compare(u.path.size() - 3, 3, "/v1") == 0;
  return u.path + (v1 ? "/models" : "/v1/models");
}

json build_payload(const Config& c, const json& messages) {
  if (c.flavour == "ollama")
    return { {"model", c.model}, {"messages", messages}, {"stream", false},
             {"options", { {"temperature", c.temperature}, {"num_predict", c.max_tokens} }} };
  return { {"model", c.model}, {"messages", messages}, {"stream", false},
           {"temperature", c.temperature}, {"max_tokens", c.max_tokens} };
}

std::optional<std::string> parse_answer(const std::string& flavour, const json& r) {
  try {
    const json& msg = flavour == "ollama" ? r.at("message") : r.at("choices").at(0).at("message");
    const auto& content = msg.at("content");
    if (content.is_string()) return content.get<std::string>();
  } catch (...) {}
  return std::nullopt;
}

std::vector<std::string> parse_models(const std::string& flavour, const json& r) {
  std::vector<std::string> out;
  const char* list = flavour == "ollama" ? "models" : "data";
  const char* key = flavour == "ollama" ? "name" : "id";
  if (!r.is_object() || !r.contains(list) || !r.at(list).is_array()) return out;
  for (const auto& m : r.at(list))
    if (m.is_object() && m.contains(key) && m.at(key).is_string()) out.push_back(m.at(key).get<std::string>());
  return out;
}

std::string validate_ask(const json& body) {
  if (!body.is_object()) return "тело запроса — JSON-объект";
  if (!body.contains("messages") || !body.at("messages").is_array()) return "нет поля messages";
  const auto& ms = body.at("messages");
  if (ms.empty() || ms.size() > kMaxMessages) return "сообщений должно быть от 1 до " + std::to_string(kMaxMessages);
  for (const auto& m : ms) {
    if (!m.is_object() || !m.contains("role") || !m.contains("content") || !m.at("role").is_string() || !m.at("content").is_string())
      return "сообщение — {role, content}";
    const auto role = m.at("role").get<std::string>();
    if (role != "system" && role != "user" && role != "assistant") return "недопустимая роль сообщения: " + role;
    const auto& text = m.at("content").get_ref<const std::string&>();
    if (text.empty() || text.size() > kMaxMessageChars) return "длина сообщения вне лимита";
  }
  if (ms.back().at("role") != "user") return "последнее сообщение — вопрос пользователя (role = user)";
  for (const char* k : { "template_id", "prompt_version", "asked" })
    if (body.contains(k) && (!body.at(k).is_string() || body.at(k).get_ref<const std::string&>().size() > 160))
      return std::string("поле ") + k + " — строка до 160 символов";
  return "";
}

std::string question_of(const json& messages) {
  if (!messages.is_array() || messages.empty()) return "";
  const auto& last = messages.back();
  if (!last.is_object() || !last.contains("content") || !last.at("content").is_string()) return "";
  const auto& text = last.at("content").get_ref<const std::string&>();
  const auto at = text.rfind("ВОПРОС:");
  std::string q = trim(at == std::string::npos ? text : text.substr(at + std::string("ВОПРОС:").size()));
  if (q.size() > 500) {
    q.resize(500);
    while (!q.empty() && (static_cast<unsigned char>(q.back()) & 0xC0) == 0x80) q.pop_back();  // не резать UTF-8
    if (!q.empty() && (static_cast<unsigned char>(q.back()) & 0x80)) q.pop_back();
  }
  return q;
}

HttpReply http_transport(const std::string& method, const Url& url, const std::string& path,
                         const std::string& payload, const Config& cfg) {
  httplib::Client cli(url.host, url.port);
  cli.set_follow_location(false);
  cli.set_connection_timeout(std::chrono::seconds(3));
  cli.set_read_timeout(std::chrono::seconds(method == "GET" ? 5 : cfg.timeout_s));
  cli.set_write_timeout(std::chrono::seconds(30));
  httplib::Headers headers;
  if (!cfg.api_key.empty()) headers.emplace("Authorization", "Bearer " + cfg.api_key);
  auto res = method == "GET" ? cli.Get(path, headers) : cli.Post(path, headers, payload, "application/json");
  if (!res) return { 0, "", httplib::to_string(res.error()) };
  if (res->body.size() > kMaxAnswerBytes) return { res->status, "", "ответ модели больше лимита" };
  return { res->status, res->body, "" };
}

}  // namespace maos::mentat
