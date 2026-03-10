// electron/peer/discovery.js
const { Bonjour } = require('bonjour-service')

const 서비스타입 = 'lan-chat'

let 봉쥬르인스턴스 = null
let 발행된서비스 = null
let 탐색인스턴스 = null

function 피어발견시작({ 닉네임, 피어아이디, 웹소켓포트, 파일포트, 피어발견콜백, 피어퇴장콜백 }) {
  봉쥬르인스턴스 = new Bonjour()

  발행된서비스 = 봉쥬르인스턴스.publish({
    name: `${닉네임}__${피어아이디}`,
    type: 서비스타입,
    port: 웹소켓포트,
    txt: {
      닉네임,
      피어아이디,
      파일포트: String(파일포트),
    },
  })

  탐색인스턴스 = 봉쥬르인스턴스.find({ type: 서비스타입 }, (서비스) => {
    const 발견된피어아이디 = 서비스.txt?.피어아이디
    if (발견된피어아이디 === 피어아이디) return

    피어발견콜백({
      피어아이디: 발견된피어아이디,
      닉네임: 서비스.txt?.닉네임 || '알 수 없음',
      호스트: 서비스.host,
      웹소켓포트: 서비스.port,
      파일포트: Number(서비스.txt?.파일포트),
    })
  })

  탐색인스턴스.on('down', (서비스) => {
    const 퇴장피어아이디 = 서비스.txt?.피어아이디
    if (퇴장피어아이디) 피어퇴장콜백(퇴장피어아이디)
  })
}

function 피어발견중지() {
  if (발행된서비스) 발행된서비스.stop()
  if (탐색인스턴스) 탐색인스턴스.stop()
  if (봉쥬르인스턴스) 봉쥬르인스턴스.destroy()
  봉쥬르인스턴스 = null
}

module.exports = { 피어발견시작, 피어발견중지 }
