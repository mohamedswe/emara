import type {
  FrameworkPack,
  JavaScriptFrameworkConventions,
  PythonFrameworkConventions,
} from "./types.js";

const NODE_HTTP: JavaScriptFrameworkConventions = {
  httpFactoryNames: [
    "Application", "Elysia", "Hapi.server", "Hono", "Koa", "NestFactory.create",
    "Router", "createApp", "createRouter", "express", "fastify",
  ],
  httpReceivers: ["app", "fastify", "router", "server"],
  httpMethods: ["all", "delete", "get", "head", "options", "patch", "post", "put"],
  websocketMethods: ["ws", "websocket"],
  startupReceivers: ["app", "fastify", "server"],
};

const PYTHON_HTTP_DECORATORS: PythonFrameworkConventions = {
  applicationFactoryNames: [
    "APIFlask", "FastAPI", "Flask", "Litestar", "Quart", "Sanic", "Starlette",
    "get_asgi_application", "get_wsgi_application",
  ],
  decorators: [
    { decorator: "app.delete", kind: "http", httpMethod: "DELETE" },
    { decorator: "app.get", kind: "http", httpMethod: "GET" },
    { decorator: "app.head", kind: "http", httpMethod: "HEAD" },
    { decorator: "app.options", kind: "http", httpMethod: "OPTIONS" },
    { decorator: "app.patch", kind: "http", httpMethod: "PATCH" },
    { decorator: "app.post", kind: "http", httpMethod: "POST" },
    { decorator: "app.put", kind: "http", httpMethod: "PUT" },
    { decorator: "app.route", kind: "http" },
    { decorator: "blueprint.route", kind: "http" },
    { decorator: "bp.route", kind: "http" },
    { decorator: "router.delete", kind: "http", httpMethod: "DELETE" },
    { decorator: "router.get", kind: "http", httpMethod: "GET" },
    { decorator: "router.patch", kind: "http", httpMethod: "PATCH" },
    { decorator: "router.post", kind: "http", httpMethod: "POST" },
    { decorator: "router.put", kind: "http", httpMethod: "PUT" },
    { decorator: "router.websocket", kind: "websocket", httpMethod: "GET" },
  ],
  calls: [
    { callee: "add_api_route", kind: "http", handlerArgumentIndex: 1 },
    { callee: "add_route", kind: "http", handlerArgumentIndex: 1 },
    { callee: "add_url_rule", kind: "http", handlerArgumentIndex: 1 },
    { callee: "add_delete", kind: "http", httpMethod: "DELETE", handlerArgumentIndex: 1 },
    { callee: "add_get", kind: "http", httpMethod: "GET", handlerArgumentIndex: 1 },
    { callee: "add_head", kind: "http", httpMethod: "HEAD", handlerArgumentIndex: 1 },
    { callee: "add_options", kind: "http", httpMethod: "OPTIONS", handlerArgumentIndex: 1 },
    { callee: "add_patch", kind: "http", httpMethod: "PATCH", handlerArgumentIndex: 1 },
    { callee: "add_post", kind: "http", httpMethod: "POST", handlerArgumentIndex: 1 },
    { callee: "add_put", kind: "http", httpMethod: "PUT", handlerArgumentIndex: 1 },
  ],
};

