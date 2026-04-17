// tests/store/stores.test.js
// 실제 usePeerStore를 import하여 store actions를 직접 테스트
import usePeerStore from '../../src/store/usePeerStore'

beforeEach(() => {
  // 각 테스트 전 스토어 초기화
  usePeerStore.getState().clearAllPeers()
  usePeerStore.getState().clearPastDMPeers()
})

describe('usePeerStore — onlinePeers', () => {
  it('피어를 추가하면 onlinePeers에 포함됨', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스', host: '192.168.0.2', wsPort: 49152 })
    expect(usePeerStore.getState().onlinePeers).toHaveLength(1)
    expect(usePeerStore.getState().onlinePeers[0].peerId).toBe('p1')
  })

  it('같은 peerId를 다시 추가하면 upsert (중복 없이 정보 업데이트)', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스', host: '192.168.0.2', wsPort: 49152 })
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스(수정)', host: '192.168.0.2', wsPort: 49153 })

    const peers = usePeerStore.getState().onlinePeers
    expect(peers).toHaveLength(1)
    expect(peers[0].nickname).toBe('앨리스(수정)')
    expect(peers[0].wsPort).toBe(49153)
  })

  it('피어를 제거하면 onlinePeers에서 사라짐', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스' })
    usePeerStore.getState().addPeer({ peerId: 'p2', nickname: '밥' })
    usePeerStore.getState().removePeer('p1')

    const peers = usePeerStore.getState().onlinePeers
    expect(peers).toHaveLength(1)
    expect(peers[0].peerId).toBe('p2')
  })

  it('updatePeerNickname — 닉네임만 변경, 다른 필드는 유지', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스', wsPort: 49152 })
    usePeerStore.getState().updatePeerNickname('p1', '앨리스(변경)')

    const peer = usePeerStore.getState().onlinePeers[0]
    expect(peer.nickname).toBe('앨리스(변경)')
    expect(peer.wsPort).toBe(49152)
  })

  it('updatePeer — 부분 업데이트', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스', filePort: 0 })
    usePeerStore.getState().updatePeer('p1', { filePort: 8080 })

    const peer = usePeerStore.getState().onlinePeers[0]
    expect(peer.filePort).toBe(8080)
    expect(peer.nickname).toBe('앨리스')
  })

  it('clearAllPeers — 전체 초기화', () => {
    usePeerStore.getState().addPeer({ peerId: 'p1', nickname: '앨리스' })
    usePeerStore.getState().addPeer({ peerId: 'p2', nickname: '밥' })
    usePeerStore.getState().clearAllPeers()

    expect(usePeerStore.getState().onlinePeers).toHaveLength(0)
  })
})

describe('usePeerStore — pastDMPeers', () => {
  it('addPastDMPeer — 과거 DM 목록에 추가', () => {
    usePeerStore.getState().addPastDMPeer({ peerId: 'p1', nickname: '앨리스' })
    expect(usePeerStore.getState().pastDMPeers).toHaveLength(1)
  })

  it('addPastDMPeer — 같은 peerId 중복 추가 방지', () => {
    usePeerStore.getState().addPastDMPeer({ peerId: 'p1', nickname: '앨리스' })
    usePeerStore.getState().addPastDMPeer({ peerId: 'p1', nickname: '앨리스' })
    expect(usePeerStore.getState().pastDMPeers).toHaveLength(1)
  })

  it('setPastDMPeers — 목록 일괄 설정', () => {
    usePeerStore.getState().setPastDMPeers([
      { peerId: 'p1', nickname: '앨리스' },
      { peerId: 'p2', nickname: '밥' },
    ])
    expect(usePeerStore.getState().pastDMPeers).toHaveLength(2)
  })
})
