#pragma once
/**
 * MENTAT-API (METHODOLOGY-V2 §9, блок [8]): прокси к ЛОКАЛЬНОЙ модели владельца. Сам сервер ничего не
 * «объясняет» и ответов не придумывает: промпт (правила + контекст графа расчёта + вопрос) собирает фронтенд
 * (src/features/explain/prompts), сервер проверяет запрос, пересылает его модели — только если адрес задан
 * (MAOS_LLM_URL или настройки проекта `mentat.llm`) и разрешён — и пишет аудит вопроса.
 *
 *   GET  /api/mentat/status[?probe=1] — задана ли модель, откуда адрес, отвечает ли (probe), список моделей;
 *   PUT  /api/mentat/settings         — настройки проекта (адрес, модель, вид API, температура, лимиты);
 *   POST /api/mentat/ask              — {messages, template_id, prompt_version, asked, context} → {text, model,…};
 *                                       503 {error:"LLM не подключена"}, если адрес не задан.
 * Безопасность: только http:// без логина в адресе, хост — localhost/127.0.0.0/8/::1 или явно перечисленный в
 * MAOS_LLM_ALLOWED_HOSTS (или хост самой MAOS_LLM_URL); без перенаправлений; лимиты размера запроса;
 * ключ MAOS_LLM_API_KEY только из окружения — не хранится, не возвращается, не пишется в журналы.
 */
#include <nlohmann/json.hpp>
#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace httplib { class Server; }
class Database;

namespace maos::mentat {

using json = nlohmann::json;

/** Лимиты запроса /ask (техн.). */
constexpr std::size_t kMaxBodyBytes = 512 * 1024;
constexpr std::size_t kMaxMessages = 16;
constexpr std::size_t kMaxMessageChars = 160 * 1024;
constexpr std::size_t kMaxAnswerBytes = 2 * 1024 * 1024;
/** Ключ настроек проекта в app_prefs. */
inline constexpr const char* kPrefsKey = "mentat.llm";
/** Текст 503 — фронтенд показывает честное пустое состояние. */
inline constexpr const char* kNotConnected = "LLM не подключена";

struct Url {
  std::string scheme;  // http | https
  std::string host;    // в нижнем регистре, IPv6 — без скобок
  int port = 0;
  std::string path;    // без завершающего «/», может быть пустым
};

/** Разбор адреса модели; nullopt + причина, если адрес не годится (схема, логин, запрос, порт). */
std::optional<Url> parse_url(const std::string& s, std::string* why = nullptr);
/** localhost, *.localhost, 127.0.0.0/8, ::1. */
bool is_loopback_host(const std::string& host);
/** «a.lan, B.lan» → {"a.lan","b.lan"}. */
std::vector<std::string> parse_host_list(const std::string& csv);
/** "" — адрес годится; иначе причина по-русски. */
std::string validate_base_url(const std::string& url, const std::vector<std::string>& allowed_hosts);

struct Env {
  std::string url, model, flavour, api_key, allowed_hosts;
};
/** Переменные окружения MAOS_LLM_URL / _MODEL / _FLAVOUR / _API_KEY / _ALLOWED_HOSTS. */
Env read_env();

struct Config {
  std::string base_url, model, flavour = "openai";
  std::string source;  // env | prefs | ""
  double temperature = 0.1;
  int max_tokens = 800;
  int timeout_s = 120;
  bool audit_answers = false;
  bool env_locked = false;
  std::string api_key;  // только из окружения
};

/** Настройки проекта с умолчаниями и диапазонами (те же, что src/features/explain/llm/settings.ts). */
json normalize_settings(const json& raw);
/** Окружение важнее настроек проекта (адрес, модель, вид API); прочее — из настроек. */
Config resolve_config(const json& prefs, const Env& env);
/** Разрешённые хосты: список окружения + хост MAOS_LLM_URL. */
std::vector<std::string> allowed_hosts(const Env& env);
/** "" — модель задана и адрес разрешён; иначе причина. */
std::string config_problem(const Config& c, const std::vector<std::string>& allowed);

/** Путь конечной точки чата: OpenAI-совместимый — …/v1/chat/completions, Ollama — …/api/chat. */
std::string chat_path(const Config& c, const Url& u);
/** Путь списка моделей для проверки соединения: …/v1/models или …/api/tags. */
std::string models_path(const Config& c, const Url& u);
/** Тело запроса к модели (без потоковой выдачи, низкая температура, лимит токенов). */
json build_payload(const Config& c, const json& messages);
/** Текст ответа модели или nullopt. */
std::optional<std::string> parse_answer(const std::string& flavour, const json& resp);
/** Имена моделей из ответа /v1/models или /api/tags. */
std::vector<std::string> parse_models(const std::string& flavour, const json& resp);

/** "" — тело /ask годится; иначе причина (роли, число и длина сообщений, последнее — user). */
std::string validate_ask(const json& body);
/** Вопрос пользователя из последнего сообщения (строка «ВОПРОС: …»), не длиннее 500 символов. */
std::string question_of(const json& messages);

struct HttpReply {
  int status = 0;         // 0 — нет соединения
  std::string body;
  std::string error;      // причина сбоя соединения
};
/** Транспорт к модели (подменяется в тестах). method: GET | POST. */
using Transport = std::function<HttpReply(const std::string& method, const Url& url, const std::string& path,
                                          const std::string& payload, const Config& cfg)>;
/** Настоящий HTTP-клиент (cpp-httplib), без перенаправлений. */
HttpReply http_transport(const std::string& method, const Url& url, const std::string& path,
                         const std::string& payload, const Config& cfg);

struct AskResult {
  int status = 200;
  json data;           // {text, model, flavour, ms, prompt_version}
  std::string error;
};
/** Вопрос модели: 503 — не подключена/адрес не разрешён, 400 — плохое тело, 502 — модель не ответила. */
AskResult ask(const Config& c, const std::vector<std::string>& allowed, const json& body, const Transport& transport);

/** Статус для GET /status (без секретов); probe — проверить соединение через транспорт. */
json status_json(const Config& c, const std::vector<std::string>& allowed, const json& stored, bool probe,
                 const Transport& transport);

/** Запись аудита вопроса: шаблон, версия промпта, узел, вопрос, модель, итог; ответ — только по настройке. */
json audit_payload(const json& body, const Config& c, const AskResult& r);

using AuditFn = std::function<void(const std::string& entity, const std::string& id, const std::string& action,
                                   const json& payload)>;
/** Регистрация маршрутов /api/mentat/*. */
void register_routes(httplib::Server& svr, Database& db, AuditFn audit);

}  // namespace maos::mentat
