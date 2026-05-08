// tests/peer/fileServer.test.js
// 5단계 이후 fileServer 는 /profile 만 서빙. /files 라우트는 폐기됐는지 확인.

const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const { startFileServer, stopFileServer, getFilePort } = require('../../electron/peer/fileServer')

describe('파일 서버', () => {
  let profileDir
  let port

  beforeEach(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-prof-'))
    port = await startFileServer(profileDir)
  })

  afterEach((done) => {
    stopFileServer()
    fs.rmSync(profileDir, { recursive: true, force: true })
    setTimeout(done, 100)
  })

  function get(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      }).on('error', reject)
    })
  }

  it('서버 시작 후 양수 포트를 반환함', () => {
    expect(port).toBeGreaterThan(0)
    expect(getFilePort()).toBe(port)
  })

  it('/profile/<file> 은 평문 응답', async () => {
    fs.writeFileSync(path.join(profileDir, 'avatar.png'), '내 아바타 바이트')
    const { status, body } = await get(`http://localhost:${port}/profile/avatar.png`)
    expect(status).toBe(200)
    expect(body).toBe('내 아바타 바이트')
  })

  it('/files/* 라우트는 더 이상 존재하지 않음 (404)', async () => {
    const { status } = await get(`http://localhost:${port}/files/anything.png`)
    expect(status).toBe(404)
  })
})
