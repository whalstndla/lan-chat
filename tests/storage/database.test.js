// tests/storage/database.test.js
const { 데이터베이스초기화, 데이터베이스닫기 } = require('../../electron/storage/database')

describe('데이터베이스 초기화', () => {
  let 데이터베이스

  afterEach(() => {
    if (데이터베이스) 데이터베이스닫기(데이터베이스)
  })

  it('메모리 DB로 초기화 후 messages 테이블이 존재함', () => {
    데이터베이스 = 데이터베이스초기화(':memory:')
    const 결과 = 데이터베이스.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    ).get()
    expect(결과.name).toBe('messages')
  })

  it('메모리 DB로 초기화 후 profile 테이블이 존재함', () => {
    데이터베이스 = 데이터베이스초기화(':memory:')
    const 결과 = 데이터베이스.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='profile'"
    ).get()
    expect(결과.name).toBe('profile')
  })
})
