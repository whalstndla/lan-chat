// src/store/usePeerStore.js
import { create } from 'zustand'

const usePeerStore = create((set) => ({
  onlinePeers: [],    // [{ peerId, nickname, host, wsPort, filePort, profileImageUrl }]
  pastDMPeers: [],    // [{ peerId, nickname }] — DB에서 불러온 과거 DM 상대 (오프라인 포함)

  addPeer: (peerInfo) =>
    set((state) => ({
      onlinePeers: state.onlinePeers.some(peer => peer.peerId === peerInfo.peerId)
        // 이미 존재하는 피어면 정보 업데이트 (upsert)
        ? state.onlinePeers.map(peer => peer.peerId === peerInfo.peerId ? { ...peer, ...peerInfo } : peer)
        : [...state.onlinePeers, peerInfo],
    })),

  removePeer: (peerId) =>
    set((state) => ({
      onlinePeers: state.onlinePeers.filter(peer => peer.peerId !== peerId),
    })),

  updatePeerNickname: (peerId, nickname) =>
    set((state) => ({
      onlinePeers: state.onlinePeers.map(peer =>
        peer.peerId === peerId ? { ...peer, nickname } : peer
      ),
    })),

  updatePeer: (peerId, updates) =>
    set((state) => ({
      onlinePeers: state.onlinePeers.map(peer =>
        peer.peerId === peerId ? { ...peer, ...updates } : peer
      ),
    })),

  clearAllPeers: () => set({ onlinePeers: [] }),

  setPastDMPeers: (peers) => set({ pastDMPeers: peers }),

  clearPastDMPeers: () => set({ pastDMPeers: [] }),

  // 새 DM 수신 시 과거 목록에 없는 상대 추가
  addPastDMPeer: (peerInfo) =>
    set((state) => ({
      pastDMPeers: state.pastDMPeers.some(p => p.peerId === peerInfo.peerId)
        ? state.pastDMPeers
        : [peerInfo, ...state.pastDMPeers],
    })),
}))

export default usePeerStore
