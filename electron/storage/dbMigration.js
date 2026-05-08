// 평문 SQLite DB → SQLCipher 암호화 DB 마이그레이션 (보안 6단계).
// better-sqlite3-multiple-ciphers 빌드는 sqlcipher_export 함수를 노출하지 않으므로
// 스키마/데이터를 명시적으로 복사하는 방식으로 구현. virtual table 은 sqlite_master 의
// 원본 sql 로 재생성하고, content='messages' FTS5 는 부모 테이블 복사 후 INSERT 로 재구성한다.

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3-multiple-ciphers')
const { applyEncryption } = require('./database')

// SQLite 평문 DB 파일 시그니처 — 'SQLite format 3\0'
function isPlaintextSqliteDb(dbPath) {
  if (!fs.existsSync(dbPath)) return false
  const fd = fs.openSync(dbPath, 'r')
  try {
    const buf = Buffer.alloc(16)
    fs.readSync(fd, buf, 0, 16, 0)
    return buf.toString('utf-8').startsWith('SQLite format 3')
  } catch {
    return false
  } finally {
    fs.closeSync(fd)
  }
}

function copyTablesAndIndexes(srcDb, dstDb) {
  const items = srcDb.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid
  `).all()

  // 1) 스키마 재생성 (FTS5 같은 가상 테이블 포함)
  for (const item of items) {
    try { dstDb.exec(item.sql) } catch (err) {
      // FTS 컨텐츠 모드는 부모 테이블 생성 후 자동으로 동작 — 중복 생성 시 무시
      if (!String(err.message).includes('already exists')) throw err
    }
  }

  // 2) 일반 테이블 데이터 복사 (rowid 포함). 가상 테이블 (FTS5) 은 콘텐츠 모드라 부모 테이블 복사로
  //    자동 채워지지 않으므로 별도 INSERT 로 재구성한다.
  const tables = srcDb.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map(r => r.name)

  for (const tableName of tables) {
    // 가상 테이블 (FTS5 등) 은 그대로 복사 불가 — 이름이 fts 로 끝나면 본 테이블 복사 후 재구성에 위임
    const isFts = tableName.endsWith('_fts')
    if (isFts) continue

    const cols = srcDb.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name)
    if (cols.length === 0) continue
    const colList = cols.map(c => `"${c}"`).join(', ')
    const placeholders = ['?', ...cols.map(() => '?')].join(', ')
    const select = srcDb.prepare(`SELECT rowid AS _rowid, * FROM "${tableName}"`)
    const insert = dstDb.prepare(`INSERT OR REPLACE INTO "${tableName}" (rowid, ${colList}) VALUES (${placeholders})`)
    const insertMany = dstDb.transaction((rows) => {
      for (const row of rows) {
        insert.run(row._rowid, ...cols.map(c => row[c]))
      }
    })
    const rows = select.all()
    if (rows.length > 0) insertMany(rows)
  }

  // 3) FTS5 재구성 — content='messages' 모드라 부모 테이블 데이터로 채운다.
  try {
    dstDb.exec(`
      INSERT INTO messages_fts(rowid, id, content, from_name)
      SELECT rowid, id, content, from_name FROM messages
      WHERE type = 'message' AND content IS NOT NULL
    `)
  } catch { /* FTS5 미지원 / 테이블 부재 무시 */ }
}

// 평문 DB 를 암호화 DB 로 변환. 원자적 교체 + 백업본 보존.
// 반환: { migrated: boolean, backupPath?: string }
function migratePlaintextDbToEncrypted(dbPath, masterKey) {
  if (!fs.existsSync(dbPath)) return { migrated: false }
  if (!isPlaintextSqliteDb(dbPath)) return { migrated: false }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('masterKey 가 없으면 마이그레이션 불가')
  }

  const dir = path.dirname(dbPath)
  const base = path.basename(dbPath)
  const tmpEncryptedPath = path.join(dir, `${base}.encrypted-tmp-${process.pid}`)
  const backupPath = path.join(dir, `${base}.plaintext.bak`)

  // 잔존 임시파일 정리
  try { fs.unlinkSync(tmpEncryptedPath) } catch {}

  const plain = new Database(dbPath, { readonly: true })
  const encrypted = new Database(tmpEncryptedPath)
  try {
    applyEncryption(encrypted, masterKey)
    encrypted.pragma('journal_mode = WAL')
    encrypted.pragma('foreign_keys = ON')
    copyTablesAndIndexes(plain, encrypted)
  } finally {
    plain.close()
    encrypted.close()
  }

  // 원본 백업 후 교체
  if (!fs.existsSync(backupPath)) {
    fs.renameSync(dbPath, backupPath)
  } else {
    fs.unlinkSync(dbPath)
  }
  fs.renameSync(tmpEncryptedPath, dbPath)
  try { fs.chmodSync(dbPath, 0o600) } catch {}
  try { fs.chmodSync(backupPath, 0o600) } catch {}

  return { migrated: true, backupPath }
}

module.exports = { isPlaintextSqliteDb, migratePlaintextDbToEncrypted, copyTablesAndIndexes }
