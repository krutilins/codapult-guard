import type {
  ModuleRecord,
  ProjectFileRecord,
  ImportResolutionStatus,
} from '../discovery/discovery.js';
export type ModuleFact = 'imports' | 'calls' | 'directives' | 'packages';
/** Static inputs for one discovery; implementations must never execute project code. */
export interface LanguageContext {
  root: string;
  allFiles: string[];
  projectFiles: Set<string>;
  workspaceNames: ReadonlySet<string>;
  resolutionRoots: Record<string, string[]>;
}
export interface ImportReference {
  source: string;
  resolved?: string | undefined;
  canonical?: string | undefined;
  line: number;
}
export interface LanguageProjectFacts {
  routeHandlers: string[];
  routeDetails: { path: string; methods: string[] }[];
  barrelFiles: string[];
  serverActions: string[];
  clientComponents: string[];
  environmentReads: { name: string; files: string[] }[];
}
export interface LanguageSession {
  /** Parse facts may be reused while content and declared resolution inputs are unchanged. */
  parseModule(path: string): ModuleRecord | undefined;
  /** Called on fresh and reused records whenever discovery rebuilds the model. */
  resolveModules(modules: ModuleRecord[]): ModuleRecord[];
  /** Backend-owned syntax enrichment; shared discovery merges and sorts the result. */
  projectFacts(modules: ModuleRecord[], sourceFiles: string[]): LanguageProjectFacts;
}
export interface LanguageBackend {
  readonly id: string;
  readonly extensions: ReadonlySet<string>;
  readonly collectedFacts: readonly ModuleFact[];
  classifyFile(path: string): ProjectFileRecord['kind'];
  readonly routeLayerSegments: readonly string[];
  isTestFile(path: string): boolean;
  createSession(context: LanguageContext): LanguageSession;
  /** Content inputs invalidate parsed records; path inputs track the target-file inventory. */
  resolutionInput(path: string): 'content' | 'path' | undefined;
  importStatus(module: ModuleRecord, specifier: string): ImportResolutionStatus;
  referenceMatches(reference: ImportReference, pattern: string): boolean;
  fallbackTargets(module: ModuleRecord, projectFiles: Set<string>): string[];
  isImportHotspot(module: ModuleRecord, specifier: string): boolean;
}
