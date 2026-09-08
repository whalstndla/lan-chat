jest.mock('electron', () => {
  const { EventEmitter } = require('events')
  const ipcRenderer = new EventEmitter()
  ipcRenderer.invoke = jest.fn()
  return { ipcRenderer, contextBridge: { exposeInMainWorld: jest.fn() } }
})

const { ipcRenderer, contextBridge } = require('electron')
require('../../electron/preload')
const api = contextBridge.exposeInMainWorld.mock.calls[0][1]

describe('Lanpet preload subscriptions', () => {
  afterEach(() => ipcRenderer.removeAllListeners())

  it('strips privileged IPC events and unsubscribes only its own listener', () => {
    const first = jest.fn()
    const second = jest.fn()
    const unsubscribe = api.lanpet.onChanged(first)
    api.lanpet.onChanged(second)
    const snapshot = { pet: { name: 'Sprout' } }
    ipcRenderer.emit('lanpet:changed', { sender: 'privileged' }, snapshot)
    expect(first).toHaveBeenCalledWith(snapshot)
    unsubscribe()
    ipcRenderer.emit('lanpet:changed', {}, snapshot)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('keeps pet events isolated from chat listener cleanup', () => {
    const listener = jest.fn()
    api.lanpet.onChanged(listener)
    api.unsubscribeAll()
    ipcRenderer.emit('lanpet:changed', {}, { enabled: true })
    expect(listener).toHaveBeenCalledWith({ enabled: true })
  })
})
