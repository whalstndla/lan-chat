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

function stopPeerDiscovery() {
  if (publishedService) publishedService.stop()
  if (browseInstance) browseInstance.stop()
  if (bonjourInstance) bonjourInstance.destroy()
  bonjourInstance = null
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
