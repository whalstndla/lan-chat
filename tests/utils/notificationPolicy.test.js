// tests/utils/notificationPolicy.test.js
// 알림(소리 + OS알림) 발송 여부 판정 순수 로직 테스트(#42).
// 배지(안읽음 카운트)는 이 판정과 무관하게 호출부가 항상 증가시키므로 여기서는 다루지 않는다.

const { shouldNotify, maskNotificationBody, resolveNotificationDecision } = require('../../electron/utils/notificationPolicy')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile, updateStatus } = require('../../electron/storage/profile')

describe('shouldNotify — 알림 범위 판정', () => {
  it('뮤트된 방은 scope/dnd 와 무관하게 항상 억제한다', () => {
    expect(shouldNotify({ roomType: 'dm', scope: 'all', isMuted: true, isDnd: false })).toBe(false)
  })

  it('방해금지(dnd) 상태면 뮤트 여부와 무관하게 항상 억제한다', () => {
    expect(shouldNotify({ roomType: 'global', scope: 'all', isMuted: false, isDnd: true })).toBe(false)
  })

  it("scope='off' 이면 항상 억제한다", () => {
    expect(shouldNotify({ roomType: 'dm', scope: 'off', isMuted: false, isDnd: false })).toBe(false)
    expect(shouldNotify({ roomType: 'global', scope: 'off', isMuted: false, isDnd: false })).toBe(false)
  })

  it("scope='dm' 이면 DM 은 허용하고 전체채팅은 억제한다", () => {
    expect(shouldNotify({ roomType: 'dm', scope: 'dm', isMuted: false, isDnd: false })).toBe(true)
    expect(shouldNotify({ roomType: 'global', scope: 'dm', isMuted: false, isDnd: false })).toBe(false)
  })

  it("scope='all' 이면 전체채팅/DM 모두 허용한다(뮤트/DND 아닐 때)", () => {
    expect(shouldNotify({ roomType: 'global', scope: 'all', isMuted: false, isDnd: false })).toBe(true)
    expect(shouldNotify({ roomType: 'dm', scope: 'all', isMuted: false, isDnd: false })).toBe(true)
  })
})

describe('maskNotificationBody — 본문 숨김', () => {
  it('hideBody 가 true 면 실제 내용 대신 고정 문구를 반환한다', () => {
    expect(maskNotificationBody(true, '비밀 회의 자료입니다')).toBe('새 메시지')
  })

  it('hideBody 가 false 면 실제 내용을 그대로 반환한다', () => {
    expect(maskNotificationBody(false, '안녕하세요')).toBe('안녕하세요')
  })
})

describe('resolveNotificationDecision — ctx/DB 통합 판정', () => {
  let db
  beforeEach(async () => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    await saveProfile(db, { username: 'test', nickname: '테스트', password: 'pw123' })
  })
  afterEach(() => closeDatabase(db))

  function buildCtx(mutedRoomKeys = []) {
    return { state: { database: db, mutedRoomKeySet: new Set(mutedRoomKeys) } }
  }

  it('기본값(scope=all, hideBody=false, 뮤트 없음, 방해금지 아님) — 알림을 보낸다', () => {
    const ctx = buildCtx()
    const result = resolveNotificationDecision(ctx, { roomType: 'global', roomKey: 'global', fallbackBody: '안녕' })
    expect(result.notify).toBe(true)
    expect(result.body).toBe('안녕')
  })

  it('뮤트된 방은 알림을 억제한다', () => {
    const ctx = buildCtx(['peer-a'])
    const result = resolveNotificationDecision(ctx, { roomType: 'dm', roomKey: 'peer-a', fallbackBody: '안녕' })
    expect(result.notify).toBe(false)
  })

  it('내 상태가 dnd 이면 뮤트 여부와 무관하게 알림을 억제한다', () => {
    updateStatus(db, { statusType: 'dnd', statusMessage: '집중 중' })
    const ctx = buildCtx()
    const result = resolveNotificationDecision(ctx, { roomType: 'dm', roomKey: 'peer-a', fallbackBody: '안녕' })
    expect(result.notify).toBe(false)
  })

  it("notification_scope='dm' 저장 시 전체채팅 알림은 억제되고 DM 은 허용된다", () => {
    db.prepare('UPDATE profile SET notification_scope = ? WHERE id = 1').run('dm')
    const ctx = buildCtx()
    expect(resolveNotificationDecision(ctx, { roomType: 'global', roomKey: 'global', fallbackBody: 'x' }).notify).toBe(false)
    expect(resolveNotificationDecision(ctx, { roomType: 'dm', roomKey: 'peer-a', fallbackBody: 'x' }).notify).toBe(true)
  })

  it('notification_hide_body 가 켜져 있으면 본문을 마스킹한다', () => {
    db.prepare('UPDATE profile SET notification_hide_body = 1 WHERE id = 1').run()
    const ctx = buildCtx()
    const result = resolveNotificationDecision(ctx, { roomType: 'global', roomKey: 'global', fallbackBody: '민감한 내용' })
    expect(result.notify).toBe(true)
    expect(result.body).toBe('새 메시지')
  })

  it('database 가 아직 없으면(로그인 전) 기본값으로 안전하게 동작한다', () => {
    const ctx = { state: { database: null, mutedRoomKeySet: new Set() } }
    const result = resolveNotificationDecision(ctx, { roomType: 'global', roomKey: 'global', fallbackBody: '안녕' })
    expect(result.notify).toBe(true)
    expect(result.body).toBe('안녕')
  })
})
