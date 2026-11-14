import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { readinessQuery } from '../src/content.js';

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
    assert.equal(sql, readinessQuery);
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
    assert.match(sql, /a.slug = 'default'/);
    assert.match(sql, /p.path = '\/' \|\| \$1 AND p.status = 'published'/);
    assert.deepEqual(params, ['hello']);
    return { rows: [page] };
  });
  assert.deepEqual((await app.inject('/api/pages/hello')).json(), page);
});

test('app page lookups are scoped by app and include ordered views', async (t) => {
  let calls = 0;
  const page = { id: 'page-id', app_id: 'app-id', path: '/', title: 'Home' };
  const view = { id: 'placement-id', position: 0, type: 'hero' };
  const app = setup(t, async (sql, params) => {
    calls++;
    if (calls === 1) {
      assert.match(sql, /a.slug = \$1 AND p.path = \$2/);
      assert.deepEqual(params, ['shop', '/']);
      return { rows: [page] };
    }
    assert.match(sql, /ORDER BY pv.position/);
    assert.deepEqual(params, ['app-id', 'page-id']);
    return { rows: [view] };
  });
  const response = await app.inject('/api/apps/shop/pages?path=/');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ...page, views: [view] });
});

test('invalid paths and locale tags return 400 before querying', async (t) => {
  const app = setup(t, () => { throw new Error('must not query'); });
  for (const url of ['/api/apps/shop/pages?path=relative', '/api/apps/shop/pages?path=//double', '/api/apps/shop/texts/checkout?locale=en_US']) {
    assert.equal((await app.inject(url)).statusCode, 400, url);
  }
});

test('missing app, group, and format key return 404', async (t) => {
  const app = setup(t);
  assert.equal((await app.inject('/api/apps/missing/pages?path=/')).statusCode, 404);
  assert.equal((await app.inject('/api/apps/missing/texts/checkout')).statusCode, 404);
  const response = await app.inject({ method: 'POST', url: '/api/apps/missing/texts/checkout/submit/format', payload: {} });
  assert.equal(response.statusCode, 404);
});

test('locale fallback candidates reach the parameterized text query', async (t) => {
  let calls = 0;
  const app = setup(t, async (_sql, params) => {
    if (++calls === 1) {
      assert.deepEqual(params, ['shop', 'checkout']);
      return { rows: [{ app_id: 'app-id', group_id: 'group-id', default_locale: 'nb' }] };
    }
    assert.deepEqual(params, ['app-id', 'group-id', ['en-GB', 'en', 'nb']]);
    return { rows: [{ key: 'submit', locale: 'en', message: 'Pay now', is_override: false }] };
  });
  const response = await app.inject('/api/apps/shop/texts/checkout?locale=EN-gb');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().texts.submit, { locale: 'en', message: 'Pay now', isOverride: false });
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
