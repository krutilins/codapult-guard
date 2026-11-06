import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeProjectImpact } from './analysis/impact.js';
import { discoverProject } from './discovery/discovery.js';
import { initializeGuard, scanGuard, type GuardConfig } from './guard.js';

// Local Python fixtures. None of them is installed or executed (Task 08).
const fixtures = resolve(import.meta.dirname, '../../fixtures');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function model(name: string): ReturnType<typeof discoverProject> {
  return discoverProject(join(fixtures, name), { persistCache: false });
}

function copy(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `guard-${name}-`));
  roots.push(root);
  cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

function unresolved(project: ReturnType<typeof discoverProject>): [string, string[]][] {
  return project.modules
    .filter((module) => (module.unresolvedImports?.length ?? 0) > 0)
    .map((module) => [module.path, module.unresolvedImports ?? []]);
}

describe('Python fixtures', () => {
  it('python-app: flat layout, package re-exports, relative imports, and TYPE_CHECKING cycles', () => {
    const project = model('python-app');

    expect(project.files.filter((file) => file.kind !== 'source').map((file) => file.path)).toEqual(
      ['pyproject.toml', 'requirements.txt', 'tests/conftest.py', 'tests/test_orders.py'],
    );
    expect(project.insights.dependencyEdges).toEqual([
      { from: 'shop/__init__.py', to: 'shop/services/orders.py' },
      { from: 'shop/api/routes.py', to: 'shop/schemas.py' },
      { from: 'shop/api/routes.py', to: 'shop/services/orders.py' },
      { from: 'shop/services/orders.py', to: 'shop/api/routes.py' },
      { from: 'shop/services/orders.py', to: 'shop/db/session.py' },
      { from: 'tests/test_orders.py', to: 'shop/services/orders.py' },
    ]);
    // The import inside `if TYPE_CHECKING:` counts, so the cycle is reported (C3, D5).
    expect(project.insights.cycles).toEqual([['shop/api/routes.py', 'shop/services/orders.py']]);
    expect(project.insights.layers).toMatchObject({
      routes: ['shop/api/__init__.py', 'shop/api/routes.py'],
      application: ['shop/services/__init__.py', 'shop/services/orders.py'],
      infrastructure: ['shop/db/__init__.py', 'shop/db/session.py'],
      tests: ['tests/conftest.py', 'tests/test_orders.py'],
    });
    expect(project.insights.importResolution).toEqual([
      {
        language: 'python',
        modules: 11,
        imports: 15,
        resolved: 9,
        unresolved: 0,
        external: 6,
        modulesWithParseDiagnostics: 0,
      },
    ]);
    expect(project.insights.importHotspots.map((hotspot) => hotspot.module)).toEqual([
      'fastapi',
      'os',
      'pydantic',
      'pytest',
      'sqlalchemy',
      'typing',
    ]);
  });

  it('python-src-layout: resolves through the src directory of the project root', () => {
    const project = model('python-src-layout');

    expect(project.insights.dependencyEdges).toEqual([
      { from: 'src/inventory/core.py', to: 'src/inventory/storage.py' },
      { from: 'tests/test_core.py', to: 'src/inventory/core.py' },
    ]);
    expect(unresolved(project)).toEqual([]);
  });

  it('python-monorepo: resolves a namespace package split across project roots', () => {
    const project = model('python-monorepo');

    expect(project.insights.dependencyEdges).toEqual([
      {
        from: 'packages/billing/src/company/billing/service.py',
        to: 'packages/users/src/company/users/service.py',
      },
      {
        from: 'services/worker/worker/main.py',
        to: 'packages/billing/src/company/billing/service.py',
      },
    ]);
    expect(project.project.workspacePackages).toEqual([]);
    expect(unresolved(project)).toEqual([]);
  });

  it('python-mixed: keeps one graph per language with no edge between them', () => {
    const project = model('python-mixed');

    expect(project.insights.dependencyEdges).toEqual([
      { from: 'backend/app/main.py', to: 'backend/app/routes.py' },
      { from: 'backend/app/routes.py', to: 'backend/app/models.py' },
      { from: 'web/src/api.ts', to: 'web/src/settings.ts' },
    ]);
    expect(project.insights.importResolution?.map((summary) => summary.language)).toEqual([
      'js-ts',
      'python',
    ]);
    expect(analyzeProjectImpact(project, ['backend/app/models.py']).dependents).toEqual([
      'backend/app/main.py',
      'backend/app/routes.py',
    ]);
  });

  it('python-edge-cases: unresolved, ambiguous, malformed, shadowing, and ignored paths', () => {
    const project = model('python-edge-cases');

    expect(project.files.map((file) => file.path)).toEqual([
      'json.py',
      'libs/a/common/helpers.py',
      'libs/a/pyproject.toml',
      'libs/b/common/helpers.py',
      'libs/b/pyproject.toml',
      'main.py',
      'pkg/__init__.py',
      'pkg/core.py',
      'pkg/helpers.py',
      'pkg/my-module.py',
      'pyproject.toml',
      'stubs/typed.pyi',
    ]);
    expect(project.modules.some((module) => module.path.endsWith('.pyi'))).toBe(false);
    expect(project.insights.dependencyEdges).toEqual([
      { from: 'main.py', to: 'json.py' },
      { from: 'main.py', to: 'pkg/__init__.py' },
      { from: 'main.py', to: 'pkg/core.py' },
      { from: 'pkg/__init__.py', to: 'pkg/core.py' },
      { from: 'pkg/__init__.py', to: 'pkg/helpers.py' },
      { from: 'pkg/core.py', to: 'pkg/helpers.py' },
    ]);
    // `common.helpers` exists in two roots of one group, `...` goes above the root.
    expect(unresolved(project)).toEqual([
      ['main.py', ['common.helpers']],
      ['pkg/core.py', ['...', '.missing']],
    ]);
    const helpers = project.modules.find((module) => module.path === 'pkg/helpers.py');
    expect(helpers?.parseDiagnostics).toEqual([1]);
    expect(helpers?.imports).toEqual(['logging']);
    expect(analyzeProjectImpact(project, ['pkg/core.py']).graph).toMatchObject({
      status: 'partial',
      unresolvedImportCount: 3,
    });
  });

  it('initializes a Python-only fixture and applies every D8 rule and contract kind', () => {
    const root = copy('python-app');
    initializeGuard(root);
    const guardConfig: GuardConfig = {
      version: 1,
      rules: [
        {
          id: 'routes-no-db',
          description: 'Routes go through services.',
          severity: 'error',
          kind: 'forbidden-import',
          patterns: ['shop.db', 'sqlalchemy'],
          files: ['shop/api'],
        },
        {
          id: 'client-no-db',
          description: 'Client code must not import the database.',
          severity: 'error',
          kind: 'client-forbidden-import',
          patterns: ['shop.db'],
        },
      ],
      contracts: [
        {
          id: 'services-no-api',
          statement: 'Services do not import the API layer.',
          kind: 'import-boundary',
          scope: ['shop/services'],
          mustNotImport: ['shop.api'],
        },
        {
          id: 'routes-use-schemas',
          statement: 'Routes validate input with schemas.',
          kind: 'import-boundary',
          scope: ['shop/api/routes.py'],
          mustImport: ['shop.schemas'],
        },
        {
          id: 'orders-audit',
          statement: 'Order services call audit.',
          kind: 'required-call',
          scope: ['shop/services'],
          mustCall: ['audit'],
        },
        {
          id: 'no-db-package',
          statement: 'The app does not import the database package.',
          kind: 'package-boundary',
          fromPackages: ['shop'],
          mustNotImportPackages: ['db'],
        },
      ],
      budgets: [
        {
          id: 'module-imports',
          description: 'Modules keep a small import surface.',
          metric: 'imports',
          scope: ['shop'],
          limit: 2,
          severity: 'warning',
          reason: 'Wide import surfaces are hard to review.',
        },
      ],
    };

    const report = scanGuard(root, guardConfig);

    expect(
      report.findings
        .map((finding) => [finding.ruleId, finding.file, finding.line, finding.importPath])
        .sort(),
    ).toEqual([
      ['budget:module-imports', 'shop/api/routes.py', 1, 'budget:imports'],
      ['budget:module-imports', 'shop/services/orders.py', 1, 'budget:imports'],
      // The written module and the derived submodule are separate references (D6).
      ['contract:services-no-api', 'shop/services/orders.py', 6, 'shop.api'],
      ['contract:services-no-api', 'shop/services/orders.py', 6, 'shop.api.routes'],
    ]);
    expect(report.notApplicable).toEqual([
      {
        ruleId: 'client-no-db',
        reason: 'Discovery does not collect directives such as "use client" for these modules.',
        modules: 9,
      },
      {
        ruleId: 'contract:no-db-package',
        reason:
          'Package membership comes from package.json workspaces, which do not cover these modules.',
        modules: 11,
      },
      {
        ruleId: 'contract:orders-audit',
        reason: 'Discovery does not collect calls for these modules.',
        modules: 2,
      },
    ]);
  });

  it('detects an injected forbidden Python import and returns to clean after removing it', () => {
    const root = copy('python-app');
    initializeGuard(root);
    const guardConfig: GuardConfig = {
      version: 1,
      rules: [
        {
          id: 'routes-no-db',
          description: 'Routes go through services.',
          severity: 'error',
          kind: 'forbidden-import',
          patterns: ['shop.db'],
          files: ['shop/api'],
        },
      ],
    };
    expect(scanGuard(root, guardConfig).findings).toEqual([]);

    const injected = join(root, 'shop/api/admin.py');
    writeFileSync(injected, '"""Admin routes."""\n\nfrom ..db.session import save\n');
    expect(
      scanGuard(root, guardConfig).findings.map((finding) => [
        finding.file,
        finding.line,
        finding.importPath,
      ]),
    ).toEqual([['shop/api/admin.py', 3, '..db.session']]);

    rmSync(injected);
    expect(existsSync(injected)).toBe(false);
    expect(scanGuard(root, guardConfig).findings).toEqual([]);
  });
});
