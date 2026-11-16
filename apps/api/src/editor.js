import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalLocale } from './messages.js';
import { changeTexts, draftStatuses, EditorError, history, structure, textMatrix } from './editor-content.js';

const slug = { type: 'string', maxLength: 160, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' };
const key = { type: 'string', maxLength: 160, pattern: '^[a-z][a-z0-9_]*$' };
const uuid = { type: 'string', format: 'uuid' };
const name = { type: 'string', minLength: 1, maxLength: 240, pattern: '\\S' };
const locale = { type: 'string', minLength: 2, maxLength: 63 };
const path = {
  type: 'string',
  maxLength: 2048,
  pattern: '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$',
};
const object = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const appParams = object({ app: slug }, ['app']);
const itemParams = object({ app: slug, id: uuid }, ['app', 'id']);
const textCell = {
  textId: uuid,
  locale,
  revision: { anyOf: [uuid, { type: 'null' }] },
  approvedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
};

function normalizeLocale(value) {
  try {
    return canonicalLocale(value);
  } catch {
    throw new EditorError(400, 'Invalid locale');
  }
}
function found(row) {
  if (!row) throw new EditorError(404, 'Item not found');
  return row;
}

export async function editorRoutes(app, { database, editorToken }) {
  const secret = editorToken && createHash('sha256').update(editorToken).digest();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!secret) return reply.code(503).send({ error: 'Editor access is not configured' });
    const supplied = request.headers.authorization;
    if (
      typeof supplied !== 'string' ||
      !supplied.startsWith('Bearer ') ||
      !timingSafeEqual(secret, createHash('sha256').update(supplied.slice(7)).digest())
    ) {
      return reply.code(401).send({ error: 'Editor access required' });
    }
  });

  app.get('/catalog', async () => {
    const { rows: apps } = await database.query(
      'SELECT id,slug,name,default_locale FROM apps ORDER BY name,id',
    );
    const { rows: groups } = await database.query('SELECT id,key,name FROM text_groups ORDER BY key');
    return { apps, groups };
  });
  app.get('/apps/:app', { schema: { params: appParams } }, (request) =>
    structure(database, request.params.app),
  );

  app.get(
    '/texts',
    {
      schema: {
        querystring: object({
          app: slug,
          status: { enum: ['approved', ...draftStatuses] },
          view: uuid,
          page: uuid,
          placement: uuid,
          locales: { type: 'string', maxLength: 640 },
        }),
      },
    },
    async (request) => {
      const locales = request.query.locales?.split(',').map(normalizeLocale);
      if (locales?.length > 10) throw new EditorError(400, 'At most ten requested languages');
      return textMatrix(database, { ...request.query, ...(locales ? { locales } : {}) });
    },
  );
  for (const [route, approve] of [
    ['/texts/batch', false],
    ['/texts/approve', true],
  ]) {
    const changes = object(
      {
        ...textCell,
        ...(!approve ? { message: { anyOf: [{ type: 'string', maxLength: 20000 }, { type: 'null' }] } } : {}),
      },
      ['textId', 'locale', 'revision', 'approvedRevision', ...(!approve ? ['message'] : [])],
    );
    app.post(
      route,
      {
        schema: {
          body: object(
            {
              app: { anyOf: [slug, { type: 'null' }] },
              status: { enum: draftStatuses },
              changes: { type: 'array', minItems: 1, maxItems: 1000, items: changes },
            },
            ['app', 'status', 'changes'],
          ),
        },
      },
      (request) => {
        request.body.changes.forEach((change) => {
          change.locale = normalizeLocale(change.locale);
        });
        return changeTexts(database, request.body, approve);
      },
    );
  }
  app.get(
    '/texts/:id/history',
    { schema: { params: object({ id: uuid }, ['id']), querystring: object({ app: slug }) } },
    (request) => history(database, request.params.id, request.query.app),
  );

  app.post(
    '/apps',
    { schema: { body: object({ slug, name, defaultLocale: locale }, ['slug', 'name', 'defaultLocale']) } },
    async (request, reply) => {
      const { slug, name, defaultLocale } = request.body;
      const {
        rows: [app],
      } = await database.query('INSERT INTO apps (slug,name,default_locale) VALUES ($1,$2,$3) RETURNING *', [
        slug,
        name.trim(),
        normalizeLocale(defaultLocale),
      ]);
      return reply.code(201).send(app);
    },
  );
  app.post(
    '/groups',
    { schema: { body: object({ key, name }, ['key', 'name']) } },
    async (request, reply) => {
      const {
        rows: [group],
      } = await database.query('INSERT INTO text_groups (key,name) VALUES ($1,$2) RETURNING *', [
        request.body.key,
        request.body.name.trim(),
      ]);
      return reply.code(201).send(group);
    },
  );
  app.post(
    '/keys',
    { schema: { body: object({ group: key, key }, ['group', 'key']) } },
    async (request, reply) => {
      const {
        rows: [text],
      } = await database.query(
        `INSERT INTO texts (group_id,key) SELECT id,$2 FROM text_groups WHERE key=$1 RETURNING *`,
        [request.body.group, request.body.key],
      );
      return reply.code(201).send(found(text));
    },
  );
  app.post(
    '/apps/:app/groups',
    { schema: { params: appParams, body: object({ groupId: uuid }, ['groupId']) } },
    async (request) => {
      const {
        rows: [context],
      } = await database.query(
        'SELECT a.id AS app_id,g.id AS group_id FROM apps a CROSS JOIN text_groups g WHERE a.slug=$1 AND g.id=$2',
        [request.params.app, request.body.groupId],
      );
      found(context);
      await database.query(
        'INSERT INTO app_text_groups (app_id,group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [context.app_id, context.group_id],
      );
      return { linked: true };
    },
  );
  const pageBody = object({ title: name, path, status: { enum: ['draft', 'published'] } }, [
    'title',
    'path',
    'status',
  ]);
  app.post('/apps/:app/pages', { schema: { params: appParams, body: pageBody } }, async (request, reply) => {
    const { title, path, status } = request.body;
    const {
      rows: [page],
    } = await database.query(
      'INSERT INTO pages (app_id,title,path,status) SELECT id,$2,$3,$4 FROM apps WHERE slug=$1 RETURNING *',
      [request.params.app, title.trim(), path, status],
    );
    return reply.code(201).send(found(page));
  });
  app.put('/apps/:app/pages/:id', { schema: { params: itemParams, body: pageBody } }, async (request) => {
    const { title, path, status } = request.body;
    const {
      rows: [page],
    } = await database.query(
      `UPDATE pages p SET title=$3,path=$4,status=$5 FROM apps a
      WHERE p.app_id=a.id AND a.slug=$1 AND p.id=$2 RETURNING p.*`,
      [request.params.app, request.params.id, title.trim(), path, status],
    );
    return found(page);
  });
  app.post(
    '/apps/:app/views',
    {
      schema: {
        params: appParams,
        body: object(
          { name, type: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z][a-z0-9_-]*$' } },
          ['name', 'type'],
        ),
      },
    },
    async (request, reply) => {
      const {
        rows: [view],
      } = await database.query(
        'INSERT INTO views (app_id,name,type) SELECT id,$2,$3 FROM apps WHERE slug=$1 RETURNING *',
        [request.params.app, request.body.name.trim(), request.body.type],
      );
      return reply.code(201).send(found(view));
    },
  );
  app.post(
    '/apps/:app/pages/:id/views',
    { schema: { params: itemParams, body: object({ viewId: uuid }, ['viewId']) } },
    async (request, reply) => {
      const {
        rows: [placement],
      } = await database.query(
        `INSERT INTO page_views (app_id,page_id,view_id,position)
      SELECT a.id,p.id,v.id,(SELECT COALESCE(max(position)+1,0) FROM page_views WHERE page_id=p.id)
      FROM apps a JOIN pages p ON p.app_id=a.id JOIN views v ON v.app_id=a.id
      WHERE a.slug=$1 AND p.id=$2 AND v.id=$3 RETURNING *`,
        [request.params.app, request.params.id, request.body.viewId],
      );
      return reply.code(201).send(found(placement));
    },
  );
  app.put(
    '/apps/:app/views/:id/texts',
    {
      schema: {
        params: itemParams,
        body: object({ textIds: { type: 'array', maxItems: 100, uniqueItems: true, items: uuid } }, [
          'textIds',
        ]),
      },
    },
    async (request) => {
      const { rows: keys } = await database.query(
        `SELECT t.id,g.key || '.' || t.key AS key FROM texts t
      JOIN text_groups g ON g.id=t.group_id JOIN app_text_groups ag ON ag.group_id=g.id
      JOIN apps a ON a.id=ag.app_id WHERE a.slug=$1 AND t.id=ANY($2::uuid[])`,
        [request.params.app, request.body.textIds],
      );
      if (keys.length !== request.body.textIds.length)
        throw new EditorError(404, 'Text group not linked to app');
      const {
        rows: [view],
      } = await database.query(
        `UPDATE views v SET config=jsonb_set(v.config,'{textKeys}',to_jsonb($3::text[]))
      FROM apps a WHERE v.app_id=a.id AND a.slug=$1 AND v.id=$2 RETURNING v.*`,
        [request.params.app, request.params.id, keys.map((key) => key.key)],
      );
      return found(view);
    },
  );
}
