const crypto = require('crypto')
const Database = require('better-sqlite3-multiple-ciphers')
const { createLanpetStore } = require('../../electron/lanpet/store')
const { createLanpetProtocol, CAPABILITY } = require('../../electron/lanpet/protocol')
const { fingerprint, decryptPetEnvelope, encryptPetEnvelope } = require('../../electron/lanpet/petCrypto')
const { buildHello, WIRE_VERSION } = require('../../electron/peer/wire')
const WebSocket = require('ws')
const { startWsServer } = require('../../electron/peer/wsServer')

function createPair() {
  let timestamp = new Date(2026, 8, 8, 10).getTime()
  const nodes = {}
  const packets = []
  const results = []
  for (const id of ['first', 'second']) {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const db = new Database(':memory:')
    db.prepare('CREATE TABLE test_rewards (event_id TEXT PRIMARY KEY, activity TEXT, cost INTEGER)').run()
    const store = createLanpetStore(db, { now: () => timestamp })
    const settings = { enabled: true, sharingEnabled: true }
    const pet = { petId: id, generationId: `${id}-generation`, name: id, stage: 'seed', energy: 80, appearanceId: 'spark' }
    const node = { id, pair, db, store, settings, pet }
    node.ctx = { state: { peerId: id, pendingKeyChangeMap: new Map(), latestDiscoveredPeerInfoMap: new Map() } }
    node.service = {
      store, getLocalPet: () => pet, getSettings: () => settings, emitChanged: () => {},
      applySocialReward: ({ eventId, activity, cost }) => {
        db.prepare('INSERT OR IGNORE INTO test_rewards VALUES (?, ?, ?)').run(eventId, activity, cost)
        return { ok: true }
      },
    }
    nodes[id] = node
  }
  for (const node of Object.values(nodes)) {
    node.identityFor = peerId => {
      if (node.ctx.state.pendingKeyChangeMap.has(peerId)) throw new Error('PEER_KEY_CHANGED')
      return {
        localPeerId: node.id, peerId, privateKey: node.pair.privateKey, peerPublicKey: nodes[peerId].pair.publicKey,
        localFingerprint: fingerprint(node.pair.publicKey), peerFingerprint: fingerprint(nodes[peerId].pair.publicKey),
      }
    }
    node.start = ({ autoRecover = false } = {}) => {
      node.protocol = createLanpetProtocol({
        ctx: node.ctx, service: node.service, now: () => timestamp, autoRecover,
        identityFor: node.identityFor, connectedPeerIds: () => Object.keys(nodes).filter(id => id !== node.id),
        send: (peerId, wrapper) => { packets.push({ peerId, wrapper }); return true },
      })
    }
    node.start()
  }
  function deliver(filter = () => true) {
    let count = 0
    while (packets.length) {
      if (++count > 200) throw new Error('PACKET_LOOP')
      const packet = packets.shift()
      if (filter(packet)) results.push(nodes[packet.peerId].protocol.receive(packet.wrapper))
    }
  }
  function command(node, input) {
    const result = nodes[node].protocol.command({ ...input, requestId: crypto.randomUUID() })
    deliver()
    return result
  }
  function invite(activity) {
    const { sessionId } = command('first', { type: 'invite', peerId: 'second', activity })
    command('second', { type: 'respond', sessionId, response: 'accept' })
    return sessionId
  }
  nodes.first.protocol.onPeerHello('second', [CAPABILITY])
  nodes.second.protocol.onPeerHello('first', [CAPABILITY])
  deliver()
  return {
    nodes, packets, results, deliver, command, invite,
    now: () => timestamp,
    advance: amount => { timestamp += amount },
    rewards: id => nodes[id].db.prepare('SELECT * FROM test_rewards').all(),
    close: () => { for (const node of Object.values(nodes)) { node.protocol.dispose(); node.db.close() } },
  }
}

