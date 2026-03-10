// src/store/usePeerStore.js
import { create } from 'zustand'

const usePeerStore = create((set) => ({
  온라인피어목록: [], // [{ 피어아이디, 닉네임, 호스트, 웹소켓포트, 파일포트 }]

  피어추가: (피어정보) =>
    set((상태) => ({
      온라인피어목록: 상태.온라인피어목록.some(피어 => 피어.피어아이디 === 피어정보.피어아이디)
        ? 상태.온라인피어목록
        : [...상태.온라인피어목록, 피어정보],
    })),

  피어제거: (피어아이디) =>
    set((상태) => ({
      온라인피어목록: 상태.온라인피어목록.filter(피어 => 피어.피어아이디 !== 피어아이디),
    })),
}))

export default usePeerStore
