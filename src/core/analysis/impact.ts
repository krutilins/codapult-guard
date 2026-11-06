import type { GuardContract } from '../guard.js';
import {
  buildModuleTargetGraph,
  importResolutionStatus,
  moduleImportSpecifiers,
  summarizeImportResolution,
  type ImportResolutionSummary,
  type ProjectModel,
} from '../discovery/discovery.js';

/** Unresolved imports listed in a partial graph status; the count covers all of them. */
const MAX_LISTED_UNRESOLVED_IMPORTS = 20;

/**
 * Whether the affected part of the graph is complete within the supported static subset. Dynamic
 * imports with computed specifiers are never seen, so `complete` is not a runtime guarantee.
 * External imports never make the status partial.
 */
export interface GuardImpactGraphStatus {
  status: 'complete' | 'partial';
  unresolvedImportCount: number;
  unresolvedImports: { file: string; specifier: string }[];
  /** Import resolution of the whole project per language, for context. */
  projectImportResolution: ImportResolutionSummary[];
}

export interface GuardImpactAnalysis {
  requestedFiles: string[];
  directModules: string[];
  dependencies: string[];
  dependents: string[];
  affectedModules: string[];
  impactPaths: ProjectModel['insights']['impactPaths'];
  capabilities: string[];
  relevantContracts: GuardContract[];
  dependencyEdges: ProjectModel['insights']['dependencyEdges'];
  layerEdges: ProjectModel['insights']['layerEdges'];
  graph: GuardImpactGraphStatus;
}

function matchesScope(path: string, scope: string): boolean {
  return path === scope || path.startsWith(`${scope.replace(/\\/g, '/')}/`);
}

function graphStatus(model: ProjectModel, affected: Set<string>): GuardImpactGraphStatus {
  const unresolved = model.modules
    .filter((module) => affected.has(module.path))
    .flatMap((module) =>
      moduleImportSpecifiers(module)
        .filter((specifier) => importResolutionStatus(module, specifier) === 'unresolved')
        .map((specifier) => ({ file: module.path, specifier })),
    )
    .sort((left, right) =>
      left.file !== right.file
        ? left.file.localeCompare(right.file)
        : left.specifier.localeCompare(right.specifier),
    );
  return {
    status: unresolved.length > 0 ? 'partial' : 'complete',
    unresolvedImportCount: unresolved.length,
    unresolvedImports: unresolved.slice(0, MAX_LISTED_UNRESOLVED_IMPORTS),
    projectImportResolution:
      model.insights.importResolution ?? summarizeImportResolution(model.modules),
  };
}

function walk(graph: Map<string, string[]>, starts: Iterable<string>): Set<string> {
  const visited = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

/**
 * Computes the blast radius of a change from the discovered graph.
 *
 * The graph direction is importer -> imported module. Therefore `dependencies` are what the
 * changed code relies on, while `dependents` are callers that can regress when the changed
 * code changes. Both directions matter for an AI review packet.
 */
export function analyzeProjectImpact(
  model: ProjectModel,
  files: Iterable<string>,
  contracts: GuardContract[] = [],
): GuardImpactAnalysis {
  const requestedFiles = [...new Set([...files].map((file) => file.replace(/\\/g, '/')))].sort();
  const modulePaths = new Set(model.modules.map((module) => module.path));
  const directModules = requestedFiles.filter((file) => modulePaths.has(file));
  const graph = buildModuleTargetGraph(model.modules);
  const reverse = new Map<string, string[]>();
  for (const [from, targets] of graph) {
    for (const to of targets) {
      const callers = reverse.get(to) ?? [];
      callers.push(from);
      reverse.set(to, callers);
    }
  }
  const dependencies = walk(graph, directModules);
  const dependencyList = [...dependencies].filter((path) => !directModules.includes(path)).sort();
  const dependents = walk(reverse, directModules);
  const dependentList = [...dependents].filter((path) => !directModules.includes(path)).sort();
  const affected = new Set([...directModules, ...dependencyList, ...dependentList]);
  const impactPaths = model.insights.impactPaths.filter(
    (impact) =>
      impact.entrypoint &&
      (affected.has(impact.entrypoint) || impact.files.some((file) => affected.has(file))),
  );
  const capabilities = Object.entries(model.capabilities)
    .filter(([, signal]) => signal.files.some((file) => affected.has(file)))
    .map(([id]) => id)
    .sort();
  const relevantContracts = contracts.filter((contract) => {
    const scopes = [...(contract.scope ?? []), ...(contract.entrypoints ?? [])];
    return (
      scopes.length === 0 ||
      scopes.some((scope) => [...affected].some((file) => matchesScope(file, scope)))
    );
  });
  const dependencyEdges = model.insights.dependencyEdges.filter(
    (edge) => affected.has(edge.from) || affected.has(edge.to),
  );
  const affectedLayers = new Set(
    Object.entries(model.insights.layers)
      .filter(([, paths]) => paths.some((path) => affected.has(path)))
      .map(([layer]) => layer),
  );
  const layerEdges = model.insights.layerEdges.filter(
    (edge) => affectedLayers.has(edge.from) || affectedLayers.has(edge.to),
  );
  return {
    requestedFiles,
    directModules,
    dependencies: dependencyList,
    dependents: dependentList,
    affectedModules: [...affected].sort(),
    impactPaths,
    capabilities,
    relevantContracts,
    dependencyEdges,
    layerEdges,
    graph: graphStatus(model, affected),
  };
}
