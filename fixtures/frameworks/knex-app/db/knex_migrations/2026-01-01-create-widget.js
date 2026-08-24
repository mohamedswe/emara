exports.up = function up(knex) {
  return knex.schema.createTable("widget", (table) => table.increments("id"));
};

exports.down = function down(knex) {
  return knex.schema.dropTable("widget");
};
