// file_cache 정리 관련 단위 테스트 (#24)
// - deleteMessageAndCachedFile: 메시지 삭제 시 연결된 캐시 파일도 함께 제거
// - sweepOrphanedFileCache: 어떤 메시지도 참조하지 않는 orphan 캐시 파일 정리
// - clearAllMessages/clearAllDMs: 삭제 대상이 참조하던 캐시 경로를 반환

const fs = require('fs')
const os = require('os')
const path = require('path')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, saveFileCache, getFileCache, clearAllMessages, clearAllDMs } = require('../../electron/storage/queries')

// fileServer 모듈을 mock — appUtils.js 가 require 하지만 이 테스트에서는 사용하지 않음
jest.mock('../../electron/peer/fileServer', () => ({
  getFilePort: () => 50000,
}))

const { deleteMessageAndCachedFile, sweepOrphanedFileCache } = require('../../electron/utils/appUtils')

describe('deleteMessageAndCachedFile', () => {
  let db
  let tempDir

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-cache-'))
    fs.mkdirSync(path.join(tempDir, 'file_cache'), { recursive: true })
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'me', from_name: '나', to_id: null,
      content: null, content_type: 'image', encrypted_payload: null,
      file_url: 'http://x/files/a.png', file_name: 'a.png', timestamp: Date.now(),
    })
  })

  afterEach(() => {
    closeDatabase(db)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function buildCtx() {
    return { state: { database: db, peerId: 'me' }, config: { appDataPath: tempDir } }
  }

  it('본인 메시지를 삭제하면 DB 행과 캐시 파일이 함께 제거된다', () => {
    const cachedPath = path.join(tempDir, 'file_cache', 'msg-1.png')
    fs.writeFileSync(cachedPath, Buffer.from([0x01]))
    saveFileCache(db, { messageId: 'msg-1', cachedPath })

    deleteMessageAndCachedFile(buildCtx(), 'msg-1', 'me')

    expect(db.prepare('SELECT * FROM messages WHERE id = ?').get('msg-1')).toBeUndefined()
    expect(fs.existsSync(cachedPath)).toBe(false)
  })

  it('다른 사람 id 로는 삭제되지 않고, 캐시 파일도 지워지지 않는다', () => {
    const cachedPath = path.join(tempDir, 'file_cache', 'msg-1.png')
    fs.writeFileSync(cachedPath, Buffer.from([0x01]))
    saveFileCache(db, { messageId: 'msg-1', cachedPath })

    deleteMessageAndCachedFile(buildCtx(), 'msg-1', 'other-peer')

    expect(db.prepare('SELECT * FROM messages WHERE id = ?').get('msg-1')).toBeTruthy()
    expect(fs.existsSync(cachedPath)).toBe(true)
  })

  it('캐시 파일이 없는 메시지를 삭제해도 에러 없이 통과한다', () => {
    expect(() => deleteMessageAndCachedFile(buildCtx(), 'msg-1', 'me')).not.toThrow()
    expect(getFileCache(db, 'msg-1')).toBeNull()
  })
})

describe('sweepOrphanedFileCache', () => {
  let db
  let tempDir
  let cacheDir

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-sweep-'))
    cacheDir = path.join(tempDir, 'file_cache')
    fs.mkdirSync(cacheDir, { recursive: true })
  })

  afterEach(() => {
    closeDatabase(db)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function buildCtx() {
    return { state: { database: db }, config: { appDataPath: tempDir } }
  }

  it('DB 가 참조하는 파일은 남기고, 참조하지 않는 orphan 파일만 제거한다', () => {
    saveMessage(db, {
      id: 'msg-referenced', type: 'message', from_id: 'me', from_name: '나', to_id: null,
      content: null, content_type: 'image', encrypted_payload: null,
      file_url: null, file_name: 'ref.png', timestamp: Date.now(),
    })
    const referencedPath = path.join(cacheDir, 'msg-referenced.png')
    fs.writeFileSync(referencedPath, Buffer.from([0x01]))
    saveFileCache(db, { messageId: 'msg-referenced', cachedPath: referencedPath })

    const orphanPath = path.join(cacheDir, 'orphan-leftover.png')
    fs.writeFileSync(orphanPath, Buffer.from([0x02]))

    const result = sweepOrphanedFileCache(buildCtx())

    expect(result.removed).toBe(1)
    expect(fs.existsSync(referencedPath)).toBe(true)
    expect(fs.existsSync(orphanPath)).toBe(false)
  })

  it('file_cache 디렉토리가 없으면 아무 것도 하지 않는다', () => {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    expect(() => sweepOrphanedFileCache(buildCtx())).not.toThrow()
    expect(sweepOrphanedFileCache(buildCtx())).toEqual({ removed: 0 })
  })
})

describe('clearAllMessages / clearAllDMs — 캐시 경로 반환', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
  })

  afterEach(() => closeDatabase(db))

  it('clearAllMessages 는 삭제되는 메시지의 캐시 경로를 모두 반환한다', () => {
    saveMessage(db, {
      id: 'm1', type: 'message', from_id: 'p1', from_name: 'A', to_id: null,
      content: null, content_type: 'image', encrypted_payload: null,
      file_url: null, file_name: 'a.png', timestamp: 1,
    })
    saveMessage(db, {
      id: 'm2', type: 'message', from_id: 'p1', from_name: 'A', to_id: null,
      content: '텍스트만', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 2,
    })
    saveFileCache(db, { messageId: 'm1', cachedPath: '/cache/m1.png' })

    const { cachedFilePaths } = clearAllMessages(db)
    expect(cachedFilePaths).toEqual(['/cache/m1.png'])
    expect(db.prepare('SELECT count(*) c FROM messages').get().c).toBe(0)
  })

  it('clearAllDMs 는 DM 메시지의 캐시 경로만 반환한다', () => {
    saveMessage(db, {
      id: 'global-1', type: 'message', from_id: 'p1', from_name: 'A', to_id: null,
      content: null, content_type: 'image', encrypted_payload: null,
      file_url: null, file_name: 'g.png', timestamp: 1,
    })
    saveMessage(db, {
      id: 'dm-1', type: 'dm', from_id: 'p1', from_name: 'A', to_id: 'p2',
      content: null, content_type: 'image', encrypted_payload: 'cipher==',
      file_url: null, file_name: 'd.png', timestamp: 2,
    })
    saveFileCache(db, { messageId: 'global-1', cachedPath: '/cache/global-1.png' })
    saveFileCache(db, { messageId: 'dm-1', cachedPath: '/cache/dm-1.png' })

    const { cachedFilePaths } = clearAllDMs(db)
    expect(cachedFilePaths).toEqual(['/cache/dm-1.png'])
    // 전역 메시지는 그대로 남아있어야 함
    expect(db.prepare('SELECT count(*) c FROM messages').get().c).toBe(1)
  })
})
