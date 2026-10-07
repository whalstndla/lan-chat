const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('electron', () => {
  const handlers = new Map()
  return { __handlers: handlers, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } }
})
jest.mock('../../electron/utils/appUtils', () => ({
  sendPeerMessage: jest.fn(() => true), broadcastPeerMessage: jest.fn(),
  getCurrentNicknameSafely: () => 'Local', cacheOwnFile: jest.fn(),
  sendToRenderer: jest.fn(), incrementBadge: jest.fn(), showNotification: jest.fn(),
  playNotificationSound: jest.fn(), cacheReceivedFile: jest.fn(), isRoomMuted: () => false,
}))

const { __handlers } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { getDMHistory, getGlobalHistory, getDMHistoryBeforeMessage, getDMHistoryThroughMessage,
  getGlobalHistoryBeforeMessage, getGlobalHistoryThroughMessage, getLatestGlobalMessageTimestamp } = require('../../electron/storage/queries')
const { deriveSharedSecret, encryptDM } = require('../../electron/crypto/encryption')
const { sendToRenderer } = require('../../electron/utils/appUtils')
const { registerMessageHandlers } = require('../../electron/ipcHandlers/message')
const handleDm = require('../../electron/peer/inbound/handlers/dm')
const handleGlobalMessage = require('../../electron/peer/inbound/handlers/message')

const localKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const remoteKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
let context
let clock

beforeEach(() => {
  const database = initDatabase(':memory:')
  migrateDatabase(database)
  context = { state: { database, peerId: 'local', myPrivateKey: localKeys.privateKey,
    peerPublicKeyMap: new Map([['remote', remoteKeys.publicKey]]), mainWindow: { isFocused: () => true } } }
  __handlers.clear()
  sendToRenderer.mockClear()
  clock = jest.spyOn(Date, 'now').mockReturnValue(10000)
  registerMessageHandlers(context)
})
afterEach(() => { clock.mockRestore(); closeDatabase(context.state.database) })

function receiveDm(timestamp, extra = {}) {
  const sharedSecret = deriveSharedSecret(remoteKeys.privateKey, localKeys.publicKey)
  const encryptedPayload = encryptDM({ content: 'Reply', contentType: 'text' }, sharedSecret, 'remote', 'local')
  handleDm({ ctx: context, message: { id: 'reply', type: 'dm', from: 'Remote', fromId: 'remote', to: 'local', timestamp, encryptedPayload, ...extra } })
  return sendToRenderer.mock.calls.find(call => call[1] === 'message-received')[2]
}

it.each([9500, 10000])('keeps a DM reply after my send with a remote timestamp of %i', timestamp => {
  const sent = __handlers.get('send-dm')(null, { recipientPeerId: 'remote', content: 'First', contentType: 'text' })
  const reply = receiveDm(timestamp)
  expect(reply.timestamp).toBe(timestamp)
  expect(getDMHistory(context.state.database, 'local', 'remote').map(message => message.id)).toEqual([sent.id, 'reply'])
  expect(reply.sortTimestamp).toBeGreaterThan(sent.sortTimestamp)
})

it('keeps a global reply after my send despite clock skew', () => {
  const sent = __handlers.get('send-global-message')(null, { content: 'First', contentType: 'text' })
  handleGlobalMessage({ ctx: context, message: { id: 'reply', type: 'message', from: 'Remote', fromId: 'remote', content: 'Reply', contentType: 'text', timestamp: 9500 } })
  expect(getGlobalHistory(context.state.database).map(message => message.id)).toEqual([sent.id, 'reply'])
})

it('keeps my reply after a message from a faster remote clock', () => {
  receiveDm(10500)
  const sent = __handlers.get('send-dm')(null, { recipientPeerId: 'remote', content: 'My reply', contentType: 'text' })
  expect(sent.timestamp).toBe(10000)
  expect(getDMHistory(context.state.database, 'local', 'remote').map(message => message.id)).toEqual(['reply', sent.id])
})

it('preserves historical placement for an offline queued message', () => {
  const sent = __handlers.get('send-dm')(null, { recipientPeerId: 'remote', content: 'First', contentType: 'text' })
  receiveDm(9500, { deferred: true })
  expect(getDMHistory(context.state.database, 'local', 'remote').map(message => message.id)).toEqual(['reply', sent.id])
})

it('uses the same DM order for history pages and search jumps', () => {
  const first = __handlers.get('send-dm')(null, { recipientPeerId: 'remote', content: 'First', contentType: 'text' })
  receiveDm(9500)
  const third = __handlers.get('send-dm')(null, { recipientPeerId: 'remote', content: 'Third', contentType: 'text' })
  expect(getDMHistoryBeforeMessage(context.state.database, 'local', 'remote', third.id).map(message => message.id)).toEqual([first.id, 'reply'])
  expect(getDMHistoryThroughMessage(context.state.database, 'local', 'remote', 'reply').messages.map(message => message.id)).toEqual(['reply', third.id])
})

it('uses the same global order for history pages while keeping the wire sync timestamp', () => {
  const first = __handlers.get('send-global-message')(null, { content: 'First', contentType: 'text' })
  handleGlobalMessage({ ctx: context, message: { id: 'reply', type: 'message', from: 'Remote', fromId: 'remote', content: 'Reply', contentType: 'text', timestamp: 9500 } })
  const third = __handlers.get('send-global-message')(null, { content: 'Third', contentType: 'text' })
  expect(getGlobalHistoryBeforeMessage(context.state.database, third.id).map(message => message.id)).toEqual([first.id, 'reply'])
  expect(getGlobalHistoryThroughMessage(context.state.database, 'reply').messages.map(message => message.id)).toEqual(['reply', third.id])
  expect(getLatestGlobalMessageTimestamp(context.state.database)).toBe(10000)
})

it('preserves ordering after reopening an encrypted database and rerunning migration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-order-'))
  const databasePath = path.join(directory, 'messages.db')
  const masterKey = crypto.randomBytes(32)
  let database = initDatabase(databasePath, masterKey)
  try {
    migrateDatabase(database)
    const persistedContext = { state: { ...context.state, database } }
    registerMessageHandlers(persistedContext)
    const sent = __handlers.get('send-global-message')(null, { content: 'First', contentType: 'text' })
    handleGlobalMessage({ ctx: persistedContext, message: { id: 'reply', type: 'message', from: 'Remote', fromId: 'remote', content: 'Reply', contentType: 'text', timestamp: 9500 } })
    closeDatabase(database)
    database = initDatabase(databasePath, masterKey)
    migrateDatabase(database)
    migrateDatabase(database)
    expect(getGlobalHistory(database).map(message => message.id)).toEqual([sent.id, 'reply'])
    expect(getGlobalHistory(database)[1].timestamp).toBe(9500)
  } finally {
    closeDatabase(database)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
