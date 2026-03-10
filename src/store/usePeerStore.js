// src/store/usePeerStore.js
import { create } from 'zustand'

const usePeerStore = create((set) => ({
  onlinePeers: [], // [{ peerId, nickname, host, wsPort, filePort }]

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
}))

export default usePeerStore
