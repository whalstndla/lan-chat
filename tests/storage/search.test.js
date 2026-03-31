// tests/storage/search.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, searchMessages } = require('../../electron/storage/queries')

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
