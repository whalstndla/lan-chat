// tests/storage/reactions.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, addReaction, removeReaction, getReactions, getReactionsByMessageIds } = require('../../electron/storage/queries')

describe('메시지 리액션', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '안녕', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
  })

  afterEach(() => closeDatabase(db))

  it('리액션 추가 후 조회', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    const result = getReactions(db, 'msg-1')
    expect(result).toHaveLength(1)
    expect(result[0].emoji).toBe('👍')
    expect(result[0].peer_id).toBe('peer1')
  })

  it('같은 이모지 중복 무시', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '❤️' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '❤️' })
    const result = getReactions(db, 'msg-1')
    expect(result).toHaveLength(1)
  })

  it('리액션 제거', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '😂' })
    removeReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '😂' })
    const result = getReactions(db, 'msg-1')
    expect(result).toHaveLength(0)
  })

  it('여러 이모지/피어 조회', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer2', emoji: '👍' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '❤️' })

    // 두 번째 메시지 생성
    saveMessage(db, {
      id: 'msg-2', type: 'message', from_id: 'peer2', from_name: '이순신',
      to_id: null, content: '반가워', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
    addReaction(db, { messageId: 'msg-2', peerId: 'peer2', emoji: '🎉' })

    const grouped = getReactionsByMessageIds(db, ['msg-1', 'msg-2'])
    expect(grouped['msg-1']).toHaveLength(3)
    expect(grouped['msg-2']).toHaveLength(1)
    expect(grouped['msg-2'][0].emoji).toBe('🎉')
  })
})
