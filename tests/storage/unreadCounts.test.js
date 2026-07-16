// tests/storage/unreadCounts.test.js
// getUnreadCountsByPeer — 부팅 시 사이드바 안읽음 배지 복원에 사용되는 순수 쿼리 검증
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, markMessagesAsRead, getUnreadCountsByPeer } = require('../../electron/storage/queries')

describe('getUnreadCountsByPeer', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
  })
  afterEach(() => { closeDatabase(db) })

  function saveDM({ id, fromId, toId, read }) {
    saveMessage(db, {
      id, type: 'dm', from_id: fromId, from_name: '테스터',
      to_id: toId, content: '안녕', content_type: 'text',
      encrypted_payload: 'enc==', file_url: null, file_name: null, timestamp: Date.now(),
    })
    if (read) db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(id)
  }

  it('상대별로 안읽은 DM 개수를 그룹핑해 반환한다', () => {
    saveDM({ id: 'm1', fromId: 'peer1', toId: 'me', read: false })
    saveDM({ id: 'm2', fromId: 'peer1', toId: 'me', read: false })
    saveDM({ id: 'm3', fromId: 'peer2', toId: 'me', read: false })

    const counts = getUnreadCountsByPeer(db, 'me')
    expect(counts).toEqual({ peer1: 2, peer2: 1 })
  })

  it('read=1 인 메시지는 카운트에서 제외된다', () => {
    saveDM({ id: 'm1', fromId: 'peer1', toId: 'me', read: true })
    saveDM({ id: 'm2', fromId: 'peer1', toId: 'me', read: false })

    const counts = getUnreadCountsByPeer(db, 'me')
    expect(counts).toEqual({ peer1: 1 })
  })

  it('내가 보낸 메시지(to_id가 상대)는 카운트에 포함되지 않는다', () => {
    saveDM({ id: 'm1', fromId: 'me', toId: 'peer1', read: false })

    const counts = getUnreadCountsByPeer(db, 'me')
    expect(counts).toEqual({})
  })

  it('안읽은 메시지가 없으면 빈 객체를 반환한다', () => {
    expect(getUnreadCountsByPeer(db, 'me')).toEqual({})
  })

  it('markMessagesAsRead 로 읽음 처리하면 카운트에서 제외된다', () => {
    saveDM({ id: 'm1', fromId: 'peer1', toId: 'me', read: false })
    saveDM({ id: 'm2', fromId: 'peer1', toId: 'me', read: false })
    markMessagesAsRead(db, ['m1'])

    const counts = getUnreadCountsByPeer(db, 'me')
    expect(counts).toEqual({ peer1: 1 })
  })
})
