// MENTAT-API: проверка адреса локальной модели (только loopback или явный список), сборка тела для
// OpenAI-совместимого API и Ollama, разбор ответа, лимиты запроса, путь 503 «LLM не подключена», аудит
// без текста ответа по умолчанию и без ключа.
#include "Mentat.h"
#include <gtest/gtest.h>

using namespace maos::mentat;

namespace {

json ask_body(const std::string& question = "Почему так?") {
  return { {"messages", json::array({ { {"role", "system"}, {"content", "правила"} },
                                      { {"role", "user"}, {"content", "КОНТЕКСТ:\n{}\nВОПРОС: " + question} } })},
           {"template_id", "cvar_driver"}, {"prompt_version", "mentat-sys/1.0.0+cvar_driver@1.0+mentat-ctx/1"},
           {"asked", "crit.profit.f.cvar"}, {"context", { {"nodes", 12}, {"tokens", 900} }} };
}

Config cfg(const std::string& url = "http://127.0.0.1:11434", const std::string& flavour = "ollama") {
  Config c;
  c.base_url = url; c.model = "qwen2.5:14b"; c.flavour = flavour; c.source = "prefs";
  return c;
}

struct Recorder {
  std::string method, path, payload;
  Url url;
  HttpReply reply{ 200, R"({"message":{"role":"assistant","content":"Вывод: … ⟦node:crit.profit.f.cvar⟧."}})", "" };
  Transport fn() {
    return [this](const std::string& m, const Url& u, const std::string& p, const std::string& body, const Config&) {
      method = m; url = u; path = p; payload = body; return reply;
    };
  }
};

}  // namespace

TEST(MentatUrl, ParsesHostPortPathAndRejectsUnsafeForms) {
  auto u = parse_url("http://127.0.0.1:8000/v1/");
  ASSERT_TRUE(u);
  EXPECT_EQ(u->host, "127.0.0.1");
  EXPECT_EQ(u->port, 8000);
  EXPECT_EQ(u->path, "/v1");
  auto v6 = parse_url("http://[::1]:11434");
  ASSERT_TRUE(v6);
  EXPECT_EQ(v6->host, "::1");
  EXPECT_EQ(parse_url("http://LocalHost")->port, 80);
  std::string why;
  EXPECT_FALSE(parse_url("http://user:pw@127.0.0.1:8000", &why));
  EXPECT_NE(why.find("логин"), std::string::npos);
  EXPECT_FALSE(parse_url("file:///etc/passwd"));
  EXPECT_FALSE(parse_url("gopher://127.0.0.1"));
  EXPECT_FALSE(parse_url("http://127.0.0.1:8000/v1?x=1"));
  EXPECT_FALSE(parse_url("http://127.0.0.1:99999"));
  EXPECT_FALSE(parse_url("http://bad host/"));
  EXPECT_FALSE(parse_url("127.0.0.1:8000"));
}

TEST(MentatUrl, OnlyLoopbackOrExplicitlyAllowedHosts) {
  for (const char* h : { "localhost", "127.0.0.1", "127.9.8.7", "::1", "[::1]", "llm.localhost" }) EXPECT_TRUE(is_loopback_host(h)) << h;
  for (const char* h : { "0.0.0.0", "10.0.0.5", "127.0.0.256", "127.0.0", "localhost.evil.com", "example.com" }) EXPECT_FALSE(is_loopback_host(h)) << h;
  EXPECT_EQ(validate_base_url("http://127.0.0.1:11434", {}), "");
  EXPECT_NE(validate_base_url("https://127.0.0.1:11434", {}), "");
  EXPECT_NE(validate_base_url("http://gpu.lan:8000/v1", {}).find("MAOS_LLM_ALLOWED_HOSTS"), std::string::npos);
  EXPECT_EQ(validate_base_url("http://gpu.lan:8000/v1", parse_host_list(" GPU.lan , other ")), "");
  Env env; env.url = "http://gpu.lan:8000/v1";
  EXPECT_EQ(validate_base_url("http://gpu.lan:9000", allowed_hosts(env)), "");  // хост самой MAOS_LLM_URL разрешён
  EXPECT_NE(validate_base_url("http://169.254.169.254/latest", allowed_hosts(env)), "");
}

