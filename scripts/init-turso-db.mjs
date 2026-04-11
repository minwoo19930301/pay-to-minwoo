import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

const databaseUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!databaseUrl || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  process.exit(1);
}

const client = createClient({
  url: databaseUrl,
  authToken
});

const schemaPath = resolve(process.cwd(), "db/schema.sql");
const schema = await readFile(schemaPath, "utf8");
const statements = schema
  .split(/;\s*\n/g)
  .map((statement) => statement.trim())
  .filter(Boolean);

await client.execute("PRAGMA foreign_keys = ON");
await client.batch(statements.map((sql) => ({ sql })), "write");

console.log(`Applied ${statements.length} schema statements to Turso.`);
