// src/components/Sidebar.jsx
import React, { useState } from 'react'
import { Hash, Wifi, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import SettingsPanel from './SettingsPanel'

// 피어 아바타: 이미지 로드 성공 시 이미지, 실패 시 이니셜 표시
function PeerAvatar({ peer, size = 5 }) {
  const sizeClass = `w-${size} h-${size}`
  const textSize = size <= 5 ? 'text-[9px]' : 'text-sm'
  return (
    <div className={`relative ${sizeClass} shrink-0`}>
      <div className={`${sizeClass} rounded-full bg-vsc-border flex items-center justify-center ${textSize} text-vsc-accent font-bold`}>
        {peer.nickname?.[0]?.toUpperCase() || '?'}
      </div>
      {peer.profileImageUrl && (
        <img
          src={peer.profileImageUrl}
          alt={peer.nickname}
          className={`absolute inset-0 ${sizeClass} rounded-full object-cover`}
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )}
    </div>
  )
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const { currentRoom, setCurrentRoom } = useChatStore()
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
          onClick={() => setCurrentRoom({ type: 'global' })}
          title="전체 채팅"
          className={`cursor-pointer p-1.5 rounded transition-colors ${
            isGlobalSelected ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
          }`}
        >
          <Hash size={14} />
        </button>

        {onlinePeers.map((peer) => {
          const isSelected = currentRoom.type === 'dm' && currentRoom.peerId === peer.peerId
          const hasUnread = unreadCounts[peer.peerId] > 0
          return (
            <button
              key={peer.peerId}
              onClick={() => setCurrentRoom({ type: 'dm', peerId: peer.peerId, nickname: peer.nickname })}
              title={peer.nickname}
              className={`cursor-pointer relative p-1.5 rounded transition-colors ${
                isSelected ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
              }`}
            >
              <PeerAvatar peer={peer} size={5} />
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
              <button
                onClick={() => setCollapsed(true)}
                title="사이드바 접기"
                className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
              >
                <ChevronLeft size={13} />
              </button>
            </div>
            <button
              onClick={() => setCurrentRoom({ type: 'global' })}
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
              DM ({onlinePeers.length})
            </p>
            {onlinePeers.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 text-vsc-muted">
                <Wifi size={13} className="opacity-40" />
                <span className="text-xs">대기 중...</span>
              </div>
            ) : (
              onlinePeers.map((peer) => {
                const isSelected = currentRoom.type === 'dm' && currentRoom.peerId === peer.peerId
                return (
                  <button
                    key={peer.peerId}
                    onClick={() => setCurrentRoom({ type: 'dm', peerId: peer.peerId, nickname: peer.nickname })}
                    className={`cursor-pointer w-full text-left px-3 py-1.5 rounded text-sm transition-colors duration-150 flex items-center gap-2 ${
                      isSelected
                        ? 'bg-vsc-selected text-vsc-text'
                        : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >
                    <PeerAvatar peer={peer} size={5} />
                    <span className="truncate">{peer.nickname}</span>
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

          {/* 설정 버튼 */}
          <div className="px-3 py-2 border-t border-vsc-border">
            <button
              onClick={() => setShowSettings(true)}
              className="cursor-pointer flex items-center gap-2 text-vsc-muted hover:text-vsc-text transition-colors w-full px-1 py-0.5 rounded hover:bg-vsc-hover"
            >
              <Settings size={13} />
              <span className="text-xs">설정</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
