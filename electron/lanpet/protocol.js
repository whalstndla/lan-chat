const crypto = require('crypto')
const { DOMAIN, fingerprint, encryptPetEnvelope, decryptPetEnvelope } = require('./petCrypto')
const { ACTIVITIES, CHOICES, TERMINAL_STATUSES, assert, isIdentifier, validateEnvelope, hashPayload, roundScore } = require('./protocolValidation')

const CAPABILITY = 'lanpet-v1'
const SUMMARY_LIFETIME = 90000
const INVITE_LIFETIME = 120000
const RESULT_LIFETIME = 90 * 86400000

function trustedIdentity(ctx, peerId) {
  assert(ctx.state.database && ctx.state.myPrivateKey && ctx.state.myPublicKeyBase64, 'SESSION_LOCKED')
  assert(!ctx.state.pendingKeyChangeMap?.has(peerId), 'PEER_KEY_CHANGED')
  const publicKey = ctx.state.peerPublicKeyMap.get(peerId)
  assert(publicKey, 'PEER_UNTRUSTED')
  const { getPinnedKey } = require('../storage/queries')
  const pinned = getPinnedKey(ctx.state.database, peerId)
  const peerFingerprint = fingerprint(publicKey)
  assert(pinned && fingerprint(pinned.publicKey) === peerFingerprint, 'PEER_UNTRUSTED')
  return {
    localPeerId: ctx.state.peerId, peerId, privateKey: ctx.state.myPrivateKey,
    peerPublicKey: publicKey, localFingerprint: fingerprint(ctx.state.myPublicKeyBase64), peerFingerprint,
  }
}

