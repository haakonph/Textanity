import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { referencedKeys } from '../src/editor-content.js';
import { messageParameters } from '../src/messages.js';

const token = 'editor-test-token-with-at-least-32-characters';
test('editor is disabled unless a strong key is configured', async (t) => {
  const app = createApp({
    database: {
      query: () => {
        throw new Error('must not query');
      },
    },
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/editor/catalog')).statusCode, 503);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/editor/texts/approve', payload: {} })).statusCode,
    503,
  );
  assert.throws(() => createApp({ database: {}, editorToken: 'short' }), /at least 32/);
});

test('draft reads, history and writes require editor access before querying', async (t) => {
  const app = createApp({
    database: {
      query: () => {
        throw new Error('must not query');
      },
    },
    editorToken: token,
  });
  t.after(() => app.close());
  for (const authorization of [undefined, 'Bearer wrong', `Basic ${token}`]) {
    for (const [method, url] of [
      ['GET', '/api/editor/texts?status=development'],
      ['GET', '/api/editor/texts/00000000-0000-4000-8000-000000000001/history'],
      ['POST', '/api/editor/texts/batch'],
      ['POST', '/api/editor/texts/approve'],
    ]) {
      const response = await app.inject({
        method,
        url,
        headers: authorization ? { authorization } : {},
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.doesNotMatch(response.body, /wrong|editor-test-token/);
    }
  }
});

test('authenticated requests validate statuses and prevent direct approved writes', async (t) => {
  const app = createApp({
    database: {
      query: () => {
        throw new Error('must not query');
      },
    },
    editorToken: token,
  });
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ url: '/api/editor/texts?status=unknown', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/editor/texts?locales=en_US', headers })).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/editor/texts/batch',
        headers,
        payload: { app: null, status: 'approved', changes: [] },
      })
    ).statusCode,
    400,
  );
});

test('view text keys include nested references but ignore ordinary text', () => {
  assert.deepEqual(
    referencedKeys({
      title: 'home.title',
      nested: ['checkout.submit', { message: 'home.title' }],
      other: 'Ordinary text',
    }),
    ['home.title', 'checkout.submit'],
  );
});
test('ICU parameter contracts include nested branches', () => {
  assert.deepEqual(messageParameters('{count, plural, one {Hello {name}} other {# messages for {name}}}'), [
    'count',
    'name',
  ]);
});
