// electron/peer/discovery.js
const { Bonjour } = require('bonjour-service')
const { spawn } = require('child_process')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')
const { normalizeAdvertisedAddresses } = require('./networkUtils')

const SERVICE_TYPE = 'lan-chat'

let bonjourInstance = null
let publishedService = null
let browseInstance = null
let browseRefreshTimer = null
let browseBurstRefreshTimers = []
// peerId -> 현재 대표 서비스 fqdn
const peerServiceMap = new Map()
// fqdn -> peerId
const servicePeerMap = new Map()

// macOS dns-sd 서브프로세스 브라우저 상태
let dnsSdBrowserProcess = null
let dnsSdLookupProcesses = []
const dnsSdInstanceMap = new Map() // instanceName -> { peerId }
const DISCOVERY_REFRESH_INTERVAL_MS = 5000
const DISCOVERY_BURST_REFRESH_DELAYS = [250, 750, 1500, 3000]

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
    writePeerDebugLog('discovery.mdns.nonFatalError', { error })
    console.warn(`[mDNS] 네트워크 일시 오류 무시: ${error.code || 'UNKNOWN'} ${error.message || ''}`)
    return
  }
  writePeerDebugLog('discovery.mdns.fatalError', { error })
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
    advertisedAddresses: normalizeAdvertisedAddresses(service.txt?.addresses),
    refererAddress: service.referer?.address || null,
    wsPort: Number(service.port),
    filePort: Number(service.txt?.filePort),
  }
}

function buildServiceName(peerId, sessionId) {
  return `lan-chat-${peerId}-${sessionId}`
}

