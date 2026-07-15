// tests/utils/storageUsage.test.js
// 저장소 사용량 계산 순수 로직(#74) 단위 테스트 — Electron 런타임 불필요.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { formatBytes, getFileSizeSafe, getDirectorySize, computeStorageUsage } = require('../../electron/utils/storageUsage')

describe('formatBytes', () => {
  it('0 이하는 "0 B" 를 반환한다', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-10)).toBe('0 B')
  })

  it('1024 미만은 바이트 그대로 표시한다', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('KB/MB/GB 단위로 변환한다', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('소수점 1자리로 반올림한다', () => {
    expect(formatBytes(1536)).toBe('1.5 KB') // 1.5 KB
    expect(formatBytes(1024 * 2.25)).toBe('2.3 KB')
  })

  it('NaN/undefined 는 "0 B" 로 안전하게 처리한다', () => {
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
  })
})

describe('getFileSizeSafe', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-storage-usage-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('존재하는 파일의 바이트 크기를 반환한다', () => {
    const filePath = path.join(tempDir, 'a.txt')
    fs.writeFileSync(filePath, Buffer.alloc(100))
    expect(getFileSizeSafe(filePath)).toBe(100)
  })

  it('존재하지 않는 파일은 0을 반환한다', () => {
    expect(getFileSizeSafe(path.join(tempDir, 'not-exist.txt'))).toBe(0)
  })
})

describe('getDirectorySize', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-storage-usage-dir-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('디렉토리가 없으면 0을 반환한다', () => {
    expect(getDirectorySize(path.join(tempDir, 'no-such-dir'))).toBe(0)
  })

  it('디렉토리 내 파일 크기를 모두 합산한다', () => {
    fs.writeFileSync(path.join(tempDir, 'a.bin'), Buffer.alloc(100))
    fs.writeFileSync(path.join(tempDir, 'b.bin'), Buffer.alloc(200))
    expect(getDirectorySize(tempDir)).toBe(300)
  })

  it('하위 디렉토리도 재귀적으로 합산한다', () => {
    const subDir = path.join(tempDir, 'sub')
    fs.mkdirSync(subDir)
    fs.writeFileSync(path.join(tempDir, 'a.bin'), Buffer.alloc(50))
    fs.writeFileSync(path.join(subDir, 'b.bin'), Buffer.alloc(150))
    expect(getDirectorySize(tempDir)).toBe(200)
  })
})

describe('computeStorageUsage', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-storage-usage-total-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('디렉토리/파일이 전혀 없으면 모두 0을 반환한다', () => {
    const usage = computeStorageUsage(tempDir)
    expect(usage.database.bytes).toBe(0)
    expect(usage.files.bytes).toBe(0)
    expect(usage.fileCache.bytes).toBe(0)
    expect(usage.sounds.bytes).toBe(0)
    expect(usage.total.bytes).toBe(0)
    expect(usage.total.readable).toBe('0 B')
  })

  it('chat.db(+ -wal/-shm) 와 각 디렉토리 크기를 합산해 total 을 계산한다', () => {
    fs.writeFileSync(path.join(tempDir, 'chat.db'), Buffer.alloc(1000))
    fs.writeFileSync(path.join(tempDir, 'chat.db-wal'), Buffer.alloc(500))
    fs.mkdirSync(path.join(tempDir, 'files'))
    fs.writeFileSync(path.join(tempDir, 'files', 'a.png'), Buffer.alloc(2000))
    fs.mkdirSync(path.join(tempDir, 'file_cache'))
    fs.writeFileSync(path.join(tempDir, 'file_cache', 'b.png'), Buffer.alloc(3000))
    fs.mkdirSync(path.join(tempDir, 'sounds'))
    fs.writeFileSync(path.join(tempDir, 'sounds', 'c.mp3'), Buffer.alloc(4000))

    const usage = computeStorageUsage(tempDir)
    expect(usage.database.bytes).toBe(1500)
    expect(usage.files.bytes).toBe(2000)
    expect(usage.fileCache.bytes).toBe(3000)
    expect(usage.sounds.bytes).toBe(4000)
    expect(usage.total.bytes).toBe(1500 + 2000 + 3000 + 4000)
  })
})
