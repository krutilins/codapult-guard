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
  readProject() {
    return undefined;
  },
} satisfies EcosystemProvider;
