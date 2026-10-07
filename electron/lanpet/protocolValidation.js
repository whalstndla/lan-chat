const crypto = require('crypto')
const { DOMAIN, MAX_PLAINTEXT_BYTES } = require('./petCrypto')

const ACTIVITIES = Object.freeze(['visit', 'cooperativePlay', 'gift', 'battle', 'race'])
const CHOICES = Object.freeze(['focus', 'guard', 'spark'])
const MESSAGE_TYPES = new Set(['summary', 'revoked', 'invite', 'respond', 'started', 'input', 'round', 'result', 'abort', 'cancel', 'status', 'ack'])
const TERMINAL_STATUSES = new Set(['completed', 'declined', 'canceled', 'expired', 'keyChanged', 'resultDisputed', 'deleted'])
const DICE_CAPABILITY = 'lanpet-dice-v1'

function isDiceRace(session) { return session.activity === 'race' && session.ruleVersion === 2 }

function sessionRoundScore(session, round) {
  const [first, second] = session.participants
  if (!isDiceRace(session)) return roundScore(round.inputs[first], round.inputs[second], session.activity)
  assert(session.participants.every(id => round.inputs[id] === 'roll' && Number.isInteger(round.dice?.[id]) && round.dice[id] >= 1 && round.dice[id] <= 6), 'INVALID_DICE_ROLL')
  return [round.dice[first], round.dice[second]]
}

function assert(condition, code = 'INVALID_PAYLOAD') {
  if (!condition) throw new Error(code)
}

function isIdentifier(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value)
}

function validateEnvelope(envelope, identity) {
  assert(envelope && typeof envelope === 'object' && !Array.isArray(envelope))
  assert(Buffer.byteLength(JSON.stringify(envelope)) <= MAX_PLAINTEXT_BYTES, 'PAYLOAD_TOO_LARGE')
  assert(envelope.protocol === DOMAIN && envelope.version === 1, 'PROTOCOL_UNSUPPORTED')
  assert(MESSAGE_TYPES.has(envelope.messageType), 'UNSUPPORTED_MESSAGE')
  for (const key of ['eventId', 'requestId', 'senderPeerId', 'recipientPeerId', 'senderGeneration']) assert(isIdentifier(envelope[key]))
  assert(envelope.senderPeerId === identity.peerId && envelope.recipientPeerId === identity.localPeerId, 'IDENTITY_MISMATCH')
  assert(envelope.senderFingerprint === identity.peerFingerprint && envelope.recipientFingerprint === identity.localFingerprint, 'IDENTITY_MISMATCH')
  assert(Number.isSafeInteger(envelope.createdAt) && Number.isSafeInteger(envelope.expiresAt) && envelope.expiresAt >= envelope.createdAt)
  assert(envelope.expiresAt - envelope.createdAt <= 90 * 86400000, 'INVALID_EXPIRY')
  assert(envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload))
  if (envelope.messageType !== 'summary' && envelope.messageType !== 'revoked') assert(isIdentifier(envelope.sessionId))
  return envelope
}

function hashPayload(payload) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')
}

function roundScore(first, second, activity) {
  assert([...CHOICES, 'rest'].includes(first) && [...CHOICES, 'rest'].includes(second))
  if (activity === 'race') {
    const points = roundScore(first, second)
    return [first === 'rest' ? 0 : 3 + points[0] * 2, second === 'rest' ? 0 : 3 + points[1] * 2]
  }
  if (first === second) return [0, 0]
  if (first === 'rest') return [0, 1]
  if (second === 'rest') return [1, 0]
  const defeated = { focus: 'spark', spark: 'guard', guard: 'focus' }
  return defeated[first] === second ? [1, 0] : [0, 1]
}

module.exports = { ACTIVITIES, CHOICES, MESSAGE_TYPES, TERMINAL_STATUSES, DICE_CAPABILITY, isDiceRace, sessionRoundScore, assert, isIdentifier, validateEnvelope, hashPayload, roundScore }
