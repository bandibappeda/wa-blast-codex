import { describe, expect, test } from "bun:test";
import { migrate } from "./migrate";
import { createTestContext } from "../test/create-test-context";

describe("SQLite database harness", () => {
  test("applies core migrations exactly once and keeps SQLite safe", () => {
    const context = createTestContext();

    try {
      migrate(context.db);

      expect(context.migrationNames()).toEqual(["0001_core"]);
      expect(context.tableNames()).toEqual(
        expect.arrayContaining([
          "schema_migrations",
          "organizations",
          "users",
          "sessions",
          "login_attempts",
          "audit_entries",
        ]),
      );
      expect(context.db.query("PRAGMA foreign_keys").get()).toEqual({
        foreign_keys: 1,
      });
      expect(context.db.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
      expect(context.migrationNames()).toEqual(["0001_core"]);
    } finally {
      context.dispose();
    }
  });
});
