const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('electron', () => {
  const handlers = new Map()
  return { __handlers: handlers, ipcMain: { handle: (name, callback) => handlers.set(name, callback) } }
})
jest.mock('../../electron/peer/fileServer', () => ({ getFilePort: () => 12345 }))
jest.mock('../../electron/utils/appUtils', () => {
  const actual = jest.requireActual('../../electron/utils/appUtils')
  return { ...actual, broadcastPeerMessage: jest.fn() }
})

const { __handlers } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveProfile } = require('../../electron/storage/profile')
const { broadcastPeerMessage, buildMyProfileImageUrl } = require('../../electron/utils/appUtils')
const { registerUserHandlers } = require('../../electron/ipcHandlers/user')

it('advertises a fresh avatar URL to connected peers when the image is replaced', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-avatar-'))
  const database = initDatabase(':memory:')
  migrateDatabase(database)
  fs.mkdirSync(path.join(directory, 'profile'))
  const context = { config: { appDataPath: directory }, state: {
    database, peerId: 'local', localIP: '127.0.0.1', localAddressCandidates: ['127.0.0.1'],
    mySessionId: 'session', myPublicKeyBase64: 'test-public-key',
  } }
  try {
    await saveProfile(database, { username: 'local', nickname: 'Local', password: 'fixture-password' })
    registerUserHandlers(context)
    const first = __handlers.get('save-profile-image')(null, Uint8Array.from([1, 2, 3]))
    fs.utimesSync(path.join(directory, 'profile/avatar.png'), new Date(1000), new Date(1000))
    const previousUrl = buildMyProfileImageUrl(context)
    broadcastPeerMessage.mockClear()
    const second = __handlers.get('save-profile-image')(null, Uint8Array.from([4, 5, 6]))
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(second.url).not.toBe(previousUrl)
    expect(broadcastPeerMessage).toHaveBeenCalledWith(context, expect.objectContaining({
      type: 'hello', profileImageUrl: second.url,
    }))
  } finally {
    closeDatabase(database)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
