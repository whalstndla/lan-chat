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

// search-dm-messages IPC 핸들러 테스트(#35).
// DM 검색이 클라이언트에 이미 로드된 메시지만 필터링하던 문제를 고쳐, main 프로세스가
// 상대와 나눈 전체 기간의 DM 을 복호화하며 검색하는지 검증한다.
describe('search-dm-messages — DM 전체 기간 검색', () => {
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

  function saveEncryptedDM({ id, fromId, toId, content, contentType = 'text', fileName = null, timestamp }) {
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content, contentType, fileUrl: null, fileName },
      sharedSecret,
      fromId,
      toId
    )
    saveMessage(db, {
      id, type: 'dm', from_id: fromId, from_name: fromId === 'peer1' ? '나' : '상대', to_id: toId,
      content: null, content_type: contentType, encrypted_payload: encryptedPayload,
      file_url: null, file_name: fileName, timestamp,
    })
  }

  it('스크롤로 화면에 로드되지 않은(=메모리에 없는) 과거 DM 도 전체 검색으로 찾아낸다', () => {
    const ctx = buildCtx()
    // "과거" 메시지 — 클라이언트가 스크롤을 올리지 않아 메모리에 없다고 가정
    saveEncryptedDM({ id: 'dm-old', fromId: 'peer1', toId: 'peer2', content: '오래된 회의 자료입니다', timestamp: 1000 })
    // "최근" 메시지 — 클라이언트 메모리에 이미 로드되어 있다고 가정
    saveEncryptedDM({ id: 'dm-recent', fromId: 'peer2', toId: 'peer1', content: '오늘 점심 뭐 먹지', timestamp: 9000 })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('search-dm-messages')
    const results = handler(null, { peerId: 'peer2', query: '회의' })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('dm-old')
    expect(results[0].content).toBe('오래된 회의 자료입니다')
  })

  it('결과 형식이 전역 검색 결과와 동일한 필드(id/from_name/content/timestamp)를 갖는다', () => {
    const ctx = buildCtx()
    saveEncryptedDM({ id: 'dm-1', fromId: 'peer1', toId: 'peer2', content: '형식 확인용 메시지', timestamp: 1000 })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('search-dm-messages')
    const results = handler(null, { peerId: 'peer2', query: '형식' })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'dm-1', from_name: '나', content: '형식 확인용 메시지', timestamp: 1000,
    })
  })

  it('파일명으로도 DM 검색이 가능하다', () => {
    const ctx = buildCtx()
    saveEncryptedDM({
      id: 'dm-file', fromId: 'peer1', toId: 'peer2', content: null,
      contentType: 'file', fileName: '계약서_최종.pdf', timestamp: 1000,
    })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('search-dm-messages')
    const results = handler(null, { peerId: 'peer2', query: '계약서' })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('dm-file')
  })

  it('일치하는 메시지가 없으면 빈 배열을 반환한다', () => {
    const ctx = buildCtx()
    saveEncryptedDM({ id: 'dm-1', fromId: 'peer1', toId: 'peer2', content: '아무 내용', timestamp: 1000 })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('search-dm-messages')
    expect(handler(null, { peerId: 'peer2', query: '없는단어' })).toHaveLength(0)
  })

  it('빈 검색어는 빈 배열을 반환한다', () => {
    const ctx = buildCtx()
    registerHistoryHandlers(ctx)
    const handler = __handlers.get('search-dm-messages')
    expect(handler(null, { peerId: 'peer2', query: '  ' })).toHaveLength(0)
  })
})
