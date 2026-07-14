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
  // 가상 테이블 (FTS5 등) 본체 이름 — 보조 테이블 (xxx_data, xxx_idx, xxx_docsize,
  // xxx_config, xxx_content) 은 SQLite 가 자동 생성하므로 명시 CREATE / INSERT 모두 거부됨.
  const virtualTableNames = srcDb.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'
  `).all().map(r => r.name)

  function isVirtualAuxiliary(name) {
    for (const vt of virtualTableNames) {
      if (name === vt) return false
      if (name.startsWith(`${vt}_`)) {
        const suffix = name.slice(vt.length + 1)
        if (['data', 'idx', 'docsize', 'config', 'content'].includes(suffix)) return true
      }
    }
    return false
  }

  const items = srcDb.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid
  `).all().filter(item => !isVirtualAuxiliary(item.name))

  // 1) 스키마 재생성 (FTS5 같은 가상 테이블 본체 포함, 보조 테이블은 자동 생성)
  for (const item of items) {
    try { dstDb.exec(item.sql) } catch (err) {
      if (!String(err.message).includes('already exists')) throw err
    }
  }

  // 2) 일반 테이블 데이터 복사 (rowid 포함). 가상 테이블 (FTS5) 본체와 그 보조 테이블
  //    (xxx_fts_data, xxx_fts_idx, xxx_fts_docsize, xxx_fts_config, xxx_fts_content) 은
  //    SQLite 가 직접 INSERT 를 거부 ("object name reserved") 하므로 제외한다.
  //    보조 테이블은 sqlite_master 에서 sql IS NULL 로 식별 가능.
  const tables = srcDb.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
  `).all().map(r => r.name).filter(name => !isVirtualAuxiliary(name))

  for (const tableName of tables) {
    // 가상 테이블 본체 (FTS5 등) 도 그대로 복사 불가 — 부모 테이블 복사 후 재구성에 위임
    if (virtualTableNames.includes(tableName)) continue

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

// 암호화 DB 가 masterKey 로 정상 오픈되고 기본 쿼리가 성공하는지 확인.
// 키가 틀리거나 파일이 손상됐으면 sqlite_master 조회 단계에서 실패한다
// (database.js 의 applyEncryption 주석과 동일한 SQLCipher 검증 방식).
function verifyEncryptedDatabase(dbPath, masterKey) {
  // new Database() 는 파일이 없으면 새로 만들어버리므로(빈 DB 도 "정상 오픈"으로 오판),
  // 검증 대상 파일이 실제로 존재하는지 먼저 확인한다.
  if (!fs.existsSync(dbPath)) return false
  let db
  try {
    db = new Database(dbPath)
    applyEncryption(db, masterKey)
    const row = db.prepare('SELECT count(*) AS count FROM sqlite_master').get()
    return !!row && typeof row.count === 'number'
  } catch {
    return false
  } finally {
    if (db) { try { db.close() } catch {} }
  }
}

// 파일을 0으로 덮어쓴 뒤 삭제 — 평문 백업처럼 민감한 파일을 디스크에서 안전하게 지우기
// 위함. 덮어쓰기가 실패해도(권한 문제 등) 삭제 자체는 계속 시도한다.
function secureWipeAndDelete(filePath) {
  try {
    const { size } = fs.statSync(filePath)
    const fd = fs.openSync(filePath, 'r+')
    try {
      const chunkSize = 64 * 1024
      const zeroChunk = Buffer.alloc(Math.min(chunkSize, size), 0)
      let written = 0
      while (written < size) {
        const toWrite = Math.min(chunkSize, size - written)
        fs.writeSync(fd, zeroChunk, 0, toWrite, written)
        written += toWrite
      }
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch { /* 덮어쓰기 실패해도 삭제는 계속 진행 */ }
  try { fs.unlinkSync(filePath) } catch { /* 이미 없거나 삭제 실패 시 무시 */ }
}

// 평문 DB 를 암호화 DB 로 변환. 원자적 교체 + 무결성 검증 후 백업본 안전 삭제.
// 반환: { migrated: boolean, backupPath?: string, backupDeleted?: boolean }
function migratePlaintextDbToEncrypted(dbPath, masterKey) {
  if (!fs.existsSync(dbPath)) return { migrated: false }

  const dir = path.dirname(dbPath)
  const base = path.basename(dbPath)
  const backupPath = path.join(dir, `${base}.plaintext.bak`)

  if (!isPlaintextSqliteDb(dbPath)) {
    // 이미 암호화된 DB — 다만 과거 실행에서 안전 삭제가 중간에 실패해(#25) 평문 백업이
    // 남아있을 수 있다. 현재 DB 가 masterKey 로 정상 오픈되면 그 백업은 더 이상 필요
    // 없으므로 함께 정리한다 (부팅/로그인 시 남은 .bak 을 치우는 가드 역할).
    if (fs.existsSync(backupPath) && Buffer.isBuffer(masterKey) && masterKey.length === 32) {
      if (verifyEncryptedDatabase(dbPath, masterKey)) {
        secureWipeAndDelete(backupPath)
      }
    }
    return { migrated: false }
  }

  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('masterKey 가 없으면 마이그레이션 불가')
  }

  const tmpEncryptedPath = path.join(dir, `${base}.encrypted-tmp-${process.pid}`)

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

  // 평문 시절의 WAL/SHM 부속 파일은 새 암호화 DB 와 매칭되지 않아
  // SQLCipher 가 "file is not a database" 로 거부한다. 모두 정리.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(dbPath + suffix) } catch {}
  }

  // 암호화 DB 무결성 확인(정상 오픈 + 기본 쿼리 성공) 후에만 평문 백업을 안전 삭제한다(#25).
  // 검증에 실패하면 — 즉 혹시 모를 손상 — 사용자 데이터 유실을 막기 위해 백업을 그대로 둔다.
  if (verifyEncryptedDatabase(dbPath, masterKey)) {
    secureWipeAndDelete(backupPath)
    return { migrated: true, backupPath, backupDeleted: true }
  }
  return { migrated: true, backupPath, backupDeleted: false }
}

module.exports = {
  isPlaintextSqliteDb,
  migratePlaintextDbToEncrypted,
  copyTablesAndIndexes,
  verifyEncryptedDatabase,
  secureWipeAndDelete,
}
