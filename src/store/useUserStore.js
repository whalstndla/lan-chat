// src/store/useUserStore.js
import { create } from 'zustand'
import { DEFAULT_THEME, resolveTheme, applyThemeToDocument } from '../utils/theme'

// 테마(#73)는 계정 데이터가 아니라 "이 기기의 UI 선호값" 이다 — useChatStore 의
// mutedRooms/sendOriginalImages 와 같은 이유로 DB(IPC)가 아닌 localStorage 에 저장한다.
// 로그인 전 화면(SetupScreen/LoginScreen)에서도 즉시 적용돼야 하는데, DB는 로그인 이후
// 마스터키 언랩 전에는 열 수 없어 애초에 DB 경로를 쓸 수 없다. 같은 이유로 reset()/logout
// 에도 영향받지 않는다(아래 reset() 이 이 필드를 건드리지 않음).
const THEME_STORAGE_KEY = 'appTheme'

function loadTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // localStorage 접근 실패 시 무시
  }
}

// 시스템 다크모드 선호 여부 — matchMedia 미지원/DOM 없는 환경(jest node 등)에서는
// 항상 다크(true)로 폴백해 이 앱의 기본 테마 불변식을 지킨다.
function getSystemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

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

  // 테마(#73) — 'dark' | 'light' | 'system'. 저장/DOM 반영은 위 helper 들이 담당.
  theme: loadTheme(),
  setTheme: (theme) => {
    saveTheme(theme)
    applyThemeToDocument(resolveTheme(theme, getSystemPrefersDark()))
    set({ theme })
  },
}))

// 모듈 로드 시점(=main.jsx 가 App 을 렌더링하기도 전)에 저장된 테마를 즉시 DOM 에 반영해
// FOUC(기본 다크가 잠깐 보였다가 저장된 라이트로 바뀌는 깜빡임)를 최대한 줄인다.
// App.jsx 가 이 스토어를 import 하므로 React 렌더 이전에 항상 실행된다.
applyThemeToDocument(resolveTheme(useUserStore.getState().theme, getSystemPrefersDark()))

// OS 다크모드 선호가 바뀌면(테마 설정이 'system' 일 때만) 즉시 재반영한다.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (useUserStore.getState().theme === 'system') {
        applyThemeToDocument(resolveTheme('system', event.matches))
      }
    })
  } catch {
    // addEventListener 시그니처 미지원 등 구형 환경 — 시스템 테마 자동 추적만 못 함(무시)
  }
}

export default useUserStore
