import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { ProjectModel } from '../discovery/discovery.js';
import type { GuardContract } from '../guard.js';
import { ecosystemRegistry } from '../ecosystems/index.js';

function importLine(model: ProjectModel, from: string, to: string): number {
  const module = model.modules.find((m) => m.path === from);
  const source = Object.entries(module?.resolvedImportMap ?? {}).find(
    ([, target]) => target === to,
  )?.[0];
  return source ? (module?.importLines?.[source] ?? 1) : 1;
}

export function persistenceImport(source: string): boolean {
  return ecosystemRegistry.providers.some((p) =>
    p.signals?.capabilities.persistence?.imports.test(source),
  );
}
export function boundaryProposals(model: ProjectModel): GuardContract[] {
  const candidates: GuardContract[] = [];
  const add = (
    scope: string[],
    patterns: string[],
    statement: string,
    evidence: string[],
    violations: number,
  ): void => {
    if (scope.length === 0 || patterns.length === 0 || violations > 2) return;
    const content = {
      kind: 'import-boundary' as const,
      scope: [...new Set(scope.map((p) => (dirname(p) === '.' ? p : dirname(p))))].sort(),
      mustNotImport: [...new Set(patterns)].sort(),
    };
    candidates.push({
      ...content,
      id:
        'observed-boundary-' +
        createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12),
      statement,
      severity: 'error',
      status: 'proposed',
      confidence: violations > 0 ? 'low' : 'medium',
      evidence: [...new Set(evidence)].sort(),
    });
  };
  for (const [from, to] of [
    ['domain', 'infrastructure'],
    ['ui', 'infrastructure'],
  ]) {
    const sources = model.insights.layers[from] ?? [];
    const targets = model.insights.layers[to] ?? [];
    const violations = model.insights.dependencyEdges.filter(
      (e) => sources.includes(e.from) && targets.includes(e.to),
    );
    if (model.insights.dependencyEdges.length === 0) continue;
    add(
      sources,
      [...new Set(targets.map((p) => (dirname(p) === '.' ? p : dirname(p))))],
      `${from} modules should not import ${to} modules.`,
      [
        `Observed layers: ${from} -> ${to}`,
        ...violations.map((e) => `${e.from}:${importLine(model, e.from, e.to)} -> ${e.to}`),
      ],
      violations.length,
    );
  }
  const infrastructure = model.insights.layers.infrastructure ?? [];
  const accesses = model.modules.filter((m) => m.imports.some(persistenceImport));
  const owners = accesses.filter((m) => infrastructure.includes(m.path));
  const directories = [...new Set(owners.map((m) => dirname(m.path)))].sort();
  const scattered = accesses.filter(
    (m) =>
      !infrastructure.includes(m.path) && !(model.insights.layers.tests ?? []).includes(m.path),
  );
  if (
    Object.hasOwn(model.capabilities, 'persistence') &&
    directories.length > 0 &&
    directories.length <= 3 &&
    scattered.length === 0
  ) {
    const scope = Object.entries(model.insights.layers)
      .filter(([layer]) => ['domain', 'ui', 'application', 'routes'].includes(layer))
      .flatMap(([, files]) => files);
    const patterns = owners.flatMap((m) => m.imports.filter(persistenceImport));
    add(
      scope,
      patterns,
      'Production code should use the observed persistence boundary.',
      [
        `Persistence directories: ${directories.join(', ')}`,
        ...model.capabilities.persistence.evidence,
      ],
      0,
    );
  }
  return [...new Map(candidates.map((c) => [c.id, c])).values()].slice(0, 5);
}
