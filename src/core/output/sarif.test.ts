import { describe, expect, it } from 'vitest';
import { guardFindingsToSarif } from './sarif.js';

describe('guardFindingsToSarif', () => {
  it('emits GitHub-compatible SARIF locations and levels', () => {
    const sarif = guardFindingsToSarif([
      {
        ruleId: 'client-no-db',
        severity: 'error',
        file: 'src/client.ts',
        line: 7,
        importPath: '@/lib/db',
        message: 'Client code must not import the database.',
        fingerprint: 'fingerprint',
      },
    ]);

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0]).toMatchObject({
      ruleId: 'client-no-db',
      level: 'error',
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'src/client.ts' },
            region: { startLine: 7 },
          },
        },
      ],
    });

    expect(JSON.stringify(sarif)).toBe(
      JSON.stringify({
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [
          {
            tool: {
              driver: {
                name: 'Codapult Guard',
                informationUri: 'https://codapult.dev/docs/developer-tools/guard',
              },
            },
            results: [
              {
                ruleId: 'client-no-db',
                level: 'error',
                message: { text: 'Client code must not import the database.' },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: 'src/client.ts' },
                      region: { startLine: 7 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
  });

  it('emits location-free operational notices', () => {
    const sarif = guardFindingsToSarif(
      [],
      [
        {
          ruleId: 'guard-waiver-expiring',
          level: 'warning',
          message: 'Waiver expires soon.',
        },
      ],
    );

    expect(sarif.runs[0].results).toEqual([
      {
        ruleId: 'guard-waiver-expiring',
        level: 'warning',
        message: { text: 'Waiver expires soon.' },
      },
    ]);
  });

  it('writes skipped checks as tool execution notifications, not results', () => {
    const sarif = guardFindingsToSarif(
      [],
      [],
      [
        {
          ruleId: 'contract:audit',
          reason: 'Discovery does not collect calls for these modules.',
          modules: 2,
        },
      ],
    );

    expect(sarif.runs[0].results).toEqual([]);
    expect(sarif.runs[0].invocations).toEqual([
      {
        executionSuccessful: true,
        toolExecutionNotifications: [
          {
            level: 'note',
            message: {
              text: 'Not applicable to 2 module(s): Discovery does not collect calls for these modules.',
            },
            associatedRule: { id: 'contract:audit' },
          },
        ],
      },
    ]);
    expect(guardFindingsToSarif([]).runs[0]).not.toHaveProperty('invocations');
  });
});
