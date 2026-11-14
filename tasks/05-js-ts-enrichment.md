# Task 05: Move JS/TS AST enrichment behind its backend

**Phase:** 1, Language layer  
**Estimate:** 1–2 days  
**Depends on:** Task 04  
**Commit:** `refactor(languages): move route and environment facts into backends`  
**Status:** Not started

## Goal

Remove the remaining direct AST access from shared discovery. Today `routeDetails` and `envReferences` read the `ts-morph` project inside `discoverProjectOnce` and `buildInsights`.

## Work

A new session method returns project-level facts per language, and discovery merges them:

```ts
export interface LanguageProjectFacts {
  routeHandlers: string[];
  routeDetails: { path: string; methods: string[] }[];
  barrelFiles: string[];
  serverActions: string[];
  clientComponents: string[];
  environmentReads: { name: string; files: string[] }[];
}

export interface LanguageSession {
  // Earlier members omitted.
  projectFacts(modules: ModuleRecord[], sourceFiles: string[]): LanguageProjectFacts;
}
```

- The Next.js route patterns, HTTP method detection, `use client` and `use server` filters, barrel file detection, and `process.env` scanning move to the JS/TS backend.
- The Python backend returns empty values for now. Tasks 13 and 15 fill them in.
- The `declared` check on environment references stays in shared code, because it depends on project files instead of syntax.
- `buildImpactPaths` keeps its behavior and receives entrypoints from the merged facts.
- `impactPaths[].boundaries` keeps reading directives, and it is empty for languages without them.

## Acceptance criteria

- The model baseline is unchanged.
- `discovery.ts` no longer imports `ts-morph`, as a value or as a type.
- `buildInsights` no longer takes an AST project.
