// src/components/MessageInput.jsx
import React, { useState, useRef } from 'react'
import EmojiPicker from 'emoji-picker-react'
import useChatStore from '../store/useChatStore'

// 파일 MIME 타입 → contentType 변환
function 파일타입판별(파일) {
  if (파일.type.startsWith('image/')) return 'image'
  if (파일.type.startsWith('video/')) return 'video'
  return 'file'
}

export default function MessageInput() {
  const [입력텍스트, 입력텍스트설정] = useState('')
  const [이모지피커표시, 이모지피커표시설정] = useState(false)
  const [전송중, 전송중설정] = useState(false)
  const 파일입력ref = useRef(null)
  const 현재채팅방 = useChatStore(상태 => 상태.현재채팅방)
  const { 전체채팅메시지추가, DM메시지추가 } = useChatStore()

  async function 메시지전송() {
    const 내용 = 입력텍스트.trim()
    if (!내용 || 전송중) return

    전송중설정(true)
    try {
      let 전송된메시지
      if (현재채팅방.타입 === 'global') {
        전송된메시지 = await window.electronAPI.전체메시지전송({ content: 내용, contentType: 'text' })
        전체채팅메시지추가(전송된메시지)
      } else {
        전송된메시지 = await window.electronAPI.DM전송({
          수신자피어아이디: 현재채팅방.상대피어아이디,
          content: 내용,
          contentType: 'text',
        })
        DM메시지추가(현재채팅방.상대피어아이디, 전송된메시지)
      }
      입력텍스트설정('')
    } finally {
      전송중설정(false)
    }
  }

  async function 파일전송(파일) {
    전송중설정(true)
    try {
      const 배열버퍼 = await 파일.arrayBuffer()
      const 파일URL = await window.electronAPI.파일저장(배열버퍼, 파일.name)
      const 내용타입 = 파일타입판별(파일)

      const payload = { content: null, contentType: 내용타입, fileUrl: 파일URL, fileName: 파일.name }

      let 전송된메시지
      if (현재채팅방.타입 === 'global') {
        전송된메시지 = await window.electronAPI.전체메시지전송(payload)
        전체채팅메시지추가(전송된메시지)
      } else {
        전송된메시지 = await window.electronAPI.DM전송({
          수신자피어아이디: 현재채팅방.상대피어아이디,
          ...payload,
        })
        DM메시지추가(현재채팅방.상대피어아이디, 전송된메시지)
      }
    } finally {
      전송중설정(false)
    }
  }

  function 엔터키처리(이벤트) {
    if (이벤트.key === 'Enter' && !이벤트.shiftKey) {
      이벤트.preventDefault()
      메시지전송()
    }
  }

  function 이모지선택(이모지데이터) {
    입력텍스트설정(이전 => 이전 + 이모지데이터.emoji)
    이모지피커표시설정(false)
  }

  return (
    <div className="px-4 pb-4 pt-2 shrink-0 relative">
      {/* 이모지 피커 */}
      {이모지피커표시 && (
        <div className="absolute bottom-16 right-4 z-10">
          <EmojiPicker
            onEmojiClick={이모지선택}
            theme="dark"
            height={380}
            searchPlaceholder="이모지 검색..."
          />
        </div>
      )}

      <div className="flex items-end gap-2 bg-vsc-panel rounded border border-vsc-border focus-within:border-vsc-accent transition-colors">
        {/* 텍스트 입력 */}
        <textarea
          value={입력텍스트}
          onChange={(이벤트) => 입력텍스트설정(이벤트.target.value)}
          onKeyDown={엔터키처리}
          placeholder={`${현재채팅방.타입 === 'global' ? '전체 채팅' : 현재채팅방.상대닉네임}에게 메시지 입력...`}
          className="flex-1 bg-transparent text-vsc-text text-sm px-3 py-2.5 resize-none outline-none placeholder-vsc-muted min-h-[40px] max-h-32"
          rows={1}
        />

        {/* 버튼 영역 */}
        <div className="flex items-center gap-1 pr-2 pb-1.5">
          {/* 파일 첨부 */}
          <input
            ref={파일입력ref}
            type="file"
            accept="image/*,video/*,*"
            className="hidden"
            onChange={(이벤트) => {
              const 파일 = 이벤트.target.files?.[0]
              if (파일) 파일전송(파일)
              이벤트.target.value = ''
            }}
          />
          <button
            onClick={() => 파일입력ref.current?.click()}
            disabled={전송중}
            className="text-vsc-muted hover:text-vsc-text disabled:opacity-40 p-1 rounded transition-colors"
            title="파일 첨부"
          >
            📎
          </button>

          {/* 이모지 */}
          <button
            onClick={() => 이모지피커표시설정(이전 => !이전)}
            className="text-vsc-muted hover:text-vsc-text p-1 rounded transition-colors"
            title="이모지"
          >
            😊
          </button>

          {/* 전송 */}
          <button
            onClick={메시지전송}
            disabled={!입력텍스트.trim() || 전송중}
            className="text-vsc-accent hover:opacity-80 disabled:opacity-30 p-1 rounded transition-opacity"
            title="전송 (Enter)"
          >
            ➤
          </button>
        </div>
      </div>
      <p className="text-vsc-muted text-xs mt-1 ml-1">Enter 전송 · Shift+Enter 줄바꿈</p>
    </div>
  )
}
