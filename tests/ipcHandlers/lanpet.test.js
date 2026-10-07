jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }))
jest.mock('../../electron/lanpet/service', () => ({ getLanpetService: jest.fn() }), { virtual: true })

const { ipcMain } = require('electron')
const { getLanpetService } = require('../../electron/lanpet/service')
const { registerLanpetHandlers } = require('../../electron/ipcHandlers/lanpet')

describe('Lanpet IPC security boundary', () => {
  let context, event, handlers, service

  beforeEach(() => {
    jest.clearAllMocks()
    const webContents = { isDestroyed: () => false, mainFrame: {}, send: jest.fn() }
    context = { state: {
      mainWindow: { isDestroyed: () => false, webContents },
      database: {}, peerId: 'local-peer', masterKey: Buffer.alloc(32), isSessionClosing: false,
    } }
    event = { sender: webContents, senderFrame: webContents.mainFrame }
    service = { getSnapshot: jest.fn(() => ({ pet: { name: 'Sprout' } })), command: jest.fn(() => ({ ok: true })), subscribe: jest.fn() }
    getLanpetService.mockReturnValue(service)
    registerLanpetHandlers(context)
    handlers = new Map(ipcMain.handle.mock.calls)
  })

  it('returns the authenticated pet snapshot to the main frame', () => {
    expect(handlers.get('lanpet:get-snapshot')(event)).toEqual({ pet: { name: 'Sprout' } })
  })

  it.each(['foreign-window', 'child-frame', 'missing-frame'])('rejects %s without opening the pet store', async (kind) => {
    const untrusted = { ...event }
    if (kind === 'foreign-window') untrusted.sender = {}
    if (kind === 'child-frame') untrusted.senderFrame = {}
    if (kind === 'missing-frame') delete untrusted.senderFrame
    expect(handlers.get('lanpet:get-snapshot')(untrusted).pet).toBeNull()
    expect(await handlers.get('lanpet:command')(untrusted, { type: 'care' })).toMatchObject({ ok: false, code: 'UNTRUSTED_SENDER' })
    expect(getLanpetService).not.toHaveBeenCalled()
  })

  it('rejects commands while the account is closing', async () => {
    context.state.isSessionClosing = true
    expect(await handlers.get('lanpet:command')(event, { type: 'delete' })).toMatchObject({ code: 'SESSION_CLOSED' })
    expect(getLanpetService).not.toHaveBeenCalled()
  })

  it.each([null, [], { type: 'eval' }, { type: 'create', name: 'x'.repeat(17000) }])('rejects malformed or oversized input', async (command) => {
    expect(await handlers.get('lanpet:command')(event, command)).toMatchObject({ code: 'INVALID_COMMAND' })
    expect(service.command).not.toHaveBeenCalled()
  })

  it('does not leak a previous account snapshot after an in-flight command', async () => {
    let complete
    service.command.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = handlers.get('lanpet:command')(event, { type: 'care', action: 'care' })
    context.state.database = {}
    context.state.peerId = 'next-account'
    complete({ ok: true, snapshot: { pet: { name: 'Private pet' } } })
    expect(await pending).toEqual({ ok: false, code: 'SESSION_CLOSED', message: '다시 로그인해 주세요.' })
  })

  it('contains migration failure without returning internal paths or crashing chat', () => {
    getLanpetService.mockImplementation(() => { throw new Error('/private/account/chat.db') })
    const result = handlers.get('lanpet:get-snapshot')(event)
    expect(result.error.code).toBe('LANPET_UNAVAILABLE')
    expect(JSON.stringify(result)).not.toContain('/private/account')
  })

  it('sends one committed peer update per turn without duplicating service subscriptions', async () => {
    handlers.get('lanpet:get-snapshot')(event)
    handlers.get('lanpet:get-snapshot')(event)
    expect(service.subscribe).toHaveBeenCalledTimes(1)
    const changed = service.subscribe.mock.calls[0][0]
    changed()
    changed()
    expect(context.state.mainWindow.webContents.send).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(context.state.mainWindow.webContents.send).toHaveBeenCalledTimes(1)
    expect(context.state.mainWindow.webContents.send).toHaveBeenCalledWith('lanpet:changed', { pet: { name: 'Sprout' } })
  })

  it('drops an event queued immediately before logout', async () => {
    handlers.get('lanpet:get-snapshot')(event)
    service.subscribe.mock.calls[0][0]()
    context.state.isSessionClosing = true
    await Promise.resolve()
    expect(context.state.mainWindow.webContents.send).not.toHaveBeenCalled()
  })
})
