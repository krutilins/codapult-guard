import type { EcosystemSignals } from '../types.js';
export const npmSignals: EcosystemSignals = {
  runtimeAlwaysObserved: true,
  frameworks: [
    { dependency: 'next', name: 'Next.js' },
    { dependency: 'react', name: 'React' },
    { dependency: 'vue', name: 'Vue' },
    { dependency: 'svelte', name: 'Svelte' },
    { dependency: 'express', name: 'Express' },
    { dependency: 'fastify', name: 'Fastify' },
    { dependency: '@nestjs/core', name: 'NestJS' },
    { dependency: 'drizzle-orm', name: 'Drizzle' },
    { dependency: 'prisma', name: 'Prisma' },
    { dependency: 'vite', name: 'Vite', unless: 'next' },
  ],
  capabilities: {
    runtime: {
      packages: /^(next|react|vue|svelte|express|fastify|@nestjs\/core)$/,
      imports: /^(next|react|vue|svelte|express|fastify)(\/|$)/,
      evidence: 'package metadata and runtime imports',
    },
    routing: {
      packages: /^next$/,
      imports: /^(next\/navigation|next\/server|next\/headers)$/,
      evidence: 'route and page conventions',
    },
    persistence: {
      packages:
        /^(?:drizzle-orm|drizzle-kit|prisma|@prisma\/client|typeorm|sequelize|mongoose|knex|@libsql\/client)$/,
      imports:
        /^(?:@prisma\/client|prisma|drizzle-orm|drizzle-kit|typeorm|sequelize|mongoose|knex|@libsql\/client)(\/|$)|(?:^|\/)(?:db|database)(\/|$)/i,
      evidence: 'database and ORM conventions',
    },
    identity: {
      packages: /auth|identity|session|kinde|clerk|lucia|next-auth|better-auth/i,
      imports: /(?:^|\/)(?:auth|authentication|identity|session)(?:\/|$)/i,
      evidence: 'identity and session conventions',
    },
    payments: {
      packages: /stripe|lemonsqueezy|paddle|paypal|braintree|polar/i,
      imports: /stripe|lemonsqueezy|paddle|paypal|braintree|polar/i,
      evidence: 'payment provider conventions',
    },
    email: {
      packages: /resend|react-email|nodemailer|postmark|sendgrid|mailgun/i,
      imports: /resend|react-email|nodemailer|postmark|sendgrid|mailgun/i,
      evidence: 'email delivery and template conventions',
    },
    ai: {
      packages: /^(?:ai|openai|anthropic|@ai-sdk\/|@langchain\/)/i,
      imports: /^(?:ai|openai|anthropic|@ai-sdk\/|@langchain\/)/i,
      evidence: 'AI and model integration conventions',
    },
    jobs: {
      packages: /bullmq|agenda|inngest|trigger\.dev|@temporalio|graphile-worker|bee-queue|pg-boss/i,
      imports: /bullmq|agenda|inngest|trigger\.dev|@temporalio|graphile-worker|bee-queue|pg-boss/i,
      evidence: 'background job and queue conventions',
    },
    env: {
      packages: /dotenv|envalid|convex|@t3-oss\/env/i,
      imports: /dotenv|envalid|@t3-oss\/env/i,
      evidence: 'environment and configuration conventions',
    },
    deployment: {
      packages: /vercel|docker|pulumi|terraform|kubernetes|helm|aws-sdk|@aws-sdk\//i,
      imports: /vercel|pulumi|terraform|kubernetes|helm|aws-sdk|@aws-sdk\//i,
      evidence: 'deployment and infrastructure conventions',
    },
    testing: {
      packages: /vitest|jest|playwright|cypress|mocha|ava/i,
      imports: /vitest|jest|playwright|cypress|mocha|ava/i,
      evidence: 'test runner and test layout conventions',
    },
    observability: {
      packages: /sentry|opentelemetry|datadog|pino|winston|otel/i,
      imports: /sentry|opentelemetry|datadog|pino|winston|otel/i,
      evidence: 'logging, tracing, and error monitoring conventions',
    },
    storage: {
      packages: /s3|minio|r2|uploadthing|cloudinary|sharp/i,
      imports: /s3|minio|r2|uploadthing|cloudinary/i,
      evidence: 'file and object storage conventions',
    },
    'graphql-rpc': {
      packages: /graphql|trpc|grpc|@connectrpc\//i,
      imports: /graphql|trpc|grpc|@connectrpc\//i,
      evidence: 'GraphQL and RPC conventions',
    },
    i18n: {
      packages: /next-intl|i18next|react-i18next|lingui/i,
      imports: /next-intl|i18next|react-i18next|lingui/i,
      evidence: 'internationalization conventions',
    },
    configs: {
      packages: /^(?:cosmiconfig|convict|config|dotenv|jiti|tsx|ts-node)$/i,
      imports: /^(?:cosmiconfig|convict|config|dotenv|jiti|tsx|ts-node)(\/|$)/i,
      evidence: 'configuration files and loaders',
    },
    security: {
      packages:
        /(?:helmet|csrf|rate-limit|ratelimit|clerk|lucia|next-auth|better-auth|sentry|semgrep|zod|valibot|jose|bcrypt|argon2)/i,
      imports: /(?:helmet|csrf|rate-limit|ratelimit|jose|bcrypt|argon2|sentry)(\/|$)/i,
      evidence: 'security, validation, and permission conventions',
    },
    webhooks: {
      packages: /stripe|svix|webhooks?[-/]?js|inngest|resend|paypal|paddle/i,
      imports: /(?:webhooks?|events?)(\/|$)/i,
      evidence: 'webhook and event receiver conventions',
    },
    cache: {
      packages: /redis|ioredis|upstash|lru-cache|node-cache|react-cache/i,
      imports: /redis|ioredis|upstash|lru-cache|node-cache/i,
      evidence: 'cache and key-value storage conventions',
    },
    analytics: {
      packages: /posthog|segment|mixpanel|amplitude|plausible|google-analytics|vercel\/analytics/i,
      imports: /posthog|segment|mixpanel|amplitude|plausible|analytics/i,
      evidence: 'product analytics and tracking conventions',
    },
    search: {
      packages: /algoliasearch|elasticsearch|opensearch|meilisearch|typesense|instantsearch/i,
      imports: /algoliasearch|elasticsearch|opensearch|meilisearch|typesense|instantsearch/i,
      evidence: 'search and indexing conventions',
    },
    content: {
      packages: /contentlayer|mdx|remark|rehype|sanity|contentful|strapi|payload/i,
      imports: /contentlayer|remark|rehype|sanity|contentful|strapi|payload/i,
      evidence: 'content and CMS conventions',
    },
    tooling: {
      packages:
        /^(?:typescript|eslint|prettier|biome|dependency-cruiser|madge|knip|semgrep|snyk|npm-check-updates|lefthook|husky)$/i,
      imports:
        /^(?:typescript|eslint|prettier|biome|dependency-cruiser|madge|knip|semgrep|snyk|lefthook|husky)(\/|$)/i,
      evidence: 'static analysis, formatting, dependency graph, and hook tooling',
    },
  },
};
