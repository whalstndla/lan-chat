// tests/storage/queries.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, getGlobalHistory, getDMHistory } = require('../../electron/storage/queries')

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
