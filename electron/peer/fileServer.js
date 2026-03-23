// electron/peer/fileServer.js
const http = require('http')
const express = require('express')

let serverInstance = null
let filePort = 0

function startFileServer(tempFolderPath, profileFolderPath) {
  return new Promise((resolve) => {
    const app = express()

    // 보안 헤더 — Stored XSS 방지 (.html/.svg 파일의 브라우저 내 실행 차단)
    const securityHeaders = {
      setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff')
        res.set('Content-Disposition', 'attachment')
      },
    }

    app.use('/files', express.static(tempFolderPath, securityHeaders))
    if (profileFolderPath) {
      // 프로필 이미지는 인라인 표시 필요 (Content-Disposition 미적용)
      app.use('/profile', express.static(profileFolderPath, {
        setHeaders: (res) => { res.set('X-Content-Type-Options', 'nosniff') },
      }))
    }
    // http.createServer를 사용하여 listen 이전에 서버 인스턴스를 확보
    serverInstance = http.createServer(app)
    serverInstance.listen(0, () => {
      filePort = serverInstance.address().port
      resolve(filePort)
    })
  })
}

function stopFileServer() {
  if (serverInstance) {
    serverInstance.close()
    serverInstance = null
    filePort = 0
  }
}

function getFilePort() {
  return filePort
}

module.exports = { startFileServer, stopFileServer, getFilePort }
