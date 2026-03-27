// tests/storage/fileCache.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, saveFileCache, getFileCache } = require('../../electron/storage/queries')

describe('파일 영구 캐시', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    // 테스트용 파일 메시지 저장
    saveMessage(db, {
      id: 'msg-file',
      type: 'message',
      from_id: 'peer1',
      from_name: '홍길동',
      to_id: null,
      content: null,
      content_type: 'image',
      encrypted_payload: null,
      file_url: 'http://peer1:3000/files/test.jpg',
      file_name: 'test.jpg',
      timestamp: Date.now(),
    })
  })

  afterEach(() => closeDatabase(db))

  it('캐시 경로 저장/조회', () => {
    saveFileCache(db, { messageId: 'msg-file', cachedPath: '/cache/test.jpg' })
    expect(getFileCache(db, 'msg-file')).toBe('/cache/test.jpg')
  })

  it('캐시 없으면 null', () => {
    expect(getFileCache(db, 'msg-none')).toBeNull()
  })
})
