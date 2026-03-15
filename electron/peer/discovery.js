// electron/peer/discovery.js
const { Bonjour } = require('bonjour-service')

const SERVICE_TYPE = 'lan-chat'

let bonjourInstance = null
let publishedService = null
let browseInstance = null

function startPeerDiscovery({ nickname, peerId, wsPort, filePort, onPeerFound, onPeerLeft }) {
  bonjourInstance = new Bonjour()

  publishedService = bonjourInstance.publish({
    name: `${nickname}__${peerId}`,
    type: SERVICE_TYPE,
    port: wsPort,
    txt: {
      nickname,
      peerId,
      filePort: String(filePort),
    },
  })

  browseInstance = bonjourInstance.find({ type: SERVICE_TYPE }, (service) => {
    const discoveredPeerId = service.txt?.peerId
    if (discoveredPeerId === peerId) return

    onPeerFound({
      peerId: discoveredPeerId,
      nickname: service.txt?.nickname || '알 수 없음',
      host: service.host,
      wsPort: service.port,
      filePort: Number(service.txt?.filePort),
    })
  })

  browseInstance.on('down', (service) => {
    const leftPeerId = service.txt?.peerId
    if (leftPeerId) onPeerLeft(leftPeerId)
  })
}

async function stopPeerDiscovery() {
  if (publishedService) {
    publishedService.stop()
    publishedService = null
  }
  if (browseInstance) {
    browseInstance.stop()
    browseInstance = null
  }
  if (bonjourInstance) {
    bonjourInstance.destroy()
    bonjourInstance = null
  }
  // mDNS goodbye 패킷이 네트워크에 전파될 때까지 대기
  await new Promise(resolve => setTimeout(resolve, 500))
}

// browse는 유지하고 서비스 공고만 재등록 (닉네임 변경 시 사용)
function republishService({ nickname, peerId, wsPort, filePort }) {
  if (!bonjourInstance) return
  if (publishedService) publishedService.stop()
  publishedService = bonjourInstance.publish({
    name: `${nickname}__${peerId}`,
    type: SERVICE_TYPE,
    port: wsPort,
    txt: { nickname, peerId, filePort: String(filePort) },
  })
}

module.exports = { startPeerDiscovery, stopPeerDiscovery, republishService }