function createLanpetProtocol({ ctx, service, now = Date.now, send, connectedPeerIds, identityFor, autoRecover = true }) {
  const store = service.store
  const read = (namespace, id) => store.getProtocolRecord(namespace, id)
  const write = (namespace, id, value) => store.setProtocolRecord(namespace, id, value)
  const records = namespace => store.listProtocolRecords(namespace)
  const transact = callback => store.transaction(callback)
  const getIdentity = identityFor || (peerId => trustedIdentity(ctx, peerId))
  const getConnected = connectedPeerIds || (() => require('../utils/appUtils').getConnectedPeerIds(ctx))
  const sendWire = send || ((peerId, wrapper) => require('../utils/appUtils').sendPeerMessage(ctx, peerId, wrapper))
  const localPeerId = ctx.state.peerId
  const supportedPeers = new Map()
  let disposed = false
  let lastSummaryAt = 0
  let previousSharing = false
  let previousWorking = require('./engine').isWorkingHours(now())
  let recoveryTimer
  let lastCleanupAt = 0

  function settings() {
    const value = service.getSettings()
    return { ...value, enabled: value.enabled ?? value.petFeatureEnabled, sharingEnabled: value.sharingEnabled ?? value.petSharingEnabled }
  }

  function pet() {
    const value = service.getLocalPet()
    assert(value, 'PET_NOT_CREATED')
    return value
  }

  function generation() {
    return pet().generationId
  }

  function working() {
    return require('./engine').isWorkingHours(now())
  }

  function sharing() {
    const value = settings()
    return value.enabled === true && value.sharingEnabled === true && !!service.getLocalPet()
  }

  function blocked(peerId) {
    return (settings().blockedPeerIds || []).includes(peerId)
  }

  function allowActivity(activity, peerId) {
    assert(sharing(), 'PET_SHARING_DISABLED')
    assert(working(), 'OUTSIDE_WORK_HOURS')
    assert(!(pet().napEndsAt > now()), 'PET_RESTING')
    if (peerId) assert(!blocked(peerId), 'PEER_BLOCKED')
    const value = settings()
    const setting = { visit: 'allowVisit', cooperativePlay: 'allowCooperativePlay', gift: 'allowGift', battle: 'allowBattle' }[activity]
    assert(ACTIVITIES.includes(activity) && value[setting] !== false, 'ACTIVITY_DISABLED')
  }

  function notify() {
    if (!disposed) service.emitChanged()
  }

  function currentSessions() {
    const currentGeneration = service.getLocalPet()?.generationId
    if (!currentGeneration) return []
    return records('sessions').filter(session => session.generations?.[localPeerId] === currentGeneration)
  }

  function getReservedEnergy() {
    return currentSessions().reduce((sum, session) => sum + (session.energyReserved || 0), 0)
  }

  function hasActiveSession() {
    return currentSessions().some(session => session.energyReserved > 0 || !TERMINAL_STATUSES.has(session.status))
  }

  function reserve(session) {
    if (session.activity !== 'cooperativePlay' && session.activity !== 'battle') return
    assert(pet().energy - getReservedEnergy() >= 6, 'NOT_ENOUGH_ENERGY')
    session.energyReserved = 6
  }

  function buildEnvelope(peerId, messageType, payload, session, lifetime = INVITE_LIFETIME) {
    const identity = getIdentity(peerId)
    const remote = read('peers', peerId)
    return {
      protocol: DOMAIN, version: 1, messageType, eventId: crypto.randomUUID(), requestId: crypto.randomUUID(),
      senderPeerId: localPeerId, recipientPeerId: peerId,
      senderFingerprint: identity.localFingerprint, recipientFingerprint: identity.peerFingerprint,
      senderGeneration: generation(), recipientGeneration: session?.generations?.[peerId] || remote?.generationId || '*',
      sessionId: session?.sessionId, createdAt: now(), expiresAt: now() + lifetime, payload,
    }
  }

  function queue(peerId, messageType, payload, session, lifetime) {
    const envelope = buildEnvelope(peerId, messageType, payload, session, lifetime)
    write('outbox', envelope.eventId, { envelope, peerId, status: 'pending', attempts: 0, nextAttemptAt: now(), expiresAt: envelope.expiresAt })
    return envelope
  }

  function transmit(envelope) {
    const identity = getIdentity(envelope.recipientPeerId)
    assert(identity.peerFingerprint === envelope.recipientFingerprint && identity.localFingerprint === envelope.senderFingerprint, 'PEER_KEY_CHANGED')
    return sendWire(envelope.recipientPeerId, {
      type: 'lanpet', id: crypto.randomUUID(), fromId: localPeerId, to: envelope.recipientPeerId,
      encryptedPayload: encryptPetEnvelope(envelope, identity),
    })
  }

  function flush() {
    for (const entry of records('outbox')) {
      if (entry.status !== 'pending' || entry.nextAttemptAt > now()) continue
      if (blocked(entry.peerId) && !['result', 'abort', 'cancel', 'status', 'ack', 'revoked'].includes(entry.envelope.messageType)) {
        entry.status = 'blocked'
        write('outbox', entry.envelope.eventId, entry)
        continue
      }
      if (entry.envelope.expiresAt <= now()) {
        entry.status = 'expired'
        write('outbox', entry.envelope.eventId, entry)
        continue
      }
      entry.attempts += 1
      entry.nextAttemptAt = now() + Math.min(30000, 1000 * 2 ** Math.min(entry.attempts, 5))
      write('outbox', entry.envelope.eventId, entry)
      try { transmit(entry.envelope) } catch (error) {
        if (error.message === 'PEER_KEY_CHANGED') {
          entry.status = 'keyChanged'
          write('outbox', entry.envelope.eventId, entry)
        }
      }
    }
  }

  function sendAck(envelope, status = 'ok') {
    const session = read('sessions', envelope.sessionId)
    const acknowledgement = buildEnvelope(envelope.senderPeerId, 'ack', {
      eventId: envelope.eventId, requestId: envelope.requestId, status,
    }, session || { sessionId: envelope.sessionId, generations: { [envelope.senderPeerId]: envelope.senderGeneration } }, RESULT_LIFETIME)
    transmit(acknowledgement)
  }

  function advertise(peerId) {
    if (!sharing() || !working() || blocked(peerId) || !supportedPeers.get(peerId)) return
    const current = pet()
    const envelope = buildEnvelope(peerId, 'summary', {
      petName: String(current.name).slice(0, 40), stage: current.stage || current.growthStage,
      visibilityVersion: read('visibility', 'local')?.version || 1,
      appearanceId: current.appearanceId, activities: ACTIVITIES.filter(activity => {
        const key = { visit: 'allowVisit', cooperativePlay: 'allowCooperativePlay', gift: 'allowGift', battle: 'allowBattle' }[activity]
        return settings()[key] !== false
      }),
    }, null, SUMMARY_LIFETIME)
    transmit(envelope)
  }

  function onPeerHello(peerId, capabilities = []) {
    supportedPeers.set(peerId, capabilities.includes(CAPABILITY))
    try {
      const identity = getIdentity(peerId)
      for (const session of currentSessions()) {
        if (session.peerId === peerId && session.fingerprints[peerId] !== identity.peerFingerprint && !TERMINAL_STATUSES.has(session.status)) {
          session.status = 'keyChanged'
          session.error = 'PEER_KEY_CHANGED'
          write('sessions', session.sessionId, session)
        }
      }
      advertise(peerId)
      for (const entry of records('outbox')) {
        if (entry.peerId === peerId && entry.status === 'pending') {
          entry.nextAttemptAt = now()
          write('outbox', entry.envelope.eventId, entry)
        }
      }
      flush()
    } catch { /* 승인되지 않은 피어에는 공개 데이터와 재전송을 보내지 않는다. */ }
    notify()
  }

  function publicSession(session) {
    const ownChoice = session.inputs?.[localPeerId] || null
    const last = session.rounds?.at(-1)
    const result = session.certificate?.result
    let ownOutcome = 'completed'
    if (result && session.activity === 'battle') {
      ownOutcome = 'draw'
      if (result.scores[localPeerId] > result.scores[session.peerId]) ownOutcome = 'win'
      if (result.scores[localPeerId] < result.scores[session.peerId]) ownOutcome = 'loss'
    }
    return {
      sessionId: session.sessionId, peerId: session.peerId, peerName: session.peerName,
      activity: session.activity, direction: session.role === 'host' ? 'outgoing' : 'incoming', status: session.status,
      turn: session.turn, totalTurns: session.activity === 'battle' ? 5 : 3, turnEndsAt: session.turnEndsAt,
      ownChoice, waitingForPeer: !!ownChoice && session.status === 'inProgress',
      startedAt: session.startedAt, expiresAt: session.expiresAt, energyReserved: session.energyReserved || 0,
      settlementPending: !!session.certificate && !session.remoteAcknowledged && session.role === 'host', error: session.error,
      lastRound: last ? { ownChoice: last.inputs[localPeerId], peerChoice: last.inputs[session.peerId], ownScore: last.scores[localPeerId], peerScore: last.scores[session.peerId] } : null,
      result: result ? { outcome: ownOutcome, ownScore: result.scores[localPeerId], peerScore: result.scores[session.peerId] } : null,
    }
  }

  function getSnapshot() {
    const connected = new Set(getConnected())
    const ids = new Set([...connected, ...supportedPeers.keys()])
    const peers = [...ids].filter(peerId => peerId !== localPeerId).map(peerId => {
      const summary = read('peers', peerId)
      const currentSummary = summary && summary.expiresAt > now() && !blocked(peerId) ? summary : null
      const pendingKeyChange = !!ctx.state.pendingKeyChangeMap?.has(peerId)
      let trusted = false
      try { trusted = !!getIdentity(peerId) } catch { /* 신뢰 실패는 비활성 상태로 표시한다. */ }
      const online = connected.has(peerId)
      return {
        peerId, name: ctx.state.latestDiscoveredPeerInfoMap?.get(peerId)?.nickname || peerId,
        petName: currentSummary?.petName, stage: currentSummary?.stage, appearanceId: currentSummary?.appearanceId,
        activities: currentSummary?.activities || [], supported: !!supportedPeers.get(peerId), online, pendingKeyChange, blocked: blocked(peerId),
        available: sharing() && working() && !(service.getLocalPet()?.napEndsAt > now()) && trusted && online && !!currentSummary,
      }
    })
    const sessions = currentSessions().filter(session => !session.tombstone).sort((a, b) => b.createdAt - a.createdAt)
    return {
      peers,
      invitations: sessions.filter(session => ['incomingPending', 'outgoingPending'].includes(session.status)).map(publicSession),
      sessions: sessions.filter(session => !['incomingPending', 'outgoingPending'].includes(session.status)).slice(0, 100).map(publicSession),
      history: sessions.filter(session => TERMINAL_STATUSES.has(session.status)).slice(0, 100).map(publicSession),
    }
  }

  function saveSession(session) {
    session.updatedAt = now()
    write('sessions', session.sessionId, session)
  }

  function requireSession(sessionId) {
    const session = read('sessions', sessionId)
    assert(session && session.generations[localPeerId] === generation(), 'SESSION_NOT_FOUND')
    assert(getIdentity(session.peerId).peerFingerprint === session.fingerprints[session.peerId], 'PEER_KEY_CHANGED')
    return session
  }

  function createSession(peerId, activity, sessionId, identity, remoteGeneration, role) {
    return {
      sessionId, peerId, peerName: read('peers', peerId)?.petName || peerId, activity, role,
      hostId: role === 'host' ? localPeerId : peerId,
      participants: role === 'host' ? [localPeerId, peerId] : [peerId, localPeerId],
      fingerprints: { [localPeerId]: identity.localFingerprint, [peerId]: identity.peerFingerprint },
      generations: { [localPeerId]: generation(), [peerId]: remoteGeneration },
      status: role === 'host' ? 'outgoingPending' : 'incomingPending', turn: 1, sequence: 0,
      inputs: {}, rounds: [], energyReserved: 0, createdAt: now(), expiresAt: now() + INVITE_LIFETIME,
    }
  }

  function commitResult(session) {
    assert(session.role === 'host' && !session.certificate, 'INVALID_STATE_TRANSITION')
    const scores = Object.fromEntries(session.participants.map(id => [id, 0]))
    for (const round of session.rounds) for (const id of session.participants) scores[id] += round.scores[id]
    const result = { scores, completedTogether: true }
    const certificate = {
      sessionId: session.sessionId, activity: session.activity, hostId: localPeerId,
      participants: session.participants, generations: session.generations, fingerprints: session.fingerprints,
      ruleVersion: 1, sequence: ++session.sequence, rounds: session.rounds,
      inputHash: hashPayload(session.rounds), result, eventId: crypto.randomUUID(), decision: 'result',
    }
    session.certificate = certificate
    session.status = 'completed'
    session.remoteAcknowledged = false
    const cost = session.energyReserved || 0
    session.energyReserved = 0
    saveSession(session)
    if (session.activity !== 'gift') {
      const applied = service.applySocialReward({ eventId: certificate.eventId, activity: session.activity, peerId: session.peerId, outcome: result, cost, now: now(),
        settlement: true, sessionId: session.sessionId, generationId: session.generations[localPeerId] })
      assert(applied?.ok !== false, applied?.code || 'REWARD_FAILED')
    }
    queue(session.peerId, 'result', { certificate }, session, RESULT_LIFETIME)
  }

  function commitAbort(session, reason = 'canceled') {
    assert(session.role === 'host', 'HOST_REQUIRED')
    if (session.certificate) {
      queue(session.peerId, session.certificate.decision, { certificate: session.certificate }, session, RESULT_LIFETIME)
      return
    }
    session.certificate = { sessionId: session.sessionId, eventId: crypto.randomUUID(), decision: 'abort', reason,
      hostId: localPeerId, participants: session.participants, generations: session.generations, fingerprints: session.fingerprints, sequence: ++session.sequence, ruleVersion: 1 }
    session.status = reason
    session.energyReserved = 0
    saveSession(session)
    queue(session.peerId, 'abort', { certificate: session.certificate }, session, RESULT_LIFETIME)
  }

  function finishRound(session) {
    if (!session.participants.every(id => [...CHOICES, 'rest'].includes(session.inputs[id]))) return
    const [first, second] = session.participants
    const [firstScore, secondScore] = roundScore(session.inputs[first], session.inputs[second])
    const round = { turn: session.turn, inputs: { ...session.inputs }, scores: { [first]: firstScore, [second]: secondScore }, timedOut: session.timedOut || [] }
    session.rounds.push(round)
    session.inputs = {}
    const requiredRounds = { visit: 1, cooperativePlay: 3, battle: 5 }[session.activity]
    if (session.rounds.length >= requiredRounds) {
      commitResult(session)
      return
    }
    session.turn += 1
    session.timedOut = []
    if (session.activity === 'battle') session.turnEndsAt = now() + 15000
    session.sequence += 1
    saveSession(session)
    queue(session.peerId, 'round', { round, turn: session.turn, sequence: session.sequence, turnEndsAt: session.turnEndsAt }, session)
  }

  function command(input) {
    assert(input && typeof input === 'object' && isIdentifier(input.requestId), 'INVALID_REQUEST')
    const requestKey = `${generation()}:${input.requestId}`
    const previous = read('commands', requestKey)
    if (previous) {
      assert(previous.hash === hashPayload(input), 'REQUEST_ID_CONFLICT')
      return previous.result
    }
    const result = transact(() => {
      let session
      if (input.type === 'invite') {
        allowActivity(input.activity, input.peerId)
        assert(isIdentifier(input.peerId) && input.peerId !== localPeerId)
        const remote = read('peers', input.peerId)
        assert(remote && remote.expiresAt > now() && remote.activities.includes(input.activity), 'PEER_UNAVAILABLE')
        assert(getConnected().includes(input.peerId), 'PEER_OFFLINE')
        assert(!currentSessions().some(value => !TERMINAL_STATUSES.has(value.status) && value.status !== 'reconciliationNeeded'), 'SESSION_CONFLICT')
        const recent = currentSessions().filter(value => value.role === 'host' && value.peerId === input.peerId && value.createdAt > now() - 600000)
        assert(recent.length === 0, 'INVITE_RATE_LIMITED')
        if (input.activity === 'gift') {
          const gifts = records('sessions').filter(value => value.role === 'host' && value.activity === 'gift' && value.createdAt > now() - 86400000)
          assert(gifts.length < 3 && !gifts.some(value => value.peerId === input.peerId), 'GIFT_LIMIT_REACHED')
        }
        const identity = getIdentity(input.peerId)
        assert(identity.peerFingerprint === remote.fingerprint, 'PEER_KEY_CHANGED')
        session = createSession(input.peerId, input.activity, crypto.randomUUID(), identity, remote.generationId, 'host')
        if (input.activity === 'gift') session.expiresAt = now() + 86400000
        saveSession(session)
        queue(input.peerId, 'invite', { activity: input.activity }, session, input.activity === 'gift' ? 86400000 : INVITE_LIFETIME)
      } else {
        session = requireSession(input.sessionId)
        if (input.type === 'respond') {
          assert(session.role === 'guest' && session.status === 'incomingPending', 'INVALID_STATE_TRANSITION')
          assert(['accept', 'decline'].includes(input.response))
          assert(session.expiresAt > now(), 'INVITE_EXPIRED')
          if (input.response === 'accept') {
            allowActivity(session.activity, session.peerId)
            reserve(session)
            session.accepted = true
            session.status = 'preparing'
          } else session.status = 'declined'
          saveSession(session)
          queue(session.peerId, 'respond', { response: input.response }, session)
        } else if (input.type === 'action') {
          allowActivity(session.activity, session.peerId)
          assert(session.status === 'inProgress' && CHOICES.includes(input.choice), 'INVALID_STATE_TRANSITION')
          if (session.activity === 'battle') assert(now() < session.turnEndsAt, 'TURN_EXPIRED')
          assert(!session.inputs[localPeerId], 'INPUT_ALREADY_SUBMITTED')
          session.inputs[localPeerId] = input.choice
          saveSession(session)
          if (session.role === 'host') finishRound(session)
          else queue(session.peerId, 'input', { turn: session.turn, choice: input.choice }, session)
        } else if (input.type === 'end') {
          assert(!TERMINAL_STATUSES.has(session.status), 'INVALID_STATE_TRANSITION')
          if (session.role === 'host') commitAbort(session)
          else {
            session.status = 'resultUnknown'
            saveSession(session)
            queue(session.peerId, 'cancel', {}, session, RESULT_LIFETIME)
          }
        } else throw new Error('UNKNOWN_COMMAND')
      }
      const value = { ok: true, sessionId: session.sessionId }
      write('commands', requestKey, { hash: hashPayload(input), result: value })
      return value
    })
    flush()
    notify()
    return result
  }

  function validateCertificate(session, certificate) {
    assert(certificate && certificate.sessionId === session.sessionId && certificate.hostId === session.hostId && certificate.ruleVersion === 1, 'INVALID_CERTIFICATE')
    assert(hashPayload(certificate.participants) === hashPayload(session.participants) && hashPayload(certificate.generations) === hashPayload(session.generations) && hashPayload(certificate.fingerprints) === hashPayload(session.fingerprints), 'INVALID_CERTIFICATE')
    assert(isIdentifier(certificate.eventId) && Number.isSafeInteger(certificate.sequence) && certificate.sequence > 0, 'INVALID_CERTIFICATE')
    if (certificate.decision !== 'result') {
      assert(certificate.decision === 'abort' && ['canceled', 'expired', 'declined'].includes(certificate.reason), 'INVALID_CERTIFICATE')
      return
    }
    assert(session.accepted === true, 'ACTIVITY_NOT_ACCEPTED')
    assert(certificate.activity === session.activity && Array.isArray(certificate.rounds) && certificate.rounds.length <= 5, 'INVALID_CERTIFICATE')
    assert(certificate.inputHash === hashPayload(certificate.rounds), 'INVALID_CERTIFICATE')
    const requiredRounds = { gift: 0, visit: 1, cooperativePlay: 3, battle: 5 }[session.activity]
    assert(certificate.rounds.length === requiredRounds, 'INVALID_CERTIFICATE')
    const expectedScores = Object.fromEntries(session.participants.map(id => [id, 0]))
    certificate.rounds.forEach((round, index) => {
      const [first, second] = session.participants
      assert(round.turn === index + 1 && round.inputs && round.scores, 'INVALID_CERTIFICATE')
      const scores = roundScore(round.inputs[first], round.inputs[second])
      assert(round.scores[first] === scores[0] && round.scores[second] === scores[1], 'INVALID_CERTIFICATE')
      const ownSubmitted = session.rounds[index]?.inputs[localPeerId] || (session.turn === index + 1 ? session.inputs[localPeerId] : null)
      const timedOut = !ownSubmitted && round.inputs[localPeerId] === 'rest' && round.timedOut?.includes(localPeerId) && session.activity === 'battle'
      assert(ownSubmitted === round.inputs[localPeerId] || timedOut, 'INPUT_MISMATCH')
      expectedScores[first] += scores[0]
      expectedScores[second] += scores[1]
    })
    assert(certificate.result?.completedTogether === true && hashPayload(certificate.result.scores) === hashPayload(expectedScores), 'INVALID_CERTIFICATE')
  }

  function processEnvelope(envelope, identity) {
    const peerId = envelope.senderPeerId
    let session = read('sessions', envelope.sessionId)
    if (envelope.messageType === 'invite') {
      allowActivity(envelope.payload.activity, peerId)
      assert(!session, 'SESSION_CONFLICT')
      const prior = currentSessions().filter(value => value.role === 'guest' && value.peerId === peerId && value.createdAt > now() - 600000)
      assert(prior.length === 0, 'INVITE_RATE_LIMITED')
      const active = currentSessions().find(value => !TERMINAL_STATUSES.has(value.status))
      if (active) {
        const remoteWins = active.status === 'outgoingPending' && active.peerId === peerId && peerId.localeCompare(localPeerId) < 0
        assert(remoteWins, 'SESSION_CONFLICT')
        commitAbort(active)
      }
      session = createSession(peerId, envelope.payload.activity, envelope.sessionId, identity, envelope.senderGeneration, 'guest')
      session.expiresAt = Math.min(envelope.expiresAt, now() + (session.activity === 'gift' ? 86400000 : INVITE_LIFETIME))
      saveSession(session)
      return
    }
    assert(session && session.peerId === peerId, 'SESSION_NOT_FOUND')
    assert(session.fingerprints[peerId] === identity.peerFingerprint && session.generations[peerId] === envelope.senderGeneration, 'IDENTITY_MISMATCH')
    const messageType = envelope.messageType
    if (session.tombstone) {
      if (messageType === 'result' || messageType === 'abort') assert(envelope.payload.certificate?.eventId === session.certificateEventId, 'RESULT_DISPUTED')
      else assert(messageType === 'status' || messageType === 'cancel', 'INVALID_STATE_TRANSITION')
      return
    }
    if (messageType === 'status' || messageType === 'cancel') {
      assert(session.role === 'host', 'HOST_REQUIRED')
      if (session.certificate) queue(peerId, session.certificate.decision, { certificate: session.certificate }, session, RESULT_LIFETIME)
      else if (messageType === 'cancel' || !working() || !sharing() || session.expiresAt <= now()) commitAbort(session)
      return
    }
    if (messageType === 'result' || messageType === 'abort') {
      assert(session.role === 'guest', 'HOST_REQUIRED')
      const certificate = envelope.payload.certificate
      validateCertificate(session, certificate)
      assert(certificate.decision === messageType, 'INVALID_CERTIFICATE')
      if (session.certificate) {
        assert(session.certificate.eventId === certificate.eventId, 'RESULT_DISPUTED')
        return
      }
      const cost = session.energyReserved || 0
      session.certificate = certificate
      if (messageType === 'result') session.rounds = certificate.rounds
      session.energyReserved = 0
      session.status = messageType === 'result' ? 'completed' : certificate.reason || 'canceled'
      session.remoteAcknowledged = true
      session.settledAt = now()
      saveSession(session)
      if (messageType === 'result') {
        const applied = service.applySocialReward({ eventId: certificate.eventId, activity: session.activity, peerId, outcome: certificate.result, cost, giftType: 'friendshipStar', now: now(),
          settlement: true, sessionId: session.sessionId, generationId: session.generations[localPeerId] })
        assert(applied?.ok !== false, applied?.code || 'REWARD_FAILED')
      }
      return
    }
    allowActivity(session.activity, peerId)
    assert(!TERMINAL_STATUSES.has(session.status), 'INVALID_STATE_TRANSITION')
    if (messageType === 'respond') {
      assert(session.role === 'host' && session.status === 'outgoingPending', 'INVALID_STATE_TRANSITION')
      assert(['accept', 'decline'].includes(envelope.payload.response))
      if (envelope.payload.response === 'decline') return commitAbort(session, 'declined')
      assert(session.expiresAt > now(), 'INVITE_EXPIRED')
      reserve(session)
      session.accepted = true
      session.status = 'inProgress'
      session.startedAt = now()
      if (session.activity === 'battle') session.turnEndsAt = now() + 15000
      session.expiresAt = now() + 10 * 60000
      session.sequence += 1
      saveSession(session)
      if (session.activity === 'gift') commitResult(session)
      else queue(peerId, 'started', { startedAt: session.startedAt, expiresAt: session.expiresAt, sequence: session.sequence, turnEndsAt: session.turnEndsAt }, session)
    } else if (messageType === 'started') {
      assert(session.role === 'guest' && session.status === 'preparing', 'INVALID_STATE_TRANSITION')
      assert(Number.isSafeInteger(envelope.payload.sequence) && envelope.payload.sequence === 1)
      session.status = 'inProgress'
      session.sequence = 1
      session.startedAt = now()
      if (session.activity === 'battle') session.turnEndsAt = now() + 15000
      session.expiresAt = now() + 10 * 60000
      saveSession(session)
    } else if (messageType === 'input') {
      assert(session.role === 'host' && session.status === 'inProgress', 'INVALID_STATE_TRANSITION')
      assert(envelope.payload.turn === session.turn && CHOICES.includes(envelope.payload.choice), 'INVALID_TURN')
      assert(!session.inputs[peerId], 'INPUT_ALREADY_SUBMITTED')
      session.inputs[peerId] = envelope.payload.choice
      saveSession(session)
      finishRound(session)
    } else if (messageType === 'round') {
      assert(session.role === 'guest' && session.status === 'inProgress', 'INVALID_STATE_TRANSITION')
      const { round, turn, sequence } = envelope.payload
      assert(round && round.turn === session.turn && turn === session.turn + 1 && sequence === session.sequence + 1, 'EVENT_SEQUENCE_GAP')
      const timedOut = !session.inputs[localPeerId] && round.inputs[localPeerId] === 'rest' && round.timedOut?.includes(localPeerId) && session.activity === 'battle'
      assert(round.inputs[localPeerId] === session.inputs[localPeerId] || timedOut, 'INPUT_MISMATCH')
      const scores = roundScore(round.inputs[session.participants[0]], round.inputs[session.participants[1]])
      assert(session.participants.every((id, index) => round.scores[id] === scores[index]), 'INVALID_ROUND')
      session.rounds.push(round)
      session.inputs = {}
      session.turn = turn
      session.sequence = sequence
      if (session.activity === 'battle') session.turnEndsAt = now() + 15000
      saveSession(session)
    } else throw new Error('UNSUPPORTED_MESSAGE')
  }

  function receive(wrapper) {
    if (disposed || wrapper?.type !== 'lanpet' || wrapper.to !== localPeerId || !isIdentifier(wrapper.fromId)) return { ok: false, error: 'INVALID_WRAPPER' }
    let envelope
    try {
      const identity = getIdentity(wrapper.fromId)
      envelope = validateEnvelope(decryptPetEnvelope(wrapper.encryptedPayload, identity), identity)
      if (envelope.messageType === 'summary') {
        assert(sharing() && working(), 'PET_SHARING_DISABLED')
        assert(!blocked(wrapper.fromId), 'PEER_BLOCKED')
        assert(envelope.expiresAt > now() && envelope.expiresAt - envelope.createdAt <= SUMMARY_LIFETIME, 'REQUEST_EXPIRED')
        const summary = envelope.payload
        assert(typeof summary.petName === 'string' && summary.petName.length <= 40 && Array.isArray(summary.activities) && summary.activities.every(activity => ACTIVITIES.includes(activity)))
        assert(['seed', 'young', 'grown'].includes(summary.stage) && typeof summary.appearanceId === 'string' && summary.appearanceId.length <= 64)
        const previous = read('peers', wrapper.fromId)
        const knownGenerations = read('peerGenerations', identity.peerFingerprint) || { current: null, retired: [] }
        assert(!knownGenerations.retired.includes(envelope.senderGeneration), 'GENERATION_MISMATCH')
        if (knownGenerations.current && knownGenerations.current !== envelope.senderGeneration) knownGenerations.retired.push(knownGenerations.current)
        knownGenerations.current = envelope.senderGeneration
        assert(Number.isSafeInteger(summary.visibilityVersion) && summary.visibilityVersion > 0)
        assert(!previous || previous.fingerprint !== identity.peerFingerprint || previous.generationId !== envelope.senderGeneration ||
          (summary.visibilityVersion >= (previous.visibilityVersion || 0) && summary.visibilityVersion > (previous.revokedVersion || 0)), 'VISIBILITY_REVOKED')
        write('peerGenerations', identity.peerFingerprint, knownGenerations)
        write('peers', wrapper.fromId, { ...summary, fingerprint: identity.peerFingerprint, generationId: envelope.senderGeneration, expiresAt: Math.min(envelope.expiresAt, now() + SUMMARY_LIFETIME) })
        supportedPeers.set(wrapper.fromId, true)
        if (!previous || previous.expiresAt <= now()) advertise(wrapper.fromId)
        notify()
        return { ok: true }
      }
      if (envelope.messageType === 'revoked') {
        const previous = read('peers', wrapper.fromId)
        assert(Number.isSafeInteger(envelope.payload.visibilityVersion) && envelope.payload.visibilityVersion > 0)
        assert(!previous || previous.generationId === envelope.senderGeneration, 'GENERATION_MISMATCH')
        if (!previous || envelope.payload.visibilityVersion >= previous.visibilityVersion) {
          transact(() => {
            write('peers', wrapper.fromId, {
              ...previous, fingerprint: identity.peerFingerprint, generationId: envelope.senderGeneration, visibilityVersion: envelope.payload.visibilityVersion,
              revokedVersion: envelope.payload.visibilityVersion, expiresAt: 0,
            })
            for (const session of currentSessions()) {
              if (session.peerId !== wrapper.fromId || TERMINAL_STATUSES.has(session.status)) continue
              if (session.role === 'host') commitAbort(session)
              else {
                session.status = 'resultUnknown'
                saveSession(session)
                queue(session.peerId, 'cancel', {}, session, RESULT_LIFETIME)
              }
            }
          })
          flush()
        }
        notify()
        return { ok: true }
      }
      if (envelope.messageType === 'ack') {
        assert(typeof envelope.payload.status === 'string' && envelope.payload.status.length <= 64, 'INVALID_ACK')
        const entry = read('outbox', envelope.payload.eventId)
        assert(entry && entry.peerId === wrapper.fromId && entry.envelope.requestId === envelope.payload.requestId, 'UNKNOWN_ACK')
        assert(envelope.recipientGeneration === entry.envelope.senderGeneration && envelope.senderGeneration === entry.envelope.recipientGeneration, 'GENERATION_MISMATCH')
        entry.status = envelope.payload.status === 'ok' ? 'acknowledged' : 'rejected'
        entry.error = envelope.payload.status
        const deletedGeneration = service.getLocalPet()?.generationId !== entry.envelope.senderGeneration
        if (deletedGeneration) store.removeProtocolRecord('outbox', entry.envelope.eventId)
        else write('outbox', entry.envelope.eventId, entry)
        const session = read('sessions', envelope.sessionId)
        if (session && session.status !== 'deleted' && ['result', 'abort'].includes(entry.envelope.messageType) && entry.status === 'acknowledged') {
          session.remoteAcknowledged = true
          session.settledAt ??= now()
          saveSession(session)
        }
        if (session && session.status !== 'deleted' && entry.status === 'rejected') {
          session.error = entry.error
          if (session.role === 'host' && !session.certificate) transact(() => commitAbort(session))
          else if (!session.certificate) { session.status = 'resultUnknown'; saveSession(session) }
        }
        notify()
        return { ok: true }
      }
      assert(envelope.recipientGeneration === generation(), 'GENERATION_MISMATCH')
      const key = `${identity.peerFingerprint}:${envelope.requestId}`
      const hash = hashPayload(envelope)
      const previous = read('inbox', key)
      if (previous) {
        assert(previous.hash === hash, 'REQUEST_ID_CONFLICT')
        sendAck(envelope, previous.status)
        flush()
        return { ok: true, duplicate: true }
      }
      assert(envelope.expiresAt > now(), 'REQUEST_EXPIRED')
      assert(envelope.createdAt <= now() + 120000, 'INVALID_TIMESTAMP')
      transact(() => {
        processEnvelope(envelope, identity)
        write('inbox', key, { hash, status: 'ok', eventId: envelope.eventId, expiresAt: now() + RESULT_LIFETIME })
      })
      sendAck(envelope)
      flush()
      notify()
      return { ok: true }
    } catch (error) {
      if (envelope && !['ack', 'summary', 'revoked'].includes(envelope.messageType)) {
        const code = /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'PROTOCOL_ERROR'
        try { sendAck(envelope, code) } catch { /* 키 변경과 잠금 중에는 응답을 보내지 않는다. */ }
      }
      return { ok: false, error: error.message }
    }
  }

  function refreshVisibility() {
    const enabled = sharing()
    const visibility = { version: (read('visibility', 'local')?.version || 1) + 1 }
    write('visibility', 'local', visibility)
    if (previousSharing && !enabled) {
      for (const peerId of getConnected()) {
        try { transmit(buildEnvelope(peerId, 'revoked', { visibilityVersion: visibility.version }, null, SUMMARY_LIFETIME)) } catch { /* 오프라인 공개 요약은 TTL로 만료된다. */ }
      }
      for (const session of currentSessions()) {
        if (TERMINAL_STATUSES.has(session.status)) continue
        transact(() => {
          if (session.role === 'host') commitAbort(session)
          else {
            session.status = 'resultUnknown'
            saveSession(session)
            queue(session.peerId, 'cancel', {}, session, RESULT_LIFETIME)
          }
        })
      }
    }
    previousSharing = enabled
    if (ctx.state.database && ctx.state.myPrivateKey) {
      try {
        const utilities = require('../utils/appUtils')
        for (const peerId of getConnected()) sendWire(peerId, utilities.buildMyHelloPayload(ctx, localPeerId, utilities.getCurrentNicknameSafely(ctx)))
      } catch { /* 테스트 또는 잠금 중에는 hello 갱신을 생략한다. */ }
    }
    if (enabled) for (const peerId of getConnected()) { try { advertise(peerId) } catch {} }
    flush()
    notify()
  }

  function prepareDelete() {
    const deletedGeneration = generation()
    const visibility = { version: (read('visibility', 'local')?.version || 1) + 1 }
    write('visibility', 'local', visibility)
    for (const peerId of getConnected()) {
      try { queue(peerId, 'revoked', { visibilityVersion: visibility.version }, null, SUMMARY_LIFETIME) } catch {}
    }
    for (const session of currentSessions()) {
      if (!TERMINAL_STATUSES.has(session.status)) {
        try {
          if (session.role === 'host') commitAbort(session)
          else queue(session.peerId, 'cancel', {}, session, RESULT_LIFETIME)
        } catch { /* 상대 키 변경·오프라인 때문에 사용자의 로컬 삭제를 막지 않는다. */ }
      }
      // 삭제 뒤에는 상세 놀이 기록 대신 재전송 차단과 발신 한도에 필요한 식별자만 남긴다.
      write('sessions', session.sessionId, {
        sessionId: session.sessionId, peerId: session.peerId, activity: session.activity, role: session.role,
        generations: session.generations, status: 'deleted', energyReserved: 0,
        createdAt: session.createdAt, expiresAt: now() + RESULT_LIFETIME, tombstone: true,
      })
    }
    for (const entry of records('outbox')) {
      if (entry.envelope.senderGeneration !== deletedGeneration) continue
      if (entry.status === 'pending' && ['result', 'abort', 'cancel', 'revoked', 'ack'].includes(entry.envelope.messageType)) continue
      store.removeProtocolRecord('outbox', entry.envelope.eventId)
    }
    for (const peer of records('peers')) store.removeProtocolRecord('peers', peer.recordId)
    previousSharing = false
  }

  function recover() {
    if (disposed) return
    let changed = false
    try {
      if (!service.getLocalPet()) return
      if (now() - lastCleanupAt >= 60000) {
        lastCleanupAt = now()
        const cleanup = store.cleanupRetention(now())
        changed = Object.values(cleanup).some(count => count > 0)
      }
    } catch {
      // 로그아웃과 DB 종료 중에는 정리 오류를 타이머 밖으로 전파하지 않는다.
      dispose()
      return
    }
    changed ||= previousWorking !== working()
    previousWorking = working()
    for (const session of records('sessions')) {
      if (session.generations[localPeerId] !== generation() || TERMINAL_STATUSES.has(session.status)) continue
      try {
        if (session.fingerprints[session.peerId] !== getIdentity(session.peerId).peerFingerprint) {
          session.status = 'keyChanged'
          saveSession(session)
          changed = true
          continue
        }
        if (session.role === 'host' && (session.expiresAt <= now() || !working() || !sharing() || blocked(session.peerId))) {
          transact(() => commitAbort(session, session.expiresAt <= now() ? 'expired' : 'canceled'))
          changed = true
        } else if (session.role === 'host' && session.activity === 'battle' && session.status === 'inProgress' && session.turnEndsAt <= now()) {
          transact(() => {
            session.timedOut = session.participants.filter(id => !session.inputs[id])
            for (const id of session.timedOut) session.inputs[id] = 'rest'
            finishRound(session)
          })
          changed = true
        } else if (session.role === 'guest' && session.status !== 'incomingPending' && (session.expiresAt <= now() || session.status === 'resultUnknown' || session.status === 'preparing')) {
          const nextStatus = now() - session.createdAt > 7 * 86400000 ? 'reconciliationNeeded' : 'resultUnknown'
          if (session.status !== nextStatus) {
            session.status = nextStatus
            saveSession(session)
            changed = true
          }
          const pendingStatus = records('outbox').some(entry => entry.envelope.sessionId === session.sessionId && entry.envelope.messageType === 'status' && entry.status === 'pending')
          if (!pendingStatus) queue(session.peerId, 'status', {}, session, RESULT_LIFETIME)
        } else if (session.status === 'incomingPending' && session.expiresAt <= now()) {
          session.status = 'expired'; saveSession(session)
          changed = true
        }
      } catch { /* 상대 오프라인과 키 미확인 상태에서 미확정 예약을 임의 환불하지 않는다. */ }
    }
    if (now() - lastSummaryAt >= 30000) {
      lastSummaryAt = now()
      for (const peerId of getConnected()) { try { advertise(peerId) } catch {} }
    }
    flush()
    if (changed) notify()
  }

  function dispose() {
    disposed = true
    clearInterval(recoveryTimer)
  }

  previousSharing = sharing()
  if (autoRecover) {
    recoveryTimer = setInterval(recover, 2000)
    recoveryTimer.unref?.()
  }
  return { command, receive, onPeerHello, refreshVisibility, prepareDelete, flush, recover, getSnapshot, getReservedEnergy, hasActiveSession, dispose }
}

function getLanpetProtocol(ctx, service) {
  assert(!ctx.state.isSessionClosing, 'SESSION_LOCKED')
  const currentService = service || require('./service').getLanpetService(ctx)
  const protocol = currentService.getProtocol()
  assert(protocol, 'PROTOCOL_UNAVAILABLE')
  return protocol
}

function isLanpetSharingEnabled(ctx) {
  if (!ctx.state.database || !ctx.state.myPrivateKey || ctx.state.isSessionClosing) return false
  try {
    const value = require('./service').getLanpetService(ctx).getSettings()
    return (value.enabled ?? value.petFeatureEnabled) === true && (value.sharingEnabled ?? value.petSharingEnabled) === true
  } catch { return false }
}

module.exports = { CAPABILITY, createLanpetProtocol, getLanpetProtocol, isLanpetSharingEnabled, trustedIdentity }
