// tests/ipcHandlers/file.test.js
// 기본 다운로드 폴더 설정(#74) IPC 핸들러 단위 테스트 — get-download-folder / set-download-folder,
// 그리고 download-file 이 설정된 폴더를 저장 다이얼로그 기본 경로로 사용하는지 검증.

const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('electron', () => {
  const handlers = new Map()
  return {
    __handlers: handlers,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
    dialog: {
      showOpenDialog: jest.fn(),
      showSaveDialog: jest.fn(),
    },
    app: {
      getPath: jest.fn(() => '/os/default/downloads'),
    },
    shell: { showItemInFolder: jest.fn() },
  }
})

jest.mock('../../electron/peer/fileServer', () => ({ getFilePort: () => 50000 }))
jest.mock('../../electron/peer/fileChunkTransfer', () => ({ cancelInboundTransferByMessageId: jest.fn() }))

const { __handlers, dialog } = require('electron')
const { registerFileHandlers } = require('../../electron/ipcHandlers/file')
const { saveDownloadFolderPath, loadDownloadFolderPath } = require('../../electron/utils/downloadFolder')

describe('다운로드 폴더 설정(#74) IPC 핸들러', () => {
  let appDataDir
  let chosenFolderDir

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-file-ipc-appdata-'))
    chosenFolderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-file-ipc-chosen-'))
    __handlers.clear()
    dialog.showOpenDialog.mockReset()
    dialog.showSaveDialog.mockReset()
  })

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true })
    fs.rmSync(chosenFolderDir, { recursive: true, force: true })
  })

  function buildCtx() {
    return { state: { mainWindow: null, database: null }, config: { appDataPath: appDataDir } }
  }

  it('get-download-folder — 설정이 없으면 folderPath 는 null, osDefaultPath 는 OS 기본 경로', async () => {
    const ctx = buildCtx()
    registerFileHandlers(ctx)
    const result = await __handlers.get('get-download-folder')()
    expect(result).toEqual({ folderPath: null, osDefaultPath: '/os/default/downloads' })
  })

  it('set-download-folder — 폴더 선택 다이얼로그 결과를 저장하고 반환한다', async () => {
    const ctx = buildCtx()
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [chosenFolderDir] })
    registerFileHandlers(ctx)

    const result = await __handlers.get('set-download-folder')()
    expect(result).toEqual({ ok: true, folderPath: chosenFolderDir })
    expect(loadDownloadFolderPath(appDataDir)).toBe(chosenFolderDir)
  })

  it('set-download-folder — 다이얼로그를 취소하면 저장하지 않는다', async () => {
    const ctx = buildCtx()
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerFileHandlers(ctx)

    const result = await __handlers.get('set-download-folder')()
    expect(result).toEqual({ ok: false, canceled: true })
    expect(loadDownloadFolderPath(appDataDir)).toBeNull()
  })

  it('get-download-folder — 설정 후에는 저장된 folderPath 를 반환한다', async () => {
    const ctx = buildCtx()
    saveDownloadFolderPath(appDataDir, chosenFolderDir)
    registerFileHandlers(ctx)

    const result = await __handlers.get('get-download-folder')()
    expect(result.folderPath).toBe(chosenFolderDir)
  })

  it('download-file — 사용자 지정 폴더가 있으면 저장 다이얼로그 기본 경로로 사용한다', async () => {
    const ctx = buildCtx()
    saveDownloadFolderPath(appDataDir, chosenFolderDir)

    // getFileForDownload 가 조회할 캐시 파일을 실제로 준비 (평문 캐시 — isEncryptedFile 이 false 로 판정)
    const cachedFilePath = path.join(appDataDir, 'cached-source.bin')
    fs.writeFileSync(cachedFilePath, Buffer.from('plain content'))
    ctx.state.database = {
      prepare: () => ({
        get: () => ({ file_name: '원본.txt', cached_file_path: cachedFilePath }),
      }),
    }
    dialog.showSaveDialog.mockResolvedValue({ canceled: true }) // 실제 저장까지는 검증하지 않고 defaultPath 인자만 확인

    registerFileHandlers(ctx)
    await __handlers.get('download-file')(null, 'msg-1')

    // resolveDownloadFolderPath 는 OS 기본 경로를 폴백 인자로 항상 평가하지만(app.getPath 호출),
    // 사용자 지정 폴더가 유효하면 실제로는 그 경로가 우선 사용되어야 한다.
    expect(dialog.showSaveDialog).toHaveBeenCalledWith({ defaultPath: path.join(chosenFolderDir, '원본.txt') })
  })
})
