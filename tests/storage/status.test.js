// tests/storage/status.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile, getProfile, updateStatus } = require('../../electron/storage/profile')

describe('상태 메시지', () => {
  let db
  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveProfile(db, { username: 'test', nickname: '테스트', password: 'pw123' })
  })
  afterEach(() => closeDatabase(db))

  it('상태 저장/조회', () => {
    updateStatus(db, { statusType: 'busy', statusMessage: '회의 중' })
    const profile = getProfile(db)
    expect(profile.status_type).toBe('busy')
    expect(profile.status_message).toBe('회의 중')
  })

  it('온라인으로 초기화', () => {
    updateStatus(db, { statusType: 'busy', statusMessage: '회의 중' })
    updateStatus(db, { statusType: 'online', statusMessage: '' })
    const profile = getProfile(db)
    expect(profile.status_type).toBe('online')
  })
})
