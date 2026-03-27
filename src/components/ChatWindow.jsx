// src/components/ChatWindow.jsx
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import Message from './Message'
import MessageInput from './MessageInput'

export default function ChatWindow() {
  const currentRoom = useChatStore(state => state.currentRoom)
  const globalMessages = useChatStore(state => state.globalMessages)
  const dmMessages = useChatStore(state => state.dmMessages)
  const typingUsers = useChatStore(state => state.typingUsers)
  const lastReadTimestamps = useChatStore(state => state.lastReadTimestamps)
  const { setDMHistory, resetUnread, setLastReadTimestamp, searchQuery, searchResults, isSearching, setSearchQuery, setSearchResults, setIsSearching, clearSearch } = useChatStore()
  const myPeerId = useUserStore(state => state.myPeerId)
  const scrollEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const currentRoomKeyRef = useRef(null)
  // MessageInput의 handleDroppedFiles 메서드 접근용 ref
  const messageInputRef = useRef(null)
  // 드래그 중첩 요소 진입/이탈 카운터 (dragenter/dragleave 오작동 방지)
  const dragCounterRef = useRef(0)
  // 스크롤 위에 있을 때 새 메시지 토스트 표시용
  const [newMessageToast, setNewMessageToast] = useState(null)
  // 드래그 오버 상태 (오버레이 표시 여부)
  const [isDragOver, setIsDragOver] = useState(false)
  // 검색 패널 표시 여부
  const [showSearch, setShowSearch] = useState(false)

  const currentMessages = currentRoom.type === 'global'
    ? globalMessages
    : (dmMessages[currentRoom.peerId] || [])

  // 현재 방의 마지막 읽은 타임스탬프 — 구분선 기준
  const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
  const lastReadTimestamp = lastReadTimestamps[roomKey]

  const chatTitle = currentRoom.type === 'global'
    ? '전체 채팅'
    : `${currentRoom.nickname} (DM)`

  // 현재 방에 해당하는 타이핑 유저 목록
  const typingUserList = currentRoom.type === 'global'
    ? Object.values(typingUsers)
    : (typingUsers[currentRoom.peerId] ? [typingUsers[currentRoom.peerId]] : [])

  // 스크롤 위치 추적 — 하단 근처(50px 이내)인지 체크
  function handleScroll() {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const nearBottom = scrollHeight - scrollTop - clientHeight <= 50
    isNearBottomRef.current = nearBottom
    // 하단 도달 시 토스트 자동 숨김
    if (nearBottom) setNewMessageToast(null)
  }

  // 하단으로 스크롤 이동
  function scrollToBottom() {
    isNearBottomRef.current = true
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setNewMessageToast(null)
  }

  // 드래그 진입 — 카운터 증가 후 파일 타입 확인 시 오버레이 표시
  function handleDragEnter(event) {
    dragCounterRef.current += 1
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  // 드래그 이탈 — 카운터 감소 후 0이 되면 오버레이 숨김
  function handleDragLeave() {
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  // 드래그 오버 — 기본 동작만 막아 드롭 허용
  function handleDragOver(event) {
    event.preventDefault()
  }

  // 드롭 — 카운터 초기화 후 파일을 MessageInput으로 전달
  function handleDrop(event) {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const { files } = event.dataTransfer
    if (files && files.length > 0) {
      messageInputRef.current?.handleDroppedFiles(files)
    }
  }

  // 검색창 토글 — 닫을 때 검색 상태 초기화
  function handleToggleSearch() {
    if (showSearch) {
      setShowSearch(false)
      clearSearch()
    } else {
      setShowSearch(true)
    }
  }

  // 검색어 입력 시 실시간 검색 실행
  async function handleSearch(query) {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    // 글로벌 채팅만 type 필터 적용 (DM은 암호화되어 FTS 인덱싱 불가)
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
      // (이미 기록된 경우 덮어쓰지 않아 구분선 위치를 보존)
      const existingTimestamp = useChatStore.getState().lastReadTimestamps[roomKey]
      if (existingTimestamp === undefined) {
        const currentDmMessages = useChatStore.getState().dmMessages[roomKey] || []
        const lastMessage = currentDmMessages[currentDmMessages.length - 1]
        const lastTimestamp = lastMessage ? (lastMessage.createdAt || lastMessage.created_at || null) : null
        setLastReadTimestamp(roomKey, lastTimestamp)
      }

      resetUnread(currentRoom.peerId)
      window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
        .then(history => setDMHistory(currentRoom.peerId, history))
      // 안읽은 메시지 ID를 DB에서 직접 조회 (100개 제한 없음) 후 읽음 확인 전송
      window.electronAPI.getUnreadDMIds(currentRoom.peerId)
        .then(unreadIds => {
          if (unreadIds.length > 0) {
            window.electronAPI.sendReadReceipt(currentRoom.peerId, unreadIds).catch(() => {})
          }
        })
    }
  }, [currentRoom, myPeerId])

  // DM 채팅방 이탈 시 현재 마지막 메시지 타임스탬프를 lastRead로 업데이트
  // (다음에 다시 진입했을 때 어디서부터 새 메시지인지 알 수 있도록)
  useEffect(() => {
    return () => {
      if (currentRoom.type === 'dm') {
        const roomKey = currentRoom.peerId
        const currentDmMessages = useChatStore.getState().dmMessages[roomKey] || []
        const lastMessage = currentDmMessages[currentDmMessages.length - 1]
        const lastTimestamp = lastMessage ? (lastMessage.createdAt || lastMessage.created_at || null) : null
        setLastReadTimestamp(roomKey, lastTimestamp)
      }
    }
  }, [currentRoom])

  // 새 메시지 처리: 배열 길이 증가만 감지 (삭제/pending 해제는 무시)
  useEffect(() => {
    // 방 변경 시 카운터만 동기화하고 토스트 표시하지 않음
    const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
    if (currentRoomKeyRef.current !== roomKey) {
      currentRoomKeyRef.current = roomKey
      prevMessageCountRef.current = currentMessages.length
      return
    }

    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = currentMessages.length

    // 길이가 줄었거나 같으면 새 메시지가 아님 (삭제, pending 해제 등)
    if (currentMessages.length <= prevCount || currentMessages.length === 0) return

    const lastMessage = currentMessages[currentMessages.length - 1]

    if (isNearBottomRef.current) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      // 내 메시지는 토스트 없이 바로 스크롤
      const isMyMessage = lastMessage.fromId === myPeerId || lastMessage.from_id === myPeerId
      if (isMyMessage) {
        scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        return
      }
      // 새 메시지 토스트 표시
      const sender = lastMessage.from || lastMessage.from_name || '알 수 없음'
      const contentType = lastMessage.contentType || lastMessage.content_type
      let preview = lastMessage.content || ''
      if (contentType === 'image') preview = '사진을 보냈습니다'
      else if (contentType === 'video') preview = '동영상을 보냈습니다'
      else if (contentType === 'file') preview = `📎 ${lastMessage.fileName || lastMessage.file_name || '파일'}`
      setNewMessageToast({ sender, preview })
    }
  }, [currentMessages, currentRoom])

  // 채팅방 변경 시 항상 하단으로 이동 + 토스트 초기화
  // prevMessageCountRef는 새 메시지 effect에서 방 변경 감지 시 동기화됨
  useEffect(() => {
    isNearBottomRef.current = true
    setNewMessageToast(null)
    scrollEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [currentRoom])

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* 헤더 */}
      <div className="border-b border-vsc-border shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
          {/* 검색 버튼 — 검색창 토글 */}
          <button
            onClick={handleToggleSearch}
            className={`p-1 rounded hover:bg-vsc-hover transition-colors ${showSearch ? 'text-vsc-accent' : 'text-vsc-muted'}`}
            title="메시지 검색"
          >
            <Search size={15} />
          </button>
        </div>

        {/* 검색 입력창 — showSearch 상태에 따라 표시/숨김 */}
        {showSearch && (
          <div className="px-3 pb-2.5">
            <div className="flex items-center gap-2 bg-vsc-input-bg border border-vsc-border rounded px-2 py-1.5">
              <Search size={13} className="text-vsc-muted shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder="메시지 검색..."
                className="flex-1 bg-transparent text-xs text-vsc-text placeholder:text-vsc-muted outline-none"
                autoFocus
              />
              {/* 검색 중 스피너 또는 결과 수 표시 */}
              {isSearching ? (
                <span className="text-xs text-vsc-muted shrink-0">검색 중...</span>
              ) : searchQuery.trim() ? (
                <span className="text-xs text-vsc-muted shrink-0">{searchResults.length}건</span>
              ) : null}
              {/* 검색어 지우기 버튼 */}
              {searchQuery && (
                <button
                  onClick={() => handleSearch('')}
                  className="text-vsc-muted hover:text-vsc-text shrink-0"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 검색 결과 목록 */}
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

            {/* 검색어 있지만 결과 없음 */}
            {!isSearching && searchQuery.trim() && searchResults.length === 0 && (
              <p className="mt-1.5 text-xs text-vsc-muted text-center py-2">검색 결과가 없습니다.</p>
            )}
          </div>
        )}
      </div>

      {/* 메시지 목록 — 토스트 위치 기준을 위한 relative */}
      <div className="flex-1 overflow-hidden relative">
        {/* 드래그 앤 드롭 오버레이 */}
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
            currentMessages.map((message, index) => {
              // 구분선 표시 조건:
              // 1. lastReadTimestamp가 존재할 것
              // 2. 이전 메시지 타임스탬프 <= lastReadTimestamp AND 현재 메시지 타임스탬프 > lastReadTimestamp
              // 3. 현재 메시지가 내 메시지가 아닐 것
              const messageTimestamp = message.createdAt || message.created_at
              const prevMessage = index > 0 ? currentMessages[index - 1] : null
              const prevTimestamp = prevMessage ? (prevMessage.createdAt || prevMessage.created_at) : null
              const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId

              const shouldShowDivider =
                lastReadTimestamp !== undefined &&
                lastReadTimestamp !== null &&
                messageTimestamp > lastReadTimestamp &&
                (prevTimestamp === null || prevTimestamp <= lastReadTimestamp) &&
                !isMyMessage

              return (
                <React.Fragment key={message.id}>
                  {shouldShowDivider && (
                    <div className="flex items-center gap-2 px-4 py-1 my-1">
                      <div className="flex-1 border-t border-red-400/50" />
                      <span className="text-xs text-red-400 font-semibold shrink-0">여기서부터 새 메시지</span>
                      <div className="flex-1 border-t border-red-400/50" />
                    </div>
                  )}
                  <Message message={message} onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)} isHighlighted={!!searchQuery.trim() && searchResults.some(result => result.id === message.id)} />
                </React.Fragment>
              )
            })
          )}

          {/* 타이핑 인디케이터 */}
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

        {/* 새 메시지 토스트 — 메시지 목록 하단에 고정 */}
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

      {/* 메시지 입력창 */}
      <MessageInput ref={messageInputRef} />
    </div>
  )
}
