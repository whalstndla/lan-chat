// electron/storage/database.js
const Database = require('better-sqlite3')

function 데이터베이스초기화(데이터베이스경로) {
  const 데이터베이스 = new Database(데이터베이스경로)

  데이터베이스.pragma('journal_mode = WAL')
  데이터베이스.pragma('foreign_keys = ON')

  데이터베이스.exec(`
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

  return 데이터베이스
}

function 데이터베이스닫기(데이터베이스) {
  데이터베이스.close()
}

module.exports = { 데이터베이스초기화, 데이터베이스닫기 }
