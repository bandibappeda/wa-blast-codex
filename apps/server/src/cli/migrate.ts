import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { migrate } from "../db/migrate";

const config = loadConfig();
const database = openDatabase(config.databasePath);

try {
  migrate(database);
  console.info(JSON.stringify({ event: "database_migrated" }));
} finally {
  database.close();
}
