import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

interface MigrationRow {
  name: string;
}

export function migrate(
  database: Database,
  migrationsDirectory = join(import.meta.dir, "migrations"),
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database
      .query<MigrationRow, []>(
        "SELECT name FROM schema_migrations ORDER BY name",
      )
      .all()
      .map((row) => row.name),
  );

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const name = migrationFile.slice(0, -4);
    if (applied.has(name)) continue;

    const sql = readFileSync(join(migrationsDirectory, migrationFile), "utf8");
    const applyMigration = database.transaction(() => {
      database.exec(sql);
      database
        .query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, new Date().toISOString());
    });

    applyMigration();
  }
}
