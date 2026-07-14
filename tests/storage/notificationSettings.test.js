// tests/storage/notificationSettings.test.js
// 알림 설정 저장/조회 — 알림 범위(scope)/본문 숨김(hideBody) 필드 확장(#42).
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile, getNotificationSettings, saveNotificationSettings } = require('../../electron/storage/profile')

describe('알림 설정 — scope/hideBody', () => {
  let db
  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveProfile(db, { username: 'test', nickname: '테스트', password: 'pw123' })
  })
  afterEach(() => closeDatabase(db))

  it('기본값은 scope=all, hideBody=false 이다', () => {
    const settings = getNotificationSettings(db, '/tmp')
    expect(settings.scope).toBe('all')
    expect(settings.hideBody).toBe(false)
  })

  it('scope/hideBody 를 저장하면 그대로 조회된다', () => {
    saveNotificationSettings(db, { sound: 'notification2', volume: 0.5, scope: 'dm', hideBody: true })
    const settings = getNotificationSettings(db, '/tmp')
    expect(settings.sound).toBe('notification2')
    expect(settings.volume).toBe(0.5)
    expect(settings.scope).toBe('dm')
    expect(settings.hideBody).toBe(true)
  })

  it('scope/hideBody 를 생략하고 sound/volume 만 저장하면 기존 값이 유지된다', () => {
    saveNotificationSettings(db, { sound: 'notification1', volume: 0.7, scope: 'off', hideBody: true })
    // 볼륨만 바꾸는 기존 호출부 패턴 — scope/hideBody 생략
    saveNotificationSettings(db, { sound: 'notification1', volume: 0.9 })
    const settings = getNotificationSettings(db, '/tmp')
    expect(settings.volume).toBe(0.9)
    expect(settings.scope).toBe('off')
    expect(settings.hideBody).toBe(true)
  })
})
