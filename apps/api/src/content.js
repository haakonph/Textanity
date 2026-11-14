import { localeFallbacks } from './messages.js';

export const readinessQuery = `SELECT p.app_id, p.path, a.default_locale, v.config,
  pv.position, g.key, ag.group_id, t.key, tr.locale, o.message, ta.source_text_id
  FROM pages p
  JOIN apps a ON a.id = p.app_id
  LEFT JOIN views v ON v.app_id = a.id
  LEFT JOIN page_views pv ON pv.page_id = p.id
  LEFT JOIN app_text_groups ag ON ag.app_id = a.id
  LEFT JOIN text_groups g ON g.id = ag.group_id
  LEFT JOIN texts t ON t.group_id = g.id
  LEFT JOIN text_translations tr ON tr.text_id = t.id
  LEFT JOIN app_text_overrides o ON o.app_id = a.id AND o.text_id = t.id
  LEFT JOIN text_aliases ta ON ta.app_id = a.id AND ta.text_id = t.id
  LIMIT 0`;

export async function getPage(database, appSlug, path) {
  const { rows: [page] } = await database.query(`
    SELECT p.id, p.app_id, p.path, p.title, p.body, p.updated_at
    FROM pages p JOIN apps a ON a.id = p.app_id
    WHERE a.slug = $1 AND p.path = $2 AND p.status = 'published'`, [appSlug, path]);
  if (!page) return null;
  const { rows: views } = await database.query(`
    SELECT pv.id, pv.view_id, pv.position, v.name, v.type,
      v.config AS view_config, pv.config AS page_config
    FROM page_views pv JOIN views v ON v.id = pv.view_id AND v.app_id = pv.app_id
    WHERE pv.app_id = $1 AND pv.page_id = $2
    ORDER BY pv.position`, [page.app_id, page.id]);
  return { ...page, views };
}

export async function getTextGroup(database, appSlug, groupKey, requestedLocale) {
  const { rows: [context] } = await database.query(`
    SELECT a.id AS app_id, a.default_locale, g.id AS group_id
    FROM apps a
    JOIN app_text_groups ag ON ag.app_id = a.id
    JOIN text_groups g ON g.id = ag.group_id
    WHERE a.slug = $1 AND g.key = $2`, [appSlug, groupKey]);
  if (!context) return null;
  const locales = localeFallbacks(requestedLocale, context.default_locale);
  // Locale priority comes first. Within a locale, the app override wins.
  // NULL denotes a missing translation; an intentionally empty string is valid.
  const { rows } = await database.query(`
    SELECT t.key, resolved.locale, resolved.message, resolved.is_override,
      source_app.slug AS source_app, source_group.key AS source_group, source_text.key AS source_key
    FROM texts t
    LEFT JOIN LATERAL (
      SELECT candidate.locale,
        COALESCE(o.message, tr.message) AS message,
        o.text_id IS NOT NULL AS is_override
      FROM unnest($3::text[]) WITH ORDINALITY AS candidate(locale, priority)
      LEFT JOIN text_translations tr ON tr.text_id = t.id AND tr.locale = candidate.locale
      LEFT JOIN app_text_overrides o ON o.text_id = t.id AND o.app_id = $1 AND o.locale = candidate.locale
      WHERE o.text_id IS NOT NULL OR tr.text_id IS NOT NULL
      ORDER BY candidate.priority
      LIMIT 1
    ) resolved ON true
    LEFT JOIN text_aliases alias ON alias.app_id = $1 AND alias.text_id = t.id
    LEFT JOIN apps source_app ON source_app.id = alias.source_app_id
    LEFT JOIN texts source_text ON source_text.id = alias.source_text_id
    LEFT JOIN text_groups source_group ON source_group.id = source_text.group_id
    WHERE t.group_id = $2 ORDER BY t.key`, [context.app_id, context.group_id, locales]);
  return {
    app: appSlug,
    group: groupKey,
    locales,
    texts: Object.fromEntries(rows.map(({ key, locale, message, is_override, source_app, source_group, source_key }) => [key, {
      locale: locale ?? null,
      message: message ?? null,
      isOverride: is_override ?? false,
      ...(source_app ? { alias: { app: source_app, group: source_group, key: source_key } } : {}),
    }])),
  };
}
