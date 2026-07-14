// src/store/useUserStore.js
import { create } from 'zustand'

const useUserStore = create((set) => ({
  myPeerId: null,
  myNickname: null,
  myProfileImageUrl: null,
  myStatusType: 'online',
  myStatusMessage: '',

  initialize: (peerId, nickname, profileImageUrl) => set({
    myPeerId: peerId,
    myNickname: nickname,
    myProfileImageUrl: profileImageUrl || null,
  }),

  updateMyNickname: (nickname) => set({ myNickname: nickname }),

  updateMyProfileImageUrl: (url) => set({ myProfileImageUrl: url }),

  // 내 상태 타입 및 상태 메시지 변경
  setMyStatus: (statusType, statusMessage) =>
    set({ myStatusType: statusType, myStatusMessage: statusMessage || '' }),

  reset: () => set({ myPeerId: null, myNickname: null, myProfileImageUrl: null, myStatusType: 'online', myStatusMessage: '' }),

  notificationSound: 'notification1',  // 'notification1'~'notification4' | 'custom'
  notificationVolume: 0.7,
  notificationCustomSoundBuffer: null, // Uint8Array | null
  notificationScope: 'all',   // 'all'(전체) | 'dm'(DM만) | 'off'(끄기)
  notificationHideBody: false, // OS 알림 본문에 실제 메시지 대신 "새 메시지"만 표시

  // scope/hideBody 는 sound/volume 을 바꾸는 기존 호출부가 넘기지 않아도 기존 값을
  // 유지하도록 병합한다(sound/volume/customSoundBuffer 는 기존 동작 그대로 유지).
  setNotificationSettings: ({ sound, volume, customSoundBuffer, scope, hideBody }) =>
    set((state) => ({
      notificationSound: sound,
      notificationVolume: volume,
      notificationCustomSoundBuffer: customSoundBuffer ?? null,
      notificationScope: scope ?? state.notificationScope,
      notificationHideBody: hideBody !== undefined ? hideBody : state.notificationHideBody,
    })),
}))

export default useUserStore