TEST(MentatConfig, EnvWinsOverPrefsAndSettingsAreClamped) {
  const json prefs = { {"base_url", "http://127.0.0.1:11434/"}, {"model", "llama3"}, {"flavour", "ollama"},
                       {"temperature", 7}, {"max_tokens", 5}, {"timeout_s", "30"}, {"audit_answers", true} };
  const json s = normalize_settings(prefs);
  EXPECT_EQ(s["base_url"], "http://127.0.0.1:11434");
  EXPECT_DOUBLE_EQ(s["temperature"].get<double>(), 1.0);
  EXPECT_EQ(s["max_tokens"], 64);
  EXPECT_EQ(s["timeout_s"], 30);
  EXPECT_EQ(s["with_examples"], true);
  EXPECT_EQ(normalize_settings(json::object())["flavour"], "openai");

  const Config p = resolve_config(prefs, Env{});
  EXPECT_EQ(p.source, "prefs");
  EXPECT_EQ(p.flavour, "ollama");
  EXPECT_TRUE(p.audit_answers);
  Env env; env.url = "http://127.0.0.1:8000/v1"; env.flavour = "openai"; env.api_key = "secret";
  const Config e = resolve_config(prefs, env);
  EXPECT_EQ(e.source, "env");
  EXPECT_TRUE(e.env_locked);
  EXPECT_EQ(e.base_url, "http://127.0.0.1:8000/v1");
  EXPECT_EQ(e.model, "llama3");  // модель из настроек, если в окружении нет
  EXPECT_EQ(e.flavour, "openai");
  EXPECT_EQ(resolve_config(json::object(), Env{}).source, "");
  EXPECT_EQ(config_problem(resolve_config(json::object(), Env{}), {}), "адрес модели не задан");
}

TEST(MentatPayload, OpenAiAndOllamaShapes) {
  const json msgs = ask_body()["messages"];
  Config o = cfg("http://127.0.0.1:8000/v1", "openai");
  o.temperature = 0.1; o.max_tokens = 800;
  EXPECT_EQ(chat_path(o, *parse_url(o.base_url)), "/v1/chat/completions");
  EXPECT_EQ(chat_path(o, *parse_url("http://127.0.0.1:8000")), "/v1/chat/completions");
  EXPECT_EQ(models_path(o, *parse_url(o.base_url)), "/v1/models");
  const json po = build_payload(o, msgs);
  EXPECT_EQ(po["stream"], false);
  EXPECT_EQ(po["max_tokens"], 800);
  EXPECT_DOUBLE_EQ(po["temperature"].get<double>(), 0.1);
  EXPECT_EQ(po["messages"], msgs);
  const Config l = cfg();
  EXPECT_EQ(chat_path(l, *parse_url(l.base_url)), "/api/chat");
  EXPECT_EQ(models_path(l, *parse_url(l.base_url)), "/api/tags");
  const json pl = build_payload(l, msgs);
  EXPECT_EQ(pl["options"]["num_predict"], 800);
  EXPECT_FALSE(pl.contains("max_tokens"));

  EXPECT_EQ(*parse_answer("openai", json::parse(R"({"choices":[{"message":{"role":"assistant","content":"ok"}}]})")), "ok");
  EXPECT_EQ(*parse_answer("ollama", json::parse(R"({"message":{"content":"да"}})")), "да");
  EXPECT_FALSE(parse_answer("openai", json::parse(R"({"message":{"content":"x"}})")));
  EXPECT_EQ(parse_models("ollama", json::parse(R"({"models":[{"name":"qwen"},{"x":1}]})")), std::vector<std::string>{ "qwen" });
  EXPECT_EQ(parse_models("openai", json::parse(R"({"data":[{"id":"m1"}]})")), std::vector<std::string>{ "m1" });
}

TEST(MentatAsk, ValidatesBodyLimits) {
  EXPECT_EQ(validate_ask(ask_body()), "");
  json bad = ask_body();
  bad["messages"].push_back({ {"role", "assistant"}, {"content", "x"} });
  EXPECT_NE(validate_ask(bad), "");  // последнее — не user
  json role = ask_body();
  role["messages"][0]["role"] = "tool";
  EXPECT_NE(validate_ask(role), "");
  json many = ask_body();
  for (int i = 0; i < 20; ++i) many["messages"].insert(many["messages"].begin(), { {"role", "user"}, {"content", "x"} });
  EXPECT_NE(validate_ask(many), "");
  json huge = ask_body();
  huge["messages"][1]["content"] = std::string(kMaxMessageChars + 1, 'a');
  EXPECT_NE(validate_ask(huge), "");
  EXPECT_NE(validate_ask(json::array()), "");
  EXPECT_EQ(question_of(ask_body("Что определило CVaR?")["messages"]), "Что определило CVaR?");
}

