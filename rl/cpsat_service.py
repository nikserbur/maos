"""Sidecar CP-SAT для правила «CP-SAT» Стадии 1 (PLAN-V2 §8 п.1, A2).

Запуск (из корня репозитория, venv стенда rl/.venv с OR-Tools):

    rl/.venv/bin/python -m rl.cpsat_service            # 127.0.0.1:8091
    rl/.venv/bin/python -m rl.cpsat_service --port 8091 --max-concurrent 2

Только localhost (адрес привязки фиксирован 127.0.0.1 — наружу sidecar не открывается).
Backend (CpSatRule.cpp) ищет его по $MAOS_CPSAT_URL (по умолчанию http://127.0.0.1:8091).

    GET  /health  → {"ok": true, "ortools": "<версия>", "busy": n}
    GET  /schema  → описание входа (rl.bench.cpsat_full.payload_schema)
    POST /solve   → вход solve_payload (джобы развёртки Expander + станки/календари/рабочие/сроки,
                    либо {"instance": Instance JSON SimEnv}); ответ — FullResult.to_json():
                    {status, objective, makespan, tardiness, bound, time_s, starts[], machines[], …}

Модель — rl/bench/cpsat_full.py (альтернативные станки, наладки через circuit, рабочие как
cumulative, календари как запрещённые интервалы, предшествование лотов/подпартий).
"""
from __future__ import annotations

import argparse
import json
import logging
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ortools import __version__ as ORTOOLS_VERSION

from rl.bench.cpsat_full import payload_schema, solve_payload

HOST = "127.0.0.1"              # техн.: только localhost
DEFAULT_PORT = 8091
MAX_BODY_BYTES = 64 * 1024 * 1024
log = logging.getLogger("cpsat_service")


class _State:
    def __init__(self, max_concurrent: int) -> None:
        self.slots = threading.BoundedSemaphore(max(1, max_concurrent))
        self.busy = 0
        self.lock = threading.Lock()


def make_handler(state: _State):
    class Handler(BaseHTTPRequestHandler):
        server_version = "maos-cpsat/1"

        def log_message(self, fmt: str, *args) -> None:  # noqa: D401 — тише стандартного вывода
            log.info("%s %s", self.address_string(), fmt % args)

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(HTTPStatus.OK, {"ok": True, "ortools": ORTOOLS_VERSION, "busy": state.busy})
            elif self.path == "/schema":
                self._send(HTTPStatus.OK, payload_schema())
            else:
                self._send(HTTPStatus.NOT_FOUND, {"error": "нет такого пути"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/solve":
                self._send(HTTPStatus.NOT_FOUND, {"error": "нет такого пути"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE if length > 0 else HTTPStatus.BAD_REQUEST,
                           {"status": "ERROR", "error": "пустое или слишком большое тело запроса"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                self._send(HTTPStatus.BAD_REQUEST, {"status": "ERROR", "error": f"некорректный JSON: {e}"})
                return
            self._solve(payload)

        def _solve(self, payload: dict) -> None:
            with state.slots:
                with state.lock:
                    state.busy += 1
                try:
                    res = solve_payload(payload)
                except Exception as e:  # noqa: BLE001 — ошибка модели не должна ронять сервис
                    log.exception("solve failed")
                    self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "ERROR", "error": str(e)})
                    return
                finally:
                    with state.lock:
                        state.busy -= 1
            code = HTTPStatus.BAD_REQUEST if res.status == "ERROR" else HTTPStatus.OK
            log.info("solve %s: %s jobs=%d obj=%s bound=%.1f %.1fs", payload.get("name", "?"), res.status,
                     res.n_jobs, res.objective, res.bound, res.time_s)
            self._send(code, res.to_json())

    return Handler


def serve(port: int = DEFAULT_PORT, max_concurrent: int = 2) -> ThreadingHTTPServer:
    """Создать сервер (не запуская цикл) — для тестов и main()."""
    return ThreadingHTTPServer((HOST, port), make_handler(_State(max_concurrent)))


def main() -> None:
    ap = argparse.ArgumentParser(description="CP-SAT sidecar Стадии 1 (только 127.0.0.1)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--max-concurrent", type=int, default=2)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    srv = serve(a.port, a.max_concurrent)
    log.info("CP-SAT sidecar на http://%s:%d (OR-Tools %s)", HOST, a.port, ORTOOLS_VERSION)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
