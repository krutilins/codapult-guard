import { resolve } from 'node:path';
import { ecosystemRegistry } from '../core/ecosystems/index.js';
import { runProjectCommand, type CommandResult } from './command.js';
import type { ProjectRuntimeDiagnostics } from '../core/ecosystems/types.js';
export type { ProjectRuntimeDiagnostics } from '../core/ecosystems/types.js';
import type { GuardAdapterName, GuardToolMode, ProjectCheck } from '../core/model/types.js';

export type { ProjectCheck } from '../core/model/types.js';
export type GuardAdapter = GuardAdapterName;
export type ExternalToolMode = GuardToolMode;

export type ProjectCheckResults = Partial<Record<ProjectCheck, CommandResult>>;

export interface ProjectChecksOptions {
  timeout?: number | undefined;
  commands?: Partial<Record<ProjectCheck, string>> | undefined;
}

export interface WorkspaceProjectChecksOptions extends ProjectChecksOptions {
  rootResults?: ProjectCheckResults | undefined;
}

export interface ProjectAdaptersOptions {
  mode?: Exclude<ExternalToolMode, 'off'> | undefined;
  timeout?: number | undefined;
  tooling?: Partial<Record<GuardAdapter, { script: string; enabled: boolean }>> | undefined;
}

function notConfigured(check: string): CommandResult {
  return {
    command: '',
    status: 'not-configured',
    passed: false,
    exitCode: 0,
    stdout: '',
    stderr: `${check} script is not configured`,
    durationMs: 0,
  };
}

function readPackageMetadata(
  root: string,
): import('../core/ecosystems/types.js').ProjectCheckMetadata {
  return ecosystemRegistry.readCheckMetadata(root);
}

export function inspectProjectRuntime(root: string): ProjectRuntimeDiagnostics {
  return (
    ecosystemRegistry.runtimeDiagnostics({ root, allFiles: [] }) ?? {
      node: process.versions.node,
      compatible: true,
      issues: [],
    }
  );
}

export function runProjectChecks(
  root: string,
  checks: ProjectCheck[],
  options: ProjectChecksOptions = {},
): ProjectCheckResults {
  const results: Partial<Record<ProjectCheck, CommandResult>> = {};
  for (const check of checks) {
    const command =
      options.commands?.[check] ??
      ecosystemRegistry.projectCheckCommand(check, { root, allFiles: [] });
    results[check] = command
      ? runProjectCommand(command, root, {
          timeout: options.timeout ?? (check === 'build' ? 300_000 : 120_000),
        })
      : notConfigured(check);
  }
  return results;
}

function hasCheck(scripts: Record<string, string>, check: ProjectCheck): boolean {
  return check === 'typecheck'
    ? Boolean(scripts.typecheck || scripts['type-check'])
    : Boolean(scripts[check]);
}

/**
 * Runs checks for workspace packages only when the root package does not own
 * the corresponding check. Root orchestration remains the source of truth.
 */
export function runWorkspaceProjectChecks(
  root: string,
  packages: { path: string; scripts: Record<string, string> }[],
  checks: ProjectCheck[],
  options: WorkspaceProjectChecksOptions = {},
): Record<string, ProjectCheckResults> {
  const rootResults = options.rootResults ?? runProjectChecks(root, checks, options);
  const missingAtRoot = new Set(
    checks.filter((check) => rootResults[check]?.status === 'not-configured'),
  );
  return Object.fromEntries(
    packages
      .filter((workspace) =>
        checks.some((check) => missingAtRoot.has(check) && hasCheck(workspace.scripts, check)),
      )
      .map((workspace) => [
        workspace.path,
        runProjectChecks(resolve(root, workspace.path), [...missingAtRoot], options),
      ]),
  );
}

const adapterScriptPatterns: Record<GuardAdapter, RegExp> = {
  'dependency-graph': /(?:dep(?:endency)?[-:]?(?:check|graph|cruise)|madge|architecture)/i,
  security: /(?:security|semgrep|gitleaks|snyk|trivy|audit)/i,
  'dependency-hygiene': /(?:knip|dep(?:endency)?[-:]?(?:unused|hygiene))/i,
  sast: /(?:semgrep|codeql|bearer|sast)/i,
  'secret-scanning': /(?:gitleaks|trufflehog|secret[-_ ]?scan)/i,
  'dependency-audit': /(?:npm audit|pnpm audit|yarn audit|osv|snyk|trivy|dependency[-_ ]?audit)/i,
};

/** Runs only explicitly configured project scripts; Guard does not recreate these tools. */
export function runProjectAdapters(
  root: string,
  options: ProjectAdaptersOptions = {},
): Partial<Record<GuardAdapter, CommandResult>> {
  const metadata = readPackageMetadata(root);
  const manager = inspectProjectRuntime(root).packageManager;
  const scripts = metadata.scripts ?? {};
  const results: Partial<Record<GuardAdapter, CommandResult>> = {};
  const executed = new Map<string, CommandResult>();
  for (const [adapter, pattern] of Object.entries(adapterScriptPatterns) as [
    GuardAdapter,
    RegExp,
  ][]) {
    const configured = options.tooling?.[adapter];
    const script = configured?.enabled
      ? configured.script
      : configured?.enabled === false
        ? undefined
        : Object.keys(scripts).find((name) => pattern.test(name));
    if ((!script || !manager) && options.mode !== 'on') {
      continue;
    }
    if (!script || !manager) {
      results[adapter] = notConfigured(adapter);
      continue;
    }
    const command = manager === 'npm' ? `npm run ${script}` : `${manager} run ${script}`;
    const previous = executed.get(command);
    const result =
      previous ??
      runProjectCommand(command, root, {
        timeout: options.timeout ?? 120_000,
      });
    executed.set(command, result);
    results[adapter] = result;
  }
  return results;
}