TEST(MentatAsk, Returns503WhenNotConnectedAndNeverCallsTransport) {
  Recorder rec;
  const AskResult r = ask(Config{}, {}, ask_body(), rec.fn());
  EXPECT_EQ(r.status, 503);
  EXPECT_EQ(r.error, "LLM не подключена");
  EXPECT_TRUE(rec.method.empty());
  const AskResult remote = ask(cfg("http://10.1.2.3:11434"), {}, ask_body(), rec.fn());
  EXPECT_EQ(remote.status, 503);
  EXPECT_NE(remote.error.find("не локальный"), std::string::npos);
  EXPECT_TRUE(rec.method.empty());
  Config nomodel = cfg(); nomodel.model.clear();
  EXPECT_EQ(ask(nomodel, {}, ask_body(), rec.fn()).status, 503);
}

TEST(MentatAsk, ForwardsToConfiguredEndpointAndReturnsText) {
  Recorder rec;
  const AskResult r = ask(cfg(), {}, ask_body(), rec.fn());
  ASSERT_EQ(r.status, 200) << r.error;
  EXPECT_EQ(rec.method, "POST");
  EXPECT_EQ(rec.url.port, 11434);
  EXPECT_EQ(rec.path, "/api/chat");
  const json sent = json::parse(rec.payload);
  EXPECT_EQ(sent["model"], "qwen2.5:14b");
  EXPECT_EQ(sent["messages"].size(), 2u);
  EXPECT_FALSE(sent.contains("template_id"));  // модели уходят только сообщения
  EXPECT_NE(r.data["text"].get<std::string>().find("⟦node:crit.profit.f.cvar⟧"), std::string::npos);
  EXPECT_EQ(r.data["prompt_version"], "mentat-sys/1.0.0+cvar_driver@1.0+mentat-ctx/1");
  EXPECT_EQ(ask(cfg(), {}, json{ {"messages", "x"} }, rec.fn()).status, 400);

  rec.reply = { 0, "", "Connection" };
  EXPECT_EQ(ask(cfg(), {}, ask_body(), rec.fn()).status, 502);
  rec.reply = { 500, "{}", "" };
  EXPECT_EQ(ask(cfg(), {}, ask_body(), rec.fn()).status, 502);
  rec.reply = { 200, "not json", "" };
  EXPECT_EQ(ask(cfg(), {}, ask_body(), rec.fn()).status, 502);
}

TEST(MentatStatus, ProbeListsModelsAndFlagsMissingModel) {
  Recorder rec;
  rec.reply = { 200, R"({"models":[{"name":"llama3"}]})", "" };
  const json s = status_json(cfg(), {}, json::object(), true, rec.fn());
  EXPECT_EQ(s["configured"], true);
  EXPECT_EQ(s["reachable"], true);
  EXPECT_EQ(rec.method, "GET");
  EXPECT_EQ(rec.path, "/api/tags");
  EXPECT_NE(s["error"].get<std::string>().find("не найдена"), std::string::npos);
  const json off = status_json(Config{}, {}, json::object(), true, rec.fn());
  EXPECT_EQ(off["configured"], false);
  EXPECT_TRUE(off["reachable"].is_null());
  EXPECT_FALSE(off.dump().find("api_key") != std::string::npos);
}

TEST(MentatAudit, NoAnswerTextByDefaultAndNoSecrets) {
  Recorder rec;
  Config c = cfg();
  c.api_key = "sk-very-secret";
  const AskResult r = ask(c, {}, ask_body("Что определило CVaR?"), rec.fn());
  const json p = audit_payload(ask_body("Что определило CVaR?"), c, r);
  EXPECT_EQ(p["question"], "Что определило CVaR?");
  EXPECT_EQ(p["template_id"], "cvar_driver");
  EXPECT_EQ(p["context_nodes"], 12);
  EXPECT_FALSE(p.contains("answer"));
  EXPECT_GT(p["answer_chars"].get<std::size_t>(), 0u);
  EXPECT_EQ(p.dump().find("sk-very-secret"), std::string::npos);
  c.audit_answers = true;
  EXPECT_TRUE(audit_payload(ask_body(), c, r).contains("answer"));
  const json failed = audit_payload(ask_body(), Config{}, ask(Config{}, {}, ask_body(), rec.fn()));
  EXPECT_EQ(failed["status"], 503);
  EXPECT_EQ(failed["error"], "LLM не подключена");
}
