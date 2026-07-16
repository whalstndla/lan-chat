// src/components/BookmarksPanel.jsx
// 북마크(#34) 모아보기 — 사이드바 안에서 SettingsPanel 과 같은 방식으로 전체를 대체해 렌더.
// 로컬 전용 데이터라 피어 목록 API 를 새로 만들 필요 없이 usePeerStore 만으로 방 이름을 표시한다.
import React from 'react'
import { ArrowLeft, Bookmark, X } from 'lucide-react'
import useChatStore from '../store/useChatStore'
import usePeerStore from '../store/usePeerStore'

// roomKey('global' 또는 DM 상대 peerId) → 화면에 표시할 방 이름.
// 온라인 피어를 우선 조회하고, 오프라인이면 과거 DM 목록에서 찾는다.
function resolveRoomLabel(roomKey, onlinePeers, pastDMPeers) {
  if (roomKey === 'global') return '전체 채팅'
  const peer = onlinePeers.find(p => p.peerId === roomKey) || pastDMPeers.find(p => p.peerId === roomKey)
  return peer ? `${peer.nickname} (DM)` : 'DM'
}

export default function BookmarksPanel({ onClose }) {
  const bookmarks = useChatStore(state => state.bookmarks)
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const pastDMPeers = usePeerStore(state => state.pastDMPeers)

  // 최근 북마크한 순서로 정렬
  const entries = Object.entries(bookmarks).sort((a, b) => b[1].savedAt - a[1].savedAt)

  // 북마크한 메시지로 이동 — 해당 방으로 전환하고, 화면에 이미 로드돼 있으면 ChatWindow 가
  // pendingScrollMessageId 를 구독해 스크롤+하이라이트한다(과거 히스토리라 아직 로드되지 않았다면
  // 조용히 무시되고 방만 전환된다 — 검색으로 다시 찾을 수 있음).
  function handleOpen(messageId, roomKey) {
    const peer = onlinePeers.find(p => p.peerId === roomKey) || pastDMPeers.find(p => p.peerId === roomKey)
    const target = roomKey === 'global'
      ? { type: 'global' }
      : { type: 'dm', peerId: roomKey, nickname: peer?.nickname || 'DM' }
    useChatStore.getState().setCurrentRoom(target)
    useChatStore.getState().setPendingScrollMessageId(messageId)
    onClose?.()
  }

  function handleRemove(event, messageId) {
    event.stopPropagation()
    useChatStore.getState().toggleBookmark(messageId)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-vsc-border shrink-0">
        <button
          onClick={onClose}
          title="뒤로"
          className="cursor-pointer p-1 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <h3 className="text-sm font-semibold text-vsc-text flex-1">북마크</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-vsc-muted">
            <Bookmark size={20} className="opacity-40" />
            <p className="text-xs">북마크한 메시지가 없습니다.</p>
          </div>
        ) : (
          entries.map(([messageId, entry]) => (
            <button
              key={messageId}
              onClick={() => handleOpen(messageId, entry.roomKey)}
              className="group/bookmark-item w-full text-left px-3 py-2 rounded hover:bg-vsc-hover transition-colors cursor-pointer mb-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-vsc-accent font-medium truncate">
                  {resolveRoomLabel(entry.roomKey, onlinePeers, pastDMPeers)}
                </span>
                <span
                  onClick={(event) => handleRemove(event, messageId)}
                  role="button"
                  tabIndex={0}
                  title="북마크 해제"
                  aria-label="북마크 해제"
                  className="opacity-0 group-hover/bookmark-item:opacity-100 text-vsc-muted hover:text-red-400 transition-opacity shrink-0 cursor-pointer"
                >
                  <X size={12} />
                </span>
              </div>
              <p className="text-xs text-vsc-text truncate mt-0.5">{entry.preview || '(내용 없음)'}</p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
