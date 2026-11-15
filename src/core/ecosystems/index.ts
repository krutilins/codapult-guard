import type { ProjectCheck } from '../model/types.js';
import { basename } from 'node:path';
import { npmEcosystem } from './npm/index.js';
import { pythonEcosystem } from './python/index.js';
import type {
  EcosystemContext,
  EcosystemProvider,
  EcosystemProject,
  ProjectCheckMetadata,
  ProjectRuntimeDiagnostics,
  ResolutionInput,
} from './types.js';
export { pythonProjectRoots } from './python/index.js';
export type { EcosystemProvider, EcosystemContext, EcosystemProject } from './types.js';
export interface EcosystemRegistry {
  rootMarkers: string[];
  providers: readonly EcosystemProvider[];
  ignoredDirectory(name: string): boolean;
  isConfigFile(path: string): boolean;
  resolutionInput(path: string): ResolutionInput;
  signatureInputs(context: EcosystemContext): unknown[];
  resolutionRoots(paths: string[]): Record<string, string[]>;
  projectCheckCommand(check: ProjectCheck, context: EcosystemContext): string | undefined;
  runtimeDiagnostics(context: EcosystemContext): ProjectRuntimeDiagnostics | undefined;
  readCheckMetadata(root: string): ProjectCheckMetadata;
  readProject(context: EcosystemContext): EcosystemProject;
}
export function createEcosystemRegistry(
  providers: readonly EcosystemProvider[],
): EcosystemRegistry {
  return {
    providers,
    rootMarkers: [...new Set(providers.flatMap((provider) => provider.rootMarkers))],
    ignoredDirectory(name: string): boolean {
      return providers.some(
        (provider) =>
          provider.ignoredDirectories.includes(name) ||
          provider.ignoredDirectorySuffixes?.some((suffix) => name.endsWith(suffix)),
      );
    },
    isConfigFile(path: string): boolean {
      const name = basename(path).toLowerCase();
      return providers.some(
        (provider) => provider.configFileNames.includes(name) || provider.isConfigFile?.(name),
      );
    },
    resolutionInput(path: string) {
      const inputs = providers.map((provider) => provider.resolutionInput?.(path));
      return inputs.includes('content') ? 'content' : inputs.includes('path') ? 'path' : undefined;
    },
    signatureInputs(context: EcosystemContext): unknown[] {
      return providers.flatMap((provider) =>
        provider.signatureInput === undefined ? [] : [provider.signatureInput(context)],
      );
    },
    resolutionRoots(paths: string[]): Record<string, string[]> {
      const result: Record<string, string[]> = {};
      for (const provider of providers)
        for (const [language, roots] of Object.entries(provider.resolutionRoots?.(paths) ?? {}))
          result[language] = [...new Set([...(result[language] ?? []), ...roots])].sort();
      return result;
    },
    projectCheckCommand(check, context) {
      for (const provider of providers) {
        const command = provider.projectCheckCommand?.(check, context);
        if (command !== undefined) return command;
      }
      return undefined;
    },
    runtimeDiagnostics(context) {
      for (const provider of providers) {
        const diagnostics = provider.runtimeDiagnostics?.(context);
        if (diagnostics !== undefined) return diagnostics;
      }
      return undefined;
    },
    readCheckMetadata(root: string): ProjectCheckMetadata {
      for (const provider of providers)
        if (provider.readCheckMetadata !== undefined) return provider.readCheckMetadata(root);
      return {};
    },
    readProject(context: EcosystemContext): EcosystemProject {
      const projects = providers.flatMap((provider) => {
        const project = provider.readProject(context);
        return project !== undefined ? [project] : [];
      });
      // Registry order preserves root npm metadata precedence. Additional providers contribute packages.
      const primary = projects.at(0);
      return {
        ...(primary?.name !== undefined ? { name: primary.name } : {}),
        ...(primary?.packageManager !== undefined
          ? { packageManager: primary.packageManager }
          : {}),
        dependencies: primary?.dependencies ?? {},
        devDependencies: primary?.devDependencies ?? {},
        scripts: primary?.scripts ?? {},
        ...(projects.some((p) => (p.diagnostics?.length ?? 0) > 0)
          ? {
              diagnostics: projects
                .flatMap((p) => p.diagnostics ?? [])
                .sort((a, b) => {
                  const path = a.path.localeCompare(b.path);
                  return path !== 0 ? path : a.message.localeCompare(b.message);
                }),
            }
          : {}),
        packages: projects
          .flatMap((project) => project.packages)
          .sort((a, b) => a.path.localeCompare(b.path)),
      };
    },
  };
}
export const ecosystemRegistry = createEcosystemRegistry([npmEcosystem, pythonEcosystem]);
