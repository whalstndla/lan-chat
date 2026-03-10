// tests/storage/profile.test.js
const { 데이터베이스초기화, 데이터베이스닫기 } = require('../../electron/storage/database')
const {
  프로필저장,
  프로필조회,
  비밀번호검증,
} = require('../../electron/storage/profile')

describe('프로필 스토리지', () => {
  let 데이터베이스

  beforeEach(() => { 데이터베이스 = 데이터베이스초기화(':memory:') })
  afterEach(() => { 데이터베이스닫기(데이터베이스) })

  it('프로필 저장 후 조회 가능', () => {
    프로필저장(데이터베이스, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    const 프로필 = 프로필조회(데이터베이스)
    expect(프로필.nickname).toBe('홍길동')
    expect(프로필.username).toBe('hong')
    expect(프로필.password_hash).not.toBe('pass123') // 평문 저장 금지
  })

  it('올바른 비밀번호는 검증 통과', () => {
    프로필저장(데이터베이스, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(비밀번호검증(데이터베이스, 'hong', 'pass123')).toBe(true)
  })

  it('잘못된 비밀번호는 검증 실패', () => {
    프로필저장(데이터베이스, { username: 'hong', nickname: '홍길동', password: 'pass123' })
    expect(비밀번호검증(데이터베이스, 'hong', '틀린비밀번호')).toBe(false)
  })

  it('프로필 없을 때 조회 시 null 반환', () => {
    expect(프로필조회(데이터베이스)).toBeNull()
  })
})
