// src/utils/resolvePeerNickname.js
// peerId → 화면에 표시할 닉네임 변환. 내 peerId 는 "나", 온라인 피어는 onlinePeers 에서,
// 오프라인 상대는 pastDMPeers 에서 조회한다. 어디에도 없으면(예: 아직 동기화 전) 안내 문구로 대체.
export function resolvePeerNickname(peerId, { myPeerId, onlinePeers = [], pastDMPeers = [] } = {}) {
  if (peerId === myPeerId) return '나'
  const peer = onlinePeers.find(p => p.peerId === peerId) || pastDMPeers.find(p => p.peerId === peerId)
  return peer?.nickname || '알 수 없음'
}
