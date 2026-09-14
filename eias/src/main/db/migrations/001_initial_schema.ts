// @ts-nocheck
// Legacy Knex migration file preserved for historical record
type Knex = any

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('departments', (t) => {
    t.increments('id').primary()
    t.string('code', 20).notNullable().unique()
    t.string('name', 100).notNullable()
    t.boolean('is_active').defaultTo(true)
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary()
    t.string('staff_id', 20).notNullable().unique()
    t.string('name', 100).notNullable()
    t.string('email', 150).nullable()
    t.string('designation', 100).nullable()
    t.string('password_hash', 255).nullable()
    t.enu('role', ['admin', 'staff']).defaultTo('staff')
    t.integer('department_id').unsigned().references('id').inTable('departments').onDelete('SET NULL').nullable()
    t.boolean('is_active').defaultTo(true)
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('halls', (t) => {
    t.increments('id').primary()
    t.string('hall_code', 20).notNullable().unique()
    t.string('name', 100).notNullable()
    t.integer('capacity').defaultTo(0)
    t.string('block', 50).nullable()
    t.integer('sort_order').defaultTo(0)
    t.boolean('is_active').defaultTo(true)
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 100).primary()
    t.text('value').nullable()
  })

  await knex.schema.createTable('exam_cycles', (t) => {
    t.increments('id').primary()
    t.string('name', 200).notNullable()
    t.string('academic_year', 20).notNullable()
    t.enu('status', ['draft', 'active', 'closed']).defaultTo('draft')
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('exam_sessions', (t) => {
    t.increments('id').primary()
    t.integer('cycle_id').unsigned().references('id').inTable('exam_cycles').onDelete('CASCADE').notNullable()
    t.date('exam_date').notNullable()
    t.enu('session_type', ['FN', 'AN']).notNullable()
    t.integer('rotation_step').notNullable()
    t.string('reporting_time', 10).nullable()
    t.string('exam_start', 10).nullable()
    t.string('exam_end', 10).nullable()
    t.enu('status', ['pending', 'draft', 'confirmed', 'published']).defaultTo('pending')
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('allocations', (t) => {
    t.increments('id').primary()
    t.integer('session_id').unsigned().references('id').inTable('exam_sessions').onDelete('CASCADE').notNullable()
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').notNullable()
    t.integer('hall_id').unsigned().references('id').inTable('halls').onDelete('CASCADE').notNullable()
    t.boolean('is_manually_edited').defaultTo(false)
    t.text('edit_reason').nullable()
    t.integer('generated_hall_id').unsigned().references('id').inTable('halls').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
    t.timestamp('updated_at').defaultTo(knex.fn.now())
    t.unique(['session_id', 'user_id'])
    t.unique(['session_id', 'hall_id'])
  })

  await knex.schema.createTable('rotation_history', (t) => {
    t.increments('id').primary()
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').notNullable()
    t.integer('session_id').unsigned().references('id').inTable('exam_sessions').onDelete('CASCADE').notNullable()
    t.integer('hall_id').unsigned().references('id').inTable('halls').onDelete('CASCADE').notNullable()
    t.integer('rotation_step').notNullable()
    t.timestamp('recorded_at').defaultTo(knex.fn.now())
    t.unique(['user_id', 'session_id'])
  })

  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary()
    t.integer('user_id').unsigned().nullable()
    t.string('action', 100).notNullable()
    t.text('description').nullable()
    t.text('payload').nullable()
    t.timestamp('created_at').defaultTo(knex.fn.now())
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log')
  await knex.schema.dropTableIfExists('rotation_history')
  await knex.schema.dropTableIfExists('allocations')
  await knex.schema.dropTableIfExists('exam_sessions')
  await knex.schema.dropTableIfExists('exam_cycles')
  await knex.schema.dropTableIfExists('settings')
  await knex.schema.dropTableIfExists('halls')
  await knex.schema.dropTableIfExists('users')
  await knex.schema.dropTableIfExists('departments')
}
