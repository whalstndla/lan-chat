// electron/peer/fileServer.js
const http = require('http')
const express = require('express')

let 서버인스턴스 = null
let 파일포트 = 0

function 파일서버시작(임시폴더경로) {
  return new Promise((resolve) => {
    const 앱 = express()
    앱.use('/files', express.static(임시폴더경로))
    // http.createServer를 사용하여 listen 이전에 서버 인스턴스를 확보
    서버인스턴스 = http.createServer(앱)
    서버인스턴스.listen(0, () => {
      파일포트 = 서버인스턴스.address().port
      resolve(파일포트)
    })
  })
}

function 파일서버중지() {
  if (서버인스턴스) {
    서버인스턴스.close()
    서버인스턴스 = null
    파일포트 = 0
  }
}

function 파일포트조회() {
  return 파일포트
}

module.exports = { 파일서버시작, 파일서버중지, 파일포트조회 }
