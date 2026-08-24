import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePythonSourceFile } from "./parsePythonSourceFile.ts";

test("extracts Python symbols, imports, calls, routes, and startup entrypoints", () => {
  const parsed = parsePythonSourceFile("app/api.py", [
    "from fastapi import FastAPI, APIRouter",
    "from .services import create",
    "from . import helpers",
    "app = FastAPI()",
    "router = APIRouter(prefix='/api')",
    "@router.post('/users')",
    "async def create_user(payload):",
    "    helpers.audit(payload)",
    "    return create(payload)",
    "",
    "class Worker:",
    "    @app.get('/work')",
    "    def run(self):",
    "        return helpers.work()",
    "",
    "if __name__ == '__main__':",
    "    create_user({})",
  ].join("\n"));

  assert.equal(parsed.language, "python");
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(
    parsed.symbols.map(({ type, name, exported }) => ({ type, name, exported })),
    [
      { type: "variable", name: "app", exported: true },
      { type: "variable", name: "router", exported: true },
      { type: "function", name: "create_user", exported: true },
      { type: "class", name: "Worker", exported: true },
      { type: "function", name: "Worker.run", exported: false },
    ],
  );
  assert.deepEqual(
    parsed.imports.map(({ kind, source, importedName, localName }) => ({
      kind, source, importedName, localName,
    })),
    [
      { kind: "named", source: "fastapi", importedName: "FastAPI", localName: "FastAPI" },
      { kind: "named", source: "fastapi", importedName: "APIRouter", localName: "APIRouter" },
      { kind: "named", source: ".services", importedName: "create", localName: "create" },
      { kind: "namespace", source: ".helpers", importedName: "*", localName: "helpers" },
    ],
  );
  assert.ok(parsed.calls.some((call) =>
    call.callee === "create" && call.caller === "create_user" && call.importedLocalName === "create"
  ));
  assert.ok(parsed.calls.some((call) =>
    call.callee === "helpers.work" && call.caller === "Worker.run" && call.importedLocalName === "helpers"
  ));
  assert.deepEqual(
    parsed.entrypoints.map(({ kind, name, handlerName, httpMethod, route }) => ({
      kind, name, handlerName, httpMethod, route,
    })),
    [
      { kind: "application", name: "app application", handlerName: undefined, httpMethod: undefined, route: undefined },
      { kind: "http", name: "POST /api/users", handlerName: "create_user", httpMethod: "POST", route: "/api/users" },
      { kind: "http", name: "GET /work", handlerName: "Worker.run", httpMethod: "GET", route: "/work" },
      { kind: "startup", name: "python __main__", handlerName: undefined, httpMethod: undefined, route: undefined },
    ],
  );
});

test("extracts Django, Celery, Click, and serverless conventions", () => {
  const parsed = parsePythonSourceFile("service/handlers.py", [
    "from django.urls import path",
    "from celery import shared_task",
    "import click",
    "",
    "def health(request):",
    "    return response()",
    "",
    "urlpatterns = [path('health/', health)]",
    "",
    "@shared_task",
    "def refresh_cache():",
    "    publish('cache.refreshed')",
    "",
    "@click.command()",
    "def inspect():",
    "    pass",
    "",
    "def lambda_handler(event, context):",
    "    return health(event)",
  ].join("\n"));

  assert.ok(parsed.entrypoints.some((item) =>
    item.kind === "http" && item.route === "health/" && item.handlerName === "health"
  ));
  assert.ok(parsed.entrypoints.some((item) =>
    item.kind === "event" && item.handlerName === "refresh_cache"
  ));
  assert.ok(parsed.entrypoints.some((item) =>
    item.kind === "cli" && item.handlerName === "inspect"
  ));
  assert.ok(parsed.entrypoints.some((item) =>
    item.kind === "application" && item.handlerName === "lambda_handler"
  ));
  assert.deepEqual(parsed.events, [{
    name: "cache.refreshed",
    operation: "publish",
    ownerName: "refresh_cache",
    lineRange: { start: 12, end: 12 },
  }]);
});

test("reports Python syntax errors and unresolved entrypoint-like decorators", () => {
  const unresolved = parsePythonSourceFile("app.py", [
    "@custom.handler('/x')",
    "def x():",
    "    return 1",
  ].join("\n"));
  assert.deepEqual(unresolved.diagnostics, []);
  assert.equal(unresolved.frameworkDiagnostics.length, 1);

  const broken = parsePythonSourceFile("broken.py", "def broken(:\n    pass\n");
  assert.ok(broken.diagnostics.length > 0);
});

test("extracts imported Python type and callable references with their owners", () => {
  const parsed = parsePythonSourceFile("app/api.py", [
    "from .models import ChatRequest, ChatResponse",
    "from .processor import pdf_processor",
    "@router.post('/', response_model=ChatResponse)",
    "async def upload(request: ChatRequest, tasks):",
    "    tasks.add_task(pdf_processor.process_document, request.id)",
  ].join("\n"));

  assert.deepEqual(
    parsed.references.map(({ targetName, ownerName, importedLocalName }) => ({
      targetName,
      ownerName,
      importedLocalName,
    })),
    [
      {
        targetName: "ChatResponse",
        ownerName: "upload",
        importedLocalName: "ChatResponse",
      },
      {
        targetName: "ChatRequest",
        ownerName: "upload",
        importedLocalName: "ChatRequest",
      },
      {
        targetName: "pdf_processor.process_document",
        ownerName: "upload",
        importedLocalName: "pdf_processor",
      },
    ],
  );
});
