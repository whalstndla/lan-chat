// src/components/MessageInput.jsx
import React, { useState, useRef } from 'react'
import EmojiPicker from 'emoji-picker-react'
import { Paperclip, Smile, Send, Loader2 } from 'lucide-react'
import useChatStore from '../store/useChatStore'

// 파일 MIME 타입 → contentType 변환
function getFileContentType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

export default function MessageInput() {
  const [inputText, setInputText] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const fileInputRef = useRef(null)
  const currentRoom = useChatStore(state => state.currentRoom)
  const { addGlobalMessage, addDMMessage } = useChatStore()

  async function sendMessage() {
    const content = inputText.trim()
    if (!content || isSending) return

    setIsSending(true)
    try {
      let sentMessage
      if (currentRoom.type === 'global') {
        sentMessage = await window.electronAPI.sendGlobalMessage({ content, contentType: 'text' })
        addGlobalMessage(sentMessage)
      } else {
        sentMessage = await window.electronAPI.sendDM({
          recipientPeerId: currentRoom.peerId,
          content,
          contentType: 'text',
        })
        addDMMessage(currentRoom.peerId, sentMessage)
      }
      setInputText('')
    } finally {
      setIsSending(false)
    }
  }

  async function sendFile(file) {
    setIsSending(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const fileUrl = await window.electronAPI.saveFile(arrayBuffer, file.name)
      const contentType = getFileContentType(file)

      const payload = { content: null, contentType, fileUrl, fileName: file.name }

      let sentMessage
      if (currentRoom.type === 'global') {
        sentMessage = await window.electronAPI.sendGlobalMessage(payload)
        addGlobalMessage(sentMessage)
      } else {
        sentMessage = await window.electronAPI.sendDM({
          recipientPeerId: currentRoom.peerId,
          ...payload,
        })
        addDMMessage(currentRoom.peerId, sentMessage)
      }
    } finally {
      setIsSending(false)
    }
  }

  function handleEnterKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  function onEmojiSelect(emojiData) {
    setInputText(prev => prev + emojiData.emoji)
    setShowEmojiPicker(false)
  }

  const canSend = inputText.trim().length > 0 && !isSending

  return (
    <div className="px-4 pb-4 pt-2 shrink-0 relative">
      {/* 이모지 피커 */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 right-4 z-10">
          <EmojiPicker
            onEmojiClick={onEmojiSelect}
            theme="dark"
            height={380}
            searchPlaceholder="이모지 검색..."
          />
        </div>
      )}

      <div className="flex items-end gap-2 bg-vsc-panel rounded border border-vsc-border focus-within:border-vsc-accent transition-colors duration-150">
        {/* 텍스트 입력 */}
        <textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={handleEnterKey}
          placeholder={`${currentRoom.type === 'global' ? '전체 채팅' : currentRoom.nickname}에게 메시지 입력...`}
          className="flex-1 bg-transparent text-vsc-text text-sm px-3 py-2.5 resize-none outline-none placeholder-vsc-muted min-h-[40px] max-h-32"
          rows={1}
        />

        {/* 버튼 영역 */}
        <div className="flex items-center gap-0.5 pr-2 pb-1.5">
          {/* 파일 첨부 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) sendFile(file)
              event.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            aria-label="파일 첨부"
            title="파일 첨부"
            className="cursor-pointer p-1.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <Paperclip size={16} />
          </button>

          {/* 이모지 */}
          <button
            onClick={() => setShowEmojiPicker(prev => !prev)}
            aria-label="이모지 선택"
            title="이모지"
            className={`cursor-pointer p-1.5 rounded transition-colors duration-150 ${
              showEmojiPicker
                ? 'text-vsc-accent bg-vsc-hover'
                : 'text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover'
            }`}
          >
            <Smile size={16} />
          </button>

          {/* 전송 */}
          <button
            onClick={sendMessage}
            disabled={!canSend}
            aria-label="메시지 전송"
            title="전송 (Enter)"
            className="cursor-pointer p-1.5 rounded transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30 text-vsc-accent hover:bg-vsc-hover disabled:hover:bg-transparent"
          >
            {isSending
              ? <Loader2 size={16} className="animate-spin" />
              : <Send size={16} />
            }
          </button>
        </div>
      </div>
      <p className="text-vsc-muted text-xs mt-1 ml-1 select-none">Enter 전송 · Shift+Enter 줄바꿈</p>
    </div>
  )
}
