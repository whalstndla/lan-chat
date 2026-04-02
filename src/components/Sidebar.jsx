// src/components/Sidebar.jsx
import React, { useState } from 'react'
import { Hash, Wifi, ChevronLeft, ChevronRight, Settings, FileText, RotateCw } from 'lucide-react'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import SettingsPanel from './SettingsPanel'

// 상태 타입 → dot 색상 클래스 매핑
const statusColors = {
  online: 'bg-green-400',
  away: 'bg-yellow-400',
  busy: 'bg-red-400',
  dnd: 'bg-red-600',
}

// 피어 아바타: 이미지 로드 성공 시 이미지, 실패 시 이니셜 표시 + 상태 dot
function PeerAvatar({ peer, isOnline }) {
  // 온라인이면 피어의 statusType 색상, 오프라인이면 회색
  const dotColor = isOnline
    ? (statusColors[peer.statusType] || statusColors.online)
    : 'bg-vsc-muted'

  return (
    <div className="relative w-5 h-5 shrink-0">
      {/* 이니셜 배경 */}
      <div className="w-5 h-5 rounded-full bg-vsc-border overflow-hidden flex items-center justify-center text-[9px] text-vsc-accent font-bold">
        {peer.nickname?.[0]?.toUpperCase() || '?'}
      </div>
      {/* 프로필 이미지 — 이니셜 위에 덮어씌움 */}
      {peer.profileImageUrl && (
        <img
          src={peer.profileImageUrl}
          alt={peer.nickname}
          className="absolute inset-0 w-5 h-5 rounded-full object-cover"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )}
      {/* 상태 dot */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-vsc-sidebar ${dotColor}`}
      />
    </div>
  )
}

export default function Sidebar({ onShowPatchNotes }) {
  const [collapsed, setCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const pastDMPeers = usePeerStore(state => state.pastDMPeers)
  const myStatusType = useUserStore(state => state.myStatusType)

  // 온라인 피어 + 오프라인 과거 DM 상대 병합 (온라인 우선)
  const onlinePeerIds = new Set(onlinePeers.map(p => p.peerId))
  const offlinePastPeers = pastDMPeers.filter(p => !onlinePeerIds.has(p.peerId))
  const currentRoom = useChatStore(state => state.currentRoom)
  const unreadCounts = useChatStore(state => state.unreadCounts)

  const isGlobalSelected = currentRoom.type === 'global'

  if (collapsed) {
    return (
      <div className="w-10 bg-vsc-sidebar border-r border-vsc-border flex flex-col items-center py-2 gap-1 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          title="사이드바 열기"
          className="cursor-pointer p-1.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
        >
          <ChevronRight size={14} />
        </button>

        <button
          onClick={() => useChatStore.getState().setCurrentRoom({ type: 'global' })}
          title="전체 채팅"
          className={`cursor-pointer p-1.5 rounded transition-colors ${
            isGlobalSelected ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
          }`}
        >
          <Hash size={14} />
        </button>

        {[...onlinePeers, ...offlinePastPeers].map((peer) => {
          const isSelected = currentRoom.type === 'dm' && currentRoom.peerId === peer.peerId
          const hasUnread = unreadCounts[peer.peerId] > 0
          const isOnline = onlinePeerIds.has(peer.peerId)
          return (
            <button
              key={peer.peerId}
              onClick={() => useChatStore.getState().setCurrentRoom({ type: 'dm', peerId: peer.peerId, nickname: peer.nickname })}
              title={`${peer.nickname}${isOnline ? '' : ' (오프라인)'}`}
              className={`cursor-pointer relative p-1.5 rounded transition-colors ${
                isSelected ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
              }`}
            >
              <PeerAvatar peer={peer} isOnline={isOnline} />
              {hasUnread && (
                <span className="absolute top-0 right-0 w-2 h-2 bg-vsc-accent rounded-full" />
              )}
            </button>
          )
        })}

        <button
          onClick={() => { setCollapsed(false); setShowSettings(true) }}
          title="설정"
          className="cursor-pointer mt-auto p-1.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
        >
          <Settings size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="w-52 bg-vsc-sidebar border-r border-vsc-border flex flex-col shrink-0">
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
        <>
          <div className="px-2 py-2">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <p className="text-vsc-muted text-xs uppercase tracking-wider">채팅</p>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => window.electronAPI.startPeerDiscovery()}
                  title="피어 재검색"
                  className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
                >
                  <RotateCw size={13} />
                </button>
                <button
                  onClick={() => setCollapsed(true)}
                  title="사이드바 접기"
                  className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
                >
                  <ChevronLeft size={13} />
                </button>
              </div>
            </div>
            <button
              onClick={() => useChatStore.getState().setCurrentRoom({ type: 'global' })}
              className={`cursor-pointer w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 flex items-center gap-2 ${
                isGlobalSelected
                  ? 'bg-vsc-selected text-vsc-text'
                  : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
              }`}
            >
              <Hash size={14} className="shrink-0" />
              전체 채팅
            </button>
          </div>

          <div className="px-2 py-2 flex-1 overflow-y-auto">
            <p className="text-vsc-muted text-xs px-2 py-1 mb-1 uppercase tracking-wider">
              DM ({onlinePeers.length}/{onlinePeers.length + offlinePastPeers.length})
            </p>
            {onlinePeers.length === 0 && offlinePastPeers.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 text-vsc-muted">
                <Wifi size={13} className="opacity-40" />
                <span className="text-xs">대기 중...</span>
              </div>
            ) : (
              [...onlinePeers, ...offlinePastPeers].map((peer) => {
                const isSelected = currentRoom.type === 'dm' && currentRoom.peerId === peer.peerId
                const isOnline = onlinePeerIds.has(peer.peerId)
                return (
                  <button
                    key={peer.peerId}
                    onClick={() => useChatStore.getState().setCurrentRoom({ type: 'dm', peerId: peer.peerId, nickname: peer.nickname })}
                    className={`cursor-pointer w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 flex items-center gap-2 ${
                      isSelected
                        ? 'bg-vsc-selected text-vsc-text'
                        : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >
                    <PeerAvatar peer={peer} isOnline={isOnline} />
                    <span className={`truncate ${!isOnline ? 'opacity-50' : ''}`}>{peer.nickname}</span>
                    {unreadCounts[peer.peerId] > 0 && (
                      <span className="ml-auto bg-vsc-accent text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                        {unreadCounts[peer.peerId]}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* 하단 영역: 상태 선택 + 설정 버튼 */}
          <div className="px-3 py-2 border-t border-vsc-border space-y-1.5">
            {/* 내 상태 선택 */}
            <div className="flex items-center gap-1.5 px-1">
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[myStatusType] || statusColors.online}`} />
              <select
                value={myStatusType}
                onChange={(e) => {
                  const newStatus = e.target.value
                  useUserStore.getState().setMyStatus(newStatus, '')
                  window.electronAPI.updateStatus({ statusType: newStatus, statusMessage: '' })
                }}
                className="bg-vsc-bg border border-vsc-border rounded px-1 py-0.5 text-xs text-vsc-text cursor-pointer flex-1 min-w-0"
              >
                <option value="online">온라인</option>
                <option value="away">자리비움</option>
                <option value="busy">바쁨</option>
                <option value="dnd">방해 금지</option>
              </select>
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => onShowPatchNotes?.()}
                className="cursor-pointer flex items-center gap-2 text-vsc-muted hover:text-vsc-text transition-colors w-full px-1 py-0.5 rounded hover:bg-vsc-hover"
              >
                <FileText size={13} />
                <span className="text-xs">패치노트</span>
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="cursor-pointer flex items-center gap-2 text-vsc-muted hover:text-vsc-text transition-colors w-full px-1 py-0.5 rounded hover:bg-vsc-hover"
              >
                <Settings size={13} />
                <span className="text-xs">설정</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
