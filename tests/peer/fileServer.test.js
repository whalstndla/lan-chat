// tests/peer/fileServer.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const { startFileServer, stopFileServer, getFilePort } = require('../../electron/peer/fileServer')

describe('파일 서버', () => {
  let tempDir
  let port

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-test-'))
    port = await startFileServer(tempDir)
  })

  afterEach((done) => {
    stopFileServer()
    fs.rmSync(tempDir, { recursive: true, force: true })
    setTimeout(done, 100)
  })

  it('서버 시작 후 양수 포트를 반환함', () => {
    expect(port).toBeGreaterThan(0)
    expect(getFilePort()).toBe(port)
  })

  it('임시 폴더의 파일을 HTTP로 서빙함', (done) => {
    const fileName = 'test.txt'
    fs.writeFileSync(path.join(tempDir, fileName), '안녕하세요')

    http.get(`http://localhost:${port}/files/${fileName}`, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        expect(data).toBe('안녕하세요')
        done()
      })
    })
  })
})
