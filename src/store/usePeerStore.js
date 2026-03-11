// src/store/usePeerStore.js
import { create } from 'zustand'

const usePeerStore = create((set) => ({
  onlinePeers: [], // [{ peerId, nickname, host, wsPort, filePort, profileImageUrl }]

  addPeer: (peerInfo) =>
    set((state) => ({
      onlinePeers: state.onlinePeers.some(peer => peer.peerId === peerInfo.peerId)
        ? state.onlinePeers
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
}))

export default usePeerStore
