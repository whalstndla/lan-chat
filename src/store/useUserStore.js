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

  notificationSound: 'notification1',  // 'notification1'~'notification4' | 'custom'
  notificationVolume: 0.7,
  notificationCustomSoundBuffer: null, // Uint8Array | null

  setNotificationSettings: ({ sound, volume, customSoundBuffer }) =>
    set({
      notificationSound: sound,
      notificationVolume: volume,
      notificationCustomSoundBuffer: customSoundBuffer ?? null,
    }),
}))

export default useUserStore
