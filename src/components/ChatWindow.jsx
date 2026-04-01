// src/components/ChatWindow.jsx
import React, { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, ChevronDown, Search, X } from 'lucide-react'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import Message from './Message'
import MessageInput from './MessageInput'

export default function ChatWindow() {
  const currentRoom = useChatStore(state => state.currentRoom)
  const globalMessages = useChatStore(state => state.globalMessages)
  const dmMessages = useChatStore(state => state.dmMessages)
  const typingUsers = useChatStore(state => state.typingUsers)
  const myPeerId = useUserStore(state => state.myPeerId)
  const scrollEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const currentRoomKeyRef = useRef(null)
  const messageInputRef = useRef(null)
  const dragCounterRef = useRef(0)
  // 읽지 않은 메시지 구분선 기준 타임스탬프 (로컬 ref — 스토어 구독 없음)
  const lastReadTimestampsRef = useRef({})

  const [newMessageToast, setNewMessageToast] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  // 검색 상태 (로컬 — 스토어 구독 없음)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  // 무한 스크롤 상태
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const mutedRooms = useChatStore(state => state.mutedRooms)
  const toggleRoomMute = useChatStore(state => state.toggleRoomMute)

  const currentMessages = currentRoom.type === 'global'
    ? globalMessages
    : (dmMessages[currentRoom.peerId] || [])

  const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
  const isMuted = !!mutedRooms[roomKey]
  const lastReadTimestamp = lastReadTimestampsRef.current[roomKey]

  const chatTitle = currentRoom.type === 'global'
    ? '전체 채팅'
    : `${currentRoom.nickname} (DM)`

  const typingUserList = currentRoom.type === 'global'
    ? Object.values(typingUsers)
    : (typingUsers[currentRoom.peerId] ? [typingUsers[currentRoom.peerId]] : [])

  function handleScroll() {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const nearBottom = scrollHeight - scrollTop - clientHeight <= 50
    isNearBottomRef.current = nearBottom
    if (nearBottom) setNewMessageToast(null)

    // 무한 스크롤 — 상단 도달 시 이전 메시지 로드
    if (scrollTop < 50 && !loadingMore && hasMore) {
      loadOlderMessages()
    }
  }

  async function loadOlderMessages() {
    setLoadingMore(true)
    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0

    try {
      const PAGE_SIZE = 50
      let older = []
      if (currentRoom.type === 'global') {
        older = await window.electronAPI.getGlobalHistory({ limit: PAGE_SIZE, offset: currentMessages.length })
      } else {
        older = await window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId, PAGE_SIZE, currentMessages.length)
      }

      if (older.length < PAGE_SIZE) setHasMore(false)
      if (older.length > 0) {
        const { prependGlobalMessages, prependDMMessages } = useChatStore.getState()
        if (currentRoom.type === 'global') {
          prependGlobalMessages(older)
        } else {
          prependDMMessages(currentRoom.peerId, older)
        }
        // 스크롤 위치 복원
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight
          }
        })
      }
    } catch { /* 로드 실패 시 무시 */ }
    setLoadingMore(false)
  }

  function scrollToBottom() {
    isNearBottomRef.current = true
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setNewMessageToast(null)
  }

  function handleDragEnter(event) {
    dragCounterRef.current += 1
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave() {
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  function handleDrop(event) {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const { files } = event.dataTransfer
    if (files && files.length > 0) {
      messageInputRef.current?.handleDroppedFiles(files)
    }
  }

  function handleToggleSearch() {
    if (showSearch) {
      setShowSearch(false)
      setSearchQuery('')
      setSearchResults([])
    } else {
      setShowSearch(true)
    }
  }

  async function handleSearch(query) {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    const type = currentRoom.type === 'global' ? 'message' : null
    const results = await window.electronAPI.searchMessages({ query, type })
    setSearchResults(results)
    setIsSearching(false)
  }

  // DM 채팅방 진입 시 기록 불러오기 + 안읽은 메시지 초기화 + 읽음 확인 전송
  useEffect(() => {
    if (currentRoom.type === 'dm' && myPeerId) {
      const roomKey = currentRoom.peerId

      // 처음 진입하는 방인 경우에만 현재 마지막 메시지 타임스탬프를 lastRead로 기록
      if (lastReadTimestampsRef.current[roomKey] === undefined) {
        const currentDmMessages = useChatStore.getState().dmMessages[roomKey] || []
        const lastMessage = currentDmMessages[currentDmMessages.length - 1]
        lastReadTimestampsRef.current[roomKey] = lastMessage ? lastMessage.timestamp : null
      }

      useChatStore.getState().resetUnread(currentRoom.peerId)
      window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
        .then(history => useChatStore.getState().setDMHistory(currentRoom.peerId, history))
      window.electronAPI.getUnreadDMIds(currentRoom.peerId)
        .then(unreadIds => {
          if (unreadIds.length > 0) {
            window.electronAPI.sendReadReceipt(currentRoom.peerId, unreadIds).catch(() => {})
          }
        })
    }
  }, [currentRoom, myPeerId])

  // DM 채팅방 이탈 시 lastRead 업데이트
  useEffect(() => {
    return () => {
      if (currentRoom.type === 'dm') {
        const roomKey = currentRoom.peerId
        const currentDmMessages = useChatStore.getState().dmMessages[roomKey] || []
        const lastMessage = currentDmMessages[currentDmMessages.length - 1]
        lastReadTimestampsRef.current[roomKey] = lastMessage ? lastMessage.timestamp : null
      }
    }
  }, [currentRoom])

  // 새 메시지 처리
  useEffect(() => {
    const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
    if (currentRoomKeyRef.current !== roomKey) {
      currentRoomKeyRef.current = roomKey
      prevMessageCountRef.current = currentMessages.length
      return
    }

    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = currentMessages.length

    if (currentMessages.length <= prevCount || currentMessages.length === 0) return

    const lastMessage = currentMessages[currentMessages.length - 1]

    if (isNearBottomRef.current) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      const isMyMessage = lastMessage.fromId === myPeerId || lastMessage.from_id === myPeerId
      if (isMyMessage) {
        scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        return
      }
      const sender = lastMessage.from || lastMessage.from_name || '알 수 없음'
      const contentType = lastMessage.contentType || lastMessage.content_type
      let preview = lastMessage.content || ''
      if (contentType === 'image') preview = '사진을 보냈습니다'
      else if (contentType === 'video') preview = '동영상을 보냈습니다'
      else if (contentType === 'file') preview = `📎 ${lastMessage.fileName || lastMessage.file_name || '파일'}`
      setNewMessageToast({ sender, preview })
    }
  }, [currentMessages, currentRoom])

  // 채팅방 변경 시 하단으로 이동 + 무한 스크롤 초기화
  useEffect(() => {
    isNearBottomRef.current = true
    setNewMessageToast(null)
    setHasMore(true)
    setLoadingMore(false)
    scrollEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [currentRoom])

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* 헤더 */}
      <div className="border-b border-vsc-border shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
          <div className="flex items-center gap-1">
            {/* 알림 뮤트 토글 버튼 */}
            <button
              onClick={() => toggleRoomMute(roomKey)}
              className={`p-1 rounded hover:bg-vsc-hover transition-colors cursor-pointer ${isMuted ? 'text-vsc-muted' : 'text-vsc-muted'}`}
              title={isMuted ? '알림 켜기' : '알림 끄기'}
            >
              {isMuted ? <BellOff size={15} /> : <Bell size={15} />}
            </button>
            {/* 메시지 검색 버튼 */}
            <button
              onClick={handleToggleSearch}
              className={`p-1 rounded hover:bg-vsc-hover transition-colors cursor-pointer ${showSearch ? 'text-vsc-accent' : 'text-vsc-muted'}`}
              title="메시지 검색"
            >
              <Search size={15} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="px-3 pb-2.5">
            <div className="flex items-center gap-2 bg-vsc-bg border border-vsc-border rounded px-2 py-1.5">
              <Search size={13} className="text-vsc-muted shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder="메시지 검색..."
                className="flex-1 bg-transparent text-xs text-vsc-text placeholder:text-vsc-muted outline-none"
                autoFocus
              />
              {isSearching ? (
                <span className="text-xs text-vsc-muted shrink-0">검색 중...</span>
              ) : searchQuery.trim() ? (
                <span className="text-xs text-vsc-muted shrink-0">{searchResults.length}건</span>
              ) : null}
              {searchQuery && (
                <button onClick={() => handleSearch('')} className="text-vsc-muted hover:text-vsc-text shrink-0 cursor-pointer">
                  <X size={12} />
                </button>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-vsc-border bg-vsc-sidebar">
                {searchResults.map((result) => (
                  <div key={result.id} className="px-3 py-2 hover:bg-vsc-hover border-b border-vsc-border last:border-b-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-vsc-text">{result.from_name}</span>
                      <span className="text-xs text-vsc-muted">
                        {new Date(result.timestamp).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-vsc-muted line-clamp-2 break-words">{result.content}</p>
                  </div>
                ))}
              </div>
            )}

            {!isSearching && searchQuery.trim() && searchResults.length === 0 && (
              <p className="mt-1.5 text-xs text-vsc-muted text-center py-2">검색 결과가 없습니다.</p>
            )}
          </div>
        )}
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-hidden relative">
        {isDragOver && (
          <div className="absolute inset-0 z-40 bg-vsc-bg/80 flex items-center justify-center border-2 border-dashed border-vsc-accent rounded-lg m-2">
            <p className="text-vsc-accent text-sm font-semibold">파일을 여기에 놓으세요</p>
          </div>
        )}
        <div ref={messagesContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto py-2">
          {currentMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-vsc-muted text-sm">아직 메시지가 없습니다.</p>
            </div>
          ) : (
            <>
            {loadingMore && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-vsc-muted">이전 메시지 불러오는 중...</span>
              </div>
            )}
            {(() => {
              const elements = []
              let i = 0
              while (i < currentMessages.length) {
                const message = currentMessages[i]
                const prevMessage = i > 0 ? currentMessages[i - 1] : null
                const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
                const messageContentType = message.contentType || message.content_type
                const messageSenderId = message.fromId || message.from_id

                const shouldShowDivider =
                  lastReadTimestamp != null &&
                  message.timestamp > lastReadTimestamp &&
                  (prevMessage === null || prevMessage.timestamp <= lastReadTimestamp) &&
                  !isMyMessage

                if (shouldShowDivider) {
                  elements.push(
                    <div key={`divider-${message.id}`} className="flex items-center gap-2 px-4 py-1 my-1">
                      <div className="flex-1 border-t border-red-400/50" />
                      <span className="text-xs text-red-400 font-semibold shrink-0">여기서부터 새 메시지</span>
                      <div className="flex-1 border-t border-red-400/50" />
                    </div>
                  )
                }

                // 연속 이미지 그룹 감지
                if (messageContentType === 'image') {
                  const imageGroup = [message]
                  let j = i + 1
                  while (j < currentMessages.length) {
                    const next = currentMessages[j]
                    const nextContentType = next.contentType || next.content_type
                    const nextSenderId = next.fromId || next.from_id
                    if (nextContentType === 'image' && nextSenderId === messageSenderId) {
                      imageGroup.push(next)
                      j++
                    } else break
                  }

                  if (imageGroup.length > 1) {
                    // 연속 이미지 그룹 → 첫 번째만 Message로 렌더, 나머지는 그리드에 포함
                    const isGrouped = prevMessage !== null && (prevMessage.fromId || prevMessage.from_id) === messageSenderId
                    elements.push(
                      <Message
                        key={message.id}
                        message={message}
                        onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)}
                        isHighlighted={!!searchQuery.trim() && searchResults.some(r => r.id === message.id)}
                        isGrouped={isGrouped}
                        extraImages={imageGroup.slice(1)}
                      />
                    )
                    i = j
                    continue
                  }
                }

                // 일반 메시지
                elements.push(
                  <Message
                    key={message.id}
                    message={message}
                    onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)}
                    isHighlighted={!!searchQuery.trim() && searchResults.some(r => r.id === message.id)}
                    isGrouped={prevMessage !== null && (prevMessage.fromId || prevMessage.from_id) === messageSenderId}
                  />
                )
                i++
              }
              return elements
            })()}
            </>
          )}

          {typingUserList.length > 0 && (
            <div className="px-4 py-1 flex items-center gap-1.5 text-vsc-muted text-xs">
              <span className="flex gap-0.5 items-end">
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              <span>
                {typingUserList.map(user => user.nickname).join(', ')}
                {typingUserList.length === 1 ? '님이 입력 중...' : '님들이 입력 중...'}
              </span>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {newMessageToast && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-white text-gray-900 shadow-lg cursor-pointer hover:bg-gray-100 transition-colors max-w-[80%]"
          >
            <ChevronDown size={14} className="shrink-0 text-gray-500" />
            <span className="text-xs font-semibold shrink-0">{newMessageToast.sender}</span>
            <span className="text-xs text-gray-500 truncate">{newMessageToast.preview}</span>
          </button>
        )}
      </div>

      <MessageInput ref={messageInputRef} />
    </div>
  )
}