describe('Lanpet durable two-owner protocol', () => {
  let pair
  beforeEach(() => { pair = createPair() })
  afterEach(() => pair.close())

  test('keeps wire v2 and hides capability until sharing consent', () => {
    const input = { peerId: 'first', sessionId: 'session', publicKey: 'key', nickname: 'Name', wsPort: 1 }
    expect(WIRE_VERSION).toBe(2)
    expect(buildHello(input).capabilities).not.toContain(CAPABILITY)
    expect(buildHello({ ...input, lanpetSharingEnabled: true }).capabilities).toContain(CAPABILITY)
    expect(pair.nodes.first.protocol.getSnapshot().peers[0].available).toBe(true)
  })

  test('requires both owners to complete a visit', () => {
    const sessionId = pair.invite('visit')
    pair.command('first', { type: 'action', sessionId, choice: 'focus' })
    expect(pair.rewards('first')).toHaveLength(0)
    pair.command('second', { type: 'action', sessionId, choice: 'spark' })
    expect(pair.rewards('first')).toHaveLength(1)
    expect(pair.rewards('second')).toHaveLength(1)
    expect(pair.nodes.first.protocol.getSnapshot().history[0].status).toBe('completed')
    expect(pair.results.filter(result => !result.ok)).toEqual([])
  })

  test('compacts settled details after 30 days and retains duplicate protection until day 90', () => {
    const sessionId = pair.invite('visit')
    pair.command('first', { type: 'action', sessionId, choice: 'focus' })
    pair.command('second', { type: 'action', sessionId, choice: 'spark' })
    const node = pair.nodes.first
    const guest = pair.nodes.second
    const resultEnvelope = node.store.listProtocolRecords('outbox').find(entry => entry.envelope.messageType === 'result').envelope
    // 다른 재전송의 ACK가 정산을 확정했어도 이전 전송 시도에는 pending이 남을 수 있다.
    const pendingReplayId = crypto.randomUUID()
    node.store.setProtocolRecord('outbox', pendingReplayId, { envelope: { ...resultEnvelope, eventId: pendingReplayId }, peerId: 'second', status: 'pending' })
    pair.advance(45 * 86400000)
    node.store.cleanupRetention(pair.now())
    guest.store.cleanupRetention(pair.now())
    expect(node.store.getProtocolRecord('sessions', sessionId)).toMatchObject({ tombstone: true, status: 'completed' })
    for (const owner of [node, guest]) {
      const session = owner.store.getProtocolRecord('sessions', sessionId)
      expect(session.peerName).toBeUndefined()
      expect(session.rounds).toBeUndefined()
      expect(session.inputs).toBeUndefined()
      expect(session.certificate).toBeUndefined()
      expect(owner.protocol.getSnapshot().history).toHaveLength(0)
      expect(owner.store.listProtocolRecords('outbox').every(entry => entry.tombstone && !entry.envelope.payload)).toBe(true)
    }
    const replay = { ...resultEnvelope, eventId: crypto.randomUUID(), requestId: crypto.randomUUID(), createdAt: pair.now(), expiresAt: pair.now() + 60000 }
    expect(guest.protocol.receive({ type: 'lanpet', fromId: 'first', to: 'second', encryptedPayload: encryptPetEnvelope(replay, node.identityFor('second')) })).toMatchObject({ ok: true })
    expect(pair.rewards('second')).toHaveLength(1)
    pair.advance(46 * 86400000)
    node.store.cleanupRetention(pair.now())
    guest.store.cleanupRetention(pair.now())
    expect(node.store.getProtocolRecord('sessions', sessionId)).toBeNull()
    expect(guest.store.getProtocolRecord('sessions', sessionId)).toBeNull()
    expect(node.store.listProtocolRecords('outbox')).toHaveLength(0)
  })

  test('preserves unresolved canonical results and guest energy reservations beyond 90 days', () => {
    const sessionId = pair.invite('battle')
    for (let turn = 0; turn < 4; turn += 1) {
      pair.command('first', { type: 'action', sessionId, choice: 'focus' })
      pair.command('second', { type: 'action', sessionId, choice: 'spark' })
    }
    pair.command('first', { type: 'action', sessionId, choice: 'focus' })
    pair.nodes.second.protocol.command({ type: 'action', sessionId, choice: 'spark', requestId: crypto.randomUUID() })
    pair.deliver(packet => {
      const target = pair.nodes[packet.peerId]
      return decryptPetEnvelope(packet.wrapper.encryptedPayload, target.identityFor(packet.wrapper.fromId)).messageType !== 'result'
    })
    pair.advance(120 * 86400000)
    for (const node of Object.values(pair.nodes)) node.store.cleanupRetention(pair.now())
    expect(pair.nodes.first.store.getProtocolRecord('sessions', sessionId)).toMatchObject({ status: 'completed', remoteAcknowledged: false, certificate: { decision: 'result' } })
    expect(pair.nodes.first.store.listProtocolRecords('outbox').some(entry => entry.envelope.messageType === 'result' && entry.envelope.payload.certificate)).toBe(true)
    expect(pair.nodes.second.protocol.getReservedEnergy()).toBe(6)
    expect(pair.nodes.second.protocol.hasActiveSession()).toBe(true)
  })

  test('blocks new activity during a scheduled nap while preserving decline and terminal settlement', () => {
    const { first, second } = pair.nodes
    first.pet.napEndsAt = pair.now() + 1800000
    expect(first.protocol.getSnapshot().peers[0].available).toBe(false)
    expect(() => pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })).toThrow('PET_RESTING')
    first.pet.napEndsAt = null
    const { sessionId } = pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })
    expect(first.protocol.hasActiveSession()).toBe(true)
    expect(second.protocol.hasActiveSession()).toBe(true)
    second.pet.napEndsAt = pair.now() + 1800000
    expect(() => pair.command('second', { type: 'respond', sessionId, response: 'accept' })).toThrow('PET_RESTING')
    pair.command('second', { type: 'respond', sessionId, response: 'decline' })
    expect(second.protocol.hasActiveSession()).toBe(false)
  })

  test('runs retention during a long-lived protocol at most once per minute', () => {
    const cleanup = jest.spyOn(pair.nodes.first.store, 'cleanupRetention')
    pair.nodes.first.protocol.recover()
    pair.nodes.first.protocol.recover()
    pair.advance(59000)
    pair.nodes.first.protocol.recover()
    expect(cleanup).toHaveBeenCalledTimes(1)
    pair.advance(1000)
    pair.nodes.first.protocol.recover()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  test('stops automatic recovery after the underlying database closes', () => {
    const node = pair.nodes.first
    node.protocol.dispose()
    jest.useFakeTimers()
    try {
      node.start({ autoRecover: true })
      const cleanup = jest.spyOn(node.store, 'cleanupRetention')
      node.db.close()
      expect(() => jest.advanceTimersByTime(2000)).not.toThrow()
      expect(() => jest.advanceTimersByTime(120000)).not.toThrow()
      expect(cleanup).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      node.protocol.dispose()
      jest.useRealTimers()
    }
  })

  test('checks the service session before attempting timed retention cleanup', () => {
    const node = pair.nodes.first
    node.protocol.dispose()
    jest.useFakeTimers()
    try {
      node.start({ autoRecover: true })
      const cleanup = jest.spyOn(node.store, 'cleanupRetention')
      jest.spyOn(node.service, 'getLocalPet').mockImplementation(() => { throw new Error('DATABASE_CLOSED') })
      expect(() => jest.advanceTimersByTime(2000)).not.toThrow()
      expect(cleanup).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      node.protocol.dispose()
      jest.useRealTimers()
    }
  })

  test('plays five actual battle turns and validates deterministic scores', () => {
    const sessionId = pair.invite('battle')
    for (let turn = 0; turn < 5; turn += 1) {
      pair.command('first', { type: 'action', sessionId, choice: 'focus' })
      pair.command('second', { type: 'action', sessionId, choice: 'spark' })
    }
    expect(pair.nodes.first.protocol.getSnapshot().history[0].result).toEqual({ outcome: 'win', ownScore: 5, peerScore: 0 })
    expect(pair.nodes.second.protocol.getSnapshot().history[0].result.outcome).toBe('loss')
    expect(pair.rewards('first')[0].cost).toBe(6)
    expect(pair.rewards('second')[0].cost).toBe(6)
    expect(pair.nodes.first.protocol.getReservedEnergy()).toBe(0)
    expect(pair.results.filter(result => !result.ok)).toEqual([])
  })

  test('battle timeout records rest rather than simulating a player action', () => {
    const sessionId = pair.invite('battle')
    for (let turn = 0; turn < 5; turn += 1) {
      pair.command('first', { type: 'action', sessionId, choice: 'focus' })
      pair.advance(15001)
      pair.nodes.first.protocol.recover()
      pair.deliver()
    }
    expect(pair.nodes.second.protocol.getSnapshot().history[0].result.outcome).toBe('loss')
    expect(pair.nodes.second.protocol.getSnapshot().history[0].lastRound.ownChoice).toBe('rest')
    expect(pair.results.filter(result => !result.ok)).toEqual([])
  })

  test('lost result ACK is replayed after restart without a second reward', () => {
    const sessionId = pair.invite('visit')
    pair.command('first', { type: 'action', sessionId, choice: 'focus' })
    pair.nodes.second.protocol.command({ type: 'action', sessionId, choice: 'guard', requestId: crypto.randomUUID() })
    pair.deliver(packet => {
      const target = pair.nodes[packet.peerId]
      const envelope = decryptPetEnvelope(packet.wrapper.encryptedPayload, target.identityFor(packet.wrapper.fromId))
      return !(packet.peerId === 'first' && envelope.messageType === 'ack' && envelope.payload.eventId === pair.nodes.first.store.listProtocolRecords('outbox').find(entry => entry.envelope.messageType === 'result')?.envelope.eventId)
    })
    expect(pair.rewards('second')).toHaveLength(1)
    pair.nodes.first.protocol.dispose()
    pair.nodes.first.start()
    pair.advance(31000)
    pair.nodes.first.protocol.recover()
    pair.deliver()
    expect(pair.rewards('first')).toHaveLength(1)
    expect(pair.rewards('second')).toHaveLength(1)
    expect(pair.nodes.first.protocol.getSnapshot().history[0].settlementPending).toBe(false)
  })

  test('gift issues only one receiver souvenir and never debits a sender inventory', () => {
    pair.invite('gift')
    expect(pair.rewards('first')).toEqual([])
    expect(pair.rewards('second')).toHaveLength(1)
    expect(pair.rewards('second')[0]).toMatchObject({ activity: 'gift', cost: 0 })
    expect(pair.results.filter(result => !result.ok)).toEqual([])
  })

  test('blocks pending key changes and old identity outbox after replacement', () => {
    pair.nodes.first.ctx.state.pendingKeyChangeMap.set('second', 'changed')
    expect(() => pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })).toThrow('PEER_KEY_CHANGED')
    expect(pair.nodes.first.protocol.getSnapshot().peers[0].available).toBe(false)
  })

  test('refuses invitations outside office hours while processing existing result ACKs', () => {
    pair.advance(8 * 3600000)
    expect(() => pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })).toThrow('OUTSIDE_WORK_HOURS')
  })

  test('blocks peer activity and advertising while preserving the chat capability contract', () => {
    pair.nodes.first.settings.blockedPeerIds = ['second']
    expect(pair.nodes.first.protocol.getSnapshot().peers[0]).toMatchObject({ blocked: true, available: false })
    expect(() => pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })).toThrow('PEER_BLOCKED')
    pair.nodes.first.protocol.onPeerHello('second', [CAPABILITY])
    expect(pair.packets).toHaveLength(0)
  })

  test('rejects conflicting payload under an already consumed request ID', () => {
    const { sessionId } = pair.command('first', { type: 'invite', peerId: 'second', activity: 'visit' })
    const original = pair.nodes.first.store.listProtocolRecords('outbox').find(entry => entry.envelope.sessionId === sessionId).envelope
    const altered = { ...original, payload: { activity: 'battle' } }
    const wrapper = { type: 'lanpet', fromId: 'first', to: 'second', encryptedPayload: encryptPetEnvelope(altered, pair.nodes.first.identityFor('second')) }
    expect(pair.nodes.second.protocol.receive(wrapper)).toMatchObject({ ok: false, error: 'REQUEST_ID_CONFLICT' })
    expect(pair.nodes.second.protocol.getSnapshot().invitations).toHaveLength(1)
  })

  test('rolls back canonical decision and reward together on a storage failure', () => {
    const sessionId = pair.invite('visit')
    pair.command('second', { type: 'action', sessionId, choice: 'focus' })
    const original = pair.nodes.first.service.applySocialReward
    pair.nodes.first.service.applySocialReward = input => { original(input); throw new Error('DISK_FAILURE') }
    expect(() => pair.command('first', { type: 'action', sessionId, choice: 'guard' })).toThrow('DISK_FAILURE')
    expect(pair.rewards('first')).toHaveLength(0)
    expect(pair.nodes.first.store.getProtocolRecord('sessions', sessionId).certificate).toBeUndefined()
    pair.nodes.first.service.applySocialReward = original
    pair.command('first', { type: 'action', sessionId, choice: 'guard' })
    expect(pair.rewards('first')).toHaveLength(1)
    expect(pair.rewards('second')).toHaveLength(1)
  })

  test('does not resurrect a revoked summary by replaying its old ciphertext', () => {
    pair.nodes.first.protocol.onPeerHello('second', [CAPABILITY])
    const oldSummary = pair.packets.find(packet => packet.peerId === 'second').wrapper
    pair.deliver()
    pair.nodes.first.settings.sharingEnabled = false
    pair.nodes.first.protocol.refreshVisibility()
    pair.deliver()
    expect(pair.nodes.second.protocol.getSnapshot().peers[0].available).toBe(false)
    expect(pair.nodes.second.protocol.receive(oldSummary)).toMatchObject({ ok: false, error: 'VISIBILITY_REVOKED' })
    expect(pair.nodes.second.protocol.getSnapshot().peers[0].available).toBe(false)
  })

  test('rejects a delayed packet targeting a deleted pet generation', () => {
    pair.nodes.first.protocol.command({ type: 'invite', peerId: 'second', activity: 'visit', requestId: crypto.randomUUID() })
    const packet = pair.packets.shift()
    pair.nodes.second.pet.generationId = 'replacement-generation'
    expect(pair.nodes.second.protocol.receive(packet.wrapper)).toMatchObject({ ok: false, error: 'GENERATION_MISMATCH' })
    expect(pair.nodes.second.protocol.getSnapshot().invitations).toHaveLength(0)
  })

  test('deleting a guest session releases only the deleted generation and lets a new pet play', () => {
    const oldSessionId = pair.invite('cooperativePlay')
    expect(pair.nodes.second.protocol.getReservedEnergy()).toBe(6)
    pair.nodes.second.store.transaction(() => pair.nodes.second.protocol.prepareDelete())
    const tombstone = pair.nodes.second.store.getProtocolRecord('sessions', oldSessionId)
    expect(tombstone).toMatchObject({ status: 'deleted', energyReserved: 0, tombstone: true })
    expect(tombstone.rounds).toBeUndefined()
    expect(tombstone.peerName).toBeUndefined()
    pair.nodes.second.pet.generationId = 'new-generation'
    expect(pair.nodes.second.protocol.getReservedEnergy()).toBe(0)
    pair.deliver()
    pair.nodes.second.protocol.onPeerHello('first', [CAPABILITY])
    pair.nodes.first.protocol.onPeerHello('second', [CAPABILITY])
    pair.deliver()
    const result = pair.command('second', { type: 'invite', peerId: 'first', activity: 'visit' })
    expect(result.ok).toBe(true)
    expect(pair.nodes.first.protocol.getSnapshot().invitations).toHaveLength(1)
  })

  test('allows local deletion when the active peer key is pending approval', () => {
    pair.invite('cooperativePlay')
    pair.nodes.second.ctx.state.pendingKeyChangeMap.set('first', 'changed-key')
    expect(() => pair.nodes.second.store.transaction(() => pair.nodes.second.protocol.prepareDelete())).not.toThrow()
    expect(pair.nodes.second.protocol.getReservedEnergy()).toBe(0)
  })

  test('acknowledges a deleted sender generation without applying rewards to its replacement', () => {
    const sessionId = pair.invite('visit')
    pair.command('second', { type: 'action', sessionId, choice: 'focus' })
    pair.nodes.first.protocol.command({ type: 'action', sessionId, choice: 'guard', requestId: crypto.randomUUID() })
    const oldResult = pair.nodes.first.store.listProtocolRecords('outbox').find(entry => entry.envelope.messageType === 'result')
    pair.nodes.first.store.transaction(() => pair.nodes.first.protocol.prepareDelete())
    pair.nodes.first.pet.generationId = 'replacement-generation'
    pair.deliver()
    expect(pair.nodes.first.store.getProtocolRecord('outbox', oldResult.envelope.eventId)).toBeNull()
    expect(pair.rewards('first')).toHaveLength(1)
    expect(pair.rewards('second')).toHaveLength(1)
    expect(pair.nodes.first.protocol.getReservedEnergy()).toBe(0)
  })

  test('completes a session through the real WebSocket server whitelist and transport', async () => {
    const servers = []
    const clients = {}
    try {
      for (const id of ['first', 'second']) {
        const server = await startWsServer({ onMessage: wrapper => pair.nodes[id].protocol.receive(wrapper), heartbeatInterval: 60000 })
        servers.push(server.server)
        clients[id] = new WebSocket(`ws://127.0.0.1:${server.port}`)
        await new Promise((resolve, reject) => { clients[id].once('open', resolve); clients[id].once('error', reject) })
      }
      async function pumpUntil(condition) {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          while (pair.packets.length) {
            const packet = pair.packets.shift()
            clients[packet.peerId].send(JSON.stringify(packet.wrapper))
          }
          if (condition()) return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('TRANSPORT_TIMEOUT')
      }
      const { sessionId } = pair.nodes.first.protocol.command({ type: 'invite', peerId: 'second', activity: 'visit', requestId: crypto.randomUUID() })
      await pumpUntil(() => pair.nodes.second.protocol.getSnapshot().invitations.length === 1)
      pair.nodes.second.protocol.command({ type: 'respond', sessionId, response: 'accept', requestId: crypto.randomUUID() })
      await pumpUntil(() => pair.nodes.second.protocol.getSnapshot().sessions[0]?.status === 'inProgress')
      pair.nodes.first.protocol.command({ type: 'action', sessionId, choice: 'focus', requestId: crypto.randomUUID() })
      pair.nodes.second.protocol.command({ type: 'action', sessionId, choice: 'spark', requestId: crypto.randomUUID() })
      await pumpUntil(() => pair.rewards('second').length === 1 && pair.nodes.first.protocol.getSnapshot().history[0]?.settlementPending === false)
      expect(pair.rewards('first')).toHaveLength(1)
      expect(pair.rewards('second')).toHaveLength(1)
    } finally {
      for (const client of Object.values(clients)) client.terminate()
      for (const server of servers) {
        for (const client of server.clients) client.terminate()
        await new Promise(resolve => server.close(resolve))
      }
    }
  })

  test('integrates with the actual service and encrypted-store transaction contract', async () => {
    const { createLanpetService } = require('../../electron/lanpet/service')
    for (const node of Object.values(pair.nodes)) {
      node.protocol.dispose()
      node.ctx.state.database = node.db
      node.service = createLanpetService(node.ctx, {
        now: pair.now,
        protocolFactory: options => createLanpetProtocol({ ...options, autoRecover: false, identityFor: node.identityFor,
          connectedPeerIds: () => Object.keys(pair.nodes).filter(id => id !== node.id),
          send: (peerId, wrapper) => { pair.packets.push({ peerId, wrapper }); return true },
        }),
      })
      expect(node.service.command({ type: 'create', name: node.id, requestId: crypto.randomUUID() }).ok).toBe(true)
      expect(node.service.command({ type: 'settings', sharingEnabled: true, requestId: crypto.randomUUID() }).ok).toBe(true)
      node.protocol = node.service.getProtocol()
    }
    pair.nodes.first.protocol.onPeerHello('second', [CAPABILITY])
    pair.nodes.second.protocol.onPeerHello('first', [CAPABILITY])
    pair.deliver()
    const response = await pair.nodes.first.service.command({ type: 'invite', peerId: 'second', activity: 'visit', requestId: crypto.randomUUID() })
    expect(response.ok).toBe(true)
    pair.deliver()
    const sessionId = pair.nodes.second.protocol.getSnapshot().invitations[0].sessionId
    expect((await pair.nodes.second.service.command({ type: 'respond', sessionId, response: 'accept', requestId: crypto.randomUUID() })).ok).toBe(true)
    pair.deliver()
    expect((await pair.nodes.first.service.command({ type: 'action', sessionId, choice: 'focus', requestId: crypto.randomUUID() })).ok).toBe(true)
    pair.deliver()
    expect((await pair.nodes.second.service.command({ type: 'action', sessionId, choice: 'guard', requestId: crypto.randomUUID() })).ok).toBe(true)
    const delayedResults = []
    pair.deliver(packet => {
      const target = pair.nodes[packet.peerId]
      const envelope = decryptPetEnvelope(packet.wrapper.encryptedPayload, target.identityFor(packet.wrapper.fromId))
      if (envelope.messageType === 'result') { delayedResults.push(packet); return false }
      return true
    })
    expect(pair.nodes.first.service.getLocalPet().bond).toBe(1)
    expect(pair.nodes.second.service.getLocalPet().bond).toBe(0)
    expect(pair.nodes.second.service.command({ type: 'settings', sharingEnabled: false, requestId: crypto.randomUUID() }).ok).toBe(true)
    expect(pair.nodes.second.protocol.receive(delayedResults[0].wrapper).ok).toBe(true)
    pair.deliver()
    expect(pair.nodes.second.service.getLocalPet().bond).toBe(1)
    expect(pair.nodes.first.protocol.getSnapshot().history[0].settlementPending).toBe(false)
    expect(pair.results.filter(result => !result.ok)).toEqual([])
  })
})
