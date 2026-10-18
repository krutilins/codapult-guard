import { posix } from 'node:path';
import type { PythonImportFact } from './python-imports.js';

/** File-system facts the Python resolver needs, built once per discovery from the file list. */
export interface PythonResolutionIndex {
  /** Every discovered `.py` file. */
  files: ReadonlySet<string>;
  /** Every directory that contains a `.py` file at any depth, without `.`. */
  directories: ReadonlySet<string>;
  /** Directories with a Python project marker, sorted (D10). */
  projectRoots: readonly string[];
}

export interface PythonResolution {
  /** Spellings as written plus derived submodule references (D6), sorted. */
  imports: string[];
  importLines: Record<string, number>;
  resolvedImports: string[];
  resolvedImportMap: Record<string, string>;
  unresolvedImports: string[];
  /** Absolute dotted names of relative spellings that can be converted (D7, D9). */
  canonicalImports: Record<string, string>;
}

type Lookup =
  | { kind: 'file'; path: string }
  | { kind: 'namespace' }
  | { kind: 'ambiguous' }
  | { kind: 'missing' };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function joinPath(directory: string, path: string): string {
  if (directory === '.') return path === '' ? '.' : path;
  return path === '' ? directory : `${directory}/${path}`;
}

function isAncestor(directory: string, path: string): boolean {
  return directory === '.' || path.startsWith(`${directory}/`);
}