function startPeerDiscovery({ nickname, peerId, wsPort, filePort, advertisedAddresses = [], onPeerFound, onPeerLeft }) {
  const normalizedAdvertisedAddresses = normalizeAdvertisedAddresses(advertisedAddresses)
  writePeerDebugLog('discovery.start', { nickname, peerId, wsPort, filePort, advertisedAddresses: normalizedAdvertisedAddresses })
  bonjourInstance = new Bonjour({}, handleMdnsError)
  // multicast-dns warning 이벤트도 동일 기준으로 처리해 크래시/노이즈를 줄임
  bonjourInstance.server?.mdns?.on?.('warning', (error) => {
    if (isNonFatalMdnsError(error)) {
      writePeerDebugLog('discovery.mdns.warningIgnored', { error })
      console.warn(`[mDNS] warning 무시: ${error.code || 'UNKNOWN'} ${error.message || ''}`)
      return
    }
    writePeerDebugLog('discovery.mdns.warning', { error })
    console.warn('[mDNS] warning:', error)
  })

  // 서비스 이름에 세션 ID 추가 — 새로고침 시 다른 이름으로 등록되어
  // 상대방 browser의 캐시 문제 없이 항상 새 서비스로 인식됨
  const sessionId = Date.now().toString(36)
  publishedService = bonjourInstance.publish({
    name: buildServiceName(peerId, sessionId),
    type: SERVICE_TYPE,
    port: wsPort,
    txt: {
      // DNS TXT 레코드 값은 255바이트 이하 — nickname을 200자로 제한
      nickname: nickname.slice(0, 200),
      peerId,
      filePort: String(filePort),
      addresses: normalizedAdvertisedAddresses.join(','),
    },
  })
  writePeerDebugLog('discovery.publish', {
    peerId,
    nickname,
    wsPort,
    filePort,
    advertisedAddresses: normalizedAdvertisedAddresses,
    sessionId,
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
    writePeerDebugLog('discovery.service.upsert', {
      peerId: discoveredPeerId,
      serviceIdentity,
      host: service.host,
      addresses: service.addresses || [],
      advertisedAddresses: normalizeAdvertisedAddresses(service.txt?.addresses),
      refererAddress: service.referer?.address || null,
      wsPort: discoveredWsPort,
      filePort: Number(service.txt?.filePort),
      nickname: service.txt?.nickname || '알 수 없음',
    })

    // addresses: mDNS A/AAAA 레코드에서 가져온 실제 IP 주소 목록
    // host: SRV 레코드의 hostname (예: MacBook.local) — resolve 실패 가능성 있음
    onPeerFound(normalizePeerInfoFromService(service))
  }

  browseInstance = bonjourInstance.find({ type: SERVICE_TYPE }, handleServiceUpsert)
  browseInstance.on('txt-update', handleServiceUpsert)
  browseInstance.update?.()
  writePeerDebugLog('discovery.refresh.immediate', {})

  browseBurstRefreshTimers = DISCOVERY_BURST_REFRESH_DELAYS.map((delayMs) => {
    const refreshTimer = setTimeout(() => {
      browseInstance?.update?.()
      writePeerDebugLog('discovery.refresh.burst', { delayMs })
    }, delayMs)
    if (refreshTimer.unref) refreshTimer.unref()
    return refreshTimer
  })

  browseInstance.on('down', (service) => {
    const serviceIdentity = getServiceIdentity(service)
    const leftPeerId = servicePeerMap.get(serviceIdentity) || service.txt?.peerId
    if (!leftPeerId) return

    servicePeerMap.delete(serviceIdentity)
    if (peerServiceMap.get(leftPeerId) !== serviceIdentity) return

    peerServiceMap.delete(leftPeerId)
    writePeerDebugLog('discovery.service.down', { peerId: leftPeerId, serviceIdentity })
    onPeerLeft(leftPeerId)
  })

  // 일부 환경은 up 이벤트가 유실되거나 늦게 도착하므로 주기적으로 PTR 재질의
  browseRefreshTimer = setInterval(() => {
    browseInstance?.update?.()
    writePeerDebugLog('discovery.refresh.interval', { intervalMs: DISCOVERY_REFRESH_INTERVAL_MS })
  }, DISCOVERY_REFRESH_INTERVAL_MS)
  if (browseRefreshTimer.unref) browseRefreshTimer.unref()

  // macOS: 시스템 dns-sd 서브프로세스로 mDNS 브라우징 보완
  // (macOS mDNSResponder가 멀티캐스트를 선점해 bonjour-service JS 소켓이 수신 못하는 문제 우회)
  startDnsSdBrowseMac(peerId, onPeerFound, onPeerLeft)
}

async function stopPeerDiscovery() {
  writePeerDebugLog('discovery.stop', {
    peerIds: [...peerServiceMap.keys()],
  })
  // macOS dns-sd 브라우저 정리
  stopDnsSdBrowseMac()
  // 발견된 피어 목록 초기화
  peerServiceMap.clear()
  servicePeerMap.clear()
  browseBurstRefreshTimers.forEach(timer => clearTimeout(timer))
  browseBurstRefreshTimers = []
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
async function republishService({ nickname, peerId, wsPort, filePort, advertisedAddresses = [] }) {
  if (!bonjourInstance) return
  if (publishedService) {
    publishedService.stop()
    // mDNS goodbye 패킷이 네트워크에 전파될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const normalizedAdvertisedAddresses = normalizeAdvertisedAddresses(advertisedAddresses)
  const sessionId = Date.now().toString(36)
  publishedService = bonjourInstance.publish({
    name: buildServiceName(peerId, sessionId),
    type: SERVICE_TYPE,
    port: wsPort,
    txt: {
      // DNS TXT 레코드 값은 255바이트 이하 — nickname을 200자로 제한
      nickname: nickname.slice(0, 200),
      peerId,
      filePort: String(filePort),
      addresses: normalizedAdvertisedAddresses.join(','),
    },
  })
  writePeerDebugLog('discovery.republish', {
    peerId,
    nickname,
    wsPort,
    filePort,
    advertisedAddresses: normalizedAdvertisedAddresses,
    sessionId,
  })
}

// macOS 전용: dns-sd 서브프로세스로 mDNS 브라우징
// bonjour-service의 JS 소켓이 macOS mDNSResponder에게 멀티캐스트 패킷을 빼앗기는 문제 우회
function startDnsSdBrowseMac(myPeerId, onPeerFound, onPeerLeft) {
  if (process.platform !== 'darwin') return

  dnsSdBrowserProcess = spawn('/usr/bin/dns-sd', ['-B', `_${SERVICE_TYPE}._tcp`, '.'])
  let buffer = ''

  dnsSdBrowserProcess.stdout.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // 미완성 줄 보존

    lines.forEach(line => {
      // 형식: "HH:MM:SS.fff  Add|Rmv  flags  if  domain  type  instance-name"
      const match = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s+(Add|Rmv)\s+\d+\s+\d+\s+\S+\s+\S+\s+(.+?)\s*$/)
      if (!match) return
      const action = match[1]
      const instanceName = match[2]
      writePeerDebugLog('discovery.dnsSd.browse', { action, instanceName })

      if (action === 'Add') {
        lookupDnsSdServiceMac(instanceName, myPeerId, onPeerFound)
      } else if (action === 'Rmv') {
        const info = dnsSdInstanceMap.get(instanceName)
        dnsSdInstanceMap.delete(instanceName)
        if (info?.peerId) {
          // 같은 peerId의 다른 서비스(새 세션)가 아직 활성이면 onPeerLeft 호출 금지
          // — 재시작 시 구 서비스 Rmv와 신 서비스 Add가 겹치는 경우 재연결 루프가 끊기는 버그 방지
          const hasOtherActiveService = [...dnsSdInstanceMap.values()].some(v => v.peerId === info.peerId)
          if (hasOtherActiveService) {
            writePeerDebugLog('discovery.dnsSd.rmvIgnored', { peerId: info.peerId, instanceName, reason: 'other service active' })
          } else {
            writePeerDebugLog('discovery.dnsSd.left', { peerId: info.peerId, instanceName })
            onPeerLeft(info.peerId)
          }
        }
      }
    })
  })

  dnsSdBrowserProcess.on('error', (err) => {
    writePeerDebugLog('discovery.dnsSd.browserError', { error: err.message })
  })
}

