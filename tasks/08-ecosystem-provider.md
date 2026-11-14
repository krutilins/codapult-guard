# Task 08: Add the ecosystem interface and extract npm

**Phase:** 2, Ecosystem layer  
**Estimate:** 2–3 days  
**Depends on:** Task 07  
**Commit:** `refactor(ecosystems): extract npm project metadata`  
**Status:** Not started

## Goal

Separate per-project metadata from per-file language logic, starting with a behavior-preserving extraction of npm.

## Work

New folder `src/core/ecosystems/` with `types.ts`, `index.ts` (the registry), `npm/`, and an empty `python/` that declares its existing markers.

```ts
export interface EcosystemProvider {
  readonly id: string;
  /** Files that mark a project root, used by `findGuardRoot`. */
  readonly rootMarkers: readonly string[];
  /** Directories discovery never enters, such as `node_modules` or `.venv`. */
  readonly ignoredDirectories: readonly string[];
  readonly configFileNames: readonly string[];
  readProject(context: EcosystemContext): EcosystemProject | undefined;
}

export interface EcosystemProject {
  name?: string;
  packageManager?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  packages: WorkspacePackage[];
}
```

Moved or changed:

- `packageJson` reads in `discoverProjectOnce`, `workspacePackages`, `packageManager`, and npm parts of `discoverySignature` and `resolutionFingerprint` move to the npm provider.
- `IGNORED_DIRECTORIES`, `CONFIG_NAMES`, `PYTHON_CONFIG_NAMES`, and `PYTHON_PROJECT_MARKERS` split between providers. Generic entries such as `.git` and `dist` stay shared.
- `findGuardRoot` reads root markers from the registry.
- `workspaceNames` reaches the JS/TS backend through its context in a form that replaces the temporary field from Task 04.
- Merging rule: `ProjectModel.project` keeps its current fields and shape (D24). When more than one ecosystem is present, the root `package.json` keeps today's meaning, and other ecosystems add entries as packages. Task 09 implements the second case.
- The boundary test from Task 07 also fails on `package.json` reads outside `core/ecosystems/`, with `verify.ts` and `mcp/server.ts` allowed for Guard's own version lookup.

## Acceptance criteria

- The model baseline is unchanged.
- A fake ecosystem in the conformance suite adds a manifest and a package with no change outside its test file.
- `discovery.ts` reads no manifest directly.
