// tests/storage/profile.test.js
const { initDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile, getProfile, verifyPassword } = require('../../electron/storage/profile')

describe('프로필 스토리지', () => {
  let db

  beforeEach(() => { db = initDatabase(':memory:') })
  afterEach(() => { closeDatabase(db) })

  it('프로필 저장 후 조회 가능', () => {
    saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    const profile = getProfile(db)
    expect(profile.nickname).toBe('홍길동')
    expect(profile.username).toBe('hong')
    expect(profile.password_hash).not.toBe('pass123') // 평문 저장 금지
  })

  it('올바른 비밀번호는 검증 통과', () => {
    saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(verifyPassword(db, 'hong', 'pass123')).toBe(true)
  })

  it('잘못된 비밀번호는 검증 실패', () => {
    saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(verifyPassword(db, 'hong', '틀린비밀번호')).toBe(false)
  })

  it('프로필 없을 때 조회 시 null 반환', () => {
    expect(getProfile(db)).toBeNull()
  })
})