export const FRAMEWORK_PACKS: readonly FrameworkPack[] = [
  {
    id: "node-http",
    displayName: "Node HTTP frameworks",
    family: "node-http",
    languages: ["javascript", "typescript", "tsx"],
    support: "semantic",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["express", "fastify", "koa", "@hapi/hapi"],
      importPrefixes: ["express", "fastify", "koa", "@hapi/hapi"],
    },
    javascript: NODE_HTTP,
  },
  {
    id: "edge-http",
    displayName: "Edge and alternative JavaScript HTTP frameworks",
    family: "node-http",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["hono", "elysia", "@trpc/server", "nitropack", "h3", "adonisjs"],
      importPrefixes: ["hono", "elysia", "@trpc/", "nitropack", "h3", "@adonisjs/"],
    },
    javascript: NODE_HTTP,
  },
  {
    id: "nestjs",
    displayName: "NestJS",
    family: "decorator-http",
    languages: ["typescript"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["@nestjs/common", "@nestjs/core", "@nestjs/graphql"],
      importPrefixes: ["@nestjs/"],
    },
    javascript: {
      httpDecorators: {
        All: "ALL", Delete: "DELETE", Get: "GET", Head: "HEAD",
        Options: "OPTIONS", Patch: "PATCH", Post: "POST", Put: "PUT",
      },
      graphqlDecorators: {
        Mutation: "mutation", Query: "query", Subscription: "subscription",
      },
      scheduleDecorators: ["Cron", "Interval", "Timeout"],
      eventDecorators: ["EventPattern", "MessagePattern", "OnEvent"],
      startupSymbolNames: ["bootstrap"],
    },
  },
  {
    id: "javascript-cli",
    displayName: "JavaScript CLI frameworks",
    family: "cli",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "syntax-stable",
    detection: {
      packageNames: ["commander", "yargs", "oclif"],
      importPrefixes: ["commander", "yargs", "@oclif/"],
    },
    javascript: { cliReceivers: ["cli", "command", "commander", "program", "yargs"] },
  },
  {
    id: "javascript-events",
    displayName: "JavaScript event and job frameworks",
    family: "events-jobs",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["bull", "bullmq", "kafkajs", "amqplib", "node-cron", "node-schedule"],
      importPrefixes: ["bull", "bullmq", "kafkajs", "amqplib", "node-cron", "node-schedule"],
    },
    javascript: {
      eventReceivers: ["bus", "consumer", "queue"],
      eventSubscribeMethods: ["addListener", "consume", "on", "once", "subscribe"],
      eventPublishMethods: ["dispatch", "emit", "publish"],
      scheduleReceivers: ["cron", "schedule", "scheduler"],
      scheduleMethods: ["cron", "every", "schedule", "scheduleJob"],
    },
  },
  {
    id: "knex",
    displayName: "Knex migrations",
    family: "database-migrations",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "syntax-stable",
    detection: {
      packageNames: ["knex"],
      importPrefixes: ["knex"],
      pathPatterns: [/(?:^|\/)db\/knex_migrations\/.*\.[cm]?[jt]s$/u],
    },
    javascript: {
      lifecycleExports: [{
        pathPattern: /(?:^|\/)db\/knex_migrations\/.*\.[cm]?[jt]s$/u,
        exportedNames: ["down", "up"],
        namePrefix: "Knex migration",
      }],
    },
  },
  {
    id: "next-app-router",
    displayName: "Next.js App Router",
    family: "application",
    languages: ["javascript", "typescript", "tsx"],
    support: "entrypoints",
    versionPolicy: "syntax-stable",
    detection: {
      packageNames: ["next"],
      importPrefixes: ["next"],
      pathPatterns: [
        /(?:^|\/)app\/(?:.*\/)?(?:page|route)\.[cm]?[jt]sx?$/u,
        /(?:^|\/)middleware\.[cm]?[jt]s$/u,
        /(?:^|\/)next\.config\.[cm]?[jt]s$/u,
      ],
    },
    javascript: {
      lifecycleExports: [
        {
          pathPattern: /(?:^|\/)middleware\.[cm]?[jt]s$/u,
          exportedNames: ["config", "default", "middleware"],
          namePrefix: "Next.js middleware",
        },
        {
          pathPattern: /(?:^|\/)next\.config\.[cm]?[jt]s$/u,
          exportedNames: ["default"],
          namePrefix: "Next.js config",
        },
        {
          pathPattern: /(?:^|\/)eslint\.config\.[cm]?[jt]s$/u,
          exportedNames: ["default"],
          namePrefix: "ESLint config",
        },
        {
          pathPattern: /(?:^|\/)app\/(?:.*\/)?(?:layout|page)\.[cm]?[jt]sx?$/u,
          exportedNames: ["dynamic", "generateMetadata", "metadata", "revalidate"],
          namePrefix: "Next.js route metadata",
        },
        {
          pathPattern: /(?:^|\/)app\/(?:.*\/)?layout\.[cm]?[jt]sx?$/u,
          exportedNames: ["default"],
          namePrefix: "Next.js App Router layout",
        },
      ],
    },
  },
  {
    id: "javascript-graphql",
    displayName: "JavaScript GraphQL frameworks",
    family: "graphql",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["graphql", "@apollo/server", "type-graphql", "pothos"],
      importPrefixes: ["graphql", "@apollo/", "type-graphql", "@pothos/"],
    },
    javascript: {
      graphqlReceivers: ["builder", "graphql", "resolver", "schema"],
      graphqlMethods: {
        mutation: "mutation", mutationField: "mutation", query: "query",
        queryField: "query", subscription: "subscription", subscriptionField: "subscription",
      },
    },
  },
  {
    id: "javascript-application",
    displayName: "JavaScript application runtimes",
    family: "application",
    languages: ["javascript", "typescript", "tsx"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["next", "@remix-run/node", "@sveltejs/kit", "astro", "electron", "expo"],
      importPrefixes: ["next", "@remix-run/", "@sveltejs/", "astro", "electron", "expo"],
      pathPatterns: [/(?:^|\/)app\/.*\/route\.[cm]?[jt]sx?$/u, /(?:^|\/)pages\/api\//u],
    },
    javascript: {
      exportedApplicationHandlerNames: ["handler"],
      startupSymbolNames: ["bootstrap", "buildApp", "main"],
    },
  },
  {
    id: "react-family",
    displayName: "React family",
    family: "component-ui",
    languages: ["javascript", "typescript", "tsx"],
    support: "semantic",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["react", "react-dom", "react-native", "expo", "next", "@remix-run/react"],
      importPrefixes: ["react", "react-dom", "react-native", "expo", "next", "@remix-run/"],
    },
    notes: ["JSX render relationships are extracted by the language frontend."],
  },
  {
    id: "vue-family",
    displayName: "Vue and Nuxt",
    family: "component-ui",
    languages: ["javascript", "typescript"],
    support: "baseline",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["vue", "nuxt"], importPrefixes: ["vue", "nuxt", "#app"],
      pathPatterns: [/\.vue$/u, /(?:^|\/)nuxt\.config\.[cm]?[jt]s$/u],
    },
    notes: ["Script blocks are parsed; template semantics remain diagnostic-only."],
  },
  {
    id: "svelte-family",
    displayName: "Svelte and SvelteKit",
    family: "component-ui",
    languages: ["javascript", "typescript"],
    support: "baseline",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["svelte", "@sveltejs/kit"], importPrefixes: ["svelte", "@sveltejs/"],
      pathPatterns: [/\.svelte$/u, /(?:^|\/)svelte\.config\.[cm]?js$/u],
    },
    notes: ["Script blocks are parsed; template semantics remain diagnostic-only."],
  },
  {
    id: "angular",
    displayName: "Angular",
    family: "component-ui",
    languages: ["typescript"],
    support: "baseline",
    versionPolicy: "major-fixtures",
    detection: { packageNames: ["@angular/core"], importPrefixes: ["@angular/"] },
  },
  {
    id: "solid-family",
    displayName: "Solid and SolidStart",
    family: "component-ui",
    languages: ["javascript", "typescript", "tsx"],
    support: "semantic",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["solid-js", "@solidjs/start"],
      importPrefixes: ["solid-js", "@solidjs/"],
    },
    notes: ["JSX render relationships are extracted by the language frontend."],
  },
  {
    id: "astro",
    displayName: "Astro",
    family: "component-ui",
    languages: ["javascript", "typescript"],
    support: "baseline",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["astro"], importPrefixes: ["astro"],
      pathPatterns: [/\.astro$/u, /(?:^|\/)astro\.config\.[cm]?[jt]s$/u],
    },
    notes: ["Frontmatter is parsed; template semantics remain diagnostic-only."],
  },
  {
    id: "javascript-serverless",
    displayName: "JavaScript serverless runtimes",
    family: "serverless",
    languages: ["javascript", "typescript"],
    support: "entrypoints",
    versionPolicy: "syntax-stable",
    detection: {
      packageNames: ["serverless", "firebase-functions", "@cloudflare/workers-types", "@vercel/functions"],
      importPrefixes: ["serverless", "firebase-functions", "@cloudflare/", "@vercel/"],
      pathPatterns: [/(?:^|\/)serverless\.ya?ml$/u, /(?:^|\/)wrangler\.toml$/u],
    },
    javascript: { exportedApplicationHandlerNames: ["handler", "fetch"] },
  },
  {
    id: "python-http",
    displayName: "Python API frameworks",
    family: "python-http",
    languages: ["python"],
    support: "semantic",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: [
        "aiohttp", "apiflask", "bottle", "falcon", "fastapi", "flask", "litestar",
        "pyramid", "quart", "sanic", "starlette", "tornado",
      ],
      importPrefixes: [
        "aiohttp", "apiflask", "bottle", "falcon", "fastapi", "flask", "litestar",
        "pyramid", "quart", "sanic", "starlette", "tornado",
      ],
    },
    python: PYTHON_HTTP_DECORATORS,
  },
  {
    id: "django",
    displayName: "Django and Django REST Framework",
    family: "django",
    languages: ["python"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["django", "djangorestframework"],
      importPrefixes: ["django", "rest_framework"],
      pathPatterns: [/(?:^|\/)manage\.py$/u, /(?:^|\/)urls\.py$/u],
    },
    python: {
      decorators: [
        { decorator: "api_view", kind: "http" },
        { decorator: "action", kind: "http" },
      ],
      calls: [
        { callee: "path", kind: "http", handlerArgumentIndex: 1 },
        { callee: "re_path", kind: "http", handlerArgumentIndex: 1 },
      ],
    },
  },
  {
    id: "python-jobs",
    displayName: "Python task and workflow frameworks",
    family: "events-jobs",
    languages: ["python"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["celery", "apache-airflow", "prefect", "apscheduler", "rq"],
      importPrefixes: ["celery", "airflow", "prefect", "apscheduler", "rq"],
    },
    python: {
      decorators: [
        { decorator: "app.task", kind: "event", namePrefix: "task" },
        { decorator: "celery.task", kind: "event", namePrefix: "task" },
        { decorator: "shared_task", kind: "event", namePrefix: "task" },
        { decorator: "task", kind: "event", namePrefix: "task" },
        { decorator: "flow", kind: "application", namePrefix: "flow" },
        { decorator: "dag", kind: "scheduled", namePrefix: "dag" },
        { decorator: "scheduler.scheduled_job", kind: "scheduled", namePrefix: "job" },
      ],
    },
  },
  {
    id: "python-cli",
    displayName: "Python CLI frameworks",
    family: "cli",
    languages: ["python"],
    support: "entrypoints",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["click", "typer"], importPrefixes: ["click", "typer"],
    },
    python: {
      decorators: [
        { decorator: "click.command", kind: "cli" },
        { decorator: "click.group", kind: "cli" },
        { decorator: "app.command", kind: "cli" },
        { decorator: "typer.command", kind: "cli" },
      ],
    },
  },
  {
    id: "python-data-ui",
    displayName: "Python data application frameworks",
    family: "data-ui",
    languages: ["python"],
    support: "baseline",
    versionPolicy: "major-fixtures",
    detection: {
      packageNames: ["streamlit", "gradio", "dash", "jupyter"],
      importPrefixes: ["streamlit", "gradio", "dash", "IPython", "jupyter"],
    },
    python: {
      applicationFactoryNames: ["Blocks", "Dash", "Interface"],
      startupSymbolNames: ["main"],
    },
  },
  {
    id: "python-serverless",
    displayName: "Python serverless runtimes",
    family: "serverless",
    languages: ["python"],
    support: "entrypoints",
    versionPolicy: "syntax-stable",
    detection: {
      importPrefixes: ["awslambdaric", "azure.functions", "functions_framework"],
      pathPatterns: [/(?:^|\/)lambda_function\.py$/u, /(?:^|\/)function_app\.py$/u],
    },
    python: {
      exportedApplicationHandlerNames: ["handler", "lambda_handler"],
    },
  },
] as const;

