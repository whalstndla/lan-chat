// tests/storage/queries.test.js
const { initDatabase, closeDatabase } = require('../../electron/storage/database')
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
})
