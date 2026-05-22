import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';

const db = new Database(env.DB_URL || 'local.db', {
  verbose: env.NODE_ENV !== 'production' ? console.log : undefined,
});

db.exec(`DROP TABLE IF EXISTS connections`);

db.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id VARCHAR(10) NOT NULL UNIQUE,
    user VARCHAR(20) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export default db;