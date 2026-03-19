// src/components/MessageInput.jsx
import React, { useState, useRef, useEffect, Suspense, lazy, useCallback } from 'react'
const EmojiPicker = lazy(() => import('emoji-picker-react'))
import { Paperclip, Smile, Send, Loader2, X } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [pastePreview, setPastePreview] = useState(null)
  const fileInputRef = useRef(null)
  const lastTypingSentAtRef = useRef(0)
  const sendMessageRef = useRef(null)
  const currentRoom = useChatStore(state => state.currentRoom)
  const { addGlobalMessage, addDMMessage } = useChatStore()

  // Tiptap 에디터 설정
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 헤딩은 채팅에서 불필요
        heading: false,
        // 수평선 비활성화
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: `${currentRoom.type === 'global' ? '전체 채팅' : currentRoom.nickname}에게 메시지 입력...`,
      }),
      Markdown.configure({
        // 마크다운 붙여넣기 → 리치 텍스트 변환
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'outline-none text-sm text-vsc-text min-h-[40px] max-h-32 overflow-y-auto px-3 py-2.5',
      },
      // 이미지 붙여넣기 가로채기 (기존 미리보기 다이얼로그 유지)
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) return true
            const previewUrl = URL.createObjectURL(file)
            setPastePreview({ file, previewUrl, fileName: file.name || '이미지.png', fileSize: file.size })
            return true
          }
        }
        return false
      },
      // Enter 키 처리 — 코드블록/리스트 안에서는 줄바꿈, 밖에서는 전송
      handleKeyDown: (view, event) => {
        // IME 조합 중(한국어 입력 등)에는 Enter를 전송으로 처리하지 않음
        if (event.isComposing || event.keyCode === 229) return false
        if (event.key === 'Enter' && !event.shiftKey) {
          const { state } = view
          const { $from } = state.selection
          // 코드블록 안이면 기본 동작 (줄바꿈)
          if ($from.parent.type.name === 'codeBlock') return false
          // 리스트 아이템 안이면 기본 동작 (새 항목 / 리스트 탈출)
          if ($from.parent.type.name === 'listItem') return false
          // 불릿/순서 리스트 안이면 기본 동작
          for (let depth = $from.depth; depth > 0; depth--) {
            const nodeType = $from.node(depth).type.name
            if (nodeType === 'bulletList' || nodeType === 'orderedList') return false
          }
          // 일반 텍스트 — 전송
          event.preventDefault()
          sendMessageRef.current?.()
          return true
        }
        return false
      },
    },
    // 타이핑 인디케이터
    onUpdate: ({ editor: ed }) => {
      const now = Date.now()
      if (!ed.isEmpty && now - lastTypingSentAtRef.current > 2000) {
        lastTypingSentAtRef.current = now
        const targetPeerId = currentRoom.type === 'dm' ? currentRoom.peerId : null
        window.electronAPI.sendTyping(targetPeerId).catch(() => {})
      }
    },
  }, [currentRoom])

  // placeholder 업데이트 (방 변경 시)
  useEffect(() => {
    if (!editor) return
    editor.extensionManager.extensions
      .find(ext => ext.name === 'placeholder')
      ?.options && editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
        },
      })
  }, [currentRoom, editor])

  const sendMessage = useCallback(async () => {
    if (!editor || editor.isEmpty || isSending) return

    // Tiptap → 마크다운 텍스트 변환
    const markdown = editor.storage.markdown.getMarkdown()
    const content = markdown.trim()
    if (!content) return

    setIsSending(true)
    try {
      let sentMessage
      if (currentRoom.type === 'global') {
        sentMessage = await window.electronAPI.sendGlobalMessage({
          content,
          contentType: 'text',
          format: 'markdown',
        })
        addGlobalMessage(sentMessage)
      } else {
        sentMessage = await window.electronAPI.sendDM({
          recipientPeerId: currentRoom.peerId,
          content,
          contentType: 'text',
          format: 'markdown',
        })
        addDMMessage(currentRoom.peerId, sentMessage)
      }
      editor.commands.clearContent()
    } finally {
      setIsSending(false)
    }
  }, [editor, isSending, currentRoom])

  // sendMessage를 ref에 저장 (handleKeyDown에서 참조)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

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
        sentMessage = await window.electronAPI.sendDM({ recipientPeerId: currentRoom.peerId, ...payload })
        addDMMessage(currentRoom.peerId, sentMessage)
      }
    } finally {
      setIsSending(false)
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

  // 붙여넣기 다이얼로그 키보드 단축키
  useEffect(() => {
    if (!pastePreview) return
    const handleKeyDown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); confirmPasteSend() }
      else if (event.key === 'Escape') cancelPaste()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pastePreview])

  function onEmojiSelect(emojiData) {
    if (editor) {
      editor.chain().focus().insertContent(emojiData.emoji).run()
    }
    setShowEmojiPicker(false)
  }

  const canSend = editor && !editor.isEmpty && !isSending

  return (
    <div className="px-4 pb-4 pt-2 shrink-0 relative">
      {/* 이모지 피커 */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 right-4 z-10">
          <Suspense fallback={null}>
            <EmojiPicker onEmojiClick={onEmojiSelect} theme="dark" height={380} searchPlaceholder="이모지 검색..." />
          </Suspense>
        </div>
      )}

      {/* 붙여넣기 이미지 확인 다이얼로그 */}
      {pastePreview && (
        <div className="absolute bottom-20 left-4 right-4 z-20 bg-vsc-panel border border-vsc-border rounded-lg p-4 shadow-lg">
          <div className="flex items-start justify-between mb-3">
            <span className="text-sm font-semibold text-vsc-text">이미지 전송</span>
            <button onClick={cancelPaste} className="cursor-pointer text-vsc-muted hover:text-vsc-text" aria-label="취소">
              <X size={16} />
            </button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <img src={pastePreview.previewUrl} alt="미리보기" className="w-20 h-20 object-cover rounded border border-vsc-border bg-vsc-bg shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-vsc-text truncate">{pastePreview.fileName}</p>
              <p className="text-xs text-vsc-muted mt-0.5">{formatFileSize(pastePreview.fileSize)}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancelPaste} className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-hover text-vsc-muted hover:text-vsc-text transition-colors">취소 (Esc)</button>
            <button onClick={confirmPasteSend} disabled={isSending} className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity">전송 (Enter)</button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 bg-vsc-panel rounded border border-vsc-border focus-within:border-vsc-accent transition-colors duration-150">
        {/* Tiptap 에디터 */}
        <div className="flex-1 tiptap-editor">
          <EditorContent editor={editor} />
        </div>

        {/* 버튼 영역 */}
        <div className="flex items-center gap-0.5 pr-2 pb-1.5">
          <input ref={fileInputRef} type="file" accept="image/*,video/*,*" className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) sendFile(file); event.target.value = '' }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isSending} aria-label="파일 첨부" title="파일 첨부"
            className="cursor-pointer p-1.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150">
            <Paperclip size={16} />
          </button>
          <button onClick={() => setShowEmojiPicker(prev => !prev)} aria-label="이모지 선택" title="이모지"
            className={`cursor-pointer p-1.5 rounded transition-colors duration-150 ${showEmojiPicker ? 'text-vsc-accent bg-vsc-hover' : 'text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover'}`}>
            <Smile size={16} />
          </button>
          <button onClick={sendMessage} disabled={!canSend} aria-label="메시지 전송" title="전송 (Enter)"
            className="cursor-pointer p-1.5 rounded transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30 text-vsc-accent hover:bg-vsc-hover disabled:hover:bg-transparent">
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
      <p className="text-vsc-muted text-xs mt-1 ml-1 select-none">Enter 전송 · Shift+Enter 줄바꿈 · **굵게** *기울임* `코드`</p>
    </div>
  )
}
