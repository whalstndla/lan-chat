// tests/ipcHandlers/data.test.js
// 데이터 관리 IPC 핸들러 단위 테스트(#74) — 채팅 내보내기(export-chat-history),
// 저장소 사용량 조회(get-storage-usage), 캐시 비우기(clear-file-cache).

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

// electron 은 npm 패키지가 Electron 런타임 밖에서 require 되면 실행 파일 경로 문자열을
// 반환한다 — ipcMain.handle 을 직접 스텁해 등록된 핸들러를 테스트에서 호출한다.
// dialog/app 도 함께 스텁해 실제 OS 다이얼로그 없이 저장 경로를 제어한다.
jest.mock('electron', () => {
  const handlers = new Map()
  return {
    __handlers: handlers,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
    dialog: {
      showSaveDialog: jest.fn(),
    },
    app: {
      // jest.mock 팩토리는 외부 스코프 변수(os 등)를 참조할 수 없어 리터럴 경로를 사용한다.
      // export-chat-history 는 dialog.showSaveDialog 를 항상 mock 으로 대체하므로 이 값 자체는
      // 테스트에서 실제로 쓰이지 않는다(호출 인자로만 평가됨).
      getPath: jest.fn(() => '/mock/os/downloads'),
    },
  }
})

const { __handlers, dialog } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, saveFileCache } = require('../../electron/storage/queries')
const { deriveSharedSecret, encryptDM } = require('../../electron/crypto/encryption')
const { registerDataHandlers } = require('../../electron/ipcHandlers/data')

// appUtils.js(history.js 의존)가 require 하는 peer 모듈은 실제 네트워크를 열지 않으므로 그대로 둔다.
jest.mock('../../electron/peer/fileServer', () => ({ getFilePort: () => 50000 }))

function generateKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('export-chat-history — 채팅 내보내기(#74)', () => {
  let db
  let tempDir
  const peer1 = generateKeyPair()
  const peer2 = generateKeyPair()

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-export-'))
    __handlers.clear()
    dialog.showSaveDialog.mockReset()
  })

  afterEach(() => {
    closeDatabase(db)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function buildCtx() {
    return {
      state: {
        database: db,
        peerId: 'peer1',
        myPrivateKey: peer1.privateKey,
        peerPublicKeyMap: new Map([['peer2', peer2.publicKey]]),
        mainWindow: null,
        localIP: 'localhost',
      },
      config: { appDataPath: tempDir },
    }
  }

  it('전체채팅을 txt 로 내보내면 시각순 "시각 발신자: 내용" 라인으로 저장된다', async () => {
    const ctx = buildCtx()
    saveMessage(db, { id: 'g-2', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null, content: '두번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000 })
    saveMessage(db, { id: 'g-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null, content: '첫번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000 })

    const outputPath = path.join(tempDir, 'export.txt')
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })

    registerDataHandlers(ctx)
    const result = await __handlers.get('export-chat-history')(null, { scope: 'global', format: 'txt' })

    expect(result).toEqual({ ok: true, path: outputPath })
    const content = fs.readFileSync(outputPath, 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('홍길동: 첫번째')
    expect(lines[1]).toContain('홍길동: 두번째')
  })

  it('DM을 json 으로 내보내면 history.js 의 복호화 경로를 재사용해 평문 content 로 저장된다', async () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content: 'DM 비밀 내용', contentType: 'text', fileUrl: null, fileName: null },
      sharedSecret, 'peer1', 'peer2'
    )
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer2',
      content: null, content_type: 'text', encrypted_payload: encryptedPayload,
      file_url: null, file_name: null, timestamp: 1000,
    })

    const outputPath = path.join(tempDir, 'export.json')
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })

    registerDataHandlers(ctx)
    const result = await __handlers.get('export-chat-history')(null, { scope: 'dm', peerId: 'peer2', format: 'json' })

    expect(result.ok).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].content).toBe('DM 비밀 내용') // 암호문이 아니라 복호화된 평문이어야 함
    expect(parsed[0].from).toBe('나')
  })

  it('배치 크기(500)를 초과하는 대량 히스토리도 시간순을 유지하며 전부 내보낸다', async () => {
    const ctx = buildCtx()
    const totalMessages = 550
    for (let i = 0; i < totalMessages; i++) {
      saveMessage(db, {
        id: `g-${i}`, type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
        content: `메시지-${i}`, content_type: 'text', encrypted_payload: null,
        file_url: null, file_name: null, timestamp: 1000 + i,
      })
    }

    const outputPath = path.join(tempDir, 'export-large.json')
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })

    registerDataHandlers(ctx)
    const result = await __handlers.get('export-chat-history')(null, { scope: 'global', format: 'json' })

    expect(result.ok).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    expect(parsed).toHaveLength(totalMessages)
    expect(parsed[0].content).toBe('메시지-0')
    expect(parsed[totalMessages - 1].content).toBe(`메시지-${totalMessages - 1}`)
  }, 15000)

  it('저장 다이얼로그를 취소하면 파일을 쓰지 않고 canceled 를 반환한다', async () => {
    const ctx = buildCtx()
    saveMessage(db, { id: 'g-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null, content: '내용', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000 })
    dialog.showSaveDialog.mockResolvedValue({ canceled: true })

    registerDataHandlers(ctx)
    const result = await __handlers.get('export-chat-history')(null, { scope: 'global', format: 'txt' })

    expect(result).toEqual({ ok: false, canceled: true })
    expect(dialog.showSaveDialog).toHaveBeenCalled()
  })

  it('scope 이 dm 인데 peerId 가 없으면 다이얼로그를 띄우지 않고 에러를 반환한다', async () => {
    const ctx = buildCtx()
    registerDataHandlers(ctx)
    const result = await __handlers.get('export-chat-history')(null, { scope: 'dm', format: 'txt' })

    expect(result).toEqual({ ok: false, error: 'missingPeerId' })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('잘못된 scope/format 은 에러를 반환한다', async () => {
    const ctx = buildCtx()
    registerDataHandlers(ctx)
    const handler = __handlers.get('export-chat-history')
    expect(await handler(null, { scope: 'invalid', format: 'txt' })).toEqual({ ok: false, error: 'invalidScope' })
    expect(await handler(null, { scope: 'global', format: 'csv' })).toEqual({ ok: false, error: 'invalidFormat' })
  })
})
