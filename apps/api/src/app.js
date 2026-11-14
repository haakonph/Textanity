import Fastify from 'fastify';
import { getPage, getTextGroup, readinessQuery } from './content.js';
import { canonicalLocale, createMessageFormatter } from './messages.js';

const slug = { type: 'string', maxLength: 160, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' };
const textKey = { type: 'string', maxLength: 160, pattern: '^[a-z][a-z0-9_]*$' };
const localeQuery = {
  type: 'object', additionalProperties: false,
  properties: { locale: { type: 'string', minLength: 2, maxLength: 63 } },
};

function requestedLocale(request, reply) {
  if (!request.query.locale) return undefined;
  try {
    return canonicalLocale(request.query.locale);
  } catch {
    reply.code(400).send({ error: 'Invalid locale' });
    return undefined;
  }
}

export function createApp({ database, logger = false }) {
  const app = Fastify({ logger, ajv: { customOptions: { coerceTypes: false } } });

  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async (_request, reply) => {
    try {
      // Readiness requires both a live database and the migrated CMS schema.
      await database.query(readinessQuery);
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'Database readiness check failed');
      return reply.code(503).send({ status: 'unavailable', database: 'unavailable' });
    }
  });

  app.get('/api/pages/:slug', {
    schema: {
      params: {
        type: 'object', required: ['slug'],
        properties: { slug },
      },
    },
  }, async (request, reply) => {
    const { rows } = await database.query(
      `SELECT p.id, substring(p.path FROM 2) AS slug, p.title, p.body, p.updated_at
       FROM pages p JOIN apps a ON a.id = p.app_id
       WHERE a.slug = 'default' AND p.path = '/' || $1 AND p.status = 'published'`,
      [request.params.slug],
    );
    if (!rows.length) return reply.code(404).send({ error: 'Page not found' });
    return rows[0];
  });

  app.get('/api/apps/:app/pages', {
    schema: {
      params: { type: 'object', required: ['app'], properties: { app: slug } },
      querystring: {
        type: 'object', required: ['path'], additionalProperties: false,
        properties: { path: { type: 'string', maxLength: 2048, pattern: '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$' } },
      },
    },
  }, async (request, reply) => {
    const page = await getPage(database, request.params.app, request.query.path);
    if (!page) return reply.code(404).send({ error: 'Page not found' });
    return page;
  });

  app.get('/api/apps/:app/texts/:group', {
    schema: {
      params: { type: 'object', required: ['app', 'group'], properties: { app: slug, group: textKey } },
      querystring: localeQuery,
    },
  }, async (request, reply) => {
    const locale = requestedLocale(request, reply);
    if (reply.sent) return;
    const group = await getTextGroup(database, request.params.app, request.params.group, locale);
    if (!group) return reply.code(404).send({ error: 'Text group not found' });
    return group;
  });

  // Read-only formatting operation. It never changes stored content.
  app.post('/api/apps/:app/texts/:group/:key/format', {
    schema: {
      params: { type: 'object', required: ['app', 'group', 'key'], properties: { app: slug, group: textKey, key: textKey } },
      querystring: localeQuery,
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          variables: { type: 'object', maxProperties: 50, additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
        },
      },
    },
  }, async (request, reply) => {
    const locale = requestedLocale(request, reply);
    if (reply.sent) return;
    const group = await getTextGroup(database, request.params.app, request.params.group, locale);
    const text = group && Object.hasOwn(group.texts, request.params.key) ? group.texts[request.params.key] : null;
    if (!text || text.message === null) return reply.code(404).send({ error: 'Translation not found' });
    // A malformed stored message is a server error; missing/invalid variables are a client error.
    const formatter = createMessageFormatter(text.message, text.locale);
    try {
      return { locale: text.locale, message: formatter.format(request.body?.variables || {}), isOverride: text.isOverride };
    } catch {
      return reply.code(400).send({ error: 'Invalid message variables' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'Invalid request' });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });
  return app;
}
