// tests/utils/comparePeers.test.js
// 사이드바 피어 목록 정렬 비교자 + DM 검색 필터 순수 로직 단위 테스트(#43).
import { comparePeersForSidebar, matchesPeerFilter } from '../../src/utils/comparePeers'

describe('comparePeersForSidebar', () => {
  it('안읽음이 있는 피어를 안읽음이 없는 피어보다 우선한다', () => {
    const alice = { peerId: 'alice', nickname: '앨리스' }
    const bob = { peerId: 'bob', nickname: '밥' }
    const unreadCounts = { bob: 3 }

    const sorted = [alice, bob].sort((a, b) => comparePeersForSidebar(a, b, unreadCounts))
    expect(sorted.map(p => p.peerId)).toEqual(['bob', 'alice'])
  })

  it('안읽음 여부가 같으면 닉네임 가나다순으로 정렬한다', () => {
    const peers = [
      { peerId: 'p1', nickname: '홍길동' },
      { peerId: 'p2', nickname: '김철수' },
      { peerId: 'p3', nickname: '이영희' },
    ]
    const sorted = [...peers].sort((a, b) => comparePeersForSidebar(a, b, {}))
    expect(sorted.map(p => p.nickname)).toEqual(['김철수', '이영희', '홍길동'])
  })

  it('발견 순서와 무관하게 항상 같은 순서를 만든다(안정적 정렬)', () => {
    const peers = [
      { peerId: 'p3', nickname: '다' },
      { peerId: 'p1', nickname: '가' },
      { peerId: 'p2', nickname: '나' },
    ]
    const reversed = [...peers].reverse()

    const sortedA = [...peers].sort((a, b) => comparePeersForSidebar(a, b, {}))
    const sortedB = [...reversed].sort((a, b) => comparePeersForSidebar(a, b, {}))

    expect(sortedA.map(p => p.peerId)).toEqual(sortedB.map(p => p.peerId))
    expect(sortedA.map(p => p.nickname)).toEqual(['가', '나', '다'])
  })

  it('unreadCounts 가 없어도(undefined) 안전하게 닉네임순으로 정렬한다', () => {
    const peers = [
      { peerId: 'p1', nickname: '나' },
      { peerId: 'p2', nickname: '가' },
    ]
    const sorted = [...peers].sort((a, b) => comparePeersForSidebar(a, b))
    expect(sorted.map(p => p.nickname)).toEqual(['가', '나'])
  })

  it('둘 다 안읽음이 있으면 닉네임순으로 tie-break 한다', () => {
    const peers = [
      { peerId: 'p1', nickname: '나' },
      { peerId: 'p2', nickname: '가' },
    ]
    const unreadCounts = { p1: 1, p2: 2 }
    const sorted = [...peers].sort((a, b) => comparePeersForSidebar(a, b, unreadCounts))
    expect(sorted.map(p => p.nickname)).toEqual(['가', '나'])
  })
})

describe('matchesPeerFilter', () => {
  const peer = { peerId: 'p1', nickname: '홍길동' }

  it('검색어가 비어 있으면 항상 통과한다', () => {
    expect(matchesPeerFilter(peer, '')).toBe(true)
    expect(matchesPeerFilter(peer, '   ')).toBe(true)
    expect(matchesPeerFilter(peer, undefined)).toBe(true)
  })

  it('닉네임에 검색어가 포함되면 통과한다', () => {
    expect(matchesPeerFilter(peer, '길동')).toBe(true)
    expect(matchesPeerFilter(peer, '홍')).toBe(true)
  })

  it('닉네임에 검색어가 없으면 통과하지 않는다', () => {
    expect(matchesPeerFilter(peer, '없는이름')).toBe(false)
  })

  it('영문 닉네임은 대소문자를 구분하지 않는다', () => {
    const englishPeer = { peerId: 'p2', nickname: 'Alice' }
    expect(matchesPeerFilter(englishPeer, 'ali')).toBe(true)
    expect(matchesPeerFilter(englishPeer, 'ALI')).toBe(true)
  })

  it('nickname 이 없어도(undefined) 예외 없이 false 를 반환한다', () => {
    expect(matchesPeerFilter({ peerId: 'p3' }, '아무거나')).toBe(false)
  })
})
