// Electron 런타임이 없는 테스트 환경에서 electron 모듈을 스텁한다.
// 각 node 인스턴스별로 고유한 handlers Map을 생성해 IPC 호출을 테스트에서 직접 실행 가능.

function createMockElectron() {
  const handlers = new Map()
  const mockApp = {
    getVersion: () => '0.0.0-test',
    getPath: () => process.env.HARNESS_TMP_DIR || require('os').tmpdir(),
    getName: () => 'lan-chat-test',
    isPackaged: false,
    dock: null,
    quit: () => {},
    whenReady: () => Promise.resolve(),
    on: () => {},
    requestSingleInstanceLock: () => true,
  }
  const mockIpcMain = {
    handle: (channel, fn) => { handlers.set(channel, fn) },
    on: () => {},
    removeHandler: (channel) => { handlers.delete(channel) },
  }
  class MockNotification {
    constructor() {}
    show() {}
    on() {}
    static isSupported() { return false }
  }
  class MockBrowserWindow {}
  class MockTray {
    setToolTip() {}
    setContextMenu() {}
    on() {}
  }
  const mockMenu = {
    buildFromTemplate: () => ({}),
    setApplicationMenu: () => {},
  }
  const mockNativeImage = {
    createFromPath: () => ({ resize: () => ({}) }),
  }
  const mockShell = {
    openExternal: () => {},
    openPath: () => Promise.resolve(''),
    showItemInFolder: () => {},
  }
  const mockClipboard = {
    writeImage: () => {},
    readText: () => '',
    writeText: () => {},
  }
  const mockDialog = {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
    showMessageBox: () => Promise.resolve({ response: 0 }),
  }

  return {
    api: {
      app: mockApp,
      ipcMain: mockIpcMain,
      Notification: MockNotification,
      BrowserWindow: MockBrowserWindow,
      Tray: MockTray,
      Menu: mockMenu,
      nativeImage: mockNativeImage,
      shell: mockShell,
      clipboard: mockClipboard,
      dialog: mockDialog,
    },
    handlers,
  }
}

module.exports = { createMockElectron }
