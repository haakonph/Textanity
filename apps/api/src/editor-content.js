import { createHash, randomUUID } from 'node:crypto';
import { canonicalLocale, createMessageFormatter, localeFallbacks, messageParameters } from './messages.js';

export const statuses = ['approved', 'development', 'subject', 'translation'];
export const draftStatuses = statuses.slice(1);
export class EditorError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function referencedKeys(value, result = new Set()) {
  if (typeof value === 'string' && /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(value)) result.add(value);
  else if (Array.isArray(value)) value.forEach((item) => referencedKeys(item, result));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => referencedKeys(item, result));
  return [...result];
}

async function context(db, appSlug) {
  if (!appSlug) return { id: null, default_locale: 'nb' };
  const {
    rows: [app],
  } = await db.query('SELECT * FROM apps WHERE slug = $1', [appSlug]);
  if (!app) throw new EditorError(404, 'App not found');
  return app;
}

export async function structure(db, appSlug) {
  const app = await context(db, appSlug);
  const { rows: pages } = await db.query(
    `SELECT p.*, count(pv.id)::int AS view_count FROM pages p
    LEFT JOIN page_views pv ON pv.page_id = p.id WHERE p.app_id = $1 GROUP BY p.id ORDER BY p.path`,
    [app.id],
  );
  const { rows: views } = await db.query('SELECT * FROM views WHERE app_id = $1 ORDER BY name, id', [app.id]);
  const { rows: placements } = await db.query(
    'SELECT * FROM page_views WHERE app_id = $1 ORDER BY page_id, position',
    [app.id],
  );
  return {
    app,
    pages,
    views: views.map((view) => ({ ...view, text_keys: referencedKeys(view.config) })),
    placements,
  };
}

function approvedCell(translationRows, overrideRows, textId, locale, app) {
  const candidates = app.id ? localeFallbacks(locale, app.default_locale) : [locale];
  for (const candidate of candidates) {
    const own = overrideRows.find((row) => row.text_id === textId && row.locale === candidate);
    const common = translationRows.find((row) => row.text_id === textId && row.locale === candidate);
    const row = own || common;
    if (row) return { message: row.message, locale: candidate, isOverride: !!own };
  }
  return { message: null, locale: null, isOverride: false };
}

export function approvedHash(cell) {
  return createHash('sha256')
    .update(JSON.stringify([cell.message, cell.locale, cell.isOverride]))
    .digest('hex');
}

async function matrixData(db, app, status, requestedLocales, ids) {
  const { rows: translations } = await db.query(
    'SELECT * FROM text_translations WHERE text_id = ANY($1::uuid[])',
    [ids],
  );
  const { rows: overrides } = app.id
    ? await db.query('SELECT * FROM app_text_overrides WHERE app_id = $1 AND text_id = ANY($2::uuid[])', [
        app.id,
        ids,
      ])
    : { rows: [] };
  const { rows: drafts } = await db.query(
    `SELECT * FROM text_drafts WHERE app_id IS NOT DISTINCT FROM $1::uuid
    AND text_id = ANY($2::uuid[]) AND status = $3`,
    [app.id, ids, status],
  );
  const locales = [
    ...new Set([
      ...requestedLocales,
      app.default_locale,
      ...translations.map((r) => r.locale),
      ...overrides.map((r) => r.locale),
      ...drafts.map((r) => r.locale),
    ]),
  ];
  return {
    locales,
    cells: (id) =>
      Object.fromEntries(
        locales.map((locale) => {
          const approved = approvedCell(translations, overrides, id, locale, app);
          const hash = approvedHash(approved);
          const draft = drafts.find((row) => row.text_id === id && row.locale === locale);
          const changed = draft && draft.message !== approved.message;
          return [
            locale,
            {
              message: changed ? draft.message : approved.message,
              locale: changed ? locale : approved.locale,
              isOverride: changed ? !!app.id : approved.isOverride,
              sourceStatus: changed ? status : 'approved',
              revision: draft?.revision ?? null,
              approvedRevision: hash,
              approvedMessage: approved.message,
              approvedLocale: approved.locale,
              approvedIsOverride: approved.isOverride,
              stale: !!draft && draft.approved_hash !== hash,
            },
          ];
        }),
      ),
  };
}

