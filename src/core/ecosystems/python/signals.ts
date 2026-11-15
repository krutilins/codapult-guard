import type { EcosystemSignals } from '../types.js';
const signal = (
  packages: RegExp,
  imports: RegExp,
  evidence: string,
): { packages: RegExp; imports: RegExp; evidence: string } => ({
  packages,
  imports,
  evidence,
});
export const pythonSignals: EcosystemSignals = {
  frameworks: [
    ['django', 'Django'],
    ['fastapi', 'FastAPI'],
    ['flask', 'Flask'],
    ['starlette', 'Starlette'],
    ['celery', 'Celery'],
    ['sqlalchemy', 'SQLAlchemy'],
  ].map(([dependency, name]) => ({ dependency: dependency, name: name })),
  capabilities: {
    routing: signal(
      /^(django|fastapi|flask|starlette)$/,
      /^(django\.urls|fastapi|flask|starlette\.routing)(\.|$)/,
      'Python routing integrations',
    ),
    runtime: signal(
      /^(django|fastapi|flask|starlette|celery)$/,
      /^(django|fastapi|flask|starlette|celery)(\.|$)/,
      'Python runtime imports',
    ),
    persistence: signal(
      /^(sqlalchemy|sqlmodel|psycopg|psycopg2|psycopg2-binary|asyncpg|alembic|peewee|pymongo|django)$/,
      /^(sqlalchemy|sqlmodel|django\.db|psycopg|psycopg2|asyncpg|alembic|peewee|pymongo)(\.|$)/,
      'Python database and ORM integrations',
    ),
    identity: signal(
      /^(authlib|flask-login|fastapi-users|pyjwt|django-allauth)$/,
      /^(authlib|django\.contrib\.auth|flask_login|fastapi_users|jwt)(\.|$)/,
      'Python authentication integrations',
    ),
    payments: signal(
      /^(stripe|paddle-python|braintree)$/,
      /^(stripe|paddle|braintree)(\.|$)/,
      'Python payment providers',
    ),
    email: signal(
      /^(django-anymail|sendgrid|postmarker|mailgun)$/,
      /^(anymail|sendgrid|postmarker|mailgun)(\.|$)/,
      'Python email providers',
    ),
    ai: signal(
      /^(openai|anthropic|langchain|langchain-core|transformers)$/,
      /^(openai|anthropic|langchain|langchain_core|transformers)(\.|$)/,
      'Python model integrations',
    ),
    jobs: signal(
      /^(celery|rq|dramatiq|huey|temporalio)$/,
      /^(celery|rq|dramatiq|huey|temporalio)(\.|$)/,
      'Python background jobs',
    ),
    env: signal(
      /^(python-dotenv|pydantic-settings|django-environ)$/,
      /^(dotenv|pydantic_settings|environ)(\.|$)/,
      'Python configuration libraries',
    ),
    deployment: signal(
      /^(boto3|pulumi|kubernetes|docker)$/,
      /^(boto3|pulumi|kubernetes|docker)(\.|$)/,
      'Python infrastructure integrations',
    ),
    testing: signal(
      /^(pytest|hypothesis|coverage|tox)$/,
      /^(pytest|hypothesis|unittest|coverage)(\.|$)/,
      'Python test tools',
    ),
    observability: signal(
      /^(sentry-sdk|opentelemetry-api|opentelemetry-sdk|structlog|loguru)$/,
      /^(sentry_sdk|opentelemetry|structlog|loguru)(\.|$)/,
      'Python logging and tracing',
    ),
  },
};
