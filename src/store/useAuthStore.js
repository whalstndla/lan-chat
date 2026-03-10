// src/store/useAuthStore.js
import { create } from 'zustand'

// 인증 상태: 'loading' → 'setup'(첫 실행) | 'login'(재실행) → 'authenticated'
const useAuthStore = create((set) => ({
  authStatus: 'loading',
  authenticatedNickname: null,
  setAuthStatus: (status) => set({ authStatus: status }),
  completeAuth: (nickname) => set({ authStatus: 'authenticated', authenticatedNickname: nickname }),
}))

export default useAuthStore
