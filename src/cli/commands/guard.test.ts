import { describe, expect, it, vi } from 'vitest';
import { config } from '../../core/config.js';

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true), writeFileSync: vi.fn() }));
vi.mock('../../core/guard.js', () => ({
  GUARD_BASELINE_FILE: `.${config.appName}/guard/baseline.json`,
  GUARD_BASELINE_META_FILE: `.${config.appName}/guard/baseline-meta.json`,
  GUARD_RULES_FILE: `.${config.appName}/guard/rules.json`,
  GUARD_PROJECT_FILE: `.${config.appName}/guard/project.json`,
  GUARD_HISTORY_DIR: `.${config.appName}/guard/history`,
  GUARD_ARCHITECTURE_FILE: `.${config.appName}/guard/architecture.json`,
  GUARD_CONVENTIONS_FILE: `.${config.appName}/guard/conventions.json`,
  GUARD_AGENT_FILE: `.${config.appName}/guard/agent.json`,
  GUARD_CONTRACTS_FILE: `.${config.appName}/guard/contracts.json`,
  GUARD_PROPOSALS_FILE: `.${config.appName}/guard/proposals.json`,
  findGuardRoot: vi.fn(() => '/project'),
  discoverProject: vi.fn(() => ({ files: [], modules: [], insights: { cycles: [] } })),
  discoverProjectWithMetrics: vi.fn(() => ({
    model: { files: [], modules: [], insights: { cycles: [] } },
    metrics: { durationMs: 1, files: 0, modules: 0, cacheAvailable: false },
  })),
  initializeGuard: vi.fn(() => ({
    config: { rules: [{}], contracts: [] },
    report: { scannedFiles: 3 },
  })),
  loadBaseline: vi.fn(() => new Set()),
  loadGuardConfig: vi.fn(() => ({ rules: [] })),
  writeGuardConfig: vi.fn(),
  scanGuard: vi.fn(() => ({ scannedFiles: 3, suppressed: 0, findings: [] })),
  validateGuardContracts: vi.fn(() => []),
  validateGuardBudgets: vi.fn(() => []),
  validateGuardPolicy: vi.fn(() => []),
  listGuardRuns: vi.fn(() => []),
  summarizeGuardRuns: vi.fn(() => ({
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    averageDurationMs: 0,
  })),
  buildGuardReviewPacket: vi.fn(() => ({ version: 1, changedFiles: [] })),
  buildGuardProposals: vi.fn(() => ({
    version: 1,
    generatedAt: 'now',
    rules: [],
    contracts: [],
    questions: [],
  })),
  buildGeneratedGuardConfig: vi.fn(() => ({ version: 1, rules: [], contracts: [] })),
  writeProjectState: vi.fn(() => 'working-tree'),
  loadGuardProposals: vi.fn(),
  writeGuardProposals: vi.fn(),
  recordGuardProposalDecision: vi.fn(),
  applyGuardProposalDecision: vi.fn(),
  validateGuardProposalApproval: vi.fn(() => undefined),
  getGuardProposalFreshness: vi.fn(() => 'current'),
}));

vi.mock('../../core/verification/verify.js', () => ({
  runGuardVerification: vi.fn(() => ({
    status: 'ok',
    checks: {},
    adapters: {},
    architecture: { findings: [] },
    contractIssues: [],
    requirement: { status: 'delegated-to-review', message: 'review' },
    run: { receipt: undefined },
  })),
}));