export async function textMatrix(
  db,
  { app: appSlug, status = 'approved', locales = ['nb', 'nn', 'en-GB'], view, page, placement },
) {
  const app = await context(db, appSlug);
  if ((page || placement) && !view) throw new EditorError(400, 'A placement requires a view');
  let keys;
  if (view) {
    if (!app.id) throw new EditorError(400, 'A view requires an app');
    const {
      rows: [v],
    } = await db.query('SELECT config FROM views WHERE id = $1 AND app_id = $2', [view, app.id]);
    if (!v) throw new EditorError(404, 'View not found');
    keys = referencedKeys(v.config);
    if (page || placement) {
      const { rows: placements } = await db.query(
        `SELECT config FROM page_views WHERE app_id = $1 AND view_id = $2
          AND ($3::uuid IS NULL OR page_id = $3) AND ($4::uuid IS NULL OR id = $4)`,
        [app.id, view, page || null, placement || null],
      );
      if (!placements.length) throw new EditorError(404, 'Placement not found');
      keys = [...new Set([...keys, ...placements.flatMap((p) => referencedKeys(p.config))])];
    }
  }
  const { rows: groups } = await db.query(
    `SELECT g.* FROM text_groups g
    WHERE $1::uuid IS NULL OR EXISTS (SELECT 1 FROM app_text_groups ag WHERE ag.group_id = g.id AND ag.app_id = $1)
    ORDER BY g.key`,
    [app.id],
  );
  let { rows: texts } = await db.query(
    `SELECT t.id, t.key, g.key AS group_key, g.name AS group_name
    FROM texts t JOIN text_groups g ON g.id = t.group_id
    WHERE g.id = ANY($1::uuid[]) ORDER BY g.key, t.key`,
    [groups.map((g) => g.id)],
  );
  if (keys) texts = texts.filter((text) => keys.includes(`${text.group_key}.${text.key}`));
  const data = await matrixData(
    db,
    app,
    status,
    locales.map(canonicalLocale),
    texts.map((text) => text.id),
  );
  return {
    status,
    statuses,
    locales: data.locales,
    groups,
    rows: texts.map((text) => ({
      ...text,
      fullKey: `${text.group_key}.${text.key}`,
      cells: data.cells(text.id),
    })),
  };
}

async function transaction(database, run) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function validateMessage(message, locale, references) {
  try {
    createMessageFormatter(message, locale);
    const parameters = messageParameters(message);
    for (const reference of references) {
      const expected = messageParameters(reference);
      if (JSON.stringify(parameters) !== JSON.stringify(expected)) throw new Error('parameters');
    }
  } catch {
    throw new EditorError(400, 'Invalid ICU message or inconsistent translation parameters');
  }
}

