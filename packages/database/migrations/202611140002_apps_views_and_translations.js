// Keep migration 001 immutable: existing installations may already contain pages.
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE apps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(160) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      name varchar(240) NOT NULL,
      default_locale varchar(63) NOT NULL DEFAULT 'nb',
      settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (default_locale ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$')
    );
    INSERT INTO apps (slug, name) VALUES ('default', 'Default app');

    ALTER TABLE pages RENAME COLUMN slug TO path;
    ALTER TABLE pages DROP CONSTRAINT pages_slug_unique;
    ALTER TABLE pages DROP CONSTRAINT pages_slug_check;
    ALTER TABLE pages ALTER COLUMN path TYPE text;
    UPDATE pages SET path = '/' || path;
    ALTER TABLE pages ADD COLUMN app_id uuid REFERENCES apps(id);
    UPDATE pages SET app_id = (SELECT id FROM apps WHERE slug = 'default');
    ALTER TABLE pages ALTER COLUMN app_id SET NOT NULL;
    ALTER TABLE pages ADD CONSTRAINT pages_app_path_unique UNIQUE (app_id, path);
    ALTER TABLE pages ADD CONSTRAINT pages_app_id_unique UNIQUE (app_id, id);
    ALTER TABLE pages ADD CONSTRAINT pages_path_check
      CHECK (path = '/' OR path ~ '^/[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$');

    CREATE TABLE views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id uuid NOT NULL REFERENCES apps(id),
      name varchar(240) NOT NULL,
      type varchar(80) NOT NULL CHECK (length(type) > 0),
      config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (app_id, id)
    );
    CREATE TABLE page_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id uuid NOT NULL,
      page_id uuid NOT NULL,
      view_id uuid NOT NULL,
      position integer NOT NULL CHECK (position >= 0),
      config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (page_id, position),
      FOREIGN KEY (app_id, page_id) REFERENCES pages(app_id, id) ON DELETE CASCADE,
      FOREIGN KEY (app_id, view_id) REFERENCES views(app_id, id) ON DELETE CASCADE
    );
    CREATE INDEX page_views_view_idx ON page_views(app_id, view_id);

    CREATE TABLE text_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key varchar(160) NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
      name varchar(240) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE app_text_groups (
      app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      group_id uuid NOT NULL REFERENCES text_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (app_id, group_id)
    );
    CREATE INDEX app_text_groups_group_idx ON app_text_groups(group_id);
    CREATE TABLE texts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES text_groups(id) ON DELETE CASCADE,
      key varchar(160) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (group_id, key)
    );
    CREATE TABLE text_translations (
      text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
      locale varchar(63) NOT NULL CHECK (locale ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'),
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (text_id, locale)
    );
    CREATE TABLE app_text_overrides (
      app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
      locale varchar(63) NOT NULL CHECK (locale ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'),
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (app_id, text_id, locale)
    );
    CREATE INDEX app_text_overrides_text_idx ON app_text_overrides(text_id);

    CREATE FUNCTION textanity_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = clock_timestamp();
        RETURN NEW;
      END;
    $$;
  `);
  for (const table of ['apps', 'pages', 'views', 'page_views', 'text_groups', 'texts', 'text_translations', 'app_text_overrides']) {
    await knex.raw(`CREATE TRIGGER touch_updated_at BEFORE UPDATE ON ??
      FOR EACH ROW EXECUTE FUNCTION textanity_touch_updated_at()`, [table]);
  }
}

export async function down(knex) {
  // Refuse a lossy downgrade when the old single-app schema cannot represent data.
  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM apps WHERE slug <> 'default')
        OR EXISTS (SELECT 1 FROM views)
        OR EXISTS (SELECT 1 FROM text_groups)
        OR EXISTS (SELECT 1 FROM pages WHERE path !~ '^/[a-z0-9]+(-[a-z0-9]+)*$')
      THEN RAISE EXCEPTION 'Cannot roll back: multi-app data cannot fit the legacy schema';
      END IF;
    END $$;
    DROP TABLE app_text_overrides, text_translations, texts, app_text_groups, text_groups, page_views, views;
    DROP TRIGGER touch_updated_at ON pages;
    DROP TRIGGER touch_updated_at ON apps;
    DROP FUNCTION textanity_touch_updated_at();
    ALTER TABLE pages DROP CONSTRAINT pages_app_path_unique;
    ALTER TABLE pages DROP CONSTRAINT pages_app_id_unique;
    ALTER TABLE pages DROP CONSTRAINT pages_path_check;
    ALTER TABLE pages DROP COLUMN app_id;
    UPDATE pages SET path = substring(path FROM 2);
    ALTER TABLE pages ALTER COLUMN path TYPE varchar(160);
    ALTER TABLE pages RENAME COLUMN path TO slug;
    ALTER TABLE pages ADD CONSTRAINT pages_slug_unique UNIQUE (slug);
    ALTER TABLE pages ADD CONSTRAINT pages_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
    DROP TABLE apps;
  `);
}
