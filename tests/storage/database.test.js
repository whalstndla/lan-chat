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
