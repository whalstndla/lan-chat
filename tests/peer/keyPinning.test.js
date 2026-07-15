// TOFU 키 고정 판정 헬퍼(#59) 단위 테스트 — evaluatePeerKey 3분기 + computeKeyFingerprint.
const crypto = require('crypto')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { pinKey } = require('../../electron/storage/queries')
const { evaluatePeerKey, computeKeyFingerprint } = require('../../electron/peer/keyPinning')

function makePublicKeyBase64() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

describe('evaluatePeerKey — TOFU 3분기 판정', () => {
  let db
  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
  })
  afterEach(() => closeDatabase(db))

  it('db 가 없으면 최초(first)로 간주한다(테스트/초기화 전)', () => {
    const result = evaluatePeerKey(null, 'p1', makePublicKeyBase64())
    expect(result.status).toBe('first')
    expect(result.pinned).toBeNull()
  })

  it('고정된 키가 없으면 first', () => {
    const result = evaluatePeerKey(db, 'p1', makePublicKeyBase64())
    expect(result.status).toBe('first')
  })

  it('고정 키와 일치하면 match', () => {
    const keyA = makePublicKeyBase64()
    pinKey(db, { peerId: 'p1', publicKey: keyA, firstSeen: 1000 })
    const result = evaluatePeerKey(db, 'p1', keyA)
    expect(result.status).toBe('match')
    expect(result.pinned.publicKey).toBe(keyA)
  })

  it('고정 키와 다르면 mismatch', () => {
    const keyA = makePublicKeyBase64()
    const keyB = makePublicKeyBase64()
    pinKey(db, { peerId: 'p1', publicKey: keyA, firstSeen: 1000 })
    const result = evaluatePeerKey(db, 'p1', keyB)
    expect(result.status).toBe('mismatch')
    // pinned 는 여전히 이전(고정) 키 — 호출부가 이 값을 유지해야 한다.
    expect(result.pinned.publicKey).toBe(keyA)
  })
})

describe('computeKeyFingerprint — 대면 안전 번호 형식', () => {
  it('동일 키는 항상 같은 지문을 낸다(결정적)', () => {
    const key = makePublicKeyBase64()
    expect(computeKeyFingerprint(key)).toBe(computeKeyFingerprint(key))
  })

  it('다른 키는 다른 지문을 낸다', () => {
    expect(computeKeyFingerprint(makePublicKeyBase64()))
      .not.toBe(computeKeyFingerprint(makePublicKeyBase64()))
  })

  it('4자리씩 그룹핑된 hex 형식이다', () => {
    const fp = computeKeyFingerprint(makePublicKeyBase64())
    // 32 hex → 8 그룹 × 4자리, 공백 구분
    expect(fp).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){7}$/)
  })

  it('빈 입력은 빈 문자열', () => {
    expect(computeKeyFingerprint('')).toBe('')
    expect(computeKeyFingerprint(null)).toBe('')
  })
})
