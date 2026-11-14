import Fastify from 'fastify';

export function createApp({ database, logger = false }) {
  const app = Fastify({ logger });

  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async (_request, reply) => {
    try {
      // Readiness requires both a live database and the migrated CMS schema.
      await database.query('SELECT id FROM pages LIMIT 0');
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
        properties: { slug: { type: 'string', maxLength: 160, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' } },
      },
    },
  }, async (request, reply) => {
    const { rows } = await database.query(
      "SELECT id, slug, title, body, updated_at FROM pages WHERE slug = $1 AND status = 'published'",
      [request.params.slug],
    );
    if (!rows.length) return reply.code(404).send({ error: 'Page not found' });
    return rows[0];
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: 'Invalid request' });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });
  return app;
}
