"use strict";
const { assertSafeConnectionString, allowedHostsFromEnv } = require("../ssrf-guard");

async function inspectMySQL(uri) {
  await assertSafeConnectionString(uri, allowedHostsFromEnv());
  const mysql = require("mysql2/promise");
  const parsed = new URL(uri);
  if (parsed.protocol !== "mysql:") throw new Error("Expected a mysql:// connection URL");
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database) throw new Error("Include the database name in your MySQL URL");
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const conn = await mysql.createConnection({
    host: parsed.hostname, port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database,
    connectTimeout: 15000, multipleStatements: false,
    ssl: local ? undefined : { rejectUnauthorized: true },
  });
  const query = async (sql, values = [database]) => (await conn.query({ sql, values, timeout: 15000 }))[0];
  try {
    const columns = await query(`SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
      IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    const relations = await query(`SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
      REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const unique = await query(`SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX`);
    const tables = new Map();
    const enums = [];
    for (const col of columns) {
      if (!tables.has(col.TABLE_NAME)) tables.set(col.TABLE_NAME, { schema: database, name: col.TABLE_NAME, columns: [], primary_keys: [], foreign_keys: [], unique_constraints: [], indexes: [], check_constraints: [] });
      const table = tables.get(col.TABLE_NAME);
      table.columns.push({ name: col.COLUMN_NAME, position: col.ORDINAL_POSITION, type: col.DATA_TYPE, udt: col.COLUMN_TYPE,
        nullable: col.IS_NULLABLE === "YES", default: col.COLUMN_DEFAULT, auto_increment: /auto_increment/.test(col.EXTRA || "") });
      if (col.COLUMN_KEY === "PRI") table.primary_keys.push(col.COLUMN_NAME);
      if (col.DATA_TYPE === "enum" || col.DATA_TYPE === "set") enums.push({ schema: database, name: `${col.TABLE_NAME}.${col.COLUMN_NAME}`, definition: col.COLUMN_TYPE });
    }
    for (const fk of relations) tables.get(fk.TABLE_NAME)?.foreign_keys.push({ constraint: fk.CONSTRAINT_NAME, column: fk.COLUMN_NAME,
      references: { schema: fk.REFERENCED_TABLE_SCHEMA, table: fk.REFERENCED_TABLE_NAME, column: fk.REFERENCED_COLUMN_NAME } });
    const groups = new Map();
    for (const row of unique) {
      const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
      if (!groups.has(key)) groups.set(key, { table: row.TABLE_NAME, name: row.INDEX_NAME, columns: [] });
      groups.get(key).columns.push(row.COLUMN_NAME);
    }
    for (const group of groups.values()) tables.get(group.table)?.unique_constraints.push({ name: group.name, columns: group.columns });
    return { dialect: "mysql", metadata: { database_name: database, schemas: [database], total_tables: tables.size, total_enums: enums.length },
      tables: [...tables.values()], enums, views: [], functions: [], relationship_graph: relations.map((fk) => ({
        from: `${database}.${fk.TABLE_NAME}`, from_column: fk.COLUMN_NAME,
        to: `${fk.REFERENCED_TABLE_SCHEMA}.${fk.REFERENCED_TABLE_NAME}`, to_column: fk.REFERENCED_COLUMN_NAME,
      })), storage_columns: [] };
  } finally { await conn.end(); }
}
module.exports = { inspectMySQL };
