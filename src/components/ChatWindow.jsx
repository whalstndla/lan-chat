// src/components/ChatWindow.jsx
import React, { useEffect, useRef } from 'react'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import Message from './Message'
import MessageInput from './MessageInput'

export default function ChatWindow() {
  const 현재채팅방 = useChatStore(상태 => 상태.현재채팅방)
  const 전체채팅메시지목록 = useChatStore(상태 => 상태.전체채팅메시지목록)
  const DM메시지맵 = useChatStore(상태 => 상태.DM메시지맵)
  const { DM기록설정 } = useChatStore()
  const 나의피어아이디 = useUserStore(상태 => 상태.나의피어아이디)
  const 스크롤끝ref = useRef(null)

  const 현재메시지목록 = 현재채팅방.타입 === 'global'
    ? 전체채팅메시지목록
    : (DM메시지맵[현재채팅방.상대피어아이디] || [])

  const 채팅방제목 = 현재채팅방.타입 === 'global'
    ? '전체 채팅'
    : `${현재채팅방.상대닉네임} (DM)`

  // DM 채팅방 진입 시 기록 불러오기
  useEffect(() => {
    if (현재채팅방.타입 === 'dm' && 나의피어아이디) {
      window.electronAPI.DM기록조회(나의피어아이디, 현재채팅방.상대피어아이디)
        .then(기록 => DM기록설정(현재채팅방.상대피어아이디, 기록))
    }
  }, [현재채팅방, 나의피어아이디])

  // 새 메시지 오면 자동 스크롤
  useEffect(() => {
    스크롤끝ref.current?.scrollIntoView({ behavior: 'smooth' })
  }, [현재메시지목록])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-vsc-border shrink-0">
        <h2 className="text-sm font-semibold text-vsc-text">{채팅방제목}</h2>
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto py-2">
        {현재메시지목록.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-vsc-muted text-sm">아직 메시지가 없습니다.</p>
          </div>
        ) : (
          현재메시지목록.map((메시지) => (
            <Message key={메시지.id} 메시지={메시지} />
          ))
        )}
        <div ref={스크롤끝ref} />
      </div>

      {/* 메시지 입력창 */}
      <MessageInput />
    </div>
  )
}
