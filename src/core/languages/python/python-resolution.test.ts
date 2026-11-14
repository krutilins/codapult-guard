import { describe, expect, it } from 'vitest';
import { pythonProjectRoots } from '../../discovery/discovery.js';
import { parsePythonSource } from './python-imports.js';
import {
  pythonResolutionIndex,
  resolvePythonImports,
  type PythonResolution,
} from './python-resolution.js';

function resolve(paths: string[], file: string, source: string): PythonResolution {
  return resolvePythonImports(
    file,
    parsePythonSource(source).imports,
    pythonResolutionIndex(paths, pythonProjectRoots(paths)),
  );
}

describe('resolvePythonImports', () => {
  it('resolves modules, symbols, and names defined in a package __init__', () => {
    const paths = [
      'pyproject.toml',
      'app/__init__.py',
      'app/services.py',
      'app/views.py',
      'app/db/__init__.py',
      'app/db/models.py',
    ];

    const result = resolve(
      paths,
      'app/views.py',
      [
        'from app import services',
        'from app.services import UserService',
        'from app import UserService',
        'from app.db import models, Session',
        '',
      ].join('\n'),
    );

    expect(result.resolvedImportMap).toEqual({
      'app.services': 'app/services.py',
      app: 'app/__init__.py',
      'app.db.models': 'app/db/models.py',
      'app.db': 'app/db/__init__.py',
    });
    expect(result.imports).toEqual(['app', 'app.db', 'app.db.models', 'app.services']);
    expect(result.importLines).toEqual({
      app: 1,
      'app.services': 1,
      'app.db': 4,
      'app.db.models': 4,
    });
    expect(result.resolvedImports).toEqual([
      'app/__init__.py',
      'app/db/__init__.py',
      'app/db/models.py',
      'app/services.py',
    ]);
    expect(result.unresolvedImports).toEqual([]);
  });

  it('creates an edge only to the leaf module of a dotted import', () => {
    const paths = ['app/__init__.py', 'app/db/__init__.py', 'app/db/models.py', 'main.py'];

    const result = resolve(paths, 'main.py', 'import app.db.models\nimport app.db.models as m\n');

    expect(result.resolvedImportMap).toEqual({ 'app.db.models': 'app/db/models.py' });
    expect(result.resolvedImports).toEqual(['app/db/models.py']);
  });

  it('prefers a package __init__ over a module file of the same name, as CPython does', () => {
    const paths = ['main.py', 'tools.py', 'tools/__init__.py'];

    expect(resolve(paths, 'main.py', 'import tools\n').resolvedImportMap).toEqual({
      tools: 'tools/__init__.py',
    });
  });

  it('searches the nearest project root and its src directory first', () => {
    const paths = [
      'pyproject.toml',
      'shared/config.py',
      'services/api/pyproject.toml',
      'services/api/src/shared/config.py',
      'services/api/src/api/main.py',
    ];

    const result = resolve(paths, 'services/api/src/api/main.py', 'from shared import config\n');

    expect(result.resolvedImportMap).toEqual({
      'shared.config': 'services/api/src/shared/config.py',
    });
  });

  it('falls back to the Guard root and its src directory', () => {
    const paths = [
      'src/core/__init__.py',
      'src/core/settings.py',
      'scripts/tool.py',
      'common/util.py',
    ];

    const result = resolve(
      paths,
      'scripts/tool.py',
      'from core import settings\nimport common.util\n',
    );

    expect(result.resolvedImportMap).toEqual({
      'core.settings': 'src/core/settings.py',
      'common.util': 'common/util.py',
    });
  });

  it('resolves a namespace monorepo module when exactly one package provides it', () => {
    const paths = [
      'packages/billing/pyproject.toml',
      'packages/billing/src/company/billing/__init__.py',
      'packages/billing/src/company/billing/service.py',
      'packages/users/pyproject.toml',
      'packages/users/src/company/users/__init__.py',
      'packages/users/src/company/users/service.py',
    ];

    const result = resolve(
      paths,
      'packages/billing/src/company/billing/service.py',
      [
        'import company.billing.service',
        'import company.users.service',
        'import company',
        'from company import users',
        '',
      ].join('\n'),
    );

    expect(result.resolvedImportMap).toEqual({
      'company.billing.service': 'packages/billing/src/company/billing/service.py',
      'company.users.service': 'packages/users/src/company/users/service.py',
      'company.users': 'packages/users/src/company/users/__init__.py',
    });
    expect(result.unresolvedImports).toEqual([]);
  });

  it('leaves a module present in two roots of the same group unresolved', () => {
    const paths = [
      'packages/a/pyproject.toml',
      'packages/a/common/helpers.py',
      'packages/b/pyproject.toml',
      'packages/b/common/helpers.py',
      'tools/run.py',
    ];

    const result = resolve(paths, 'tools/run.py', 'import common.helpers\nimport requests\n');

    expect(result.resolvedImportMap).toEqual({});
    expect(result.unresolvedImports).toEqual(['common.helpers']);
    expect(result.resolvedImports).toEqual([]);
  });

  it('lets local modules shadow standard-library names', () => {
    const paths = ['main.py', 'json.py', 'typing.py'];

    expect(
      resolve(paths, 'main.py', 'import json\nfrom typing import Protocol\nimport os\n'),
    ).toMatchObject({
      resolvedImportMap: { json: 'json.py', typing: 'typing.py' },
      unresolvedImports: [],
    });
  });

  it('resolves relative imports by path and converts them to canonical names', () => {
    const paths = [
      'pyproject.toml',
      'src/app/__init__.py',
      'src/app/api/__init__.py',
      'src/app/api/views.py',
      'src/app/api/schemas.py',
      'src/app/db/__init__.py',
      'src/app/db/models.py',
      'src/app/config.py',
    ];

    const result = resolve(
      paths,
      'src/app/api/views.py',
      [
        'from . import schemas',
        'from .schemas import UserIn',
        'from .. import config',
        'from ..db.models import User',
        'from ..db import models',
        'from ... import outside_package',
        'from .missing import thing',
        '',
      ].join('\n'),
    );

    expect(result.resolvedImportMap).toEqual({
      '.schemas': 'src/app/api/schemas.py',
      '..config': 'src/app/config.py',
      '..db.models': 'src/app/db/models.py',
    });
    expect(result.canonicalImports).toEqual({
      '.': 'app.api',
      '.schemas': 'app.api.schemas',
      '..': 'app',
      '..config': 'app.config',
      '..db.models': 'app.db.models',
      '..db': 'app.db',
      '.missing': 'app.api.missing',
    });
    expect(result.unresolvedImports).toEqual(['...', '.missing']);
  });

  it('treats a relative import above the Guard root as unresolved', () => {
    const result = resolve(['tool.py'], 'tool.py', 'from .. import parent\nfrom . import x\n');

    expect(result.unresolvedImports).toEqual(['.', '..']);
    expect(result.resolvedImportMap).toEqual({});
    expect(result.canonicalImports).toEqual({});
  });

  it('allows namespace packages and gives a bare namespace import no edge', () => {
    const paths = ['main.py', 'plugins/core/loader.py'];

    const result = resolve(
      paths,
      'main.py',
      [
        'import plugins',
        'import plugins.core.loader',
        'from plugins.core import loader',
        'from plugins import missing_symbol',
        '',
      ].join('\n'),
    );

    expect(result.resolvedImportMap).toEqual({
      'plugins.core.loader': 'plugins/core/loader.py',
    });
    expect(result.unresolvedImports).toEqual(['plugins']);
  });

  it('separates external, unresolved local-looking, and unresolved relative imports', () => {
    const paths = ['pyproject.toml', 'app/__init__.py', 'app/main.py', 'scripts/deploy.py'];

    const result = resolve(
      paths,
      'app/main.py',
      [
        'import requests',
        'from django.db import models',
        'import app.missing',
        'from scripts.helpers import run',
        'from .gone import value',
        '',
      ].join('\n'),
    );

    expect(result.resolvedImportMap).toEqual({});
    expect(result.unresolvedImports).toEqual(['.gone', 'app.missing', 'scripts.helpers']);
    expect(result.imports).toEqual([
      '.gone',
      'app.missing',
      'django.db',
      'requests',
      'scripts.helpers',
    ]);
  });

  it('never resolves to stubs or non-Python files', () => {
    const paths = ['main.py', 'typed.pyi', 'web/index.ts', 'data/__init__.pyi'];

    const result = resolve(paths, 'main.py', 'import typed\nimport web.index\nimport data\n');

    expect(result.resolvedImportMap).toEqual({});
    expect(result.unresolvedImports).toEqual([]);
  });

  it('searches submodules only inside the regular package that won the first segment', () => {
    const paths = [
      'main.py',
      'shared/__init__.py',
      'tools/pyproject.toml',
      'tools/shared/__init__.py',
      'tools/shared/util.py',
    ];

    const result = resolve(paths, 'main.py', 'from shared import util\nimport shared.util\n');

    // At runtime the Guard root's regular `shared` package hides the one in `tools`.
    expect(result.resolvedImportMap).toEqual({ shared: 'shared/__init__.py' });
    expect(result.unresolvedImports).toEqual(['shared.util']);
  });

  it('prefers a regular package in a later group over an earlier namespace portion', () => {
    const paths = [
      'tools/pyproject.toml',
      'tools/cli.py',
      'tools/shared/helpers.py',
      'shared/__init__.py',
      'shared/util.py',
    ];

    expect(resolve(paths, 'tools/cli.py', 'from shared import util\n').resolvedImportMap).toEqual({
      'shared.util': 'shared/util.py',
    });
  });

  it('finds no submodules under a module file', () => {
    const paths = ['main.py', 'config.py', 'config/extra.py'];

    const result = resolve(paths, 'main.py', 'import config.extra\nimport config\n');

    expect(result.resolvedImportMap).toEqual({ config: 'config.py' });
    expect(result.unresolvedImports).toEqual(['config.extra']);
  });

  it('returns the same result regardless of file order', () => {
    const paths = [
      'packages/b/pyproject.toml',
      'packages/b/lib/b.py',
      'packages/a/pyproject.toml',
      'packages/a/lib/a.py',
      'main.py',
    ];
    const source = 'import lib.a\nimport lib.b\n';

    expect(resolve([...paths].reverse(), 'main.py', source)).toEqual(
      resolve(paths, 'main.py', source),
    );
    expect(resolve(paths, 'main.py', source).resolvedImportMap).toEqual({
      'lib.a': 'packages/a/lib/a.py',
      'lib.b': 'packages/b/lib/b.py',
    });
  });
});

