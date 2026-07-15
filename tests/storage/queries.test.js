// tests/storage/queries.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const {
  saveMessage,
  getGlobalHistory,
  getDMHistory,
  getGlobalMessagesSince,
  getLatestGlobalMessageTimestamp,
  getGlobalMessagesForExport,
  getDMMessagesForExport,
} = require('../../electron/storage/queries')

describe('메시지 쿼리', () => {
  let db

  beforeEach(() => { db = initDatabase(':memory:') })
  afterEach(() => { closeDatabase(db) })

  it('전체채팅 메시지를 저장하고 조회함', () => {
    const message = {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '안녕', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now()
    }
    saveMessage(db, message)
    const result = getGlobalHistory(db)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('안녕')
  })

  it('DM 메시지를 저장하고 조회함', () => {
    const dmMessage = {
      id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '홍길동',
      to_id: 'peer2', content: null, content_type: 'text',
      encrypted_payload: 'base64encrypted==', file_url: null, file_name: null, timestamp: Date.now()
    }
    saveMessage(db, dmMessage)
    const result = getDMHistory(db, 'peer1', 'peer2')
    expect(result).toHaveLength(1)
    expect(result[0].encrypted_payload).toBe('base64encrypted==')
  })

  it('답장(#28) reply_to_id/reply_preview 를 저장하고 조회함', () => {
    const replyPreview = JSON.stringify({ fromName: '홍길동', snippet: '원본 메시지' })
    saveMessage(db, {
      id: 'msg-reply', type: 'message', from_id: 'peer2', from_name: '김철수',
      to_id: null, content: '답장입니다', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
      reply_to_id: 'msg-original', reply_preview: replyPreview,
    })
    const result = getGlobalHistory(db)
    expect(result).toHaveLength(1)
    expect(result[0].reply_to_id).toBe('msg-original')
    expect(JSON.parse(result[0].reply_preview)).toEqual({ fromName: '홍길동', snippet: '원본 메시지' })
  })

  it('답장 필드 미지정 메시지는 reply 컬럼이 null 로 저장됨(하위호환)', () => {
    saveMessage(db, {
      id: 'msg-plain', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '일반 메시지', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
    const result = getGlobalHistory(db)
    expect(result[0].reply_to_id).toBeNull()
    expect(result[0].reply_preview).toBeNull()
  })

  it('@멘션(#29) mentions 를 저장하고 조회함', () => {
    saveMessage(db, {
      id: 'msg-mention', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '@철수 확인해줘', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
      mentions: JSON.stringify(['peer2']),
    })
    const result = getGlobalHistory(db)
    expect(JSON.parse(result[0].mentions)).toEqual(['peer2'])
  })

  it('멘션 필드 미지정 메시지는 mentions 컬럼이 null 로 저장됨(하위호환)', () => {
    saveMessage(db, {
      id: 'msg-no-mention', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '일반 메시지', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
    const result = getGlobalHistory(db)
    expect(result[0].mentions).toBeNull()
  })
})

describe('#31 히스토리 동기화 쿼리 — getGlobalMessagesSince / getLatestGlobalMessageTimestamp', () => {
  let db

  // 지정한 timestamp 로 전체채팅 메시지 하나를 저장하는 헬퍼
  function insertGlobal(id, timestamp, content = 'hi') {
    saveMessage(db, {
      id, type: 'message', from_id: 'peerX', from_name: '테스터',
      to_id: null, content, content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp,
    })
  }

  beforeEach(() => { db = initDatabase(':memory:') })
  afterEach(() => { closeDatabase(db) })

  it('getLatestGlobalMessageTimestamp: 메시지가 없으면 0 을 반환', () => {
    expect(getLatestGlobalMessageTimestamp(db)).toBe(0)
  })

  it('getLatestGlobalMessageTimestamp: 가장 최근 전체채팅 timestamp 를 반환', () => {
    insertGlobal('m1', 1000)
    insertGlobal('m2', 3000)
    insertGlobal('m3', 2000)
    expect(getLatestGlobalMessageTimestamp(db)).toBe(3000)
  })

  it('getLatestGlobalMessageTimestamp: DM(type=dm)은 무시하고 전체채팅만 본다', () => {
    insertGlobal('m1', 1000)
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'a', from_name: 'A', to_id: 'b',
      content: null, content_type: 'text', encrypted_payload: 'x==',
      file_url: null, file_name: null, timestamp: 9999,
    })
    // DM 의 9999 는 무시되고 전체채팅 최신값 1000 이 나와야 한다
    expect(getLatestGlobalMessageTimestamp(db)).toBe(1000)
  })

  it('getGlobalMessagesSince: timestamp >= sinceTimestamp 를 ASC 로 반환 (경계 포함)', () => {
    insertGlobal('m1', 1000)
    insertGlobal('m2', 2000)
    insertGlobal('m3', 3000)
    // 경계값 2000 포함(>=) — m2, m3 반환
    const rows = getGlobalMessagesSince(db, 2000, 500)
    expect(rows.map(r => r.id)).toEqual(['m2', 'm3'])
  })

  it('getGlobalMessagesSince: since=0 이면 전체를 ASC 로 반환', () => {
    insertGlobal('m3', 3000)
    insertGlobal('m1', 1000)
    insertGlobal('m2', 2000)
    const rows = getGlobalMessagesSince(db, 0, 500)
    expect(rows.map(r => r.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('getGlobalMessagesSince: limit 초과 시 "가장 최신" N 개만 ASC 로 반환', () => {
    for (let i = 1; i <= 5; i++) insertGlobal(`m${i}`, i * 1000)
    // limit=3 → 최신 3개(m3,m4,m5) 를 시간 오름차순으로
    const rows = getGlobalMessagesSince(db, 0, 3)
    expect(rows.map(r => r.id)).toEqual(['m3', 'm4', 'm5'])
  })

  it('getGlobalMessagesSince: DM 은 제외한다(전체채팅만)', () => {
    insertGlobal('m1', 1000)
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'a', from_name: 'A', to_id: 'b',
      content: null, content_type: 'text', encrypted_payload: 'x==',
      file_url: null, file_name: null, timestamp: 2000,
    })
    const rows = getGlobalMessagesSince(db, 0, 500)
    expect(rows.map(r => r.id)).toEqual(['m1'])
  })
})

describe('답장 컬럼 마이그레이션(#28) — 기존 DB 호환', () => {
  // reply 컬럼이 없던 구버전 스키마를 재현해, migrateDatabase 가 ALTER TABLE 로
  // 컬럼을 추가하고 기존 행이 보존되는지 검증한다.
  it('reply 컬럼 없는 기존 messages 테이블에 컬럼을 추가하고 기존 데이터를 보존함', () => {
    const Database = require('better-sqlite3-multiple-ciphers')
    const legacyDb = new Database(':memory:')
    // 구버전(reply 컬럼 없음) messages 테이블 + 기존 메시지 1건
    legacyDb.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, from_id TEXT NOT NULL,
        from_name TEXT NOT NULL, to_id TEXT, content TEXT,
        content_type TEXT NOT NULL DEFAULT 'text', encrypted_payload TEXT,
        file_url TEXT, file_name TEXT, timestamp INTEGER NOT NULL, format TEXT
      );
    `)
    legacyDb.prepare(
      "INSERT INTO messages (id, type, from_id, from_name, timestamp) VALUES ('old-1', 'message', 'peer1', '홍길동', 1000)"
    ).run()

    migrateDatabase(legacyDb)

    // 새 컬럼이 추가되어 답장 메시지 저장 가능
    saveMessage(legacyDb, {
      id: 'new-1', type: 'message', from_id: 'peer2', from_name: '김철수',
      to_id: null, content: '답장', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000,
      reply_to_id: 'old-1', reply_preview: JSON.stringify({ fromName: '홍길동', snippet: '' }),
    })

    const rows = getGlobalHistory(legacyDb)
    const oldRow = rows.find(r => r.id === 'old-1')
    const newRow = rows.find(r => r.id === 'new-1')
    // 기존 행은 보존되고 새 컬럼은 null
    expect(oldRow).toBeDefined()
    expect(oldRow.reply_to_id).toBeNull()
    // 새 답장 메시지는 정상 저장
    expect(newRow.reply_to_id).toBe('old-1')
    legacyDb.close()
  })
})

describe('멘션 컬럼 마이그레이션(#29) — 기존 DB 호환', () => {
  // mentions 컬럼이 없던 구버전 스키마를 재현해, migrateDatabase 가 ALTER TABLE 로
  // 컬럼을 추가하고 기존 행이 보존되는지 검증한다.
  it('mentions 컬럼 없는 기존 messages 테이블에 컬럼을 추가하고 기존 데이터를 보존함', () => {
    const Database = require('better-sqlite3-multiple-ciphers')
    const legacyDb = new Database(':memory:')
    // 구버전(reply/mentions 컬럼 없음) messages 테이블 + 기존 메시지 1건
    legacyDb.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, from_id TEXT NOT NULL,
        from_name TEXT NOT NULL, to_id TEXT, content TEXT,
        content_type TEXT NOT NULL DEFAULT 'text', encrypted_payload TEXT,
        file_url TEXT, file_name TEXT, timestamp INTEGER NOT NULL, format TEXT
      );
    `)
    legacyDb.prepare(
      "INSERT INTO messages (id, type, from_id, from_name, timestamp) VALUES ('old-1', 'message', 'peer1', '홍길동', 1000)"
    ).run()

    migrateDatabase(legacyDb)

    // 새 컬럼이 추가되어 멘션 포함 메시지 저장 가능
    saveMessage(legacyDb, {
      id: 'new-1', type: 'message', from_id: 'peer2', from_name: '김철수',
      to_id: null, content: '@홍길동 확인', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000,
      mentions: JSON.stringify(['peer1']),
    })

    const rows = getGlobalHistory(legacyDb)
    const oldRow = rows.find(r => r.id === 'old-1')
    const newRow = rows.find(r => r.id === 'new-1')
    // 기존 행은 보존되고 새 컬럼은 null
    expect(oldRow).toBeDefined()
    expect(oldRow.mentions).toBeNull()
    // 새 멘션 메시지는 정상 저장
    expect(JSON.parse(newRow.mentions)).toEqual(['peer1'])
    legacyDb.close()
  })
})

// 채팅 내보내기(#74)용 배치 조회 — getGlobalHistory/getDMHistory 는 "최신 N개" 화면 표시용으로
// DESC+reverse 를 쓰지만, 내보내기는 offset 이 커질수록 계속 더 최신으로 이어져야 배치를 파일에
// 순서대로 이어붙였을 때 전체가 시간순이 된다. 이를 ASC 페이지네이션으로 검증한다.
describe('getGlobalMessagesForExport / getDMMessagesForExport — 내보내기용 ASC 페이지네이션(#74)', () => {
  let db

  beforeEach(() => { db = initDatabase(':memory:') })
  afterEach(() => { closeDatabase(db) })

  it('전체채팅 — offset 없이도 오래된 순으로 정렬해 반환한다', () => {
    saveMessage(db, { id: 'g-3', type: 'message', from_id: 'p1', from_name: 'A', to_id: null, content: '세번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 3000 })
    saveMessage(db, { id: 'g-1', type: 'message', from_id: 'p1', from_name: 'A', to_id: null, content: '첫번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000 })
    saveMessage(db, { id: 'g-2', type: 'message', from_id: 'p1', from_name: 'A', to_id: null, content: '두번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000 })

    const result = getGlobalMessagesForExport(db, 10, 0)
    expect(result.map(m => m.id)).toEqual(['g-1', 'g-2', 'g-3'])
  })

  it('전체채팅 — 배치를 offset 순서대로 이어붙이면 전체가 시간순으로 이어진다', () => {
    for (let i = 0; i < 5; i++) {
      saveMessage(db, { id: `g-${i}`, type: 'message', from_id: 'p1', from_name: 'A', to_id: null, content: `msg${i}`, content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000 + i })
    }
    const batch1 = getGlobalMessagesForExport(db, 2, 0)
    const batch2 = getGlobalMessagesForExport(db, 2, 2)
    const batch3 = getGlobalMessagesForExport(db, 2, 4)
    const combinedIds = [...batch1, ...batch2, ...batch3].map(m => m.id)
    expect(combinedIds).toEqual(['g-0', 'g-1', 'g-2', 'g-3', 'g-4'])
    expect(batch3).toHaveLength(1) // 마지막 배치는 limit 보다 적어 "더 이상 없음" 신호가 됨
  })

  it('DM — 상대와 나눈 메시지만 오래된 순으로 반환한다', () => {
    saveMessage(db, { id: 'dm-2', type: 'dm', from_id: 'peer2', from_name: '상대', to_id: 'peer1', content: '두번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000 })
    saveMessage(db, { id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer2', content: '첫번째', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000 })
    saveMessage(db, { id: 'dm-other', type: 'dm', from_id: 'peer1', from_name: '나', to_id: 'peer3', content: '다른 상대', content_type: 'text', encrypted_payload: null, file_url: null, file_name: null, timestamp: 1500 })

    const result = getDMMessagesForExport(db, 'peer1', 'peer2', 10, 0)
    expect(result.map(m => m.id)).toEqual(['dm-1', 'dm-2'])
  })
})
