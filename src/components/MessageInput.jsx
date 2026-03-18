// src/components/MessageInput.jsx
import React, { useState, useRef, useEffect, Suspense, lazy } from 'react'
const EmojiPicker = lazy(() => import('emoji-picker-react'))
import { Paperclip, Smile, Send, Loader2, X } from 'lucide-react'
import useChatStore from '../store/useChatStore'

// 파일 MIME 타입 → contentType 변환
function getFileContentType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

// 바이트 → 사람이 읽기 쉬운 파일 크기 문자열
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MessageInput() {
  const [inputText, setInputText] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isSending, setIsSending] = useState(false)
  // 붙여넣기 미리보기 상태: { file, previewUrl, fileName, fileSize } | null
  const [pastePreview, setPastePreview] = useState(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const lastTypingSentAtRef = useRef(0)
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
      // 전송 후 textarea 높이 초기화
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
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

  function handlePaste(event) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        const previewUrl = URL.createObjectURL(file)
        setPastePreview({ file, previewUrl, fileName: file.name || '이미지.png', fileSize: file.size })
        return
      }
    }
  }

  function confirmPasteSend() {
    if (!pastePreview) return
    const { file, previewUrl } = pastePreview
    URL.revokeObjectURL(previewUrl)
    setPastePreview(null)
    sendFile(file)
  }

  function cancelPaste() {
    if (!pastePreview) return
    URL.revokeObjectURL(pastePreview.previewUrl)
    setPastePreview(null)
  }

  // 붙여넣기 다이얼로그 키보드 단축키 (Enter 전송, Escape 취소)
  useEffect(() => {
    if (!pastePreview) return
    const handleKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        confirmPasteSend()
      } else if (event.key === 'Escape') {
        cancelPaste()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pastePreview])

  function onEmojiSelect(emojiData) {
    setInputText(prev => prev + emojiData.emoji)
    setShowEmojiPicker(false)
  }

  // inputText 변경 시 항상 높이 재계산 (이모지, 붙여넣기 등 모든 경로 커버)
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputText])

  // textarea 높이 자동 조절 — 내용에 맞게 늘어나고 최대 높이 제한
  function adjustTextareaHeight() {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`
  }

  // 입력 시 타이핑 인디케이터 전송 (2초 쓰로틀)
  function handleInputChange(event) {
    setInputText(event.target.value)
    const now = Date.now()
    if (event.target.value.length > 0 && now - lastTypingSentAtRef.current > 2000) {
      lastTypingSentAtRef.current = now
      const targetPeerId = currentRoom.type === 'dm' ? currentRoom.peerId : null
      window.electronAPI.sendTyping(targetPeerId).catch(() => { /* 무시 */ })
    }
  }

  const canSend = inputText.trim().length > 0 && !isSending

  return (
    <div className="px-4 pb-4 pt-2 shrink-0 relative">
      {/* 이모지 피커 — 첫 클릭 시에만 청크 로드 */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 right-4 z-10">
          <Suspense fallback={null}>
            <EmojiPicker
              onEmojiClick={onEmojiSelect}
              theme="dark"
              height={380}
              searchPlaceholder="이모지 검색..."
            />
          </Suspense>
        </div>
      )}

      {/* 붙여넣기 이미지 확인 다이얼로그 */}
      {pastePreview && (
        <div className="absolute bottom-20 left-4 right-4 z-20 bg-vsc-panel border border-vsc-border rounded-lg p-4 shadow-lg">
          <div className="flex items-start justify-between mb-3">
            <span className="text-sm font-semibold text-vsc-text">이미지 전송</span>
            <button
              onClick={cancelPaste}
              className="cursor-pointer text-vsc-muted hover:text-vsc-text"
              aria-label="취소"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <img
              src={pastePreview.previewUrl}
              alt="미리보기"
              className="w-20 h-20 object-cover rounded border border-vsc-border bg-vsc-bg shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm text-vsc-text truncate">{pastePreview.fileName}</p>
              <p className="text-xs text-vsc-muted mt-0.5">{formatFileSize(pastePreview.fileSize)}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={cancelPaste}
              className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-hover text-vsc-muted hover:text-vsc-text transition-colors"
            >
              취소 (Esc)
            </button>
            <button
              onClick={confirmPasteSend}
              disabled={isSending}
              className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              전송 (Enter)
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 bg-vsc-panel rounded border border-vsc-border focus-within:border-vsc-accent transition-colors duration-150">
        {/* 텍스트 입력 */}
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleEnterKey}
          onPaste={handlePaste}
          placeholder={`${currentRoom.type === 'global' ? '전체 채팅' : currentRoom.nickname}에게 메시지 입력...`}
          className="flex-1 bg-transparent text-vsc-text text-sm px-3 py-2.5 resize-none outline-none placeholder-vsc-muted min-h-[40px] max-h-32 overflow-y-auto"
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
