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
  const { setDMHistory, resetUnread } = useChatStore()
  const myPeerId = useUserStore(state => state.myPeerId)
  const scrollEndRef = useRef(null)

  const currentMessages = currentRoom.type === 'global'
    ? globalMessages
    : (dmMessages[currentRoom.peerId] || [])

  const chatTitle = currentRoom.type === 'global'
    ? '전체 채팅'
    : `${currentRoom.nickname} (DM)`

  // DM 채팅방 진입 시 기록 불러오기 + 안읽은 메시지 초기화
  useEffect(() => {
    if (currentRoom.type === 'dm' && myPeerId) {
      resetUnread(currentRoom.peerId)
      window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
        .then(history => setDMHistory(currentRoom.peerId, history))
    }
  }, [currentRoom, myPeerId])

  // 새 메시지 오면 자동 스크롤
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, currentRoom])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-vsc-border shrink-0">
        <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto py-2">
        {currentMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-vsc-muted text-sm">아직 메시지가 없습니다.</p>
          </div>
        ) : (
          currentMessages.map((message) => (
            <Message key={message.id} message={message} />
          ))
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* 메시지 입력창 */}
      <MessageInput />
    </div>
  )
}
