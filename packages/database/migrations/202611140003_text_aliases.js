export async function up(knex) {
  await knex.raw(`
    CREATE TABLE text_aliases (
      app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      text_id uuid NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
      source_app_id uuid NOT NULL REFERENCES apps(id),
      source_text_id uuid NOT NULL REFERENCES texts(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (app_id, text_id),
      CHECK (app_id <> source_app_id OR text_id <> source_text_id)
    );
    CREATE INDEX text_aliases_source_idx ON text_aliases(source_app_id, source_text_id);
    CREATE TRIGGER touch_updated_at BEFORE UPDATE ON text_aliases
      FOR EACH ROW EXECUTE FUNCTION textanity_touch_updated_at();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM text_aliases)
      THEN RAISE EXCEPTION 'Cannot roll back: text aliases would be lost';
      END IF;
    END $$;
    DROP TABLE text_aliases;
  `);
}
