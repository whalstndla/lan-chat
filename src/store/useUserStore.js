// src/store/useUserStore.js
import { create } from 'zustand'

const useUserStore = create((set) => ({
  myPeerId: null,
  myNickname: null,
  initialize: (peerId, nickname) => set({ myPeerId: peerId, myNickname: nickname }),
}))

export default useUserStore
