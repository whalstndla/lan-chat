// tests/peer/fileServer.test.js
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const { 파일서버시작, 파일서버중지, 파일포트조회 } = require('../../electron/peer/fileServer')

describe('파일 서버', () => {
  let 임시폴더
  let 포트

  beforeEach(async () => {
    임시폴더 = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-test-'))
    포트 = await 파일서버시작(임시폴더)
  })

  afterEach((done) => {
    파일서버중지()
    fs.rmSync(임시폴더, { recursive: true, force: true })
    setTimeout(done, 100)
  })

  it('서버 시작 후 양수 포트를 반환함', () => {
    expect(포트).toBeGreaterThan(0)
    expect(파일포트조회()).toBe(포트)
  })

  it('임시 폴더의 파일을 HTTP로 서빙함', (done) => {
    const 파일명 = 'test.txt'
    fs.writeFileSync(path.join(임시폴더, 파일명), '안녕하세요')

    http.get(`http://localhost:${포트}/files/${파일명}`, (응답) => {
      let 데이터 = ''
      응답.on('data', chunk => { 데이터 += chunk })
      응답.on('end', () => {
        expect(데이터).toBe('안녕하세요')
        done()
      })
    })
  })
})
