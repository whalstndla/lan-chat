// TOFU 키 고정(#59) — peer_keys 테이블 CRUD + 마이그레이션(기존 DB 호환) 검증.
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const {
  getPinnedKey,
  pinKey,
  updatePinnedKey,
  setVerified,
} = require('../../electron/storage/queries')

describe('peer_keys 마이그레이션(기존 DB 호환)', () => {
  it('migrateDatabase 이전엔 peer_keys 가 없고, 이후에 생성된다', () => {
    const db = initDatabase(':memory:')
    // initDatabase 는 messages/profile 만 만든다 — peer_keys 는 아직 없어야 한다.
    const before = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='peer_keys'"
    ).get()
    expect(before).toBeUndefined()

    migrateDatabase(db)

    const after = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='peer_keys'"
    ).get()
    expect(after).toBeDefined()
    closeDatabase(db)
  })

  it('migrateDatabase 를 여러 번 호출해도 안전하다(멱등)', () => {
    const db = initDatabase(':memory:')
    migrateDatabase(db)
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1000 })
    // 두 번째 마이그레이션이 기존 데이터를 지우지 않아야 한다.
    migrateDatabase(db)
    expect(getPinnedKey(db, 'p1')?.publicKey).toBe('KEY_A')
    closeDatabase(db)
  })
})

describe('peer_keys CRUD', () => {
  let db
  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
  })
  afterEach(() => closeDatabase(db))

  it('없는 peerId 는 null 을 반환한다', () => {
    expect(getPinnedKey(db, 'unknown')).toBeNull()
  })

  it('pinKey 로 최초 고정 후 조회된다', () => {
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1234 })
    const pinned = getPinnedKey(db, 'p1')
    expect(pinned).toEqual({ peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1234, verified: false })
  })

  it('pinKey 는 이미 고정된 키를 덮어쓰지 않는다(INSERT OR IGNORE)', () => {
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1000 })
    // 같은 peerId 로 다른 키를 pin 시도 — 무시되어야 한다.
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_B', firstSeen: 2000 })
    expect(getPinnedKey(db, 'p1')?.publicKey).toBe('KEY_A')
  })

  it('updatePinnedKey 는 키를 교체하고 verified 를 0 으로 리셋한다', () => {
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1000 })
    setVerified(db, 'p1', true)
    expect(getPinnedKey(db, 'p1')?.verified).toBe(true)

    updatePinnedKey(db, { peerId: 'p1', publicKey: 'KEY_B' })
    const pinned = getPinnedKey(db, 'p1')
    expect(pinned.publicKey).toBe('KEY_B')
    // 새 키는 아직 대면 검증 전 — verified 리셋.
    expect(pinned.verified).toBe(false)
    // first_seen 은 유지되어야 한다(최초 고정 이력).
    expect(pinned.firstSeen).toBe(1000)
  })

  it('setVerified 로 대면 검증 여부를 토글한다', () => {
    pinKey(db, { peerId: 'p1', publicKey: 'KEY_A', firstSeen: 1000 })
    setVerified(db, 'p1', true)
    expect(getPinnedKey(db, 'p1')?.verified).toBe(true)
    setVerified(db, 'p1', false)
    expect(getPinnedKey(db, 'p1')?.verified).toBe(false)
  })
})
