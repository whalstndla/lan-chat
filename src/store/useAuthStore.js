// src/store/useAuthStore.js
import { create } from 'zustand'

// 인증 상태: 'loading' → 'setup'(첫 실행) | 'login'(재실행) → 'authenticated'
const useAuthStore = create((set) => ({
  인증상태: 'loading',
  인증된닉네임: null,
  인증상태변경: (상태) => set({ 인증상태: 상태 }),
  인증완료: (닉네임) => set({ 인증상태: 'authenticated', 인증된닉네임: 닉네임 }),
}))

export default useAuthStore
