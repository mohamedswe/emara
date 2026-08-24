import { indexRepository } from "./indexRepository.ts";

const repositoryPath = process.argv[2] ?? process.cwd();
const requestedOutputPath = process.argv[3];
const result = await indexRepository(
  repositoryPath,
  requestedOutputPath === undefined
    ? {}
    : { outputPath: requestedOutputPath },
);

console.log(
  JSON.stringify({
    outputPath: result.outputPath,
    files: result.graph.files.length,
    symbols: result.graph.symbols.length,
    entrypoints: result.graph.entrypoints.length,
    edges: result.graph.edges.length,
    languages: result.support.languages,
    frameworks: result.support.frameworks.map((framework) => ({
      id: framework.id,
      support: framework.support,
      evidence: framework.evidence,
    })),
    unparsedSourceFiles: result.support.unparsedSourceFiles,
    frameworkDiagnostics: result.support.diagnostics,
  }),
);
