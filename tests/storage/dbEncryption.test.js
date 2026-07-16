// SQLCipher 기반 DB 암호화 + 평문 → 암호화 마이그레이션 단위 테스트.

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3-multiple-ciphers')
const { initDatabase, migrateDatabase, closeDatabase, bufferToHexKey } = require('../../electron/storage/database')
const { isPlaintextSqliteDb, migratePlaintextDbToEncrypted, verifyEncryptedDatabase, secureWipeAndDelete } = require('../../electron/storage/dbMigration')

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
  it('평문 DB 를 암호화 DB 로 변환 + 무결성 검증 후 백업 안전 삭제 + 데이터 무결', () => {
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
    // 암호화 DB 무결성 검증에 성공했으므로 평문 백업은 안전 삭제되어야 한다(#25) —
    // 과거엔 rename 만 하고 삭제하지 않아 대화 전체의 평문 사본이 영구 잔존했다.
    expect(result.backupDeleted).toBe(true)
    expect(fs.existsSync(result.backupPath)).toBe(false)
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

  it('로그인 시점에 남아있는 평문 백업(.bak)을 정리하는 가드 — 이미 암호화된 DB + 올바른 키면 안전 삭제', () => {
    // 과거 실행에서 안전 삭제가 중간에 실패해 .bak 이 남아있는 상황을 재현한다.
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    const backupPath = `${dbPath}.plaintext.bak`
    fs.writeFileSync(backupPath, '레거시 평문 백업 잔존')
    expect(fs.existsSync(backupPath)).toBe(true)

    const result = migratePlaintextDbToEncrypted(dbPath, key)
    expect(result.migrated).toBe(false)
    // 이미 암호화된 DB 이므로 마이그레이션은 수행하지 않지만, 정상 오픈이 확인되므로
    // 잔존 백업은 정리되어야 한다.
    expect(fs.existsSync(backupPath)).toBe(false)

    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('잔존 .bak 정리 가드 — masterKey 가 없으면 안전하게 아무 것도 하지 않는다', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    const backupPath = `${dbPath}.plaintext.bak`
    fs.writeFileSync(backupPath, '레거시 평문 백업 잔존')

    const result = migratePlaintextDbToEncrypted(dbPath, null)
    expect(result.migrated).toBe(false)
    // masterKey 없이는 검증 자체가 불가능하므로 안전하게 백업을 그대로 둔다.
    expect(fs.existsSync(backupPath)).toBe(true)

    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })
})

describe('verifyEncryptedDatabase', () => {
  it('올바른 masterKey 로 정상 오픈되면 true', () => {
    const key = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    expect(verifyEncryptedDatabase(dbPath, key)).toBe(true)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('잘못된 masterKey 로는 false (백업을 지우면 안 되는 근거)', () => {
    const key = crypto.randomBytes(32)
    const wrongKey = crypto.randomBytes(32)
    const dbPath = tempDbPath()
    const db = initDatabase(dbPath, key)
    migrateDatabase(db)
    closeDatabase(db)

    expect(verifyEncryptedDatabase(dbPath, wrongKey)).toBe(false)
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  it('존재하지 않는 파일은 false', () => {
    const key = crypto.randomBytes(32)
    expect(verifyEncryptedDatabase('/tmp/lan-chat-no-such-verify.db', key)).toBe(false)
  })
})

describe('secureWipeAndDelete', () => {
  it('파일을 0으로 덮어쓴 뒤 삭제한다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-wipe-'))
    const filePath = path.join(dir, 'secret.bak')
    fs.writeFileSync(filePath, '민감한 평문 내용')

    secureWipeAndDelete(filePath)

    expect(fs.existsSync(filePath)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('존재하지 않는 파일이어도 에러를 던지지 않는다', () => {
    expect(() => secureWipeAndDelete('/tmp/lan-chat-no-such-wipe.bak')).not.toThrow()
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
