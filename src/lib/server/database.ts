import { env } from '$env/dynamic/private';
import { createClient } from "@libsql/client";

const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN
});

await db.execute(`DROP TABLE IF EXISTS connections`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id VARCHAR(10) NOT NULL,
    user_name VARCHAR(10) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export default db;