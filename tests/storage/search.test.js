// tests/storage/search.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, searchMessages, editMessage, deleteMessage, clearAllMessages, clearAllDMs } = require('../../electron/storage/queries')

describe('메시지 검색', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'msg-1',
      type: 'message',
      from_id: 'peer1',
      from_name: '홍길동',
      to_id: null,
      content: '오늘 회의 자료 공유합니다',
      content_type: 'text',
      encrypted_payload: null,
      file_url: null,
      file_name: null,
      timestamp: 1000,
    })
    saveMessage(db, {
      id: 'msg-2',
      type: 'message',
      from_id: 'peer2',
      from_name: '김철수',
      to_id: null,
      content: '회의 시간이 변경되었습니다',
      content_type: 'text',
      encrypted_payload: null,
      file_url: null,
      file_name: null,
      timestamp: 2000,
    })
    saveMessage(db, {
      id: 'msg-3',
      type: 'message',
      from_id: 'peer1',
      from_name: '홍길동',
      to_id: null,
      content: '점심 뭐 먹을까요',
      content_type: 'text',
      encrypted_payload: null,
      file_url: null,
      file_name: null,
      timestamp: 3000,
    })
  })

  afterEach(() => closeDatabase(db))

  it('키워드로 검색', () => {
    const results = searchMessages(db, { query: '회의', type: 'message' })
    expect(results).toHaveLength(2)
  })

  it('결과 없으면 빈 배열', () => {
    expect(searchMessages(db, { query: '없는단어', type: 'message' })).toHaveLength(0)
  })

  it('최근 순 정렬', () => {
    const results = searchMessages(db, { query: '회의', type: 'message' })
    expect(results[0].id).toBe('msg-2')
  })
})

// FTS5 트리거가 messages 테이블의 edit/delete/clear 를 실제로 동기화하는지 검증 (#8).
// 과거엔 saveMessage() 만 수동으로 FTS 를 동기화해 수정/삭제/전체삭제 후에도 FTS
// 인덱스가 옛 상태 그대로 남아, 삭제한 메시지가 검색되거나 수정 전 텍스트로 검색되는
// 문제가 있었다.
describe('FTS5 트리거 동기화', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '오늘 회의 자료 공유합니다', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 1000,
    })
    saveMessage(db, {
      id: 'msg-2', type: 'message', from_id: 'peer2', from_name: '김철수', to_id: null,
      content: '점심 뭐 먹을까요', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 2000,
    })
  })

  afterEach(() => closeDatabase(db))

  it('메시지 수정 후에는 수정 전 텍스트로 검색되지 않고, 수정된 텍스트로 검색된다', () => {
    editMessage(db, { messageId: 'msg-1', fromId: 'peer1', newContent: '내일 점심 약속으로 변경합니다' })

    expect(searchMessages(db, { query: '회의', type: 'message' })).toHaveLength(0)
    const updated = searchMessages(db, { query: '변경합니다', type: 'message' })
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('msg-1')
  })

  it('메시지 삭제 후에는 검색되지 않는다', () => {
    deleteMessage(db, 'msg-2', 'peer2')
    expect(searchMessages(db, { query: '점심', type: 'message' })).toHaveLength(0)
    // 삭제되지 않은 메시지는 계속 검색됨
    expect(searchMessages(db, { query: '회의', type: 'message' })).toHaveLength(1)
  })

  it('clearAllMessages 이후에는 아무것도 검색되지 않고, 이후 저장한 메시지는 정상 검색된다', () => {
    clearAllMessages(db)
    expect(searchMessages(db, { query: '회의', type: 'message' })).toHaveLength(0)
    expect(searchMessages(db, { query: '점심', type: 'message' })).toHaveLength(0)

    saveMessage(db, {
      id: 'msg-3', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '새로운 회의 일정 공지', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 3000,
    })
    const results = searchMessages(db, { query: '회의', type: 'message' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('msg-3')
  })

  it('clearAllDMs 는 DM 만 삭제하고 전역 메시지의 FTS 인덱스는 그대로 유지한다', () => {
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '홍길동', to_id: 'peer2',
      content: null, content_type: 'text', encrypted_payload: 'ciphertext==',
      file_url: null, file_name: null, timestamp: 4000,
    })
    clearAllDMs(db)
    expect(searchMessages(db, { query: '회의', type: 'message' })).toHaveLength(1)
  })
})

// 파일명 검색(#36) — content 가 null 인 이미지/비디오/파일 메시지도 file_name 으로
// 검색되어야 한다. 과거엔 messages_fts 트리거 WHEN 절이 content IS NOT NULL 만 확인해
// 파일 메시지가 아예 인덱싱되지 않았다 (검색 안 되고 결과 목록에 빈 줄만 남는 문제).
describe('파일명 검색(#36)', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'file-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: null, content_type: 'file', encrypted_payload: null,
      file_url: 'http://localhost:1234/files/abc', file_name: '2025년_정산내역.xlsx', timestamp: 1000,
    })
    saveMessage(db, {
      id: 'image-1', type: 'message', from_id: 'peer2', from_name: '김철수', to_id: null,
      content: null, content_type: 'image', encrypted_payload: null,
      file_url: 'http://localhost:1234/files/def', file_name: 'screenshot.png', timestamp: 2000,
    })
    saveMessage(db, {
      id: 'text-1', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '정산 관련 문의드립니다', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 3000,
    })
  })

  afterEach(() => closeDatabase(db))

  it('파일 메시지를 파일명으로 검색할 수 있다', () => {
    const results = searchMessages(db, { query: '정산내역', type: 'message' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('file-1')
  })

  it('파일명 검색은 본문 검색과 함께 매칭된다 (정산 검색 시 텍스트 메시지와 파일명 모두 포함)', () => {
    const results = searchMessages(db, { query: '정산', type: 'message' })
    const ids = results.map(r => r.id).sort()
    expect(ids).toEqual(['file-1', 'text-1'])
  })

  it('이미지 메시지도 파일명으로 검색된다', () => {
    const results = searchMessages(db, { query: 'screenshot', type: 'message' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('image-1')
  })

  it('파일 메시지 삭제 후에는 파일명으로 검색되지 않는다', () => {
    deleteMessage(db, 'file-1', 'peer1')
    expect(searchMessages(db, { query: '정산내역', type: 'message' })).toHaveLength(0)
  })
})
