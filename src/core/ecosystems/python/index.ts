import { pythonSignals } from './signals.js';
import { readPythonProject, normalizeName } from './manifests.js';
import { basename, dirname } from 'node:path';
import type { EcosystemProvider } from '../types.js';
const projectMarkers = new Set(['pyproject.toml', 'setup.cfg', 'setup.py']);
function projectRoots(paths: string[]): string[] {
  return [
    ...new Set(
      paths
        .filter((path) => projectMarkers.has(basename(path)))
        .map((path) => dirname(path).replaceAll('\\', '/')),
    ),
  ].sort();
}

export { projectRoots as pythonProjectRoots };
export const pythonEcosystem = {
  id: 'python',
  signals: pythonSignals,
  protectedPaths: [
    { pattern: 'pyproject.toml', kind: 'dependency-input' },
    { pattern: '**/pyproject.toml', kind: 'dependency-input' },
    { pattern: 'setup.cfg', kind: 'dependency-input' },
    { pattern: '**/setup.cfg', kind: 'dependency-input' },
    { pattern: 'setup.py', kind: 'dependency-input' },
    { pattern: '**/setup.py', kind: 'dependency-input' },
    { pattern: 'requirements*.txt', kind: 'dependency-input' },
    { pattern: '**/requirements*.txt', kind: 'dependency-input' },
    { pattern: 'uv.lock', kind: 'dependency-input' },
    { pattern: '**/uv.lock', kind: 'dependency-input' },
    { pattern: 'poetry.lock', kind: 'dependency-input' },
    { pattern: '**/poetry.lock', kind: 'dependency-input' },
    { pattern: 'pdm.lock', kind: 'dependency-input' },
    { pattern: '**/pdm.lock', kind: 'dependency-input' },
    { pattern: 'Pipfile', kind: 'dependency-input' },
    { pattern: '**/Pipfile', kind: 'dependency-input' },
    { pattern: 'Pipfile.lock', kind: 'dependency-input' },
    { pattern: '**/Pipfile.lock', kind: 'dependency-input' },
    { pattern: 'ruff.toml', kind: 'tool-config' },
    { pattern: '**/ruff.toml', kind: 'tool-config' },
    { pattern: '.ruff.toml', kind: 'tool-config' },
    { pattern: '**/.ruff.toml', kind: 'tool-config' },
    { pattern: 'mypy.ini', kind: 'tool-config' },
    { pattern: '**/mypy.ini', kind: 'tool-config' },
    { pattern: '.mypy.ini', kind: 'tool-config' },
    { pattern: '**/.mypy.ini', kind: 'tool-config' },
    { pattern: 'pyrightconfig.json', kind: 'tool-config' },
    { pattern: '**/pyrightconfig.json', kind: 'tool-config' },
    { pattern: 'pytest.ini', kind: 'tool-config' },
    { pattern: '**/pytest.ini', kind: 'tool-config' },
    { pattern: 'tox.ini', kind: 'tool-config' },
    { pattern: '**/tox.ini', kind: 'tool-config' },
    { pattern: 'noxfile.py', kind: 'tool-config' },
    { pattern: '**/noxfile.py', kind: 'tool-config' },
    { pattern: 'conftest.py', kind: 'tool-config' },
    { pattern: '**/conftest.py', kind: 'tool-config' },
    { pattern: '.coveragerc', kind: 'tool-config' },
    { pattern: '**/.coveragerc', kind: 'tool-config' },
    { pattern: '.python-version', kind: 'tool-config' },
    { pattern: '**/.python-version', kind: 'tool-config' },
  ],
  rootMarkers: [...projectMarkers],
  ignoredDirectories: [
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.nox',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    '.eggs',
  ],
  ignoredDirectorySuffixes: ['.egg-info'],
  configFileNames: [
    'pipfile',
    'pipfile.lock',
    'poetry.lock',
    'uv.lock',
    'pdm.lock',
    'setup.cfg',
    'pyproject.toml',
    'tox.ini',
  ],
  isConfigFile(name) {
    return /^requirements.*\.txt$/.test(name);
  },
  resolutionRoots(paths) {
    return { python: projectRoots(paths) };
  },
  packageMatches(name, source) {
    return normalizeName(source.split('.')[0]) === normalizeName(name);
  },
  resolutionInput(path) {
    return /(?:pyproject\.toml|setup\.cfg|setup\.py|requirements.*\.txt|uv\.lock|poetry\.lock|pdm\.lock|Pipfile(?:\.lock)?)$/.test(
      basename(path),
    )
      ? 'content'
      : undefined;
  },
  readProject: readPythonProject,
} satisfies EcosystemProvider;
