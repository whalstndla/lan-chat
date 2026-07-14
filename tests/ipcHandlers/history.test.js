// get-dm-history IPC 핸들러 단위 테스트
// 버그(#3): DM 수정 후 재조회 시 encrypted_payload 를 복호화한 수정 전 내용으로
// content 가 덮어써져서 "수정된 메시지가 재시작 후 원본으로 롤백"되던 문제 검증.

const crypto = require('crypto')

// electron 은 npm 패키지가 Electron 런타임 밖에서 require 되면 실행 파일 경로 문자열을
// 반환한다 — ipcMain.handle 을 직접 스텁해 등록된 핸들러를 테스트에서 호출한다.
jest.mock('electron', () => {
  const handlers = new Map()
  return {
    __handlers: handlers,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
  }
})

const { __handlers } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, editMessage } = require('../../electron/storage/queries')
const { deriveSharedSecret, encryptDM } = require('../../electron/crypto/encryption')
const { registerHistoryHandlers } = require('../../electron/ipcHandlers/history')

function generateKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('get-dm-history — 수정된 DM 메시지 표시', () => {
  let db
  const peer1 = generateKeyPair()
  const peer2 = generateKeyPair()

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    __handlers.clear()
  })

  afterEach(() => closeDatabase(db))

  function buildCtx() {
    return {
      state: {
        database: db,
        peerId: 'peer1',
        myPrivateKey: peer1.privateKey,
        peerPublicKeyMap: new Map([['peer2', peer2.publicKey]]),
        localIP: 'localhost',
      },
    }
  }

  it('수정 후 재조회하면 수정된 내용을 반환한다 (원본으로 롤백되지 않음)', () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content: '원본 메시지', contentType: 'text', fileUrl: null, fileName: null },
      sharedSecret,
      'peer1',
      'peer2'
    )

    saveMessage(db, {
      id: 'dm-1',
      type: 'dm',
      from_id: 'peer1',
      from_name: '나',
      to_id: 'peer2',
      content: null,
      content_type: 'text',
      encrypted_payload: encryptedPayload,
      file_url: null,
      file_name: null,
      timestamp: Date.now(),
    })

    // 메시지 수정 — content 컬럼만 갱신되고 encrypted_payload 는 원문 그대로 남는다
    editMessage(db, { messageId: 'dm-1', fromId: 'peer1', newContent: '수정된 메시지' })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('get-dm-history')
    const result = handler(null, { peerId1: 'peer1', peerId2: 'peer2' })

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('수정된 메시지')
    expect(result[0].edited_at).toBeGreaterThan(0)
  })

  it('수정하지 않은 메시지는 기존과 동일하게 복호화된 내용을 반환한다', () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content: '수정 안 한 메시지', contentType: 'text', fileUrl: null, fileName: null },
      sharedSecret,
      'peer1',
      'peer2'
    )

    saveMessage(db, {
      id: 'dm-2',
      type: 'dm',
      from_id: 'peer1',
      from_name: '나',
      to_id: 'peer2',
      content: null,
      content_type: 'text',
      encrypted_payload: encryptedPayload,
      file_url: null,
      file_name: null,
      timestamp: Date.now(),
    })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('get-dm-history')
    const result = handler(null, { peerId1: 'peer1', peerId2: 'peer2' })

    expect(result[0].content).toBe('수정 안 한 메시지')
  })
})
