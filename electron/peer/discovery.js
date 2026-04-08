// electron/peer/discovery.js
const { Bonjour } = require('bonjour-service')

const SERVICE_TYPE = 'lan-chat'

let bonjourInstance = null
let publishedService = null
let browseInstance = null
let browseRefreshTimer = null
// peerId -> 현재 대표 서비스 fqdn
const peerServiceMap = new Map()
// fqdn -> peerId
const servicePeerMap = new Map()

// 네트워크 상태 변화(와이파이 전환/로컬호스트명 충돌 재조정 등) 중 발생 가능한
// mDNS 전송 오류 코드는 치명 오류로 보지 않고 복구를 기다린다.
const NON_FATAL_MDNS_ERROR_CODES = new Set([
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EADDRNOTAVAIL',
])

function isNonFatalMdnsError(error) {
  if (!error) return false
  if (NON_FATAL_MDNS_ERROR_CODES.has(error.code)) return true
  const message = String(error.message || '')
  return message.includes('224.0.0.251:5353')
}

function handleMdnsError(error) {
  if (isNonFatalMdnsError(error)) {
    console.warn(`[mDNS] 네트워크 일시 오류 무시: ${error.code || 'UNKNOWN'} ${error.message || ''}`)
    return
  }
  throw error
}

function getServiceIdentity(service) {
  if (service?.fqdn) return service.fqdn
  const peerId = service?.txt?.peerId || 'unknown-peer'
  const host = service?.host || 'unknown-host'
  const port = Number(service?.port) || 0
  return `${peerId}:${host}:${port}`
}

function normalizePeerInfoFromService(service) {
  return {
    peerId: service.txt?.peerId,
    nickname: service.txt?.nickname || '알 수 없음',
    host: service.host,
    addresses: service.addresses || [],
    refererAddress: service.referer?.address || null,
    wsPort: Number(service.port),
    filePort: Number(service.txt?.filePort),
  }
}

function startPeerDiscovery({ nickname, peerId, wsPort, filePort, onPeerFound, onPeerLeft }) {
  bonjourInstance = new Bonjour({}, handleMdnsError)
  // multicast-dns warning 이벤트도 동일 기준으로 처리해 크래시/노이즈를 줄임
  bonjourInstance.server?.mdns?.on?.('warning', (error) => {
    if (isNonFatalMdnsError(error)) {
      console.warn(`[mDNS] warning 무시: ${error.code || 'UNKNOWN'} ${error.message || ''}`)
      return
    }
    console.warn('[mDNS] warning:', error)
  })

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

  const handleServiceUpsert = (service) => {
    const discoveredPeerId = service.txt?.peerId
    const discoveredWsPort = Number(service.port)
    if (discoveredPeerId === peerId) return
    // peerId/port가 비정상이면 무시 (Set 오염 및 잘못된 연결 시도 방지)
    if (!discoveredPeerId || !Number.isInteger(discoveredWsPort) || discoveredWsPort <= 0) return

    const serviceIdentity = getServiceIdentity(service)
    const previousServiceIdentity = peerServiceMap.get(discoveredPeerId)
    if (previousServiceIdentity && previousServiceIdentity !== serviceIdentity) {
      servicePeerMap.delete(previousServiceIdentity)
    }

    peerServiceMap.set(discoveredPeerId, serviceIdentity)
    servicePeerMap.set(serviceIdentity, discoveredPeerId)

    // addresses: mDNS A/AAAA 레코드에서 가져온 실제 IP 주소 목록
    // host: SRV 레코드의 hostname (예: MacBook.local) — resolve 실패 가능성 있음
    onPeerFound(normalizePeerInfoFromService(service))
  }

  browseInstance = bonjourInstance.find({ type: SERVICE_TYPE }, handleServiceUpsert)
  browseInstance.on('txt-update', handleServiceUpsert)

  browseInstance.on('down', (service) => {
    const serviceIdentity = getServiceIdentity(service)
    const leftPeerId = servicePeerMap.get(serviceIdentity) || service.txt?.peerId
    if (!leftPeerId) return

    servicePeerMap.delete(serviceIdentity)
    if (peerServiceMap.get(leftPeerId) !== serviceIdentity) return

    peerServiceMap.delete(leftPeerId)
    onPeerLeft(leftPeerId)
  })

  // 일부 환경은 up 이벤트가 유실되거나 늦게 도착하므로 주기적으로 PTR 재질의
  browseRefreshTimer = setInterval(() => {
    browseInstance?.update?.()
  }, 5000)
  if (browseRefreshTimer.unref) browseRefreshTimer.unref()
}

async function stopPeerDiscovery() {
  // 발견된 피어 목록 초기화
  peerServiceMap.clear()
  servicePeerMap.clear()
  if (browseRefreshTimer) {
    clearInterval(browseRefreshTimer)
    browseRefreshTimer = null
  }
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

// 특정 피어를 발견 목록에서 제거 — 재연결 영구 실패 시 mDNS 재발견 허용
function removePeerFromDiscovered(peerId) {
  const serviceIdentity = peerServiceMap.get(peerId)
  if (serviceIdentity) {
    servicePeerMap.delete(serviceIdentity)
  }
  peerServiceMap.delete(peerId)
}

module.exports = { startPeerDiscovery, stopPeerDiscovery, republishService, removePeerFromDiscovered }
