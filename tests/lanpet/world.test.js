const crypto = require('crypto')
const { initDatabase, closeDatabase } = require('../../electron/storage/database')
const { createLanpetService } = require('../../electron/lanpet/service')
const { SPECIES, speciesFromSeed } = require('../../electron/lanpet/world')

describe('Lanpet world durable progression and economy', () => {
  let db, service, now, counter
  const factory = () => ({ getSnapshot: () => ({}), dispose() {} })
  const send = input => service.command({ requestId: `world-${++counter}`, ...input })
  beforeEach(() => {
    now = new Date(2026, 8, 8, 10).getTime()
    counter = 0
    db = initDatabase(':memory:')
    service = createLanpetService({ state: { database: db, peerId: 'owner' } }, { now: () => now, protocolFactory: factory })
    expect(send({ type: 'create', name: '친구' }).ok).toBe(true)
  })
  afterEach(() => { service.dispose(); closeDatabase(db); jest.restoreAllMocks() })

  test('has six deterministic base species with three unique final branches each', () => {
    expect(new Set(Array.from({ length: 200 }, (_, index) => speciesFromSeed(String(index)).id)).size).toBe(6)
    expect(SPECIES).toHaveLength(6)
    expect(new Set(SPECIES.flatMap(species => species.branches)).size).toBe(18)
    expect(speciesFromSeed('persisted')).toEqual(speciesFromSeed('persisted'))
  })
  test('preserves the seed, purchased room, and wallet across service restart and long retention', () => {
    const before = service.getSnapshot().pet
    expect(send({ type: 'buy', itemId: 'rose' }).ok).toBe(true)
    expect(send({ type: 'equip', itemId: 'rose' }).ok).toBe(true)
    service.dispose()
    service = createLanpetService({ state: { database: db, peerId: 'owner' } }, { now: () => now, protocolFactory: factory })
    service.store.cleanupRetention(now + 100 * 86400000)
    expect(service.getSnapshot().pet.speciesId).toBe(before.speciesId)
    expect(service.getSnapshot().world).toMatchObject({ balance: 40, room: { wall: 'rose' } })
  })
  test('feeding affects the tree and consumes one item despite duplicate requests', () => {
    const input = { type: 'feed', itemId: 'rice', requestId: 'one-meal' }
    const before = service.getSnapshot().pet
    expect(send(input).ok).toBe(true)
    expect(send(input).duplicate).toBe(true)
    const snapshot = service.getSnapshot()
    expect(snapshot.world.bag.rice).toBe(2)
    expect(snapshot.pet.care).toBe(before.care + 14)
    expect(snapshot.pet.tree.find(branch => branch.id === 'care').score).toBe(3)
    expect(send({ type: 'feed', itemId: 'rice' }).code).toBe('WORLD_COOLDOWN')
    expect(service.getSnapshot().world.bag.rice).toBe(2)
  })
  test('prevents overspending, unknown items, unowned equipment and repeat furniture purchases', () => {
    expect(send({ type: 'buy', itemId: 'castle' }).code).toBe('NOT_ENOUGH_COINS')
    expect(send({ type: 'equip', itemId: 'castle' }).code).toBe('ITEM_NOT_OWNED')
    expect(send({ type: 'buy', itemId: 'invalid', price: -999 }).ok).toBe(false)
    expect(service.getSnapshot().world.balance).toBe(100)
    expect(send({ type: 'buy', itemId: 'sofa' }).ok).toBe(true)
    expect(send({ type: 'buy', itemId: 'sofa' }).code).toBe('ITEM_ALREADY_OWNED')
    expect(service.getSnapshot().world.balance).toBe(0)
    expect(send({ type: 'feed', itemId: 'snack' }).ok).toBe(true)
  })
  test.each([[0, 10], [59, 10], [60, 20], [89, 20], [90, 50], [98, 50], [99, 100]])('lottery draw %i follows published odds and cannot be replayed', (roll, reward) => {
    const random = jest.spyOn(crypto, 'randomInt').mockReturnValue(roll)
    const input = { type: 'lottery', requestId: 'one-ticket' }
    expect(send(input).snapshot.world.balance).toBe(100 + reward)
    expect(send(input).duplicate).toBe(true)
    expect(send({ type: 'lottery' }).code).toBe('LOTTERY_LIMIT')
    expect(random).toHaveBeenCalledTimes(1)
  })
  test('deleting a pet cannot reset the wallet, lottery eligibility or game quota', () => {
    send({ type: 'lottery' })
    send({ type: 'gameStart', kind: 'race' })
    const balance = service.getSnapshot().world.balance
    expect(send({ type: 'delete' }).ok).toBe(true)
    expect(service.world.read().progress).toBeNull()
    expect(send({ type: 'create', name: '새 친구' }).ok).toBe(true)
    expect(service.getSnapshot().world.balance).toBe(balance)
    expect(service.getSnapshot().world.gamePlaysRemaining).toBe(4)
    expect(send({ type: 'lottery' }).code).toBe('LOTTERY_LIMIT')
  })
  test.each(['race', 'memory'])('%s validates each round, pays once, and caps combined daily starts', kind => {
    expect(send({ type: 'gameStart', kind }).ok).toBe(true)
    const initial = service.getSnapshot().world.game
    expect(initial).not.toHaveProperty('targets')
    expect(send({ type: 'gameStart', kind }).code).toBe('SESSION_CONFLICT')
    expect(send({ type: 'gameAction', gameId: initial.id, round: 0, choice: initial.target }).code).toBe('GAME_TOO_FAST')
    for (let round = 0; round < 5; round++) {
      now += 1200
      const game = service.getSnapshot().world.game
      expect(send({ type: 'gameAction', gameId: game.id, round, choice: 99 }).code).toBe('INVALID_GAME_INPUT')
      expect(send({ type: 'gameAction', gameId: game.id, round, choice: game.target }).ok).toBe(true)
    }
    expect(service.getSnapshot().world).toMatchObject({ balance: 120, game: { status: 'completed', score: 5, reward: 20 } })
    expect(send({ type: 'gameAction', gameId: initial.id, round: 4, choice: 0 }).code).toBe('GAME_NOT_ACTIVE')
    for (let index = 0; index < 4; index++) { expect(send({ type: 'gameStart', kind }).ok).toBe(true); now += 61000 }
    expect(send({ type: 'gameStart', kind }).code).toBe('GAME_LIMIT')
    expect(service.getSnapshot().world.balance).toBe(120)
  })
  test('only the leading branch can evolve and final evolution remains fixed', () => {
    send({ type: 'buy', itemId: 'berry' })
    send({ type: 'feed', itemId: 'berry' })
    let pet = service.store.getPet()
    service.store.savePet({ ...pet, growthPoints: 200, bond: 80, growthAgeMinutes: 4000 })
    let choice = service.getSnapshot().pet.growthChoices[0]
    expect(choice.family).toBe('active')
    expect(send({ type: 'grow', choiceId: 'grown.calm.a' }).code).toBe('GROWTH_NOT_AVAILABLE')
    expect(send({ type: 'grow', choiceId: choice.choiceId }).ok).toBe(true)
    choice = service.getSnapshot().pet.growthChoices[0]
    expect(send({ type: 'grow', choiceId: choice.choiceId }).ok).toBe(true)
    now += 600000
    send({ type: 'feed', itemId: 'rice' })
    expect(service.getSnapshot().pet).toMatchObject({ stage: 'grown', branch: 'active', growthChoices: [] })
  })
  test('office hours, naps and backwards clocks block economy changes', () => {
    const balance = service.getSnapshot().world.balance
    now = new Date(2026, 8, 8, 19).getTime()
    expect(send({ type: 'lottery' }).code).toBe('OUTSIDE_WORK_HOURS')
    now = new Date(2026, 8, 8, 9).getTime()
    expect(send({ type: 'buy', itemId: 'rice' }).code).toBe('CLOCK_ROLLBACK')
    now = new Date(2026, 8, 8, 11).getTime()
    send({ type: 'care', action: 'rest' })
    expect(send({ type: 'buy', itemId: 'rice' }).code).toBe('PET_UNAVAILABLE')
    expect(service.getSnapshot().world.balance).toBe(balance)
  })
  test('social settlement pays at most three rewards and rejects duplicate events', () => {
    send({ type: 'settings', sharingEnabled: true })
    const input = { activity: 'visit', peerId: 'peer', eventId: 'social-1' }
    service.applySocialReward(input)
    service.applySocialReward(input)
    for (let index = 2; index <= 5; index++) service.applySocialReward({ ...input, eventId: `social-${index}` })
    expect(service.getSnapshot().world.balance).toBe(136)
  })
})
