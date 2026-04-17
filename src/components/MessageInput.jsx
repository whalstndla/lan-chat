// src/components/MessageInput.jsx
import React, { useState, useRef, useEffect, Suspense, lazy, useCallback, forwardRef, useImperativeHandle } from 'react'
const EmojiPicker = lazy(() => import('emoji-picker-react'))
import { Paperclip, Smile, Send, Loader2, X, Pencil } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import FormattingToolbar from './input/FormattingToolbar'
import PastePreviewDialog from './input/PastePreviewDialog'
import useChatStore from '../store/useChatStore'

// 파일 MIME 타입 → contentType 변환
function getFileContentType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function isEditableElement(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-prevent-editor-autofocus="true"]')) return true
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') return true
  if (target.isContentEditable) return true
  return !!target.closest('[contenteditable="true"]')
}

const MessageInput = forwardRef(function MessageInput(props, ref) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [pastePreview, setPastePreview] = useState(null) // null 또는 { files: [File...], previews: [{ previewUrl, fileName, fileSize }...] }
  // 수정 모드: 현재 수정 중인 메시지 객체 (null이면 일반 전송 모드)
  const [editingMessage, setEditingMessage] = useState(null)
  const fileInputRef = useRef(null)
  const lastTypingSentAtRef = useRef(0)
  const sendMessageRef = useRef(null)
  const currentRoom = useChatStore(state => state.currentRoom)

  // Tiptap 에디터 설정
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
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
      // 이미지 붙여넣기 가로채기 (여러 번 붙여넣기 시 누적)
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        const newFiles = []
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) newFiles.push(file)
          }
        }
        if (newFiles.length === 0) return false
        event.preventDefault()
        // 기존 미리보기에 누적 추가
        setPastePreview(prev => {
          const existingFiles = prev ? prev.files : []
          const existingPreviews = prev ? prev.previews : []
          const addedPreviews = newFiles.map(file => ({
            previewUrl: URL.createObjectURL(file),
            fileName: file.name || '이미지.png',
            fileSize: file.size,
          }))
          return {
            files: [...existingFiles, ...newFiles],
            previews: [...existingPreviews, ...addedPreviews],
          }
        })
        return true
      },
      // 백틱 입력 감지 — ``` 완성 시 코드블록 삽입
      handleTextInput: (view, from, to, text) => {
        if (text !== '`') return false
        const { state } = view
        const { $from } = state.selection
        // 코드블록 안에서는 일반 텍스트로 입력 (변환하지 않음)
        if ($from.parent.type.name === 'codeBlock') return false
        // 커서 앞 텍스트가 ``로 끝나는지 확인 (지금 `를 추가하면 ```가 됨)
        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
        if (!textBefore.endsWith('``')) return false
        // `` 삭제 + 코드블록 삽입
        const { tr } = state
        tr.delete(from - 2, from)
        const codeBlock = state.schema.nodes.codeBlock.create()
        tr.replaceSelectionWith(codeBlock)
        view.dispatch(tr)
        return true
      },
      // Enter = 전송, Shift+Enter = 줄바꿈 (위치 무관)
      handleKeyDown: (view, event) => {
        // IME 조합 중(한국어 입력 등)에는 Enter를 전송으로 처리하지 않음
        if (event.isComposing || event.keyCode === 229) return false
        if (event.key === 'Enter' && !event.shiftKey) {
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

  const keepEditorFocus = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      editor.commands.focus('end')
    })
  }, [editor])

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

  // 창 포커스 복귀 시 키 입력으로 에디터 자동 포커스
  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229) return
      // 에디터에 이미 포커스가 있으면 무시
      if (editor.isFocused) return
      // 이벤트 대상이나 현재 포커스가 편집 가능한 요소면 무시
      if (isEditableElement(event.target)) return
      const active = document.activeElement
      if (isEditableElement(active)) return
      // 단축키(Ctrl/Cmd/Alt) 조합은 무시
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // 기능키, 탭, Esc 등 특수 키는 무시
      if (event.key.length > 1) return
      editor.commands.focus('end')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor])

  // 수정 모드 시작 — 선택한 메시지를 에디터에 로드
  function startEdit(message) {
    setEditingMessage(message)
    editor?.commands.setContent(message.content || '')
    editor?.commands.focus()
  }

  // 수정 내용 제출 — IPC 호출 후 스토어 업데이트
  async function submitEdit() {
    if (!editingMessage || !editor) return
    const newContent = editor.storage.markdown.getMarkdown().trim()
    if (!newContent) return
    const targetPeerId = editingMessage.type === 'dm'
      ? (editingMessage.to || editingMessage.to_id) : null
    const result = await window.electronAPI.editMessage({ messageId: editingMessage.id, newContent, targetPeerId })
    if (result) {
      const { editGlobalMessage, editDMMessage } = useChatStore.getState()
      if (targetPeerId) editDMMessage(targetPeerId, editingMessage.id, newContent, result.editedAt)
      else editGlobalMessage(editingMessage.id, newContent, result.editedAt)
    }
    setEditingMessage(null)
    editor.commands.clearContent()
    keepEditorFocus()
  }

  // 수정 모드 취소 — 에디터 초기화
  function cancelEdit() {
    setEditingMessage(null)
    editor?.commands.clearContent()
    keepEditorFocus()
  }

  const sendMessage = useCallback(async () => {
    // 수정 모드일 때는 메시지 전송 대신 수정 제출
    if (editingMessage) { submitEdit(); return }

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
        useChatStore.getState().addGlobalMessage(sentMessage)
      } else {
        sentMessage = await window.electronAPI.sendDM({
          recipientPeerId: currentRoom.peerId,
          content,
          contentType: 'text',
          format: 'markdown',
        })
        useChatStore.getState().addDMMessage(currentRoom.peerId, sentMessage)
      }
      editor.commands.clearContent()
      keepEditorFocus()
    } finally {
      setIsSending(false)
    }
  }, [editor, isSending, currentRoom, editingMessage, keepEditorFocus])

  // sendMessage를 ref에 저장 (handleKeyDown에서 참조)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // 단일 파일 전송 (isSending 상태는 호출부에서 관리)
  async function sendFile(file) {
    const arrayBuffer = await file.arrayBuffer()
    const fileUrl = await window.electronAPI.saveFile(arrayBuffer, file.name)
    const contentType = getFileContentType(file)
    const payload = { content: null, contentType, fileUrl, fileName: file.name }
    let sentMessage
    if (currentRoom.type === 'global') {
      sentMessage = await window.electronAPI.sendGlobalMessage(payload)
      useChatStore.getState().addGlobalMessage(sentMessage)
    } else {
      sentMessage = await window.electronAPI.sendDM({ recipientPeerId: currentRoom.peerId, ...payload })
      useChatStore.getState().addDMMessage(currentRoom.peerId, sentMessage)
    }
  }

  // 여러 파일을 순차적으로 전송
  async function sendFiles(fileList) {
    if (!fileList || fileList.length === 0) return
    setIsSending(true)
    try {
      for (const file of fileList) {
        await sendFile(file)
      }
    } finally {
      setIsSending(false)
    }
  }

  // 드래그 앤 드롭으로 전달된 파일 처리 (모든 파일 순차 전송)
  function handleDroppedFiles(fileList) {
    if (!fileList || fileList.length === 0) return
    sendFiles(fileList)
  }

  // 부모 컴포넌트에서 ref를 통해 handleDroppedFiles, startEdit 호출 가능하도록 노출
  useImperativeHandle(ref, () => ({
    handleDroppedFiles,
    startEdit,
  }))

  function confirmPasteSend() {
    if (!pastePreview) return
    const { files, previews } = pastePreview
    previews.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setPastePreview(null)
    sendFiles(files)
  }

  function cancelPaste() {
    if (!pastePreview) return
    pastePreview.previews.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setPastePreview(null)
  }

  function removePasteItem(index) {
    if (!pastePreview) return
    const { files, previews } = pastePreview
    URL.revokeObjectURL(previews[index].previewUrl)
    const newFiles = files.filter((_, i) => i !== index)
    const newPreviews = previews.filter((_, i) => i !== index)
    if (newFiles.length === 0) {
      setPastePreview(null)
    } else {
      setPastePreview({ files: newFiles, previews: newPreviews })
    }
  }

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

      <PastePreviewDialog
        pastePreview={pastePreview}
        isSending={isSending}
        onConfirm={confirmPasteSend}
        onCancel={cancelPaste}
        onRemoveItem={removePasteItem}
      />

      <div className="flex flex-col bg-vsc-panel rounded border border-vsc-border focus-within:border-vsc-accent transition-colors duration-150">
        {/* 수정 모드 배너 — 수정 중일 때만 표시 */}
        {editingMessage && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-vsc-panel border-b border-vsc-border text-xs text-vsc-muted">
            <Pencil size={12} />
            <span>메시지 수정 중</span>
            <button onClick={cancelEdit} className="ml-auto text-vsc-muted hover:text-red-400 cursor-pointer">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 마크다운 포맷팅 툴바 */}
        <FormattingToolbar editor={editor} />

        <div className="flex items-end gap-2">
        {/* Tiptap 에디터 */}
        <div className="flex-1 tiptap-editor">
          <EditorContent editor={editor} />
        </div>

        {/* 버튼 영역 */}
        <div className="flex items-center gap-0.5 pr-2 pb-1.5">
          <input ref={fileInputRef} type="file" accept="image/*,video/*,*" multiple className="hidden"
            onChange={(event) => { const files = event.target.files; if (files && files.length > 0) sendFiles(Array.from(files)); event.target.value = '' }} />
          <button onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()} disabled={isSending} aria-label="파일 첨부" title="파일 첨부"
            className="cursor-pointer p-1.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150">
            <Paperclip size={16} />
          </button>
          <button onMouseDown={(event) => event.preventDefault()} onClick={() => setShowEmojiPicker(prev => !prev)} aria-label="이모지 선택" title="이모지"
            className={`cursor-pointer p-1.5 rounded transition-colors duration-150 ${showEmojiPicker ? 'text-vsc-accent bg-vsc-hover' : 'text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover'}`}>
            <Smile size={16} />
          </button>
          <button onMouseDown={(event) => event.preventDefault()} onClick={sendMessage} disabled={!canSend} aria-label="메시지 전송" title="전송 (Enter)"
            className="cursor-pointer p-1.5 rounded transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30 text-vsc-accent hover:bg-vsc-hover disabled:hover:bg-transparent">
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        </div>
      </div>
      <p className="text-vsc-muted text-xs mt-1 ml-1 select-none">Enter 전송 · Shift+Enter 줄바꿈 · **굵게** *기울임* `코드`</p>
    </div>
  )
})

export default MessageInput
