const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { initDatabase, closeDatabase } = require('../../electron/storage/database')
const { migrateLanpetDatabase } = require('../../electron/lanpet/migrations')
const { createLanpetStore } = require('../../electron/lanpet/store')

function createPet(timestamp) {
  return {
    petId: 'pet_storage',
    generationId: 'generation_storage',
    ownerInstallationId: 'owner_storage',
    name: 'Lumi',
    temperament: 'balanced',
    stage: 'seed',
    appearanceId: 'seed-balanced-a',
    care: 70,
    joy: 70,
    energy: 80,
    bond: 0,
    growthPoints: 0,
    careBias: 0,
    socialBias: 0,
    lifecycleState: 'active',
    bornAt: timestamp,
    stageChangedAt: timestamp,
    lastEvaluatedAt: timestamp,
    lastPetInteractionAt: timestamp,
    careRemainderMinutes: 0,
    joyRemainderMinutes: 0,
    energyRemainderMinutes: 0,
    growthAgeMinutes: 0,
    napEndsAt: null,
    stateRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('Lanpet encrypted storage', () => {
  let directory
  let db

  afterEach(() => {
    if (db && db.open) closeDatabase(db)
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
    db = null
    directory = null
  })

  test('migration is idempotent and creates the complete durable schema', () => {
    db = initDatabase(':memory:')
    migrateLanpetDatabase(db, 1000)
    migrateLanpetDatabase(db, 2000)
    const names = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lanpet_%' ORDER BY name
    `).all().map(row => row.name)
    expect(names).toEqual(expect.arrayContaining([
      'lanpet_events',
      'lanpet_generations',
      'lanpet_gift_ledger',
      'lanpet_inbox',
      'lanpet_inventory',
      'lanpet_outbox',
      'lanpet_pets',
      'lanpet_protocol_records',
      'lanpet_reward_ledger',
      'lanpet_sessions',
      'lanpet_settings',
    ]))
    expect(db.prepare('SELECT version FROM lanpet_schema WHERE singleton_id = 1').get().version).toBe(1)
    expect(createLanpetStore(db).getSettings()).toMatchObject({
      enabled: false,
      sharingEnabled: false,
      notificationsEnabled: false,
      workHours: { startHour: 9, endHour: 18, weekdays: [1, 2, 3, 4, 5] },
    })
  })

  test('persists the pet and protocol records across an encrypted restart', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lanpet-storage-'))
    const databasePath = path.join(directory, 'lan-chat.db')
    const key = crypto.randomBytes(32)
    const timestamp = new Date(2026, 8, 7, 10).getTime()

    db = initDatabase(databasePath, key)
    let store = createLanpetStore(db, { now: () => timestamp })
    store.transaction(() => {
      store.createGeneration('generation_storage', timestamp)
      store.createPet(createPet(timestamp))
      store.setProtocolRecord('sessions', 'session_1', { status: 'resultUnknown', activity: 'battle' }, {
        now: timestamp,
        expiresAt: timestamp + 24 * 60 * 60 * 1000,
      })
    })
    closeDatabase(db)
    db = null

    expect(fs.readFileSync(databasePath).slice(0, 16).toString('utf8').startsWith('SQLite format 3')).toBe(false)

    db = initDatabase(databasePath, key)
    store = createLanpetStore(db, { now: () => timestamp })
    expect(store.getPet()).toMatchObject({ name: 'Lumi', generationId: 'generation_storage' })
    expect(store.getProtocolRecord('sessions', 'session_1')).toMatchObject({
      activity: 'battle',
      status: 'resultUnknown',
    })
  })

  test('keeps a deleted generation tombstone while removing mutable pet data', () => {
    const now = new Date(2026, 8, 7, 10).getTime()
    db = initDatabase(':memory:')
    const store = createLanpetStore(db, { now: () => now })
    store.transaction(() => {
      store.createGeneration('generation_storage', now)
      store.createPet(createPet(now))
      store.deleteGeneration('generation_storage', now + 1)
      store.removePet('pet_storage')
    })
    expect(store.getPet()).toBeNull()
    expect(store.getGeneration('generation_storage')).toMatchObject({ status: 'deleted', deletedAt: now + 1 })
  })

  test('enforces reward idempotency and a rolling 24-hour total', () => {
    const now = new Date(2026, 8, 7, 10).getTime()
    db = initDatabase(':memory:')
    const store = createLanpetStore(db, { now: () => now })
    store.createGeneration('generation_storage', now)
    store.createPet(createPet(now))
    const entry = {
      ledgerId: 'ledger_1',
      petId: 'pet_storage',
      eventId: 'event_1',
      rewardType: 'bond',
      amount: 2,
      sourceType: 'local',
      createdAt: now,
    }
    expect(store.addReward(entry)).toBe(true)
    expect(store.addReward({ ...entry, ledgerId: 'ledger_2' })).toBe(false)
    expect(store.getRollingEarned('pet_storage', now).bond).toBe(2)
    expect(store.getRollingEarned('pet_storage', now + 24 * 60 * 60 * 1000 + 1).bond).toBe(0)
  })

  test('removes expired gift tombstones after the 90-day retention window', () => {
    const now = new Date(2026, 8, 7, 10).getTime()
    db = initDatabase(':memory:')
    const store = createLanpetStore(db, { now: () => now })
    store.addGiftRecord({
      eventId: 'gift_old',
      direction: 'received',
      peerId: 'peer_old',
      itemType: 'friendshipStar',
      status: 'issued',
      expiresAt: now - 1,
      createdAt: now - 91 * 24 * 60 * 60 * 1000,
    })
    expect(db.prepare('SELECT COUNT(*) AS total FROM lanpet_gift_ledger').get().total).toBe(1)
    expect(store.cleanupRetention(now).gifts).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS total FROM lanpet_gift_ledger').get().total).toBe(0)
  })
})
