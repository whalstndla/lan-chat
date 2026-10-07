jest.mock('electron', () => {
  const { EventEmitter } = require('events')
  return { ipcRenderer: new EventEmitter(), contextBridge: { exposeInMainWorld: jest.fn() } }
})

const { ipcRenderer, contextBridge } = require('electron')
require('../../electron/preload')
const api = contextBridge.exposeInMainWorld.mock.calls[0][1]

describe('update subscriptions', () => {
  afterEach(() => ipcRenderer.removeAllListeners())

  it.each([
    ['onUpdateAvailable', 'update-available'],
    ['onUpdateNotAvailable', 'update-not-available'],
    ['onUpdateDownloaded', 'update-downloaded'],
    ['onUpdateError', 'update-error'],
    ['onDownloadProgress', 'update-download-progress'],
  ])('%s keeps the title bar subscribed when settings subscribes', (method, channel) => {
    const titleBar = jest.fn()
    const settings = jest.fn()
    const unsubscribe = api[method](titleBar)
    api[method](settings)
    ipcRenderer.emit(channel, {}, 'update-result')
    expect(titleBar).toHaveBeenCalledTimes(1)
    expect(settings).toHaveBeenCalledTimes(1)
    unsubscribe()
    ipcRenderer.emit(channel, {}, 'update-result')
    expect(titleBar).toHaveBeenCalledTimes(1)
    expect(settings).toHaveBeenCalledTimes(2)
  })
})
