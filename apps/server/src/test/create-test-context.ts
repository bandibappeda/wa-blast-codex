import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { migrate } from "../db/migrate";
import { openDatabase } from "../db/database";
import { FixedClock } from "../shared/clock";
import { DeterministicIdGenerator } from "../shared/id";

export function createTestContext() {
  const directory = mkdtempSync(join(tmpdir(), "wa-blast-test-"));
  const databasePath = join(directory, "test.sqlite");
  const db = openDatabase(databasePath);
  const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
  const ids = new DeterministicIdGenerator();

  migrate(db);

  return {
    db,
    clock,
    ids,
    migrationNames(): string[] {
      return db
        .query<{ name: string }, []>(
          "SELECT name FROM schema_migrations ORDER BY name",
        )
        .all()
        .map((row) => row.name);
    },
    tableNames(): string[] {
      return db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
    },
    dispose(): void {
      disposeDatabase(db, directory);
    },
  };
}

function disposeDatabase(db: Database, directory: string): void {
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
