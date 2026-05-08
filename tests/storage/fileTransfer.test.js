// 송수신 파일 처리 관련 단위 테스트
// - rewriteFileUrl: 자기 메시지에만 host:port 재작성
// - cacheOwnFile: 송신자 자기 파일을 file_cache 로 복사 + DB 매핑

const path = require('path')
const fs = require('fs')
const os = require('os')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, getFileCache } = require('../../electron/storage/queries')

// fileServer 모듈을 mock — 테스트 환경에서 실제 서버를 띄우지 않고 포트만 흉내
jest.mock('../../electron/peer/fileServer', () => ({
  getFilePort: () => 50000,
}))

const { rewriteFileUrl, cacheOwnFile } = require('../../electron/utils/appUtils')

describe('rewriteFileUrl', () => {
  const ctx = {
    state: { peerId: 'me', localIP: '192.168.0.10' },
  }

  it('자기 메시지의 fileUrl 은 현재 fileServer 주소로 재작성', () => {
    const oldUrl = 'http://192.168.0.10:49152/files/abc.png'
    expect(rewriteFileUrl(ctx, oldUrl, 'me')).toBe('http://192.168.0.10:50000/files/abc.png')
  })

  it('타인 메시지의 fileUrl 은 그대로 유지 (송신자 IP 보존)', () => {
    const senderUrl = 'http://192.168.0.20:49500/files/xyz.png'
    expect(rewriteFileUrl(ctx, senderUrl, 'other-peer')).toBe(senderUrl)
  })

  it('fromId 가 없으면 (레거시 호출) 재작성 적용 — 자기 메시지로 가정', () => {
    const oldUrl = 'http://anyhost:1/files/abc.png'
    expect(rewriteFileUrl(ctx, oldUrl)).toBe('http://192.168.0.10:50000/files/abc.png')
  })

  it('non-http URL 은 그대로 반환', () => {
    expect(rewriteFileUrl(ctx, 'file:///cache/abc.png', 'me')).toBe('file:///cache/abc.png')
    expect(rewriteFileUrl(ctx, null, 'me')).toBe(null)
  })

  it('host 만 있고 /files/ 경로가 아닌 URL 은 그대로 반환', () => {
    expect(rewriteFileUrl(ctx, 'http://example.com/profile/x.png', 'me'))
      .toBe('http://example.com/profile/x.png')
  })
})

describe('cacheOwnFile', () => {
  let db
  let tempDir

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-test-'))
    fs.mkdirSync(path.join(tempDir, 'files'), { recursive: true })
    saveMessage(db, {
      id: 'msg-1',
      type: 'message',
      from_id: 'me',
      from_name: 'tester',
      to_id: null,
      content: null,
      content_type: 'image',
      encrypted_payload: null,
      file_url: 'http://x/files/source.png',
      file_name: 'source.png',
      timestamp: Date.now(),
    })
  })

  afterEach(() => {
    closeDatabase(db)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function buildCtx() {
    return {
      state: { database: db, peerId: 'me' },
      config: { appDataPath: tempDir },
    }
  }

  it('tempFilePath 에 파일이 있으면 file_cache 로 복사 + DB 매핑 저장', () => {
    const sourcePath = path.join(tempDir, 'files', 'source.png')
    fs.writeFileSync(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    cacheOwnFile(buildCtx(), 'msg-1', 'source.png')

    const cachedPath = getFileCache(db, 'msg-1')
    expect(cachedPath).toBeTruthy()
    expect(fs.existsSync(cachedPath)).toBe(true)
    expect(cachedPath.endsWith('msg-1.png')).toBe(true)
  })

  it('tempFilePath 에 파일이 없으면 아무 것도 안 함', () => {
    cacheOwnFile(buildCtx(), 'msg-1', 'missing.png')
    expect(getFileCache(db, 'msg-1')).toBeNull()
  })

  it('이미 캐시 파일이 있으면 덮어쓰지 않고 DB 매핑만 갱신', () => {
    const sourcePath = path.join(tempDir, 'files', 'source.png')
    fs.writeFileSync(sourcePath, Buffer.from([0x01]))
    cacheOwnFile(buildCtx(), 'msg-1', 'source.png')
    const firstCached = getFileCache(db, 'msg-1')
    const firstMtime = fs.statSync(firstCached).mtimeMs

    // 원본을 다른 내용으로 덮어쓰고 다시 호출 — 캐시 파일은 그대로여야 함
    fs.writeFileSync(sourcePath, Buffer.from([0x02, 0x03]))
    cacheOwnFile(buildCtx(), 'msg-1', 'source.png')
    const secondMtime = fs.statSync(firstCached).mtimeMs
    expect(secondMtime).toBe(firstMtime)
  })
})
