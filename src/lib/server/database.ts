import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';

const db = new Database(env.DB_URL || 'local.db', { fileMustExist: true, verbose: console.log });

db.exec(`DROP TABLE IF EXISTS connections`);

db.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY NOT NULL,
    name VARCHAR(10) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export default db;