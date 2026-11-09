const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('electron', () => {
  const handlers = new Map()
  return { __handlers: handlers, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
})

const { __handlers } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, pinKey, getDMHistory } = require('../../electron/storage/queries')
const { deriveSharedSecret, encryptDM } = require('../../electron/crypto/encryption')
const { exportPublicKey } = require('../../electron/crypto/keyManager')
const { registerHistoryHandlers } = require('../../electron/ipcHandlers/history')

describe('offline DM history after an encrypted database restart', () => {
  let directory
  let database
  let databasePath
  let masterKey
  let localKeys
  let remoteKeys

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-history-restart-'))
    databasePath = path.join(directory, 'chat.db')
    masterKey = crypto.randomBytes(32)
    localKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    remoteKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    database = initDatabase(databasePath, masterKey)
    migrateDatabase(database)
    pinKey(database, { peerId: 'remote', publicKey: exportPublicKey(remoteKeys.publicKey), firstSeen: 1 })
    const secret = deriveSharedSecret(localKeys.privateKey, remoteKeys.publicKey)
    for (const [index, fromId, toId] of [[1, 'local', 'remote'], [2, 'remote', 'local']]) {
      saveMessage(database, {
        id: `message-${index}`, type: 'dm', from_id: fromId, from_name: fromId, to_id: toId,
        content: null, content_type: 'text', file_url: null, file_name: null, timestamp: index,
        encrypted_payload: encryptDM({ content: `Saved message ${index}`, contentType: 'text' }, secret, fromId, toId),
      })
    }
    closeDatabase(database)
    database = initDatabase(databasePath, masterKey)
    migrateDatabase(database)
    __handlers.clear()
  })

  afterEach(() => {
    closeDatabase(database)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function register() {
    const context = { state: { database, peerId: 'local', myPrivateKey: localKeys.privateKey, peerPublicKeyMap: new Map() } }
    registerHistoryHandlers(context)
    return context
  }

  it('restores both directions while the peer is offline and the session key map is empty', () => {
    expect(getDMHistory(database, 'local', 'remote')).toHaveLength(2)
    const context = register()
    context.state.peerPublicKeyMap.set('remote', remoteKeys.publicKey)
    expect(__handlers.get('get-dm-history')(null, { peerId1: 'local', peerId2: 'remote' })
      .map(message => message.content)).toEqual(['Saved message 1', 'Saved message 2'])
    context.state.peerPublicKeyMap.clear()
    const result = __handlers.get('get-dm-history')(null, { peerId1: 'local', peerId2: 'remote' })
    expect(result.map(message => message.content)).toEqual(['Saved message 1', 'Saved message 2'])
    expect(context.state.peerPublicKeyMap.size).toBe(0)
    expect(__handlers.get('search-dm-messages')(null, { peerId: 'remote', query: 'Saved' })).toHaveLength(2)
  })

  it('marks unavailable keys without inventing plaintext or accepting a new peer key', () => {
    database.prepare('DELETE FROM peer_keys').run()
    register()
    const result = __handlers.get('get-dm-history')(null, { peerId1: 'local', peerId2: 'remote' })
    expect(result.every(message => message.content === null && message.decryptionFailed)).toBe(true)
  })
})
