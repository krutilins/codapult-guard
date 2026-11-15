import { extname } from 'node:path';
import { jsTsBackend } from './js-ts/index.js';
import { pythonBackend } from './python/index.js';
import type { LanguageBackend, ModuleFact } from './types.js';
export type {
  ModuleFact,
  LanguageBackend,
  LanguageContext,
  LanguageSession,
  LanguageProjectFacts,
  ImportReference,
} from './types.js';
const backends = [jsTsBackend, pythonBackend] as const;
export type SourceLanguage = (typeof backends)[number]['id'];
export interface LanguageRegistry {
  readonly backends: readonly LanguageBackend[];
  forPath(path: string): LanguageBackend | undefined;
  routeLayerSegments(path: string): readonly string[];
  resolutionInput(path: string): 'content' | 'path' | undefined;
}
export function createLanguageRegistry(registered: readonly LanguageBackend[]): LanguageRegistry {
  const byExtension = new Map<string, LanguageBackend>();
  for (const backend of registered)
    for (const extension of backend.extensions) {
      if (byExtension.has(extension)) throw new Error(`Duplicate language extension: ${extension}`);
      byExtension.set(extension, backend);
    }
  return {
    backends: registered,
    forPath(path: string): LanguageBackend | undefined {
      return byExtension.get(extname(path));
    },
    routeLayerSegments(path: string): readonly string[] {
      return (
        byExtension.get(extname(path))?.routeLayerSegments ?? [
          ...new Set(registered.flatMap((backend) => backend.routeLayerSegments)),
        ]
      );
    },
    resolutionInput(path: string) {
      const inputs = registered.map((backend) => backend.resolutionInput(path));
      return inputs.includes('content') ? 'content' : inputs.includes('path') ? 'path' : undefined;
    },
  };
}
export const languageRegistry = createLanguageRegistry(backends);
export function sourceLanguage(path: string): SourceLanguage | undefined {
  return languageRegistry.forPath(path)?.id as SourceLanguage | undefined;
}
export function collectedFacts(
  path: string,
  model?: import('../discovery/discovery.js').ProjectModel,
): readonly ModuleFact[] {
  const backend = languageRegistry.forPath(path);
  return (
    (model && backend?.factsForModule
      ? backend.factsForModule(path, model)
      : backend?.collectedFacts) ?? []
  );
}

export function packageForModule(
  model: import('../discovery/discovery.js').ProjectModel,
  path: string,
): import('../ecosystems/types.js').WorkspacePackage | undefined {
  const ecosystem = languageRegistry.forPath(path)?.ecosystem;
  return model.project.workspacePackages
    .filter(
      (p) =>
        (p.ecosystem ?? 'npm') === ecosystem && (p.path === '.' || path.startsWith(p.path + '/')),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}