describe('Python resolution properties', () => {
  // Seeded so a failure reproduces.
  function shuffled<T>(items: readonly T[], seed: number): T[] {
    const result = [...items];
    let state = seed;
    for (let index = result.length - 1; index > 0; index -= 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      const other = state % (index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  const sources: Record<string, string> = {
    'pyproject.toml': '',
    'main.py': 'import common.helpers\nimport company.users.service\nfrom app import api\n',
    'app/__init__.py': '',
    'app/api.py': 'from .db import models\nfrom ..outside import x\n',
    'app/db/__init__.py': '',
    'app/db/models.py': '',
    'services/api/pyproject.toml': '',
    'services/api/src/app/__init__.py': '',
    'services/api/src/app/api.py': 'from app import api\nimport shared.config\n',
    'services/api/src/shared/config.py': '',
    'libs/a/pyproject.toml': '',
    'libs/a/common/helpers.py': '',
    'libs/b/pyproject.toml': '',
    'libs/b/common/helpers.py': '',
    'packages/users/pyproject.toml': '',
    'packages/users/src/company/users/service.py': 'from company.billing import service\n',
    'packages/billing/pyproject.toml': '',
    'packages/billing/src/company/billing/service.py': 'from company.users import service\n',
  };
  const modules = Object.keys(sources).filter((path) => path.endsWith('.py'));
  const facts = Object.fromEntries(
    modules.map((path) => [path, parsePythonSource(sources[path]).imports]),
  );

  function resolveAll(paths: readonly string[], projectRoots: readonly string[]): unknown {
    const index = pythonResolutionIndex(paths, projectRoots);
    const results = Object.fromEntries(
      shuffled(modules, paths.length + projectRoots.length).map((path) => [
        path,
        resolvePythonImports(path, facts[path], index),
      ]),
    );
    return Object.fromEntries(
      Object.keys(results)
        .sort()
        .map((path) => [path, results[path]]),
    );
  }

  it('returns identical results for every order of files and project roots', () => {
    const paths = Object.keys(sources);
    const roots = pythonProjectRoots(paths);
    const expected = resolveAll(paths, roots);

    for (let seed = 1; seed <= 12; seed += 1) {
      expect(resolveAll(shuffled(paths, seed), shuffled(roots, seed * 7)), `seed ${seed}`).toEqual(
        expected,
      );
    }
    expect(
      (expected as Record<string, PythonResolution>)['services/api/src/app/api.py']
        .resolvedImportMap,
    ).toEqual({
      'app.api': 'services/api/src/app/api.py',
      'shared.config': 'services/api/src/shared/config.py',
    });
  });
});
