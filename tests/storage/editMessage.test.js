// tests/storage/editMessage.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, getGlobalHistory, editMessage } = require('../../electron/storage/queries')

describe('메시지 수정', () => {
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
      content: '원본 메시지',
      content_type: 'text',
      encrypted_payload: null,
      file_url: null,
      file_name: null,
      timestamp: Date.now(),
    })
  })

  afterEach(() => closeDatabase(db))

  it('메시지 수정 후 edited_at 설정됨', () => {
    editMessage(db, { messageId: 'msg-1', fromId: 'peer1', newContent: '수정됨' })
    const history = getGlobalHistory(db)
    expect(history[0].content).toBe('수정됨')
    expect(history[0].edited_at).toBeGreaterThan(0)
  })

  it('다른 사용자는 수정 불가', () => {
    editMessage(db, { messageId: 'msg-1', fromId: 'peer2', newContent: '해킹' })
    expect(getGlobalHistory(db)[0].content).toBe('원본 메시지')
  })
})
