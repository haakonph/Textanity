export async function up(knex) {
  await knex.schema.createTable('pages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('slug', 160).notNullable().unique();
    table.string('title', 240).notNullable();
    table.text('body').notNullable().defaultTo('');
    table.string('status', 16).notNullable().defaultTo('draft');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("status IN ('draft', 'published')");
    table.check("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'");
  });
}

export async function down(knex) {
  await knex.schema.dropTable('pages');
}
