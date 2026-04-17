// electron/peer/broadcastDiscovery.js
// UDP 브로드캐스트 기반 피어 발견
// — mDNS(멀티캐스트)가 AP isolation으로 차단된 네트워크에서도 동작
// — 대부분의 라우터는 브로드캐스트를 클라이언트 간에 허용 (DHCP 필요)
const dgram = require('dgram')
const os = require('os')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')

// 서브넷 브로드캐스트 주소 계산 (192.168.0.255 등)
// macOS에서 255.255.255.255는 EHOSTUNREACH → 서브넷 브로드캐스트를 사용해야 함
function getSubnetBroadcastAddresses() {
  const addresses = []
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces)) {
    for (const info of (iface || [])) {
      if (info.family !== 'IPv4' || info.internal) continue
      // 브로드캐스트 = (IP & mask) | (~mask)
      const ipParts = info.address.split('.').map(Number)
      const maskParts = info.netmask.split('.').map(Number)
      const broadcast = ipParts.map((b, i) => (b & maskParts[i]) | (~maskParts[i] & 0xff)).join('.')
      if (broadcast && broadcast !== info.address) addresses.push(broadcast)
    }
  }
  // 고유값만 반환, 없으면 fallback
  return [...new Set(addresses)]
}

const BROADCAST_PORT = 49162
const BROADCAST_INTERVAL_MS = 4000
const PACKET_TYPE = 'lan-chat-discovery'

let broadcastSocket = null
let broadcastTimer = null

function buildPacket({ peerId, nickname, wsPort, filePort, addresses }) {
  return Buffer.from(JSON.stringify({
    type: PACKET_TYPE,
    peerId,
    nickname,
    wsPort,
    filePort,
    addresses,
  }))
}

function startBroadcastDiscovery({ peerId, nickname, wsPort, filePort, addresses = [], onPeerFound, myAddresses = [] }) {
  stopBroadcastDiscovery()

  broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  broadcastSocket.on('error', (err) => {
    writePeerDebugLog('broadcastDiscovery.error', { error: err.message })
    // 소켓 오류는 무시하고 계속 동작 시도
  })

  broadcastSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString())
      if (data.type !== PACKET_TYPE) return
      if (data.peerId === peerId) return // 내 브로드캐스트 무시 (peerId 기준)
      if (myAddresses.includes(rinfo.address)) return // 내 IP에서 온 패킷 무시 (루프백 방어)
      if (!data.peerId || !data.wsPort) return

      writePeerDebugLog('broadcastDiscovery.received', {
        fromIp: rinfo.address,
        peerId: data.peerId,
        wsPort: data.wsPort,
        nickname: data.nickname,
      })

      // 발신자 IP를 주소 목록에 추가 (TXT에 없을 경우 대비)
      const addresses = Array.isArray(data.addresses) ? data.addresses : []
      if (!addresses.includes(rinfo.address)) addresses.unshift(rinfo.address)

      onPeerFound({
        peerId: data.peerId,
        nickname: data.nickname || '알 수 없음',
        host: rinfo.address,
        addresses,
        advertisedAddresses: addresses,
        refererAddress: rinfo.address,
        wsPort: data.wsPort,
        filePort: data.filePort || 0,
      })
    } catch { /* 잘못된 패킷 무시 */ }
  })

  broadcastSocket.bind(BROADCAST_PORT, () => {
    broadcastSocket.setBroadcast(true)
    writePeerDebugLog('broadcastDiscovery.started', { port: BROADCAST_PORT, wsPort, peerId })

    // 즉시 한 번 전송 후 주기적으로 반복
    const broadcastTargets = getSubnetBroadcastAddresses()
    writePeerDebugLog('broadcastDiscovery.targets', { broadcastTargets })

    const sendBroadcast = () => {
      const packet = buildPacket({ peerId, nickname, wsPort, filePort, addresses })
      for (const target of broadcastTargets) {
        broadcastSocket?.send(packet, BROADCAST_PORT, target, (err) => {
          if (err) writePeerDebugLog('broadcastDiscovery.sendError', { target, error: err.message })
        })
      }
    }
    sendBroadcast()
    broadcastTimer = setInterval(sendBroadcast, BROADCAST_INTERVAL_MS)
    if (broadcastTimer.unref) broadcastTimer.unref()
  })
}

function stopBroadcastDiscovery() {
  if (broadcastTimer) {
    clearInterval(broadcastTimer)
    broadcastTimer = null
  }
  if (broadcastSocket) {
    try { broadcastSocket.close() } catch {}
    broadcastSocket = null
  }
}

module.exports = { startBroadcastDiscovery, stopBroadcastDiscovery }