describe('guard commands', () => {
  it('initializes the guard configuration and baseline', async () => {
    const { guardInitCommand } = await import('./guard.js');
    expect(() => guardInitCommand()).not.toThrow();
  });

  it('passes --force through when replacing Guard state', async () => {
    const { guardInitCommand } = await import('./guard.js');
    guardInitCommand({ force: true });
    const { initializeGuard } = await import('../../core/guard.js');
    expect(initializeGuard).toHaveBeenCalledWith('/project', { force: true });
  });

  it('checks the configured project without new violations', async () => {
    const { guardCheckCommand } = await import('./guard.js');
    guardCheckCommand();
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it('shows skipped checks without changing the exit code', async () => {
    const { guardCheckCommand } = await import('./guard.js');
    const { scanGuard } = await import('../../core/guard.js');
    const notApplicable = [
      {
        ruleId: 'contract:audit',
        reason: 'Discovery does not collect calls for these modules.',
        modules: 2,
      },
    ];
    const report = { scannedFiles: 3, suppressed: 0, findings: [], notApplicable };
    vi.mocked(scanGuard)
      .mockReturnValueOnce(report as never)
      .mockReturnValueOnce(report as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    guardCheckCommand();
    const text = log.mock.calls.flat().join('\n');
    expect(process.exitCode).toBe(0);
    log.mockClear();
    guardCheckCommand({ sarif: true });
    const sarif = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      runs: [{ results: unknown[]; invocations: unknown[] }];
    };
    log.mockRestore();

    expect(text).toContain(
      'Not applicable [contract:audit] to 2 module(s): Discovery does not collect calls',
    );
    expect(process.exitCode).toBe(0);
    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].invocations).toHaveLength(1);
    process.exitCode = undefined;
  });

  it('shows the graph status and import summary in impact output', async () => {
    const { guardImpactCommand } = await import('./guard.js');
    const { discoverProject } = await import('../../core/guard.js');
    const module = (
      path: string,
      imports: string[],
      extra: Record<string, unknown>,
    ): Record<string, unknown> => ({
      path,
      contentHash: path,
      imports,
      importedSymbols: [],
      exports: [],
      calls: [],
      resolvedImports: [],
      dynamicImports: [],
      declarations: { classes: 0, functions: 0, interfaces: 0, types: 0, variables: 0 },
      directives: [],
      ...extra,
    });
    vi.mocked(discoverProject).mockReturnValueOnce({
      modules: [
        module('app/api.py', ['app.services'], {
          resolvedImports: ['app/services.py'],
          resolvedImportMap: { 'app.services': 'app/services.py' },
        }),
        module('app/services.py', ['.database'], { unresolvedImports: ['.database'] }),
      ],
      capabilities: {},
      insights: { impactPaths: [], dependencyEdges: [], layers: {}, layerEdges: [] },
    } as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    guardImpactCommand(['app/services.py']);
    const text = [...log.mock.calls, ...warning.mock.calls].flat().join('\n');
    log.mockRestore();
    warning.mockRestore();

    expect(text).toContain('Graph: partial, 1 unresolved import(s) in affected modules');
    expect(text).toContain('app/services.py: .database');
    expect(text).toContain(
      'Imports (python): 2 module(s), 2 import(s), 1 resolved, 1 unresolved, 0 external',
    );
  });

  it('analyzes the project and refreshes the discovery snapshot', async () => {
    const { guardAnalyzeCommand } = await import('./guard.js');
    expect(() => guardAnalyzeCommand()).not.toThrow();
  });

  it('runs the unified verification gate', async () => {
    const { guardVerifyCommand } = await import('./guard.js');
    guardVerifyCommand();
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it('does not export an attestation when verification produced no receipt', async () => {
    const { guardVerifyCommand } = await import('./guard.js');
    const { writeFileSync } = await import('node:fs');

    guardVerifyCommand({ json: true, attestationOut: '/tmp/guard-verification.intoto.json' });

    expect(process.exitCode).toBe(1);
    expect(writeFileSync).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });

  it('writes an in-toto statement for a passing verification receipt', async () => {
    const { guardVerifyCommand } = await import('./guard.js');
    const { runGuardVerification } = await import('../../core/verification/verify.js');
    const { writeFileSync } = await import('node:fs');
    const result = runGuardVerification('/project');
    result.run.receipt = {
      version: 1,
      kind: 'verification-receipt',
      runId: 'run-1',
      generatedAt: '2026-10-31T00:00:00.000Z',
      outcome: 'pass',
      gate: 'none',
      subject: { changedFiles: [], workingTreeDirty: false },
      verificationScope: {
        algorithm: 'sha256',
        fingerprint: 'a'.repeat(64),
        complete: true,
        stable: true,
        files: [],
      },
      stages: { 'verification-scope': 'ok' },
      checks: {},
      findings: {
        total: 0,
        errors: 0,
        warnings: 0,
        waived: 0,
        waiverWarnings: 0,
        expiredWaivers: 0,
        fingerprints: [],
        ruleIds: [],
      },
      contractIssues: [],
      decisionIds: [],
      tool: { name: '@codapult/guard', version: '0.10.0' },
    };
    vi.mocked(runGuardVerification).mockReturnValueOnce(result);

    guardVerifyCommand({ json: true, attestationOut: '/tmp/guard-verification.intoto.json' });

    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/guard-verification.intoto.json',
      expect.stringContaining('https://in-toto.io/Statement/v1'),
    );
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it('allows the CLI to skip automatically detected external adapters', async () => {
    const { guardVerifyCommand } = await import('./guard.js');
    const { runGuardVerification } = await import('../../core/verification/verify.js');

    guardVerifyCommand({ tools: 'off' });

    expect(runGuardVerification).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({ tools: 'off' }),
    );
    process.exitCode = undefined;
  });

  it('passes protected policy options through the CLI verification command', async () => {
    const { guardVerifyCommand } = await import('./guard.js');
    const { runGuardVerification } = await import('../../core/verification/verify.js');

    guardVerifyCommand({
      policyBase: 'origin/main',
      failOnPolicyChange: true,
    });

    expect(runGuardVerification).toHaveBeenLastCalledWith(
      '/project',
      expect.objectContaining({
        policyBase: 'origin/main',
        failOnPolicyChange: true,
      }),
    );
    process.exitCode = undefined;
  });

  it('runs a full Guard audit', async () => {
    const { guardAuditCommand } = await import('./guard.js');
    guardAuditCommand();
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it('prepares a semantic review packet', async () => {
    const { guardReviewCommand } = await import('./guard.js');
    expect(() => guardReviewCommand()).not.toThrow();
    process.exitCode = undefined;
  });

  it('activates only explicitly selected proposed rules', async () => {
    const guardIndex = await import('../../core/guard.js');
    vi.mocked(guardIndex.loadGuardConfig).mockReturnValue({
      version: 1,
      rules: [
        {
          id: 'approved-rule',
          description: 'rule',
          severity: 'warning',
          kind: 'forbidden-import',
          patterns: ['internal'],
          status: 'proposed',
        },
      ],
    });
    const { guardRulesApproveCommand } = await import('./guard.js');

    guardRulesApproveCommand('approved-rule');

    expect(vi.mocked(guardIndex.applyGuardProposalDecision)).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ rules: [expect.objectContaining({ status: 'active' })] }),
      [{ id: 'approved-rule', type: 'rule', decision: 'approved' }],
      { source: 'cli' },
    );
    process.exitCode = undefined;
  });
});
