const { initDatabase, closeDatabase } = require('../../electron/storage/database')
const { createLanpetService, getLanpetService, disposeLanpetService } = require('../../electron/lanpet/service')

function at(hour, minute = 0) {
  return new Date(2026, 8, 7, hour, minute, 0, 0).getTime()
}

function contextWith(database) {
  return { state: { database, peerId: 'owner_peer' } }
}

function silentProtocolFactory() {
  return {
    command: () => ({ ok: true }),
    getSnapshot: () => ({ peers: [], invitations: [], sessions: [], history: [] }),
    refreshVisibility: () => {},
    dispose: () => {},
  }
}

describe('Lanpet service', () => {
  let db
  let secondDb

  afterEach(() => {
    if (db && db.open) closeDatabase(db)
    if (secondDb && secondDb.open) closeDatabase(secondDb)
    db = null
    secondDb = null
  })

  test('creates a private pet and applies an idempotent care command', () => {
    let now = at(10)
    db = initDatabase(':memory:')
    const ctx = contextWith(db)
    let id = 0
    const service = createLanpetService(ctx, {
      now: () => now,
      randomId: prefix => `${prefix}_${++id}`,
      protocolFactory: silentProtocolFactory,
    })

    const created = service.command({ type: 'create', name: 'Mori', requestId: 'request_create' })
    expect(created.ok).toBe(true)
    expect(created.snapshot).toMatchObject({ enabled: true, sharingEnabled: false, isWorkingTime: true })
    expect(created.snapshot.pet).toMatchObject({ name: 'Mori', stage: 'seed', care: 70, energy: 80 })

    now = at(10, 5)
    const input = { type: 'care', action: 'care', requestId: 'request_care' }
    const first = service.command(input)
    const second = service.command(input)
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: true, duplicate: true })
    expect(second.snapshot.pet.energy).toBe(first.snapshot.pet.energy)
    expect(second.snapshot.pet.bond).toBe(first.snapshot.pet.bond)
  })

  test('rejects activity after hours without changing pet state', () => {
    let now = at(10)
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), {
      now: () => now,
      protocolFactory: silentProtocolFactory,
    })
    service.command({ type: 'create', name: 'Mori' })
    const before = service.getSnapshot().pet
    now = at(19)
    const result = service.command({ type: 'care', action: 'play' })
    expect(result).toMatchObject({ ok: false, code: 'OUTSIDE_WORK_HOURS' })
    expect(service.getSnapshot().pet.bond).toBe(before.bond)
  })

  test('keeps paused time frozen after resuming and preserves unfinished work-minute rest', () => {
    let now = at(10)
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), { now: () => now, protocolFactory: silentProtocolFactory })
    service.command({ type: 'create', name: 'Mori' })
    expect(service.command({ type: 'care', action: 'rest' }).ok).toBe(true)
    now = at(10, 10)
    const paused = service.command({ type: 'settings', enabled: false }).snapshot.pet
    now += 7 * 24 * 60 * 60 * 1000
    expect(service.getSnapshot().pet).toEqual(paused)
    const resumed = service.command({ type: 'settings', enabled: true }).snapshot.pet
    expect(resumed).toMatchObject({ care: paused.care, joy: paused.joy, energy: paused.energy,
      growthAgeMinutes: paused.growthAgeMinutes, growthPoints: paused.growthPoints, bond: paused.bond,
      lifecycleState: 'resting', napEndsAt: now + 20 * 60000 })
    now += 20 * 60000
    const completed = service.getSnapshot().pet
    expect(completed.energy).toBe(paused.energy + 12)
    expect(completed.napEndsAt).toBeNull()
  })

  test('does not start a rest while a peer session remains active', () => {
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), { now: () => at(10),
      protocolFactory: () => ({ ...silentProtocolFactory(), hasActiveSession: () => true }) })
    service.command({ type: 'create', name: 'Mori' })
    expect(service.command({ type: 'care', action: 'rest' })).toMatchObject({ ok: false, code: 'SESSION_CONFLICT' })
    expect(service.getSnapshot().pet.napEndsAt).toBeNull()
  })

  test('deletes mutable state and preserves the generation tombstone', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), {
      now: () => now,
      randomId: prefix => `${prefix}_fixed`,
      protocolFactory: silentProtocolFactory,
    })
    service.command({ type: 'create', name: 'Mori' })
    const generationId = service.getSnapshot().pet.generationId
    const result = service.command({ type: 'delete' })
    expect(result.ok).toBe(true)
    expect(result.snapshot).toMatchObject({ enabled: false, sharingEnabled: false, pet: null })
    expect(service.store.getGeneration(generationId).status).toBe('deleted')
  })

  test('blocks a service instance after the authenticated database changes', () => {
    db = initDatabase(':memory:')
    secondDb = initDatabase(':memory:')
    const ctx = contextWith(db)
    const service = createLanpetService(ctx, { now: () => at(10), protocolFactory: silentProtocolFactory })
    service.command({ type: 'create', name: 'Mori' })
    ctx.state.database = secondDb
    expect(service.command({ type: 'settings', sharingEnabled: true })).toMatchObject({
      ok: false,
      code: 'SESSION_STALE',
    })
  })

  test('replaces and disposes cached services on database replacement', () => {
    db = initDatabase(':memory:')
    secondDb = initDatabase(':memory:')
    const ctx = contextWith(db)
    const first = getLanpetService(ctx)
    ctx.state.database = secondDb
    const second = getLanpetService(ctx)
    expect(second).not.toBe(first)
    expect(first.disposed).toBe(true)
    disposeLanpetService(ctx)
    expect(second.disposed).toBe(true)
  })

  test('applies one social gift reward and refuses a duplicate event', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), {
      now: () => now,
      randomId: (() => { let id = 0; return prefix => `${prefix}_${++id}` })(),
      protocolFactory: silentProtocolFactory,
    })
    service.command({ type: 'create', name: 'Mori' })
    service.command({ type: 'settings', sharingEnabled: true })
    const input = { eventId: 'gift_event_1', activity: 'gift', peerId: 'peer_friend', now }
    expect(service.applySocialReward(input)).toMatchObject({ ok: true, duplicate: false })
    expect(service.applySocialReward(input)).toMatchObject({ ok: true, duplicate: true })
    expect(service.getSnapshot().inventory).toEqual([
      expect.objectContaining({ itemType: 'friendshipStar', quantity: 1 }),
    ])
  })

  test('reserves session energy before allowing a local action', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const protocolFactory = () => ({
      ...silentProtocolFactory(),
      getReservedEnergy: () => 75,
    })
    const service = createLanpetService(contextWith(db), { now: () => now, protocolFactory })
    service.command({ type: 'create', name: 'Mori' })
    expect(service.command({ type: 'care', action: 'play' })).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_ENERGY',
    })
    expect(service.getSnapshot().pet.energy).toBe(80)
  })

  test('persists activity permissions and blocked peers separately from chat state', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const service = createLanpetService(contextWith(db), { now: () => now, protocolFactory: silentProtocolFactory })
    service.command({ type: 'create', name: 'Mori' })
    const result = service.command({
      type: 'settings',
      sharingEnabled: true,
      allowGift: false,
      allowBattle: false,
      blockedPeerIds: ['peer_blocked'],
    })
    expect(result.snapshot).toMatchObject({ sharingEnabled: true })
    expect(service.getSettings()).toMatchObject({
      allowVisit: true,
      allowCooperativePlay: true,
      allowGift: false,
      allowBattle: false,
      blockedPeerIds: ['peer_blocked'],
    })
  })

  test('settles an accepted canonical result after sharing is disabled', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const ctx = contextWith(db)
    const service = createLanpetService(ctx, {
      now: () => now,
      randomId: (() => { let id = 0; return prefix => `${prefix}_${++id}` })(),
      protocolFactory: silentProtocolFactory,
    })
    service.command({ type: 'create', name: 'Mori' })
    service.command({ type: 'settings', sharingEnabled: true })
    const generationId = service.getLocalPet().generationId
    service.setProtocolRecord('sessions', 'session_settlement', {
      sessionId: 'session_settlement',
      status: 'completed',
      generations: { owner_peer: generationId, peer_friend: 'generation_remote' },
      certificate: { decision: 'result', eventId: 'event_settlement' },
    })
    service.command({ type: 'settings', sharingEnabled: false })
    const result = service.applySocialReward({
      eventId: 'event_settlement',
      activity: 'visit',
      peerId: 'peer_friend',
      settlement: true,
      sessionId: 'session_settlement',
      generationId,
      now,
    })
    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(result.pet).toMatchObject({ joy: 74, bond: 1, growthPoints: 1 })
  })

  test('prepares deletion while the pet generation is still readable and flushes after commit', () => {
    const now = at(10)
    db = initDatabase(':memory:')
    const observations = []
    let service
    const protocolFactory = () => ({
      ...silentProtocolFactory(),
      prepareDelete: () => observations.push(`prepare:${service.getLocalPet().generationId}`),
      flush: () => observations.push(`flush:${service.getLocalPet() === null}`),
    })
    service = createLanpetService(contextWith(db), {
      now: () => now,
      randomId: prefix => `${prefix}_delete`,
      protocolFactory,
    })
    service.command({ type: 'create', name: 'Mori' })
    expect(service.command({ type: 'delete' }).ok).toBe(true)
    expect(observations).toEqual(['prepare:generation_delete', 'flush:true'])
  })
})
