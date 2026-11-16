export async function up(knex) {
  await knex.raw(`
    CREATE TABLE text_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id uuid REFERENCES apps(id) ON DELETE CASCADE,
      text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
      locale varchar(63) NOT NULL CHECK (locale ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'),
      status text NOT NULL CHECK (status IN ('development', 'subject', 'translation')),
      message text NOT NULL,
      revision uuid NOT NULL DEFAULT gen_random_uuid(),
      approved_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE NULLS NOT DISTINCT (app_id, text_id, locale, status)
    );
    CREATE TRIGGER touch_updated_at BEFORE UPDATE ON text_drafts
      FOR EACH ROW EXECUTE FUNCTION textanity_touch_updated_at();
    CREATE TABLE text_revisions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      app_id uuid REFERENCES apps(id) ON DELETE CASCADE,
      text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
      locale varchar(63) NOT NULL,
      status text NOT NULL CHECK (status IN ('approved', 'development', 'subject', 'translation')),
      action text NOT NULL CHECK (action IN ('baseline', 'save', 'reset', 'approve')),
      source_status text CHECK (source_status IN ('development', 'subject', 'translation')),
      message text,
      revision uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX text_revisions_lookup ON text_revisions(text_id, app_id, id DESC);
    INSERT INTO text_revisions (text_id, locale, status, action, message, created_at)
      SELECT text_id, locale, 'approved', 'baseline', message, updated_at FROM text_translations;
    INSERT INTO text_revisions (app_id, text_id, locale, status, action, message, created_at)
      SELECT app_id, text_id, locale, 'approved', 'baseline', message, updated_at FROM app_text_overrides;
  `);
}

export async function down(knex) {
  await knex.raw(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM text_drafts)
      OR EXISTS (SELECT 1 FROM text_revisions WHERE action <> 'baseline')
    THEN RAISE EXCEPTION 'Cannot roll back: text drafts or revision history would be lost';
    END IF;
    END $$;
    DROP TABLE text_drafts, text_revisions;
  `);
}
