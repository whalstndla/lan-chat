// electron/storage/database.js
// better-sqlite3-multiple-ciphers 기반 — SQLCipher 호환 암호화 DB.
// 마스터키 (32바이트 Buffer) 를 hex 형태로 PRAGMA key 에 적용.
// 메모리/임시 DB 는 SQLCipher 가 키 설정을 지원하지 않아 평문으로만 동작 (테스트 한정).

const Database = require('better-sqlite3-multiple-ciphers')
const fs = require('fs')

function bufferToHexKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('마스터키는 32바이트 Buffer 여야 한다')
  }
  // SQLCipher 의 raw hex 키 표기 — `"x'<hex>'"` (PRAGMA key 가 SQL 문자열로 해석)
  return `"x'${key.toString('hex')}'"`
}

function applyEncryption(db, masterKey) {
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key=${bufferToHexKey(masterKey)}`)
  // 키 적용 검증 — 키가 틀리면 다음 PRAGMA 또는 SELECT 가 실패
  // (잘못된 키로는 sqlite_master 도 못 읽는다)
}

function initDatabase(dbPath, masterKey) {
  const isMemory = dbPath === ':memory:' || dbPath === '' || dbPath.startsWith('file::memory:')
  const db = new Database(dbPath)

  if (!isMemory) {
    // 디스크 DB 파일 권한 제한 — 소유자만 읽기/쓰기
    try { fs.chmodSync(dbPath, 0o600) } catch { /* 마이그레이션 직후엔 누락될 수 있어 무시 */ }
    if (masterKey) applyEncryption(db, masterKey)
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // WAL 모드에서는 synchronous=FULL 이 과도하다 — NORMAL 로도 WAL 저널이 커밋을
  // 보장하며, 매 쓰기마다의 fsync 비용을 줄여준다(#27).
  db.pragma('synchronous = NORMAL')
  // 다른 프로세스/커넥션이 잠깐 잠그고 있을 때 즉시 SQLITE_BUSY 로 실패하는 대신
  // 최대 5초까지 재시도 대기.
  db.pragma('busy_timeout = 5000')

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
      timestamp         INTEGER NOT NULL,
      format            TEXT,
      reply_to_id       TEXT,
      reply_preview     TEXT,
      mentions          TEXT
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
    "ALTER TABLE profile ADD COLUMN notification_sound TEXT DEFAULT 'notification1'",
    'ALTER TABLE profile ADD COLUMN notification_volume REAL DEFAULT 0.7',
    'ALTER TABLE profile ADD COLUMN notification_custom_sound TEXT',
    "ALTER TABLE profile ADD COLUMN status_type TEXT DEFAULT 'online'",
    "ALTER TABLE profile ADD COLUMN status_message TEXT DEFAULT ''",
    // 알림 범위: 'all'(전체) | 'dm'(DM만) | 'off'(끄기)
    "ALTER TABLE profile ADD COLUMN notification_scope TEXT DEFAULT 'all'",
    // OS 알림 본문 숨김 — on 이면 실제 메시지 내용 대신 "새 메시지"만 표시
    'ALTER TABLE profile ADD COLUMN notification_hide_body INTEGER DEFAULT 0',
    // 링크 미리보기(외부 서버 OG 요청) 사용 여부 — 기본 on(1). off 면 완전 단절.
    'ALTER TABLE profile ADD COLUMN link_preview_enabled INTEGER DEFAULT 1',
  ]
  for (const sql of profileMigrations) {
    try { db.prepare(sql).run() } catch { /* 이미 존재하면 무시 */ }
  }

  // messages 테이블 신규 컬럼 추가
  const messagesMigrations = [
    'ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN format TEXT',
    'ALTER TABLE messages ADD COLUMN edited_at INTEGER',
    'ALTER TABLE messages ADD COLUMN cached_file_path TEXT',
    // 답장/인용(#28) — 원본 messageId + 비정규화 미리보기 스냅샷(JSON 문자열).
    // additive 하위호환: 구버전 클라이언트는 이 컬럼/필드를 무시한다.
    'ALTER TABLE messages ADD COLUMN reply_to_id TEXT',
    'ALTER TABLE messages ADD COLUMN reply_preview TEXT',
    // @멘션(#29) — 멘션된 peerId 배열(JSON 문자열). additive 하위호환: 구버전 클라이언트는
    // 이 컬럼/필드를 무시하고, 이 값이 없는 메시지는 멘션 없음으로 취급한다.
    'ALTER TABLE messages ADD COLUMN mentions TEXT',
  ]
  for (const sql of messagesMigrations) {
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

  // 이모지 리액션 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL,
      peer_id    TEXT NOT NULL,
      emoji      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      PRIMARY KEY (message_id, peer_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
  `)

  // 피어 캐시 — mDNS 없이도 마지막으로 연결된 피어에 재연결하기 위한 저장소
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_cache (
      peer_id   TEXT PRIMARY KEY,
      ip        TEXT NOT NULL,
      ws_port   INTEGER NOT NULL,
      nickname  TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `)

  // 방별 마지막 읽은 지점(타임스탬프) — 안읽음 구분선을 재시작 후에도 유지하기 위한 영속
  // 저장소(#39). room_key 는 전체채팅이면 'global', DM 이면 상대 peerId — 렌더러의
  // getRoomKey() 규약과 동일하게 맞춰 별도 매핑 없이 그대로 키로 사용한다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_read_state (
      room_key            TEXT PRIMARY KEY,
      last_read_timestamp INTEGER
    );
  `)

  // FTS5 전문 검색 (글로벌 메시지만 — DM은 암호화되어 인덱싱 불가)
  try {
    // 백필 여부 판단은 반드시 "이번 호출 전에 messages_fts 테이블이 이미 존재했는가"로
    // 해야 한다. content='messages' 외부 콘텐츠 테이블은 MATCH 없는 일반 SELECT/count(*)
    // 가 인덱스를 거치지 않고 원본 messages 테이블을 그대로 스캔하므로, count(*) 결과가
    // 항상 messages 테이블의 행 수와 같아진다 — 즉 "FTS 인덱스에 실제로 백필됐는지"를
    // 전혀 반영하지 못하는 값이라 가드로 쓸 수 없다.
    const existingFtsRow = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'`
    ).get()

    // 구버전 스키마(#36 이전 — file_name 컬럼 없음) 감지 시 DROP 후 재생성한다.
    // FTS5 external-content 테이블은 컬럼 추가를 위한 ALTER TABLE 을 지원하지 않으므로,
    // 기존 사용자 DB 에 이미 2컬럼(content, from_name) 짜리 messages_fts 가 있다면
    // DROP + CREATE + 전체 재백필이 유일한 안전한 마이그레이션 경로다.
    // DROP TABLE 은 messages_fts 의 shadow 테이블(_data/_idx/_docsize/_config)도 함께 정리한다.
    const isLegacyFtsSchema = !!existingFtsRow && !existingFtsRow.sql.includes('file_name')
    if (isLegacyFtsSchema) {
      db.exec('DROP TABLE messages_fts')
    }

    const ftsTableExistedBefore = !isLegacyFtsSchema && !!existingFtsRow

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED, content, from_name, file_name,
        content='messages', content_rowid='rowid'
      );
    `)

    // 기존 messages 데이터를 FTS 인덱스로 백필 — 테이블을 이번 호출에서 새로 만든
    // 경우(=최초 1회, 신규 프로필이거나 FTS5 도입 이전/구버전 스키마 DB 의 첫 로그인)에만
    // 수행한다. migrateDatabase() 는 로그인/등록마다 호출되는데, 가드 없이 매번 INSERT 하면
    // 동일 rowid 가 반복 삽입 시도되어 검색 중복·인덱스 증가로 이어진다(#7).
    // 이후 신규/수정/삭제 메시지는 트리거가 전담하므로 두 번째 로그인부터는 건너뛴다.
    // 파일 메시지(content가 null인 이미지/비디오/파일)도 file_name 으로 검색 가능해야
    // 하므로(#36) content IS NOT NULL 조건뿐 아니라 file_name IS NOT NULL 도 포함한다.
    if (!ftsTableExistedBefore) {
      // content='messages' 모드에서는 FTS rowid가 messages 테이블 rowid와 반드시 일치해야 함.
      // rowid를 명시하지 않으면 FTS rowid가 자동 할당되어 실제 messages rowid와 어긋나고,
      // 엉뚱한 메시지(dm 등)가 검색 결과에 섞이는 버그가 발생함.
      // 따라서 rowid를 SELECT rowid FROM messages 로 명시적으로 지정함.
      db.exec(`
        INSERT INTO messages_fts(rowid, id, content, from_name, file_name)
        SELECT rowid, id, content, from_name, file_name FROM messages
        WHERE type = 'message' AND (content IS NOT NULL OR file_name IS NOT NULL);
      `)
    }

    // messages 테이블 변경을 messages_fts 에 자동 동기화하는 트리거.
    // 과거엔 saveMessage() 가 INSERT 시에만 수동으로 FTS 를 동기화해 edit/delete/
    // clearAllMessages/clearAllDMs 이후 FTS 인덱스가 실제 messages 테이블과 어긋나
    // (삭제된 메시지의 토큰이 남거나, 수정 전 텍스트로 검색되는) 문제가 있었다.
    // 표준 external-content FTS5 트리거로 일원화해 INSERT/UPDATE/DELETE 모두
    // 자동으로 반영되도록 한다 (전역 메시지만 대상 — DM 은 암호화되어 제외).
    //
    // 트리거는 "CREATE TRIGGER IF NOT EXISTS" 대신 매번 DROP 후 재생성한다 — file_name
    // 컬럼 추가처럼 트리거 본문 자체가 바뀌는 마이그레이션에서 IF NOT EXISTS 를 쓰면
    // 기존 사용자 DB 에 이미 등록된 구버전 트리거 정의가 영구히 남아, 로그인해도 새
    // 컬럼(file_name)이 절대 채워지지 않는 문제가 생긴다(#36).
    db.exec(`
      DROP TRIGGER IF EXISTS messages_fts_after_insert;
      DROP TRIGGER IF EXISTS messages_fts_after_delete;
      DROP TRIGGER IF EXISTS messages_fts_after_update;

      CREATE TRIGGER messages_fts_after_insert AFTER INSERT ON messages
      WHEN new.type = 'message' AND (new.content IS NOT NULL OR new.file_name IS NOT NULL)
      BEGIN
        INSERT INTO messages_fts(rowid, id, content, from_name, file_name)
        VALUES (new.rowid, new.id, new.content, new.from_name, new.file_name);
      END;

      CREATE TRIGGER messages_fts_after_delete AFTER DELETE ON messages
      WHEN old.type = 'message' AND (old.content IS NOT NULL OR old.file_name IS NOT NULL)
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, id, content, from_name, file_name)
        VALUES ('delete', old.rowid, old.id, old.content, old.from_name, old.file_name);
      END;

      CREATE TRIGGER messages_fts_after_update AFTER UPDATE OF content, from_name, file_name ON messages
      BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, id, content, from_name, file_name)
          SELECT 'delete', old.rowid, old.id, old.content, old.from_name, old.file_name
          WHERE old.type = 'message' AND (old.content IS NOT NULL OR old.file_name IS NOT NULL);
        INSERT INTO messages_fts(rowid, id, content, from_name, file_name)
          SELECT new.rowid, new.id, new.content, new.from_name, new.file_name
          WHERE new.type = 'message' AND (new.content IS NOT NULL OR new.file_name IS NOT NULL);
      END;
    `)
  } catch { /* FTS5 미지원 환경 무시 */ }
}

function closeDatabase(db) {
  // WAL 파일에 쌓인 내용을 메인 DB 파일로 합쳐 WAL 이 무한정 커지는 것을 방지(#27).
  // :memory: 이거나 WAL 모드가 아니면 실패할 수 있으므로 안전하게 무시하고 close 는
  // 계속 진행한다.
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* 무시 */ }
  db.close()
}

module.exports = { initDatabase, migrateDatabase, closeDatabase, applyEncryption, bufferToHexKey }
