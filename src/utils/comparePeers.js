// src/utils/comparePeers.js
// 사이드바 피어 목록 정렬/필터 순수 로직(#43). 온라인/오프라인 그룹 내부에서 발견 순서에
// 따른 불안정한 정렬을 방지하기 위해, 안읽음 있는 피어를 우선하고 그 다음 닉네임 가나다순으로
// 정렬한다. 그룹(온라인/오프라인) 자체의 우선순위는 Sidebar.jsx 가 그대로 유지한다.

// 정렬 비교자 — Array.prototype.sort 에 그대로 전달.
// unreadCounts 는 useChatStore 의 { peerId: 개수 } 맵을 그대로 받는다.
export function comparePeersForSidebar(peerA, peerB, unreadCounts = {}) {
  const unreadA = (unreadCounts[peerA.peerId] || 0) > 0 ? 1 : 0
  const unreadB = (unreadCounts[peerB.peerId] || 0) > 0 ? 1 : 0
  if (unreadA !== unreadB) return unreadB - unreadA
  return (peerA.nickname || '').localeCompare(peerB.nickname || '', 'ko')
}

// DM 검색/필터 — 닉네임 부분일치(대소문자 무시). 검색어가 비어 있으면 항상 통과.
export function matchesPeerFilter(peer, query) {
  const trimmed = (query || '').trim().toLowerCase()
  if (!trimmed) return true
  return (peer.nickname || '').toLowerCase().includes(trimmed)
}
