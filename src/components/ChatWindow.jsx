// src/components/ChatWindow.jsx
import React, { useEffect, useRef } from 'react'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import Message from './Message'
import MessageInput from './MessageInput'

export default function ChatWindow() {
  const currentRoom = useChatStore(state => state.currentRoom)
  const globalMessages = useChatStore(state => state.globalMessages)
  const dmMessages = useChatStore(state => state.dmMessages)
  const typingUsers = useChatStore(state => state.typingUsers)
  const { setDMHistory, resetUnread } = useChatStore()
  const myPeerId = useUserStore(state => state.myPeerId)
  const scrollEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const isNearBottomRef = useRef(true)

  const currentMessages = currentRoom.type === 'global'
    ? globalMessages
    : (dmMessages[currentRoom.peerId] || [])

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
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight <= 50
  }

  // DM 채팅방 진입 시 기록 불러오기 + 안읽은 메시지 초기화
  useEffect(() => {
    if (currentRoom.type === 'dm' && myPeerId) {
      resetUnread(currentRoom.peerId)
      window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
        .then(history => setDMHistory(currentRoom.peerId, history))
    }
  }, [currentRoom, myPeerId])

  // 새 메시지 시 스크롤이 하단 근처에 있을 때만 자동 스크롤
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentMessages])

  // 채팅방 변경 시 항상 하단으로 이동
  useEffect(() => {
    isNearBottomRef.current = true
    scrollEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [currentRoom])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-vsc-border shrink-0">
        <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
      </div>

      {/* 메시지 목록 */}
      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-2">
        {currentMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-vsc-muted text-sm">아직 메시지가 없습니다.</p>
          </div>
        ) : (
          currentMessages.map((message) => (
            <Message key={message.id} message={message} />
          ))
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

      {/* 메시지 입력창 */}
      <MessageInput />
    </div>
  )
}