export function pythonResolutionIndex(
  paths: readonly string[],
  projectRoots: readonly string[],
): PythonResolutionIndex {
  const files = new Set<string>();
  const directories = new Set<string>();
  for (const path of paths) {
    if (!path.endsWith('.py')) continue;
    files.add(path);
    let directory = posix.dirname(path);
    while (directory !== '.' && !directories.has(directory)) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  return { files, directories, projectRoots: [...projectRoots].sort() };
}

function withSourceDirectory(root: string, index: PythonResolutionIndex): string[] {
  const source = joinPath(root, 'src');
  return index.directories.has(source) ? [root, source] : [root];
}

/**
 * Resolution root groups for one importing file (D9): its nearest Python project root and that
 * root's `src/`, then the Guard root and its `src/`, then every other Python project root.
 * A root appears in the first group that names it. Each group is sorted.
 */
function rootGroups(file: string, index: PythonResolutionIndex): string[][] {
  const nearest = index.projectRoots
    .filter((root) => isAncestor(root, file))
    .sort((left, right) => right.length - left.length)[0];
  const seen = new Set<string>();
  const group = (roots: string[]): string[] => {
    const fresh = roots.filter((root) => !seen.has(root)).sort();
    for (const root of fresh) seen.add(root);
    return fresh;
  };
  return [
    group(nearest ? withSourceDirectory(nearest, index) : []),
    group(withSourceDirectory('.', index)),
    group(index.projectRoots.flatMap((root) => withSourceDirectory(root, index))),
  ].filter((roots) => roots.length > 0);
}

/**
 * Looks up a dotted name one segment at a time, as the import system does. In each search group a
 * package `__init__.py` wins over a module file in the same directory. The first group with a
 * regular package or module decides that segment, and its submodules are searched only inside
 * it. Directories without `__init__.py` are namespace portions, which combine across groups and
 * are used only when no group has a regular package or module. More than one candidate within a
 * group is ambiguous (D9).
 */
function lookupSegments(
  segments: string[],
  searchGroups: string[][],
  index: PythonResolutionIndex,
): Lookup {
  let groups = searchGroups;
  for (const [position, segment] of segments.entries()) {
    const last = position === segments.length - 1;
    let found: { path: string; directory?: string | undefined } | undefined;
    const portions: string[][] = [];
    for (const group of groups) {
      const candidates = new Map<string, string | undefined>();
      const namespaceDirectories: string[] = [];
      for (const directory of group) {
        const base = joinPath(directory, segment);
        if (index.files.has(`${base}/__init__.py`)) candidates.set(`${base}/__init__.py`, base);
        else if (index.files.has(`${base}.py`)) candidates.set(`${base}.py`, undefined);
        else if (index.directories.has(base)) namespaceDirectories.push(base);
      }
      if (candidates.size > 1) return { kind: 'ambiguous' };
      if (candidates.size === 1) {
        const [[path, directory]] = [...candidates];
        found = { path, directory };
        break;
      }
      if (namespaceDirectories.length > 0) portions.push(namespaceDirectories);
    }
    if (found) {
      if (last) return { kind: 'file', path: found.path };
      // A module file has no submodules.
      if (found.directory === undefined) return { kind: 'missing' };
      groups = [[found.directory]];
    } else if (portions.length > 0) {
      if (last) return { kind: 'namespace' };
      groups = portions;
    } else return { kind: 'missing' };
  }
  return { kind: 'missing' };
}

/** The package a relative spelling names when it has no module part: `.` or `..`. */
function lookupDirectory(directory: string, index: PythonResolutionIndex): Lookup {
  const packageFile = joinPath(directory, '__init__.py');
  if (index.files.has(packageFile)) return { kind: 'file', path: packageFile };
  return directory === '.' || index.directories.has(directory)
    ? { kind: 'namespace' }
    : { kind: 'missing' };
}

/** The directory a relative spelling starts from, or undefined above the Guard root. */
function relativeBase(file: string, level: number): string | undefined {
  let directory = posix.dirname(file);
  for (let step = 1; step < level; step += 1) {
    if (directory === '.') return undefined;
    directory = posix.dirname(directory);
  }
  return directory;
}

function relativeParts(spelling: string): { level: number; rest: string } {
  const level = /^\.*/.exec(spelling)?.[0].length ?? 0;
  return { level, rest: spelling.slice(level) };
}

/** `X.n` for an absolute `X`, `.n` or `..pkg.n` for a relative one. */
function childSpelling(spelling: string, name: string): string {
  return spelling.endsWith('.') ? `${spelling}${name}` : `${spelling}.${name}`;
}

/**
 * Resolves the Python imports of one module from its parse facts (D9). Runs on every discovery,
 * so results never depend on cached state. Resolution only targets `.py` files.
 */
export function resolvePythonImports(
  file: string,
  facts: readonly PythonImportFact[],
  index: PythonResolutionIndex,
): PythonResolution {
  const groups = rootGroups(file, index);
  const allRoots = groups.flat();
  // The deepest root containing the file defines its package, used for canonical names.
  const packageRoot = allRoots
    .filter((root) => isAncestor(root, file))
    .sort((left, right) => right.length - left.length)[0];
  const resolvedImportMap: Record<string, string> = {};
  const unresolved = new Set<string>();
  const canonicalImports: Record<string, string> = {};
  const importLines: Record<string, number> = {};
  const recordLine = (spelling: string, line: number): void => {
    if (!Object.hasOwn(importLines, spelling)) importLines[spelling] = line;
  };

  const localLooking = (dotted: string): boolean => {
    const first = dotted.split('.')[0];
    return allRoots.some(
      (root) =>
        index.files.has(joinPath(root, `${first}.py`)) ||
        index.directories.has(joinPath(root, first)),
    );
  };
  const lookup = (spelling: string): Lookup => {
    const { level, rest } = relativeParts(spelling);
    if (level === 0) return lookupSegments(spelling.split('.'), groups, index);
    const base = relativeBase(file, level);
    if (base === undefined) return { kind: 'missing' };
    return rest === ''
      ? lookupDirectory(base, index)
      : lookupSegments(rest.split('.'), [[base]], index);
  };
  const canonical = (spelling: string): void => {
    const { level, rest } = relativeParts(spelling);
    if (level === 0 || packageRoot === undefined) return;
    const base = relativeBase(file, level);
    if (base === undefined || (base !== packageRoot && !isAncestor(packageRoot, base))) return;
    const directory =
      base === packageRoot ? '' : packageRoot === '.' ? base : base.slice(packageRoot.length + 1);
    const segments = [...directory.split('/'), ...rest.split('.')].filter(Boolean);
    if (segments.length > 0 && segments.every((segment) => IDENTIFIER.test(segment))) {
      canonicalImports[spelling] = segments.join('.');
    }
  };
  /** Records a module the statement needs; a namespace directory has no file to point at. */
  const requireModule = (spelling: string, namespaceIsGap: boolean): void => {
    const found = lookup(spelling);
    if (found.kind === 'file') resolvedImportMap[spelling] = found.path;
    else if (found.kind === 'namespace') {
      if (namespaceIsGap) unresolved.add(spelling);
    } else if (found.kind === 'ambiguous' || spelling.startsWith('.') || localLooking(spelling)) {
      unresolved.add(spelling);
    }
  };

  for (const fact of facts) {
    recordLine(fact.module, fact.line);
    canonical(fact.module);
    if (fact.names === undefined) {
      requireModule(fact.module, false);
      continue;
    }
    // `from X import n`: `X.n` as a module first, otherwise `n` is a symbol of `X` (D9).
    let needsModule = fact.names.length === 0;
    for (const name of fact.names) {
      const child = childSpelling(fact.module, name);
      const found = lookup(child);
      if (found.kind === 'file' || found.kind === 'ambiguous') {
        recordLine(child, fact.line);
        canonical(child);
        if (found.kind === 'file') resolvedImportMap[child] = found.path;
        else unresolved.add(child);
      } else if (found.kind === 'missing') needsModule = true;
    }
    // Symbols cannot come from a namespace directory, which has no module file.
    if (needsModule) requireModule(fact.module, true);
  }

  for (const spelling of Object.keys(resolvedImportMap)) unresolved.delete(spelling);
  return {
    imports: Object.keys(importLines).sort(),
    importLines,
    resolvedImports: [...new Set(Object.values(resolvedImportMap))].sort(),
    resolvedImportMap,
    unresolvedImports: [...unresolved].sort(),
    canonicalImports,
  };
}
