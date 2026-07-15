// src/components/message/ReactionBadges.jsx
// 메시지의 이모지 리액션 배지 목록(#38). 반응자 닉네임 툴팁 때문에 onlinePeers/pastDMPeers 가
// 필요한데, 이 구독을 Message 최상위가 아니라 이 자식 컴포넌트에 두어 "리액션이 있는 메시지"에서만
// 마운트되게 한다. 그 결과 무관한 피어 상태 변화 시 리액션 없는 메시지는 리렌더되지 않는다
// (Message 자체는 발신자 아바타 URL 만 좁게 구독).
import React from 'react'
import usePeerStore from '../../store/usePeerStore'
import { resolvePeerNickname } from '../../utils/resolvePeerNickname'

export default function ReactionBadges({ reactions, myPeerId, onReact }) {
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const pastDMPeers = usePeerStore(state => state.pastDMPeers)

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {Object.entries(reactions).map(([emoji, peerIds]) => (
        <button key={emoji} onClick={() => onReact(emoji)}
          className={`relative group/reaction-badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${
            peerIds.includes(myPeerId)
              ? 'bg-vsc-accent/20 border-vsc-accent text-vsc-accent'
              : 'bg-vsc-panel border-vsc-border text-vsc-muted hover:border-vsc-accent'
          }`}>
          <span>{emoji}</span><span>{peerIds.length}</span>
          <span className="hidden group-hover/reaction-badge:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-vsc-sidebar border border-vsc-border rounded px-2 py-1 text-[11px] text-vsc-text shadow-lg z-20">
            {peerIds.map(peerId => resolvePeerNickname(peerId, { myPeerId, onlinePeers, pastDMPeers })).join(', ')}
          </span>
        </button>
      ))}
    </div>
  )
}
