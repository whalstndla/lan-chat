// src/store/useUserStore.js
import { create } from 'zustand'

const useUserStore = create((set) => ({
  나의피어아이디: null,
  나의닉네임: null,
  초기화: (피어아이디, 닉네임) => set({ 나의피어아이디: 피어아이디, 나의닉네임: 닉네임 }),
}))

export default useUserStore