export function mergedJavaScriptConventions(
  packs: readonly FrameworkPack[] = FRAMEWORK_PACKS,
): Required<JavaScriptFrameworkConventions> {
  const javascript = packs.flatMap((pack) =>
    pack.javascript === undefined ? [] : [pack.javascript]
  );
  return {
    httpFactoryNames: unique(javascript.flatMap((item) => item.httpFactoryNames ?? [])),
    httpReceivers: unique(javascript.flatMap((item) => item.httpReceivers ?? [])),
    httpMethods: unique(javascript.flatMap((item) => item.httpMethods ?? [])),
    websocketMethods: unique(javascript.flatMap((item) => item.websocketMethods ?? [])),
    cliReceivers: unique(javascript.flatMap((item) => item.cliReceivers ?? [])),
    eventReceivers: unique(javascript.flatMap((item) => item.eventReceivers ?? [])),
    eventSubscribeMethods: unique(javascript.flatMap((item) => item.eventSubscribeMethods ?? [])),
    eventPublishMethods: unique(javascript.flatMap((item) => item.eventPublishMethods ?? [])),
    scheduleReceivers: unique(javascript.flatMap((item) => item.scheduleReceivers ?? [])),
    scheduleMethods: unique(javascript.flatMap((item) => item.scheduleMethods ?? [])),
    graphqlReceivers: unique(javascript.flatMap((item) => item.graphqlReceivers ?? [])),
    graphqlMethods: Object.assign({}, ...javascript.map((item) => item.graphqlMethods ?? {})),
    startupReceivers: unique(javascript.flatMap((item) => item.startupReceivers ?? [])),
    startupSymbolNames: unique(javascript.flatMap((item) => item.startupSymbolNames ?? [])),
    exportedApplicationHandlerNames: unique(javascript.flatMap((item) => item.exportedApplicationHandlerNames ?? [])),
    httpDecorators: Object.assign({}, ...javascript.map((item) => item.httpDecorators ?? {})),
    graphqlDecorators: Object.assign({}, ...javascript.map((item) => item.graphqlDecorators ?? {})),
    scheduleDecorators: unique(javascript.flatMap((item) => item.scheduleDecorators ?? [])),
    eventDecorators: unique(javascript.flatMap((item) => item.eventDecorators ?? [])),
    lifecycleExports: uniqueBy(
      javascript.flatMap((item) => item.lifecycleExports ?? []),
      (item) => [
        item.pathPattern.source,
        item.pathPattern.flags,
        [...item.exportedNames].sort(compareStrings).join("\0"),
        item.namePrefix,
      ].join("\0"),
    ),
  };
}

export function mergedPythonConventions(
  packs: readonly FrameworkPack[] = FRAMEWORK_PACKS,
): Required<PythonFrameworkConventions> {
  const python = packs.flatMap((pack) =>
    pack.python === undefined ? [] : [pack.python]
  );
  return {
    applicationFactoryNames: unique(
      python.flatMap((item) => item.applicationFactoryNames ?? []),
    ),
    decorators: uniqueBy(
      python.flatMap((item) => item.decorators ?? []),
      (item) => `${item.decorator}\0${item.kind}\0${item.httpMethod ?? ""}`,
    ),
    calls: uniqueBy(
      python.flatMap((item) => item.calls ?? []),
      (item) => `${item.callee}\0${item.kind}\0${item.httpMethod ?? ""}`,
    ),
    startupSymbolNames: unique(python.flatMap((item) => item.startupSymbolNames ?? [])),
    exportedApplicationHandlerNames: unique(
      python.flatMap((item) => item.exportedApplicationHandlerNames ?? []),
    ),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(key(value), value);
  return [...byKey.values()].sort((left, right) => compareStrings(key(left), key(right)));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
