// tests/storage/profile.test.js
const crypto = require('crypto')
const { initDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile, getProfile, verifyPassword } = require('../../electron/storage/profile')

describe('프로필 스토리지', () => {
  let db

  beforeEach(() => { db = initDatabase(':memory:') })
  afterEach(() => { closeDatabase(db) })

  it('프로필 저장 후 조회 가능', async () => {
    await saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    const profile = getProfile(db)
    expect(profile.nickname).toBe('홍길동')
    expect(profile.username).toBe('hong')
    expect(profile.password_hash).not.toBe('pass123') // 평문 저장 금지
  })

  it('올바른 비밀번호는 검증 통과', async () => {
    await saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(await verifyPassword(db, 'hong', 'pass123')).toBe(true)
  })

  it('잘못된 비밀번호는 검증 실패', async () => {
    await saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(await verifyPassword(db, 'hong', '틀린비밀번호')).toBe(false)
  })

  it('프로필 없을 때 조회 시 null 반환', () => {
    expect(getProfile(db)).toBeNull()
  })

  // pbkdf2Sync → pbkdf2(async) 전환 후에도 파생 해시가 비트 단위로 동일해야 기존에
  // 저장된 password_hash 로 로그인이 계속 성공한다. saveProfile 이 저장한 해시가
  // 동일 파라미터(310000/32/sha256)의 crypto.pbkdf2Sync 결과와 일치하는지 직접 비교한다.
  it('저장된 비밀번호 해시가 동일 파라미터의 pbkdf2Sync 결과와 비트 단위로 동일하다 (동기→비동기 전환 검증)', async () => {
    await saveProfile(db, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    const profile = getProfile(db)
    const expectedHash = crypto.pbkdf2Sync('pass123', profile.salt, 310000, 32, 'sha256').toString('hex')
    expect(profile.password_hash).toBe(expectedHash)
  })
})
