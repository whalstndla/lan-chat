// src/store/useUserStore.js
import { create } from 'zustand'

const useUserStore = create((set) => ({
  myPeerId: null,
  myNickname: null,
  myProfileImageUrl: null,

  initialize: (peerId, nickname, profileImageUrl) => set({
    myPeerId: peerId,
    myNickname: nickname,
    myProfileImageUrl: profileImageUrl || null,
  }),

  updateMyNickname: (nickname) => set({ myNickname: nickname }),

  updateMyProfileImageUrl: (url) => set({ myProfileImageUrl: url }),

  reset: () => set({ myPeerId: null, myNickname: null, myProfileImageUrl: null }),
}))

export default useUserStore
