// tests/utils/resolvePeerNickname.test.js
// resolvePeerNickname 순수 로직 단위 테스트(#38) — 리액션 배지 hover 툴팁에서 peerId → 닉네임 변환에 사용.
import { resolvePeerNickname } from '../../src/utils/resolvePeerNickname'

const onlinePeers = [
  { peerId: 'peer-1', nickname: '앨리스' },
  { peerId: 'peer-2', nickname: '밥' },
]
const pastDMPeers = [
  { peerId: 'peer-3', nickname: '캐롤(오프라인)' },
]

describe('resolvePeerNickname', () => {
  it('내 peerId 이면 "나" 를 반환한다', () => {
    expect(resolvePeerNickname('my-id', { myPeerId: 'my-id', onlinePeers, pastDMPeers })).toBe('나')
  })

  it('온라인 피어면 onlinePeers 에서 닉네임을 조회한다', () => {
    expect(resolvePeerNickname('peer-1', { myPeerId: 'my-id', onlinePeers, pastDMPeers })).toBe('앨리스')
  })

  it('오프라인 상대면 pastDMPeers 에서 닉네임을 조회한다', () => {
    expect(resolvePeerNickname('peer-3', { myPeerId: 'my-id', onlinePeers, pastDMPeers })).toBe('캐롤(오프라인)')
  })

  it('어디에도 없으면 "알 수 없음" 을 반환한다', () => {
    expect(resolvePeerNickname('peer-unknown', { myPeerId: 'my-id', onlinePeers, pastDMPeers })).toBe('알 수 없음')
  })

  it('onlinePeers/pastDMPeers 를 생략해도 안전하게 동작한다', () => {
    expect(resolvePeerNickname('peer-1', { myPeerId: 'my-id' })).toBe('알 수 없음')
  })

  it('두 번째 인자를 아예 생략해도 예외 없이 "알 수 없음" 을 반환한다', () => {
    expect(resolvePeerNickname('peer-1')).toBe('알 수 없음')
  })
})