export async function changeTexts(database, payload, approve = false) {
  return transaction(database, async (db) => {
    const app = await context(db, payload.app);
    // A stable lock order makes batches atomic and serializes concurrent approvals across scopes.
    const ids = [...new Set(payload.changes.map((change) => change.textId))].sort();
    const { rows: texts } = await db.query(
      'SELECT * FROM texts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [ids],
    );
    if (texts.length !== ids.length) throw new EditorError(404, 'Text not found');
    if (app.id) {
      const { rows } = await db.query(
        'SELECT group_id FROM app_text_groups WHERE app_id = $1 AND group_id = ANY($2::uuid[]) FOR SHARE',
        [app.id, texts.map((t) => t.group_id)],
      );
      if (texts.some((t) => !rows.some((r) => r.group_id === t.group_id)))
        throw new EditorError(404, 'Text group not linked to app');
    }
    const normalized = payload.changes.map((change) => ({
      ...change,
      locale: canonicalLocale(change.locale),
    }));
    const cellKeys = normalized.map((change) => `${change.textId}/${change.locale}`);
    if (new Set(cellKeys).size !== cellKeys.length) throw new EditorError(400, 'Duplicate cell in batch');
    const data = await matrixData(
      db,
      app,
      payload.status,
      normalized.map((change) => change.locale),
      ids,
    );
    const operations = [];
    for (const change of normalized) {
      const cell = data.cells(change.textId)[change.locale];
      if (cell.revision !== change.revision || cell.approvedRevision !== change.approvedRevision)
        throw new EditorError(409, 'Text changed; reload before saving');
      if (approve && (!cell.revision || cell.stale))
        throw new EditorError(409, 'Approved text changed; review and save the draft again');
      let message = change.message;
      if (approve) {
        const {
          rows: [draft],
        } = await db.query(
          `SELECT message FROM text_drafts WHERE app_id IS NOT DISTINCT FROM $1::uuid
          AND text_id = $2 AND locale = $3 AND status = $4`,
          [app.id, change.textId, change.locale, payload.status],
        );
        message = draft.message;
      }
      if (message !== null) {
        const replacedLocales = normalized
          .filter((item) => item.textId === change.textId)
          .map((item) => item.locale);
        const { rows: references } = await db.query(
          `SELECT message FROM text_translations WHERE text_id = $1
          UNION ALL SELECT message FROM app_text_overrides WHERE text_id = $1 AND app_id = $2
          UNION ALL SELECT message FROM text_drafts WHERE text_id = $1 AND app_id IS NOT DISTINCT FROM $2::uuid
            AND status = $3 AND NOT (locale = ANY($4::text[]))`,
          [change.textId, app.id, payload.status, replacedLocales],
        );
        validateMessage(
          message,
          change.locale,
          references.map((r) => r.message),
        );
        const siblings = operations.filter((op) => op.textId === change.textId && op.message !== null);
        validateMessage(
          message,
          change.locale,
          siblings.map((op) => op.message),
        );
      }
      operations.push({ ...change, message, approvedMessage: cell.approvedMessage });
    }
    for (const op of operations) {
      const reset = !approve && (op.message === null || op.message === op.approvedMessage);
      const revision = randomUUID();
      if (approve) {
        if (app.id)
          await db.query(
            `INSERT INTO app_text_overrides (app_id, text_id, locale, message) VALUES ($1,$2,$3,$4)
          ON CONFLICT (app_id,text_id,locale) DO UPDATE SET message = EXCLUDED.message`,
            [app.id, op.textId, op.locale, op.message],
          );
        else
          await db.query(
            `INSERT INTO text_translations (text_id,locale,message) VALUES ($1,$2,$3)
          ON CONFLICT (text_id,locale) DO UPDATE SET message = EXCLUDED.message`,
            [op.textId, op.locale, op.message],
          );
      }
      if (approve || reset)
        await db.query(
          `DELETE FROM text_drafts WHERE app_id IS NOT DISTINCT FROM $1::uuid
        AND text_id = $2 AND locale = $3 AND status = $4`,
          [app.id, op.textId, op.locale, payload.status],
        );
      else
        await db.query(
          `INSERT INTO text_drafts (app_id,text_id,locale,status,message,revision,approved_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (app_id,text_id,locale,status) DO UPDATE
        SET message = EXCLUDED.message, revision = EXCLUDED.revision, approved_hash = EXCLUDED.approved_hash`,
          [app.id, op.textId, op.locale, payload.status, op.message, revision, op.approvedRevision],
        );
      await db.query(
        `INSERT INTO text_revisions (app_id,text_id,locale,status,action,source_status,message,revision)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          app.id,
          op.textId,
          op.locale,
          approve ? 'approved' : payload.status,
          approve ? 'approve' : reset ? 'reset' : 'save',
          approve ? payload.status : null,
          reset ? null : op.message,
          revision,
        ],
      );
    }
    return { changed: operations.length };
  });
}

export async function history(db, textId, appSlug) {
  const app = await context(db, appSlug);
  const { rows: texts } = await db.query(
    `SELECT t.id FROM texts t WHERE t.id = $1 AND ($2::uuid IS NULL OR EXISTS
    (SELECT 1 FROM app_text_groups ag WHERE ag.group_id = t.group_id AND ag.app_id = $2))`,
    [textId, app.id],
  );
  if (!texts.length) throw new EditorError(404, 'Text not found');
  const { rows } = await db.query(
    `SELECT id::text, locale, status, action, source_status, message, created_at
    FROM text_revisions WHERE text_id = $1 AND app_id IS NOT DISTINCT FROM $2::uuid ORDER BY id DESC LIMIT 100`,
    [textId, app.id],
  );
  return rows;
}
