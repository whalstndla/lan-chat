// tests/storage/queries.test.js
const { 데이터베이스초기화, 데이터베이스닫기 } = require('../../electron/storage/database')
const { 메시지저장, 전체채팅기록조회, DM기록조회 } = require('../../electron/storage/queries')

describe('메시지 쿼리', () => {
  let 데이터베이스

  beforeEach(() => {
    데이터베이스 = 데이터베이스초기화(':memory:')
  })

  afterEach(() => {
    데이터베이스닫기(데이터베이스)
  })

  it('전체채팅 메시지를 저장하고 조회함', () => {
    const 메시지 = {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '안녕', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now()
    }
    메시지저장(데이터베이스, 메시지)
    const 결과 = 전체채팅기록조회(데이터베이스)
    expect(결과).toHaveLength(1)
    expect(결과[0].content).toBe('안녕')
  })

  it('DM 메시지를 저장하고 조회함', () => {
    const DM메시지 = {
      id: 'dm-1', type: 'dm', from_id: 'peer1', from_name: '홍길동',
      to_id: 'peer2', content: null, content_type: 'text',
      encrypted_payload: 'base64encrypted==', file_url: null, file_name: null, timestamp: Date.now()
    }
    메시지저장(데이터베이스, DM메시지)
    const 결과 = DM기록조회(데이터베이스, 'peer1', 'peer2')
    expect(결과).toHaveLength(1)
    expect(결과[0].encrypted_payload).toBe('base64encrypted==')
  })
})
