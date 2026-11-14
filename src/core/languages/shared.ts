import type { LanguageProjectFacts } from './types.js';
export function pathMatches(value: string, pattern: string): boolean {
  return pattern.endsWith('*')
    ? value.startsWith(pattern.slice(0, -1))
    : value === pattern || value.startsWith(`${pattern}/`);
}
export function emptyProjectFacts(): LanguageProjectFacts {
  return {
    routeHandlers: [],
    routeDetails: [],
    barrelFiles: [],
    serverActions: [],
    clientComponents: [],
    environmentReads: [],
  };
}
