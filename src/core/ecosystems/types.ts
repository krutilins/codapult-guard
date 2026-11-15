import type { ProjectModel } from '../discovery/discovery.js';
export type WorkspacePackage = ProjectModel['project']['workspacePackages'][number];
export type ResolutionInput = 'content' | 'path' | undefined;
export interface EcosystemContext {
  root: string;
  allFiles: string[];
}
export interface EcosystemProject {
  name?: string | undefined;
  packageManager?: string | undefined;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  packages: WorkspacePackage[];
  diagnostics?: { path: string; message: string }[];
}
export interface ProjectCheckMetadata {
  engines?: { node?: string | undefined } | undefined;
  packageManager?: string | undefined;
  scripts?: Record<string, string> | undefined;
}
export interface EcosystemProvider {
  readonly id: string;
  readonly protectedPaths?: readonly { pattern: string; kind: string }[];
  readonly signals?: EcosystemSignals;
  packageMatches?(name: string, source: string): boolean;
  readonly rootMarkers: readonly string[];
  readonly ignoredDirectories: readonly string[];
  readonly ignoredDirectorySuffixes?: readonly string[];
  readonly configFileNames: readonly string[];
  isConfigFile?(name: string): boolean;
  resolutionInput?(path: string): ResolutionInput;
  signatureInput?(context: EcosystemContext): unknown;
  resolutionRoots?(paths: string[]): Record<string, string[]>;
  readProject(context: EcosystemContext): EcosystemProject | undefined;
  readCheckMetadata?(root: string): ProjectCheckMetadata;
}

export interface EcosystemSignals {
  runtimeAlwaysObserved?: boolean;
  frameworks: readonly { dependency: string; name: string; unless?: string }[];
  capabilities: Partial<Record<string, { packages: RegExp; imports: RegExp; evidence: string }>>;
}
