// src/components/ChatWindow.jsx
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
  const prevMessageCountRef = useRef(0)
  const currentRoomKeyRef = useRef(null)
  // 스크롤 위에 있을 때 새 메시지 토스트 표시용
  const [newMessageToast, setNewMessageToast] = useState(null)

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

  // DM 채팅방 진입 시 기록 불러오기 + 안읽은 메시지 초기화 + 읽음 확인 전송
  useEffect(() => {
    if (currentRoom.type === 'dm' && myPeerId) {
      resetUnread(currentRoom.peerId)
      window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
        .then(history => {
          setDMHistory(currentRoom.peerId, history)
          // 상대방이 보낸 안읽은 메시지에 대해 읽음 확인 전송
          const unreadMessageIds = history
            .filter(msg => (msg.fromId || msg.from_id) === currentRoom.peerId)
            .map(msg => msg.id)
          if (unreadMessageIds.length > 0) {
            window.electronAPI.sendReadReceipt(currentRoom.peerId, unreadMessageIds).catch(() => {})
          }
        })
    }
  }, [currentRoom, myPeerId])

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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-vsc-border shrink-0">
        <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
      </div>

      {/* 메시지 목록 — 토스트 위치 기준을 위한 relative */}
      <div className="flex-1 overflow-hidden relative">
        <div ref={messagesContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto py-2">
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
      <MessageInput />
    </div>
  )
}
