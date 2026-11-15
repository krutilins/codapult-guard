import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverProject,
  discoverProjectWithMetrics,
  clearDiscoveryCache,
} from './discovery/discovery.js';
import {
  buildGeneratedGuardConfig,
  buildGuardProposals,
  initializeGuard,
  scanGuard,
} from './guard.js';
import { diagnoseGuard } from './analysis/doctor.js';
import { analyzeProjectImpact } from './analysis/impact.js';
import { ecosystemRegistry, createEcosystemRegistry } from './ecosystems/index.js';
import { parsePythonSource } from './languages/python/python-imports.js';
const roots: string[] = [];
function put(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-python-features-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) put(root, file, text);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('Python ecosystem metadata', () => {
  it('reads standard metadata, extras, included development groups, scripts, and normalized evidence', () => {
    const root = tree({
      'pyproject.toml': `[project]\nname="My.App"\ndependencies=["FastAPI>=0.100", "SQLAlchemy[asyncio]>=2; python_version >= '3.10'"]\n[project.optional-dependencies]\npostgres=["psycopg[binary]>=3"]\ntest=["pytest>=8"]\n[dependency-groups]\nquality=["ruff", {include-group="test"}]\ntest=["hypothesis"]\n[project.scripts]\nshop="app.cli:main"\n`,
      'uv.lock': '',
      'app/cli.py': 'def main(): pass\n',
      'app/main.py': 'from fastapi import FastAPI\nimport sqlalchemy\n',
    });
    const model = discoverProject(root);
    expect(model.project).toMatchObject({
      name: 'My.App',
      packageManager: 'uv',
      frameworks: ['FastAPI', 'SQLAlchemy'],
      dependencies: { fastapi: '>=0.100', psycopg: '[binary]>=3' },
      devDependencies: { pytest: '>=8', ruff: '*', hypothesis: '*' },
      scripts: {},
    });
    expect(model.project.workspacePackages[0]?.dependencyDeclarations).toContainEqual(
      expect.objectContaining({ name: 'sqlalchemy', writtenName: 'SQLAlchemy', group: 'runtime' }),
    );
    expect(model.project.workspacePackages[0]?.entrypoints).toEqual([
      { name: 'shop', target: 'app.cli:main' },
    ]);
    expect(model.patterns.routeHandlers).toContain('app/cli.py');
    expect(model.capabilities.persistence.confidence).toBe('high');
    expect(model.capabilities.persistence.packages).toContain('sqlalchemy');
  });
  it('reads setup.cfg, Poetry, recursive requirements, named URLs, and lock conflicts without execution', () => {
    const root = tree({
      'setup.cfg': '[metadata]\nname = legacy\n[options]\ninstall_requires =\n  Requests>=2\n',
      'setup.py': 'open("executed", "w").write("bad")\n',
      'pyproject.toml':
        '[tool.poetry]\nname="poetry-app"\n[tool.poetry.dependencies]\npython="^3.12"\nDjango="^5"\n[tool.poetry.group.dev.dependencies]\npytest="*"\n',
      'requirements.txt':
        '-r requirements-common.txt\nNamed @ https://example.invalid/pkg.whl\n-e git+https://example.invalid/repo#egg=Edit_Pkg\nhttps://example.invalid/unnamed.whl\n',
      'requirements-common.txt': 'urllib3>=2\n-r requirements.txt\n',
      'requirements-dev.txt': 'pytest>=8\n',
      'poetry.lock': '',
      'uv.lock': '',
    });
    const model = discoverProject(root);
    expect(model.project).toMatchObject({
      name: 'poetry-app',
      packageManager: 'uv',
      dependencies: {
        requests: '>=2',
        django: '^5',
        urllib3: '>=2',
        'edit-pkg': expect.any(String) as unknown,
      },
      devDependencies: { pytest: expect.any(String) as unknown },
    });
    expect(model.project.dependencies).not.toHaveProperty('python');
    expect(model.diagnostics?.map((d) => d.message).join(' ')).toMatch(/cycle/);
    expect(model.diagnostics?.map((d) => d.message).join(' ')).toMatch(/Multiple Python lockfiles/);
    expect(() => readFileSync(join(root, 'executed'))).toThrow();
  });
  it('reports malformed manifests in doctor, invalidates caches, and continues discovering source', () => {
    const root = tree({
      'pyproject.toml': '[project]\nname="ok"\ndependencies=["flask"]\n',
      'main.py': 'import os\n',
    });
    initializeGuard(root);
    put(root, 'pyproject.toml', '[project\n');
    clearDiscoveryCache(root);
    const result = discoverProjectWithMetrics(root);
    expect(result.metrics.cacheHit).toBe(false);
    expect(result.model.modules).toHaveLength(1);
    expect(diagnoseGuard(root).items).toContainEqual(
      expect.objectContaining({ path: 'pyproject.toml', status: 'warning' }),
    );
  });
  it('rejects out-of-root includes and symlinks without reading their declarations', () => {
    const outside = tree({ 'secret.txt': 'secret-package\n' });
    const root = tree({
      'requirements.txt': `-r ${join(outside, 'secret.txt')}\n-r link.txt\n`,
      'main.py': '',
    });
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    const model = discoverProject(root);
    expect(model.project.dependencies).toEqual({});
    expect(model.diagnostics?.length).toBeGreaterThan(0);
  });
  it('keeps npm primary metadata while using Python metadata for mixed-project signals', () => {
    const root = tree({
      'package.json': '{"name":"web","dependencies":{"react":"1"}}',
      'main.ts': 'import "react";',
      'backend/pyproject.toml': '[project]\nname="api"\ndependencies=["fastapi", "sqlalchemy"]',
      'backend/main.py': 'import fastapi\nimport sqlalchemy\n',
    });
    const model = discoverProject(root);
    expect(model.project.name).toBe('web');
    expect(model.project.dependencies).toEqual({ react: '1' });
    expect(model.project.frameworks).toEqual(['React', 'FastAPI', 'SQLAlchemy']);
    expect(model.capabilities.persistence.confidence).toBe('high');
  });
  it('allows a fake ecosystem to declare signals and protected paths as data', () => {
    const registry = createEcosystemRegistry([
      {
        id: 'fake',
        rootMarkers: [],
        ignoredDirectories: [],
        configFileNames: [],
        readProject: () => undefined,
        signals: { frameworks: [{ dependency: 'fake', name: 'Fake' }], capabilities: {} },
        protectedPaths: [{ pattern: 'Fakefile', kind: 'dependency-input' }],
      },
    ]);
    expect(registry.providers[0]?.signals?.frameworks[0]?.name).toBe('Fake');
    expect(registry.providers[0]?.protectedPaths).toHaveLength(1);
  });
});
describe('Python policy facts', () => {
  it('evaluates nearest-root package boundaries on local and declared external imports at their lines', () => {
    const root = tree({
      'pyproject.toml': '[project]\nname="root"',
      'packages/a/pyproject.toml': '[project]\nname="Package_A"\ndependencies=["requests"]',
      'packages/b/pyproject.toml': '[project]\nname="Package_B"',
      'packages/a/a.py': '# line one\nimport b\nimport requests\n',
      'packages/b/b.py': '',
    });
    const report = scanGuard(root, {
      version: 1,
      rules: [],
      contracts: [
        {
          id: 'packages',
          kind: 'package-boundary',
          statement: 'Separate packages',
          fromPackages: ['package-a'],
          mustNotImportPackages: ['package-b', 'requests'],
        },
      ],
    });
    expect(report.findings.map((f) => [f.file, f.line])).toEqual([
      ['packages/a/a.py', 2],
      ['packages/a/a.py', 3],
    ]);
    expect(report.notApplicable).toEqual([]);
  });
  it('keeps package contracts not applicable without a manifest', () => {
    const root = tree({ 'main.py': 'import other\n', 'other.py': '' });
    expect(
      scanGuard(root, {
        version: 1,
        rules: [],
        contracts: [
          {
            id: 'pkg',
            kind: 'package-boundary',
            statement: 'x',
            fromPackages: ['*'],
            mustNotImportPackages: ['*'],
          },
        ],
      }).notApplicable,
    ).toContainEqual(expect.objectContaining({ ruleId: 'contract:pkg', modules: 2 }));
  });
  it('collects dotted calls and skips missing calls with parse diagnostics', () => {
    const parsed = parsePythonSource(
      '@decorate()\ndef f():\n self.validate()\n client.auth.check()\n get_client().check()\n',
    );
    expect(parsed.syntax.calls).toEqual(['client.auth.check', 'get_client', 'self.validate']);
    expect(parsed.syntax.decorators).toHaveLength(1);
    const root = tree({
      'good.py': 'validate()\n',
      'missing.py': 'other()\n',
      'broken.py': 'def bad(:\n',
      'present.py': 'validate()\ndef bad(:\n',
    });
    const report = scanGuard(root, {
      version: 1,
      rules: [],
      contracts: [
        { id: 'calls', kind: 'required-call', statement: 'Validate', mustCall: ['validate'] },
      ],
    });
    expect(report.findings.map((f) => f.file)).toEqual(['missing.py']);
    expect(report.notApplicable).toContainEqual(
      expect.objectContaining({
        ruleId: 'contract:calls',
        modules: 1,
        reason: expect.stringContaining('incomplete') as unknown,
      }),
    );
  });
  it('collects literal environment reads and aliases, shares declarations, and reuses cached syntax', () => {
    const root = tree({
      'main.py': `import os as operating\nfrom os import environ, getenv as env\nx=operating.environ["ONE"]\ny=operating.environ.get("TWO")\nz=operating.getenv("THREE")\na=environ["FOUR"]\nb=env("FIVE")\nc=env(variable)\nd=env("lowercase")\n`,
      '.env.example': 'ONE=\n',
    });
    const model = discoverProject(root);
    expect(model.insights.envReferences).toEqual(
      ['FIVE', 'FOUR', 'ONE', 'THREE', 'TWO'].map((name) => ({
        name,
        files: ['main.py'],
        declared: name === 'ONE',
      })),
    );
    put(root, 'extra.py', '');
    const reused = discoverProjectWithMetrics(root);
    expect(reused.metrics.reusedModules).toBeGreaterThan(0);
    expect(reused.model.insights.envReferences).toEqual(model.insights.envReferences);
  });
  it('declares every Python protected path at root and nested levels', () => {
    const provider = ecosystemRegistry.providers.find((p) => p.id === 'python')!;
    for (const file of [
      'pyproject.toml',
      'setup.cfg',
      'setup.py',
      'requirements*.txt',
      'uv.lock',
      'poetry.lock',
      'pdm.lock',
      'Pipfile',
      'Pipfile.lock',
      'ruff.toml',
      '.ruff.toml',
      'mypy.ini',
      '.mypy.ini',
      'pyrightconfig.json',
      'pytest.ini',
      'tox.ini',
      'noxfile.py',
      'conftest.py',
      '.coveragerc',
      '.python-version',
    ]) {
      expect(provider.protectedPaths).toContainEqual(expect.objectContaining({ pattern: file }));
      expect(provider.protectedPaths).toContainEqual(
        expect.objectContaining({ pattern: '**/' + file }),
      );
    }
  });
});
describe('entrypoints and generated boundaries', () => {
  it('detects FastAPI and Flask decorators, Starlette registrations, Django views, and CLI impact', () => {
    const root = tree({
      'pyproject.toml':
        '[project]\nname="api"\ndependencies=["fastapi", "flask", "starlette", "django"]\n[project.scripts]\nrun="cli:main"',
      'api.py':
        'from fastapi import APIRouter\nimport repository\nr=APIRouter()\n@r.post("/x")\ndef handler(): return repository.fetch()\n',
      'flask_app.py':
        'from flask import Flask\na=Flask(__name__)\n@a.route("/x", methods=["GET", "POST"])\ndef f(): pass\n',
      'star.py':
        'from starlette.routing import Route\nfrom views import handler\nroutes=[Route("/x", endpoint=handler, methods=["GET"])]\n',
      'urls.py':
        'from django.urls import path\nfrom views import handler\nimport helper\nurlpatterns=[path("x/", handler)]\n',
      'views.py': 'def handler(): pass\n',
      'helper.py': '',
      'repository.py': 'def fetch(): pass\n',
      'cli.py': 'def main(): pass\n',
      'pkg/__main__.py': 'print("hello")\n',
      'unrelated.py': '@app.route("/fake")\ndef fake(): pass\n',
    });
    const model = discoverProject(root);
    expect(model.patterns.routeHandlers).toEqual([
      'api.py',
      'cli.py',
      'flask_app.py',
      'pkg/__main__.py',
      'star.py',
      'urls.py',
      'views.py',
    ]);
    expect(model.patterns.routeDetails).toContainEqual({
      path: 'flask_app.py',
      methods: ['GET', 'POST'],
    });
    expect(model.insights.impactPaths).toContainEqual(
      expect.objectContaining({
        entrypoint: 'api.py',
        files: expect.arrayContaining(['repository.py']) as unknown,
      }),
    );
    expect(analyzeProjectImpact(model, ['repository.py']).dependents).toContain('api.py');
  });
  it.each(['py', 'ts'])(
    'proposes stable %s boundaries and catches a new import after approval',
    (extension) => {
      const files =
        extension === 'py'
          ? {
              'domain/model.py': 'def value(): pass\n',
              'infrastructure/db.py': 'from domain import model\n',
            }
          : {
              'domain/model.ts': 'export const value=1;',
              'infrastructure/db.ts': 'import "../domain/model";',
            };
      const root = tree(files);
      const first = discoverProject(root);
      const config = buildGeneratedGuardConfig(first);
      expect(config.contracts?.length).toBeGreaterThan(0);
      expect(scanGuard(root, config).findings).toEqual([]);
      const proposal = buildGuardProposals(first, config);
      const again = buildGuardProposals(first, config);
      expect(again.contentFingerprint).toBe(proposal.contentFingerprint);
      expect(again.proposalId).toBe(proposal.proposalId);
      const approved = {
        ...config,
        contracts: config.contracts?.map((c) => ({ ...c, status: 'active' as const })),
      };
      put(
        root,
        `domain/new.${extension}`,
        extension === 'py' ? 'from infrastructure import db\n' : 'import "../infrastructure/db";',
      );
      expect(scanGuard(root, approved).findings).toContainEqual(
        expect.objectContaining({ file: `domain/new.${extension}`, line: 1 }),
      );
    },
  );
  it('allows two existing edges at low confidence, suppresses three, and caps candidates', () => {
    const root = tree({
      'domain/a.py': 'from infrastructure import one\n',
      'domain/b.py': 'from infrastructure import two\n',
      'infrastructure/one.py': '',
      'infrastructure/two.py': '',
    });
    let config = buildGeneratedGuardConfig(discoverProject(root));
    expect(config.contracts?.[0]?.confidence).toBe('low');
    expect(config.contracts?.[0]?.evidence?.filter((e) => e.includes('domain/'))).toHaveLength(2);
    put(root, 'domain/c.py', 'from infrastructure import one\n');
    config = buildGeneratedGuardConfig(discoverProject(root));
    expect(config.contracts).toEqual([]);
  });
  it('generates no graph boundaries for an unlayered project', () => {
    const root = tree({ 'main.py': 'import other\n', 'other.py': '' });
    expect(buildGeneratedGuardConfig(discoverProject(root)).contracts).toEqual([]);
  });
});

