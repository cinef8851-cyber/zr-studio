const IDENTIFIER = /^[a-z][a-z0-9_]{0,39}$/;
const SQL_TYPES = Object.freeze({ text: 'text', integer: 'integer', number: 'double precision', boolean: 'boolean', date: 'date', timestamp: 'timestamptz', uuid: 'uuid' });
const RESERVED = new Set(['id', 'owner_id', 'created_at', 'updated_at', 'app_id', 'schema_name']);

export function validateDatabaseSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.tables) || input.tables.length < 1 || input.tables.length > 6) return null;
  const seenTables = new Set();
  const tables = [];
  for (const item of input.tables) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') return null;
    const name = item.name.trim().toLowerCase();
    if (!IDENTIFIER.test(name) || seenTables.has(name) || RESERVED.has(name)) return null;
    seenTables.add(name);
    if (!Array.isArray(item.columns) || item.columns.length < 1 || item.columns.length > 12) return null;
    const seenColumns = new Set(['id', 'owner_id', 'created_at']);
    const columns = [];
    for (const column of item.columns) {
      if (!column || typeof column !== 'object' || typeof column.name !== 'string' || typeof column.type !== 'string') return null;
      const columnName = column.name.trim().toLowerCase();
      if (!IDENTIFIER.test(columnName) || seenColumns.has(columnName) || RESERVED.has(columnName) || !Object.hasOwn(SQL_TYPES, column.type)) return null;
      if (column.required !== undefined && typeof column.required !== 'boolean') return null;
      seenColumns.add(columnName);
      columns.push({ name: columnName, type: column.type, required: column.required === true });
    }
    tables.push({ name, columns });
  }
  return { tables };
}

export async function provisionProjectSchema(sql, { projectId, projectName, spec }) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(projectId)) throw new TypeError('Invalid project id');
  const safeSpec = validateDatabaseSpec(spec);
  if (!safeSpec) throw new TypeError('Invalid database specification');
  const crypto = await import('node:crypto');
  const schema = `app_${crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 24)}`;
  const q = value => `"${value.replaceAll('"', '""')}"`;

  // All identifiers/types are normalized by allow-lists above. Values remain parameterized.
  const statements = [`CREATE SCHEMA IF NOT EXISTS ${q(schema)}`];
  const tableStatements = [];
  for (const table of safeSpec.tables) {
    const columns = table.columns.map(c => `${q(c.name)} ${SQL_TYPES[c.type]}${c.required ? ' NOT NULL' : ''}`).join(', ');
    tableStatements.push(`CREATE TABLE IF NOT EXISTS ${q(schema)}.${q(table.name)} ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), ${columns})`);
    const policy = q(`${table.name}_owner_only`);
    const tablePath = `${q(schema)}.${q(table.name)}`;
    tableStatements.push(`ALTER TABLE ${tablePath} ENABLE ROW LEVEL SECURITY`);
    tableStatements.push(`ALTER TABLE ${tablePath} FORCE ROW LEVEL SECURITY`);
    tableStatements.push(`DROP POLICY IF EXISTS ${policy} ON ${tablePath}`);
    tableStatements.push(`CREATE POLICY ${policy} ON ${tablePath} USING ("owner_id" = NULLIF(current_setting('zr.user_id', true), '')::uuid) WITH CHECK ("owner_id" = NULLIF(current_setting('zr.user_id', true), '')::uuid)`);
  }
  const createTables = tableStatements.filter(sqlText => sqlText.startsWith('CREATE TABLE IF NOT EXISTS '));
  const policies = tableStatements.filter(sqlText => !sqlText.startsWith('CREATE TABLE IF NOT EXISTS '));
  statements.push(...createTables, ...policies);
  const stored = JSON.stringify(safeSpec);
  const registry = `INSERT INTO zr_studio_control.app_databases (app_id, app_name, schema_name, schema_spec, status) VALUES ($1,$2,$3,$4::jsonb,'schema-provisioned') ON CONFLICT (app_id) DO UPDATE SET app_name=EXCLUDED.app_name, schema_name=EXCLUDED.schema_name, schema_spec=EXCLUDED.schema_spec, status=EXCLUDED.status, updated_at=now()`;
  // One non-interactive Postgres transaction prevents an interrupted schema build from leaving half-created tables/policies.
  const queries = [...statements.map(text => sql.query(text)), sql.query(registry, [projectId, String(projectName || 'Aplicação').slice(0, 100), schema, stored])];
  await sql.transaction(queries);
  return { schema, tables: safeSpec.tables.map(t => t.name) };
}
