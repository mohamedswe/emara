import {
  FRAMEWORK_PACKS,
  mergedJavaScriptConventions,
  mergedPythonConventions,
} from "./catalog.ts";
import type {
  FrameworkPack,
  JavaScriptFrameworkConventions,
  JavaScriptLifecycleExportConvention,
  PythonFrameworkConventions,
} from "./types.js";

export interface JavaScriptConventionIndex {
  httpFactoryNames: ReadonlySet<string>;
  httpReceivers: ReadonlySet<string>;
  httpMethods: ReadonlySet<string>;
  websocketMethods: ReadonlySet<string>;
  cliReceivers: ReadonlySet<string>;
  eventReceivers: ReadonlySet<string>;
  eventSubscribeMethods: ReadonlySet<string>;
  eventPublishMethods: ReadonlySet<string>;
  scheduleReceivers: ReadonlySet<string>;
  scheduleMethods: ReadonlySet<string>;
  graphqlReceivers: ReadonlySet<string>;
  graphqlMethods: Readonly<Record<string, string>>;
  startupReceivers: ReadonlySet<string>;
  startupSymbolNames: ReadonlySet<string>;
  exportedApplicationHandlerNames: ReadonlySet<string>;
  httpDecorators: Readonly<Record<string, string>>;
  graphqlDecorators: Readonly<Record<string, string>>;
  scheduleDecorators: ReadonlySet<string>;
  eventDecorators: ReadonlySet<string>;
  lifecycleExports: readonly JavaScriptLifecycleExportConvention[];
}

export interface PythonConventionIndex {
  applicationFactoryNames: ReadonlySet<string>;
  decorators: Required<PythonFrameworkConventions>["decorators"];
  calls: Required<PythonFrameworkConventions>["calls"];
  startupSymbolNames: ReadonlySet<string>;
  exportedApplicationHandlerNames: ReadonlySet<string>;
}

export class FrameworkRegistry {
  readonly #packs: readonly FrameworkPack[];
  readonly #javascript: JavaScriptConventionIndex;
  readonly #python: PythonConventionIndex;

  constructor(packs: readonly FrameworkPack[] = FRAMEWORK_PACKS) {
    validateFrameworkPacks(packs);
    this.#packs = Object.freeze([...packs]);
    this.#javascript = javascriptIndex(mergedJavaScriptConventions(this.#packs));
    this.#python = pythonIndex(mergedPythonConventions(this.#packs));
  }

  packs(): readonly FrameworkPack[] {
    return this.#packs;
  }

  javascript(): JavaScriptConventionIndex {
    return this.#javascript;
  }

  python(): PythonConventionIndex {
    return this.#python;
  }

  with(pack: FrameworkPack): FrameworkRegistry {
    return new FrameworkRegistry([...this.#packs, pack]);
  }
}

export const DEFAULT_FRAMEWORK_REGISTRY = new FrameworkRegistry();

function javascriptIndex(
  conventions: Required<JavaScriptFrameworkConventions>,
): JavaScriptConventionIndex {
  return Object.freeze({
    httpFactoryNames: new Set(conventions.httpFactoryNames),
    httpReceivers: new Set(conventions.httpReceivers),
    httpMethods: new Set(conventions.httpMethods),
    websocketMethods: new Set(conventions.websocketMethods),
    cliReceivers: new Set(conventions.cliReceivers),
    eventReceivers: new Set(conventions.eventReceivers),
    eventSubscribeMethods: new Set(conventions.eventSubscribeMethods),
    eventPublishMethods: new Set(conventions.eventPublishMethods),
    scheduleReceivers: new Set(conventions.scheduleReceivers),
    scheduleMethods: new Set(conventions.scheduleMethods),
    graphqlReceivers: new Set(conventions.graphqlReceivers),
    graphqlMethods: Object.freeze({ ...conventions.graphqlMethods }),
    startupReceivers: new Set(conventions.startupReceivers),
    startupSymbolNames: new Set(conventions.startupSymbolNames),
    exportedApplicationHandlerNames: new Set(conventions.exportedApplicationHandlerNames),
    httpDecorators: Object.freeze({ ...conventions.httpDecorators }),
    graphqlDecorators: Object.freeze({ ...conventions.graphqlDecorators }),
    scheduleDecorators: new Set(conventions.scheduleDecorators),
    eventDecorators: new Set(conventions.eventDecorators),
    lifecycleExports: Object.freeze(
      conventions.lifecycleExports.map((convention) => Object.freeze({
        ...convention,
        exportedNames: Object.freeze([...convention.exportedNames]),
      })),
    ),
  });
}

function pythonIndex(
  conventions: Required<PythonFrameworkConventions>,
): PythonConventionIndex {
  return Object.freeze({
    applicationFactoryNames: new Set(conventions.applicationFactoryNames),
    decorators: Object.freeze([...conventions.decorators]),
    calls: Object.freeze([...conventions.calls]),
    startupSymbolNames: new Set(conventions.startupSymbolNames),
    exportedApplicationHandlerNames: new Set(conventions.exportedApplicationHandlerNames),
  });
}

function validateFrameworkPacks(packs: readonly FrameworkPack[]): void {
  const ids = new Set<string>();
  for (const pack of packs) {
    if (pack.id.length === 0) throw new Error("Framework pack ID must not be empty");
    if (ids.has(pack.id)) throw new Error(`Duplicate framework pack ID: ${pack.id}`);
    ids.add(pack.id);
    if (pack.languages.length === 0) {
      throw new Error(`Framework pack ${pack.id} must support at least one language`);
    }
  }
}