it('preserves npm protected path patterns and historical classifications', () => {
  expect(ecosystemRegistry.providers.find((p) => p.id === 'npm')?.protectedPaths).toMatchSnapshot();
});
it('does not fabricate unsupported capability imports or unbound environment reads', () => {
  const root = tree({
    'main.py': 'import os\nx=os.getenv("KNOWN")\ny=thing.getenv("FALSE")\n',
    'other.py': 'x=os.getenv("UNBOUND")\n',
    'writes.py': 'import os\nos.environ["WRITE_ONLY"] = "value"\n',
  });
  const model = discoverProject(root);
  expect(model.capabilities.storage).toBeUndefined();
  expect(model.insights.envReferences.map((r) => r.name)).toEqual(['KNOWN']);
});

it('initializes the Python app fixture with a pending persistence boundary', () => {
  const root = tree({});
  cpSync(resolve(import.meta.dirname, '../../fixtures/python-app'), root, { recursive: true });
  const model = discoverProject(root);
  const config = buildGeneratedGuardConfig(model);
  expect(config.contracts).toContainEqual(
    expect.objectContaining({
      kind: 'import-boundary',
      status: 'proposed',
      statement: expect.stringContaining('persistence') as unknown,
    }),
  );
});

it('keeps manifest-free Python confidence below high and reports incomplete metadata', () => {
  const root = tree({ 'main.py': 'import fastapi\nimport sqlalchemy\n' });
  expect(
    Object.values(discoverProject(root).capabilities).every(
      (signal) => signal.confidence !== 'high',
    ),
  ).toBe(true);
  put(
    root,
    'pyproject.toml',
    '[project]\ndependencies=42\n[dependency-groups]\na=[{include-group="b"}]\nb=[{include-group="a"}]\n',
  );
  const messages = discoverProject(root)
    .diagnostics?.map((d) => d.message)
    .join(' ');
  expect(messages).toMatch(/array of requirement strings/);
  expect(messages).toMatch(/group cycle/);
});
