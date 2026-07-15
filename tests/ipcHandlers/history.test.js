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

// deriveSharedSecret 을 jest.fn 으로 감싸 실제 구현은 그대로 두고 호출 횟수만 추적한다.
// get-dm-history 가 상대(peerId2)당 공유키를 루프 밖에서 1회만 도출하는지(호이스트) 검증하는 데 사용.
jest.mock('../../electron/crypto/encryption', () => {
  const actual = jest.requireActual('../../electron/crypto/encryption')
  return { ...actual, deriveSharedSecret: jest.fn(actual.deriveSharedSecret) }
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

// Phase 4.5 — get-dm-history 성능 호이스트: 상대(peerId2)가 고정인 한 번의 조회에서는
// deriveSharedSecret(ECDH 공유키 도출)을 메시지 개수와 무관하게 1회만 호출해야 한다.
describe('get-dm-history — 공유키 도출 호이스트 (Phase 4.5)', () => {
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

  it('메시지가 여러 건이어도 공유키는 1회만 도출하고, 각 메시지는 호이스트 전과 동일하게 복호화된다', () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)

    const messageCount = 5
    for (let i = 0; i < messageCount; i++) {
      const encryptedPayload = encryptDM(
        { content: `메시지 ${i}`, contentType: 'text', fileUrl: null, fileName: null },
        sharedSecret,
        'peer1',
        'peer2'
      )
      saveMessage(db, {
        id: `dm-${i}`,
        type: 'dm',
        from_id: 'peer1',
        from_name: '나',
        to_id: 'peer2',
        content: null,
        content_type: 'text',
        encrypted_payload: encryptedPayload,
        file_url: null,
        file_name: null,
        timestamp: 1000 + i,
      })
    }

    // 픽스처 생성 과정에서 발생한 호출은 제외하고, 핸들러 호출만 카운트한다.
    deriveSharedSecret.mockClear()

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('get-dm-history')
    const result = handler(null, { peerId1: 'peer1', peerId2: 'peer2' })

    expect(result).toHaveLength(messageCount)
    result.forEach((msg, i) => expect(msg.content).toBe(`메시지 ${i}`))
    // 100건이든 5건이든 상대가 고정이면 도출은 1회 — 루프 밖 호이스트 검증.
    expect(deriveSharedSecret).toHaveBeenCalledTimes(1)
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

// 검색 결과 점프용 rank 조회 핸들러 테스트(#36).
describe('get-global-message-rank / get-dm-message-rank — 검색 결과 점프', () => {
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

  it('전체채팅 — 대상 타임스탬프보다 최신인 메시지 개수를 반환한다', () => {
    const ctx = buildCtx()
    saveMessage(db, {
      id: 'g-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '첫번째', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 1000,
    })
    saveMessage(db, {
      id: 'g-2', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '두번째', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 2000,
    })
    saveMessage(db, {
      id: 'g-3', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '세번째', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 3000,
    })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('get-global-message-rank')
    // g-1 (timestamp=1000) 보다 최신인 메시지는 g-2, g-3 두 개
    expect(handler(null, { timestamp: 1000 })).toBe(2)
    // 가장 최신 메시지보다 최신인 메시지는 없음
    expect(handler(null, { timestamp: 3000 })).toBe(0)
  })

  it('DM — 상대와 나눈 대화 내에서만 rank 를 계산한다', () => {
    const ctx = buildCtx()
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer2',
      content: '오래된 DM', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 1000,
    })
    saveMessage(db, {
      id: 'dm-2', type: 'dm', from_id: 'peer2', from_name: '상대', to_id: 'peer1',
      content: '최근 DM', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 2000,
    })
    // 다른 상대와의 DM — rank 계산에 섞이면 안 됨
    saveMessage(db, {
      id: 'dm-other', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer3',
      content: '다른 상대와의 DM', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 1500,
    })

    registerHistoryHandlers(ctx)
    const handler = __handlers.get('get-dm-message-rank')
    expect(handler(null, { peerId: 'peer2', timestamp: 1000 })).toBe(1)
  })
})

// 답장/인용(#28) — get-dm-history 가 reply_to_id/reply_preview 를 보존하는지 검증.
// DM 은 reply 메타를 암호화 페이로드 안에 실어 보내므로, (1) 평문 컬럼에 저장된 경우와
// (2) 키 교환 이전 암호문만 저장된(컬럼 null) 경우 모두 복호화로 복원되어야 한다.
describe('get-dm-history — 답장 메타(#28) 보존', () => {
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

  it('평문 reply 컬럼에 저장된 답장 메타를 그대로 반환한다', () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content: '답장 내용', contentType: 'text', fileUrl: null, fileName: null, replyToId: 'orig-1', replyPreview: { fromName: '상대', snippet: '원본' } },
      sharedSecret, 'peer1', 'peer2'
    )
    saveMessage(db, {
      id: 'dm-reply', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer2',
      content: null, content_type: 'text', encrypted_payload: encryptedPayload,
      file_url: null, file_name: null, timestamp: 1000,
      reply_to_id: 'orig-1', reply_preview: JSON.stringify({ fromName: '상대', snippet: '원본' }),
    })

    registerHistoryHandlers(ctx)
    const result = __handlers.get('get-dm-history')(null, { peerId1: 'peer1', peerId2: 'peer2' })
    expect(result[0].reply_to_id).toBe('orig-1')
    expect(JSON.parse(result[0].reply_preview)).toEqual({ fromName: '상대', snippet: '원본' })
  })

  it('컬럼이 비어있어도(키 교환 이전 암호문) 복호화 페이로드에서 답장 메타를 복원한다', () => {
    const ctx = buildCtx()
    const sharedSecret = deriveSharedSecret(peer1.privateKey, peer2.publicKey)
    const encryptedPayload = encryptDM(
      { content: '답장 내용', contentType: 'text', fileUrl: null, fileName: null, replyToId: 'orig-2', replyPreview: { fromName: '상대', snippet: '스니펫' } },
      sharedSecret, 'peer2', 'peer1'
    )
    // saveCiphertextOnly 경로 재현 — reply 컬럼은 null, 데이터는 암호문 안에만 존재
    saveMessage(db, {
      id: 'dm-cipher', type: 'dm', from_id: 'peer2', from_name: '상대', to_id: 'peer1',
      content: null, content_type: 'text', encrypted_payload: encryptedPayload,
      file_url: null, file_name: null, timestamp: 2000,
    })

    registerHistoryHandlers(ctx)
    const result = __handlers.get('get-dm-history')(null, { peerId1: 'peer1', peerId2: 'peer2' })
    expect(result[0].reply_to_id).toBe('orig-2')
    expect(JSON.parse(result[0].reply_preview)).toEqual({ fromName: '상대', snippet: '스니펫' })
  })
})
