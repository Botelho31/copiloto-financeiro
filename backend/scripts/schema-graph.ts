// Generates a Mermaid ER diagram straight from the live SQLite schema (not
// hand-maintained prose) — run with `bun backend/scripts/schema-graph.ts`.
// Writes schema.mmd (Mermaid source); render it to an image separately with
// mermaid-cli: `npx -y @mermaid-js/mermaid-cli -i schema.mmd -o schema.svg`.
import { Database } from "bun:sqlite";

const dbPath = process.env.DB_PATH ?? "./data/budget.sqlite";
const db = new Database(dbPath, { readonly: true });

interface ColumnRow {
  name: string;
  type: string;
  pk: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
}

const tables = (
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name"
    )
    .all() as { name: string }[]
).map((r) => r.name);

const lines: string[] = ["erDiagram"];
const relationships: string[] = [];

for (const table of tables) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as ColumnRow[];
  lines.push(`    ${table} {`);
  for (const col of columns) {
    const type = (col.type || "TEXT").split("(")[0];
    const flag = col.pk ? " PK" : "";
    lines.push(`        ${type} ${col.name}${flag}`);
  }
  lines.push("    }");

  const fks = db.query(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyRow[];
  for (const fk of fks) {
    // Every FK here is optional-to-one in practice (nullable or not, SQLite
    // doesn't enforce cardinality) — }o--o{ reads as "zero or more to zero
    // or one", close enough for a structural overview, not a strict ERD.
    relationships.push(`    ${table} }o--o{ ${fk.table} : "${fk.from}"`);
  }
}

lines.push(...relationships);
await Bun.write("schema.mmd", lines.join("\n") + "\n");
console.log(`Wrote schema.mmd — ${tables.length} tables, ${relationships.length} foreign keys`);
