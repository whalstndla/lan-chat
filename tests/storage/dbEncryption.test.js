// SQLCipher 기반 DB 암호화 + 평문 → 암호화 마이그레이션 단위 테스트.

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3-multiple-ciphers')
const { initDatabase, migrateDatabase, closeDatabase, bufferToHexKey } = require('../../electron/storage/database')
const { isPlaintextSqliteDb, migratePlaintextDbToEncrypted } = require('../../electron/storage/dbMigration')

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-db-')), 'chat.db')
}

describe('암호화 DB initDatabase', () => {
  it('마스터키로 디스크 DB 생성 후 같은 키로 재오픈 가능', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    let db = initDatabase(dbPath, key)
    migrateDatabase(db)
    db.prepare(`INSERT INTO profile (id, username, nickname, password_hash, salt, created_at) VALUES (1, 'u', 'n', 'h', 's', 0)`).run()
    closeDatabase(db)

    db = initDatabase(dbPath, key)
    const row = db.prepare('SELECT username FROM profile WHERE id = 1').get()
    expect(row.username).toBe('u')
    closeDatabase(db)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('잘못된 키로 열면 throw (스키마 접근 단계에서 실패)', () => {
    const key = crypto.randomBytes(32)
    const wrongKey = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    let db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    expect(() => {
      const wrongDb = initDatabase(dbPath, wrongKey)
      wrongDb.prepare('SELECT * FROM profile').all()
    }).toThrow()
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('암호화된 DB 파일은 평문 SQLite 매직이 보이지 않음', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)
    const head = fs.readFileSync(dbPath).slice(0, 16).toString('utf8')
    expect(head.startsWith('SQLite format 3')).toBe(false)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it(':memory: 는 마스터키 무시 (SQLCipher 메모리 미지원 — 기존 단위 테스트 호환)', () => {
    const key = crypto.randomBytes(32)
    const db = initDatabase(':memory:', key)
    migrateDatabase(db)
    expect(() => db.prepare('SELECT 1').get()).not.toThrow()
    closeDatabase(db)
  })
})

describe('isPlaintextSqliteDb', () => {
  it('평문 SQLite 파일은 true', () => {
    const dbPath = tempDbPath()
    const db = new Database(dbPath)
    db.exec('CREATE TABLE t (a TEXT)')
    db.close()
    expect(isPlaintextSqliteDb(dbPath)).toBe(true)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('암호화된 DB 파일은 false', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)
    expect(isPlaintextSqliteDb(dbPath)).toBe(false)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('존재하지 않는 파일은 false', () => {
    expect(isPlaintextSqliteDb('/nonexistent/foo.db')).toBe(false)
  })
})

describe('migratePlaintextDbToEncrypted', () => {
  it('평문 DB 를 암호화 DB 로 변환 + 백업 보존 + 데이터 무결', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    // 평문 DB 생성 + 데이터 삽입
    {
      const plain = new Database(dbPath)
      plain.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT, type TEXT, from_id TEXT, from_name TEXT, to_id TEXT, content_type TEXT, encrypted_payload TEXT, file_url TEXT, file_name TEXT, timestamp INTEGER, format TEXT)`)
      plain.prepare('INSERT INTO messages (id, content, type, from_id, from_name, content_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('m1', '안녕', 'message', 'p1', '나', 'text', 1)
      plain.close()
    }
    expect(isPlaintextSqliteDb(dbPath)).toBe(true)

    const result = migratePlaintextDbToEncrypted(dbPath, key)
    expect(result.migrated).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(fs.existsSync(result.backupPath)).toBe(true)
    expect(isPlaintextSqliteDb(dbPath)).toBe(false)

    // 마이그레이션된 DB 를 암호화 DB 로 열어 데이터 검증
    const encrypted = initDatabase(dbPath, key)
    const row = encrypted.prepare('SELECT id, content FROM messages WHERE id = ?').get('m1')
    expect(row.content).toBe('안녕')
    closeDatabase(encrypted)

    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('FTS5 가상 테이블이 있는 평문 DB 도 정상 변환 (보조 테이블 reserved 에러 없음)', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    {
      const plain = new Database(dbPath)
      plain.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT, type TEXT, from_id TEXT, from_name TEXT, to_id TEXT, content_type TEXT, encrypted_payload TEXT, file_url TEXT, file_name TEXT, timestamp INTEGER, format TEXT)`)
      plain.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(id UNINDEXED, content, from_name, content='messages', content_rowid='rowid')`)
      plain.prepare('INSERT INTO messages (id, content, type, from_id, from_name, content_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('m1', '검색 가능한 한국어', 'message', 'p1', '나', 'text', 1)
      plain.exec(`INSERT INTO messages_fts(rowid, id, content, from_name) SELECT rowid, id, content, from_name FROM messages WHERE content IS NOT NULL`)
      plain.close()
    }

    const result = migratePlaintextDbToEncrypted(dbPath, key)
    expect(result.migrated).toBe(true)

    const enc = initDatabase(dbPath, key)
    const row = enc.prepare('SELECT id, content FROM messages WHERE id = ?').get('m1')
    expect(row.content).toBe('검색 가능한 한국어')
    // FTS 검색이 마이그레이션 후에도 동작
    const found = enc.prepare(`SELECT id FROM messages_fts WHERE messages_fts MATCH ?`).all('검색')
    expect(found.length).toBeGreaterThan(0)
    closeDatabase(enc)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('이미 암호화된 DB 면 마이그레이션하지 않음', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    const result = migratePlaintextDbToEncrypted(dbPath, key)
    expect(result.migrated).toBe(false)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('파일이 없으면 마이그레이션하지 않음', () => {
    const key = crypto.randomBytes(32)
    const result = migratePlaintextDbToEncrypted('/tmp/lan-chat-no-such.db', key)
    expect(result.migrated).toBe(false)
  })

  it('masterKey 누락 시 throw', () => {
    const dbPath = tempDbPath()
    const plain = new Database(dbPath)
    plain.exec('CREATE TABLE t (a)')
    plain.close()
    expect(() => migratePlaintextDbToEncrypted(dbPath, null)).toThrow()
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })
})

describe('bufferToHexKey', () => {
  it('32바이트 키는 SQL hex 리터럴 형식', () => {
    const key = Buffer.alloc(32, 0xab)
    expect(bufferToHexKey(key)).toBe(`"x'${'ab'.repeat(32)}'"`)
  })
  it('잘못된 길이 거부', () => {
    expect(() => bufferToHexKey(Buffer.alloc(16))).toThrow()
  })
})
