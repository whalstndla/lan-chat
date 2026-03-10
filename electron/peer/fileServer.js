// electron/peer/fileServer.js
const http = require('http')
const express = require('express')

let serverInstance = null
let filePort = 0

function startFileServer(tempFolderPath) {
  return new Promise((resolve) => {
    const app = express()
    app.use('/files', express.static(tempFolderPath))
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
