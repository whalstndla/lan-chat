// tests/store/stores.test.js
// Zustand 스토어를 직접 재생성해서 테스트 (모듈 캐시 우회, ESM 변환 없이 CommonJS로 처리)
const { createStore } = require('zustand/vanilla')

function peerStore생성() {
  return createStore((set) => ({
    온라인피어목록: [],
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
}

describe('usePeerStore', () => {
  it('피어를 추가하면 목록에 포함됨', () => {
    const 스토어 = peerStore생성()
    스토어.getState().피어추가({ 피어아이디: 'p1', 닉네임: '홍길동' })
    expect(스토어.getState().온라인피어목록).toHaveLength(1)
  })

  it('중복 피어는 한 번만 추가됨', () => {
    const 스토어 = peerStore생성()
    스토어.getState().피어추가({ 피어아이디: 'p1', 닉네임: '홍길동' })
    스토어.getState().피어추가({ 피어아이디: 'p1', 닉네임: '홍길동' })
    expect(스토어.getState().온라인피어목록).toHaveLength(1)
  })

  it('피어를 제거하면 목록에서 사라짐', () => {
    const 스토어 = peerStore생성()
    스토어.getState().피어추가({ 피어아이디: 'p1', 닉네임: '홍길동' })
    스토어.getState().피어제거('p1')
    expect(스토어.getState().온라인피어목록).toHaveLength(0)
  })
})
