// tests/storage/database.test.js
const { initDatabase, closeDatabase } = require('../../electron/storage/database')

describe('데이터베이스 초기화', () => {
  let db

  afterEach(() => {
    if (db) closeDatabase(db)
  })

  it('메모리 DB로 초기화 후 messages 테이블이 존재함', () => {
    db = initDatabase(':memory:')
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    ).get()
    expect(result.name).toBe('messages')
  })

  it('메모리 DB로 초기화 후 profile 테이블이 존재함', () => {
    db = initDatabase(':memory:')
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='profile'"
    ).get()
    expect(result.name).toBe('profile')
  })
})

// VACUUM/체크포인트 정책 관련 pragma 설정 검증 (#27)
describe('PRAGMA 설정', () => {
  let db

  afterEach(() => {
    if (db) closeDatabase(db)
  })

  it('synchronous 는 NORMAL(1) 로 설정된다', () => {
    db = initDatabase(':memory:')
    expect(db.pragma('synchronous', { simple: true })).toBe(1)
  })

  it('busy_timeout 은 5000ms 로 설정된다', () => {
    db = initDatabase(':memory:')
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  })

  it('closeDatabase 는 wal_checkpoint 시도 후 정상적으로 close 된다 (에러 없음)', () => {
    db = initDatabase(':memory:')
    expect(() => closeDatabase(db)).not.toThrow()
    db = null // afterEach 에서 이중 close 방지
  })
})
