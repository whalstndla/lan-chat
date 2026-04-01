// electron/peer/discovery.js
const { Bonjour } = require('bonjour-service')

const SERVICE_TYPE = 'lan-chat'

let bonjourInstance = null
let publishedService = null
let browseInstance = null
// 중복 발견 필터링용 Set — 이미 발견한 peerId를 기록
const discoveredPeerIds = new Set()

function startPeerDiscovery({ nickname, peerId, wsPort, filePort, onPeerFound, onPeerLeft }) {
  bonjourInstance = new Bonjour()

  // 서비스 이름에 세션 ID 추가 — 새로고침 시 다른 이름으로 등록되어
  // 상대방 browser의 캐시 문제 없이 항상 새 서비스로 인식됨
  const sessionId = Date.now().toString(36)
  publishedService = bonjourInstance.publish({
    name: `${nickname}__${peerId}__${sessionId}`,
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
    // 이미 발견한 피어는 중복 콜백 방지
    if (discoveredPeerIds.has(discoveredPeerId)) return
    discoveredPeerIds.add(discoveredPeerId)

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
    if (leftPeerId) {
      // down 시 Set에서 제거 → 재접속 시 다시 발견 가능
      discoveredPeerIds.delete(leftPeerId)
      onPeerLeft(leftPeerId)
    }
  })
}

async function stopPeerDiscovery() {
  // 발견된 피어 목록 초기화
  discoveredPeerIds.clear()
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
async function republishService({ nickname, peerId, wsPort, filePort }) {
  if (!bonjourInstance) return
  if (publishedService) {
    publishedService.stop()
    // mDNS goodbye 패킷이 네트워크에 전파될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const sessionId = Date.now().toString(36)
  publishedService = bonjourInstance.publish({
    name: `${nickname}__${peerId}__${sessionId}`,
    type: SERVICE_TYPE,
    port: wsPort,
    txt: { nickname, peerId, filePort: String(filePort) },
  })
}

module.exports = { startPeerDiscovery, stopPeerDiscovery, republishService }
