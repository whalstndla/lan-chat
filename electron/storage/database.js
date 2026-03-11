// electron/storage/database.js
const Database = require('better-sqlite3')

function initDatabase(dbPath) {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY,
      type              TEXT NOT NULL,
      from_id           TEXT NOT NULL,
      from_name         TEXT NOT NULL,
      to_id             TEXT,
      content           TEXT,
      content_type      TEXT NOT NULL DEFAULT 'text',
      encrypted_payload TEXT,
      file_url          TEXT,
      file_name         TEXT,
      timestamp         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type, from_id, to_id);

    CREATE TABLE IF NOT EXISTS profile (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      username      TEXT NOT NULL UNIQUE,
      nickname      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `)

  return db
}

// 기존 DB에 새 컬럼/테이블 추가 (이미 존재하면 무시)
function migrateDatabase(db) {
  // profile 테이블 신규 컬럼 추가
  const profileMigrations = [
    'ALTER TABLE profile ADD COLUMN peer_id TEXT',
    'ALTER TABLE profile ADD COLUMN profile_image TEXT',
    'ALTER TABLE profile ADD COLUMN last_login_at INTEGER',
  ]
  for (const sql of profileMigrations) {
    try { db.prepare(sql).run() } catch { /* 이미 존재하면 무시 */ }
  }

  // 오프라인 메시지 큐 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id              TEXT PRIMARY KEY,
      target_peer_id  TEXT NOT NULL,
      message_payload TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_target ON pending_messages(target_peer_id);
  `)
}

function closeDatabase(db) {
  db.close()
}

module.exports = { initDatabase, migrateDatabase, closeDatabase }
