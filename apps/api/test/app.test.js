import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function setup(t, query = async () => ({ rows: [] })) {
  const app = createApp({ database: { query } });
  t.after(() => app.close());
  return app;
}

test('liveness does not depend on the database', async (t) => {
  const app = setup(t, () => { throw new Error('must not query'); });
  const response = await app.inject('/api/health/live');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('readiness requires a migrated database', async (t) => {
  const app = setup(t, async (sql) => {
    assert.equal(sql, 'SELECT id FROM pages LIMIT 0');
    return { rows: [] };
  });
  assert.equal((await app.inject('/api/health/ready')).statusCode, 200);
});

test('readiness returns 503 without leaking connection details', async (t) => {
  const app = setup(t, () => { throw new Error('postgresql://secret'); });
  const response = await app.inject('/api/health/ready');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'unavailable', database: 'unavailable' });
});

test('published pages use a parameterized query', async (t) => {
  const page = { slug: 'hello', title: 'Hello', body: 'Welcome' };
  const app = setup(t, async (sql, params) => {
    assert.match(sql, /slug = \$1 AND status = 'published'/);
    assert.deepEqual(params, ['hello']);
    return { rows: [page] };
  });
  assert.deepEqual((await app.inject('/api/pages/hello')).json(), page);
});

test('unknown pages return 404', async (t) => {
  assert.equal((await setup(t).inject('/api/pages/missing')).statusCode, 404);
});

test('invalid slugs are rejected before querying', async (t) => {
  const app = setup(t, () => { throw new Error('must not query'); });
  assert.equal((await app.inject('/api/pages/invalid_slug')).statusCode, 400);
});

test('database failures do not expose private errors', async (t) => {
  const app = setup(t, () => { throw new Error('private database detail'); });
  const response = await app.inject('/api/pages/hello');
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal server error' });
});