function lookupDnsSdServiceMac(instanceName, myPeerId, onPeerFound) {
  const lookupProcess = spawn('/usr/bin/dns-sd', ['-L', instanceName, `_${SERVICE_TYPE}._tcp`, 'local'])
  dnsSdLookupProcesses.push(lookupProcess)
  // 프로세스 종료 시 배열에서 제거 — 누적 방지
  lookupProcess.once('close', () => {
    const index = dnsSdLookupProcesses.indexOf(lookupProcess)
    if (index !== -1) dnsSdLookupProcesses.splice(index, 1)
  })
  let output = ''
  let resolved = false

  const cleanupTimeout = setTimeout(() => {
    if (!resolved) {
      resolved = true
      try { lookupProcess.kill() } catch {}
      writePeerDebugLog('discovery.dnsSd.lookupTimeout', { instanceName })
    }
  }, 5000)
  if (cleanupTimeout.unref) cleanupTimeout.unref()

  lookupProcess.stdout.on('data', (data) => {
    if (resolved) return
    output += data.toString()

    // "...can be reached at hostname.:port (interface N)"
    const reachedMatch = output.match(/can be reached at ([^:]+):(\d+) \(interface/)
    if (!reachedMatch) return

    // TXT 레코드는 "can be reached" 줄 다음 줄에 공백으로 시작
    const afterReached = output.slice(output.indexOf('can be reached'))
    const txtLineMatch = afterReached.match(/\n[ \t]+(.+)/)
    if (!txtLineMatch) return

    resolved = true
    clearTimeout(cleanupTimeout)
    try { lookupProcess.kill() } catch {}

    const host = reachedMatch[1].replace(/\.$/, '')
    const port = Number(reachedMatch[2])
    const txtLine = txtLineMatch[1]

    // key=value 파싱 (space-separated)
    const txt = {}
    txtLine.split(/\s+/).forEach(token => {
      const eqIdx = token.indexOf('=')
      if (eqIdx > 0) txt[token.slice(0, eqIdx)] = token.slice(eqIdx + 1)
    })

    const discoveredPeerId = txt.peerId
    if (!discoveredPeerId || discoveredPeerId === myPeerId) return

    const addresses = txt.addresses
      ? txt.addresses.split(',').map(a => a.trim()).filter(Boolean)
      : (host && !host.endsWith('.local') ? [host] : [])

    const peerInfo = {
      peerId: discoveredPeerId,
      nickname: txt.nickname || '알 수 없음',
      host,
      addresses,
      advertisedAddresses: addresses,
      refererAddress: null,
      wsPort: port,
      filePort: Number(txt.filePort) || 0,
    }

    writePeerDebugLog('discovery.dnsSd.found', {
      peerId: discoveredPeerId,
      host,
      port,
      filePort: peerInfo.filePort,
      addresses,
    })

    dnsSdInstanceMap.set(instanceName, { peerId: discoveredPeerId })
    onPeerFound(peerInfo)
  })

  lookupProcess.on('error', (err) => {
    clearTimeout(cleanupTimeout)
    writePeerDebugLog('discovery.dnsSd.lookupError', { instanceName, error: err.message })
  })
}

function stopDnsSdBrowseMac() {
  dnsSdLookupProcesses.forEach(p => { try { p.kill() } catch {} })
  dnsSdLookupProcesses = []
  dnsSdInstanceMap.clear()
  if (dnsSdBrowserProcess) {
    try { dnsSdBrowserProcess.kill() } catch {}
    dnsSdBrowserProcess = null
  }
}

// 특정 피어를 발견 목록에서 제거 — 재연결 영구 실패 시 mDNS 재발견 허용
function removePeerFromDiscovered(peerId) {
  const serviceIdentity = peerServiceMap.get(peerId)
  if (serviceIdentity) {
    servicePeerMap.delete(serviceIdentity)
  }
  peerServiceMap.delete(peerId)
  writePeerDebugLog('discovery.removePeer', { peerId })
}

module.exports = { startPeerDiscovery, stopPeerDiscovery, republishService, removePeerFromDiscovered }
