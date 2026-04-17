// 실제 mDNS / UDP 브로드캐스트 / HTTP 파일서버를 대체하는 스텁 팩토리.
// createFakeDiscovery()는 startPeerDiscovery에 주입되는 콜백(onPeerFound/onPeerLeft)을 저장해,
// 테스트에서 emitPeerFound()/emitPeerLeft()로 수동 트리거 가능하게 한다.

function createFakeDiscovery() {
  let callbacks = null
  let started = false
  return {
    // 실제 discovery.js 모듈의 export 시그니처와 호환
    startPeerDiscovery(options) {
      callbacks = {
        onPeerFound: options.onPeerFound,
        onPeerLeft: options.onPeerLeft,
      }
      started = true
    },
    async stopPeerDiscovery() {
      started = false
      callbacks = null
    },
    async republishService() {},
    removePeerFromDiscovered() {},
    // 테스트에서 호출
    emitPeerFound(peerInfo) {
      if (!started || !callbacks) throw new Error('discovery not started')
      return callbacks.onPeerFound(peerInfo)
    },
    emitPeerLeft(peerId) {
      if (!started || !callbacks) throw new Error('discovery not started')
      return callbacks.onPeerLeft(peerId)
    },
    isStarted() { return started },
  }
}

function createFakeBroadcastDiscovery() {
  let callbacks = null
  let started = false
  return {
    startBroadcastDiscovery(options) {
      callbacks = { onPeerFound: options.onPeerFound }
      started = true
    },
    stopBroadcastDiscovery() {
      started = false
      callbacks = null
    },
    emitPeerFound(peerInfo) {
      if (!started || !callbacks) throw new Error('broadcast not started')
      return callbacks.onPeerFound(peerInfo)
    },
    isStarted() { return started },
  }
}

function createFakeFileServer() {
  return {
    startFileServer: async () => {},
    stopFileServer: () => {},
    getFilePort: () => 0,
  }
}

module.exports = { createFakeDiscovery, createFakeBroadcastDiscovery, createFakeFileServer }
