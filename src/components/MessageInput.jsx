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
import useChatStore, { getRoomKey } from '../store/useChatStore'

// 메시지 최대 길이 — electron/ipcHandlers/message.js 의 MAX_CONTENT_LENGTH 와 동일 값을 유지.
// 전송 전 클라이언트에서 미리 검증해, 초과 시 IPC 실패 응답을 기다리지 않고 즉시 안내한다.
const MAX_MESSAGE_LENGTH = 10000

// 파일 MIME 타입 → contentType 변환.
// SVG 는 XSS 위험으로 fileServer 가 attachment 강제 → 인라인 표시 불가.
// 클라이언트에서도 'image' 가 아닌 'file' 로 분류해 다운로드 동작과 일관성 확보.
function getFileContentType(file) {
  if (file.type === 'image/svg+xml') return 'file'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

// HEIC / HEIF 감지 — iPhone 기본 사진 포맷. Chromium 데스크톱은 시스템 코덱 의존이라
// macOS 일부 버전 외에는 디코딩 불가. 송신 단계에서 JPEG 로 변환해 모든 수신측에서
// 표시 가능하게 한다.
function isHeicFile(file) {
  if (!file) return false
  const type = (file.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  // 일부 파일 시스템은 MIME 을 누락하고 확장자만 제공 (e.g., drag&drop on Linux)
  const name = (file.name || '').toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

// HEIC blob → JPEG File. 변환 실패 시 null 반환 (호출부에서 원본 그대로 송신 폴백).
// heic2any 는 libheif WASM 을 lazy 로드하므로 첫 호출 시 약간의 지연이 있을 수 있음.
async function convertHeicToJpeg(file) {
  try {
    const { default: heic2any } = await import('heic2any')
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const blob = Array.isArray(result) ? result[0] : result
    if (!blob) return null
    // 확장자를 .jpg 로 교체. 원본 이름 보존 (User-friendly).
    const baseName = (file.name || 'image').replace(/\.(heic|heif)$/i, '')
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (err) {
    console.warn('[HEIC 변환 실패]', err?.message || err)
    return null
  }
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
  // 방별 draft 보존용 — 매 키 입력마다 store 에 쓰지 않고, 최신 마크다운을 ref 에만 저장해뒀다가
  // 방 전환/blur 시점에만 store.setDraft 로 flush 한다(IME 안전: 순수 ref 대입이라 조합에 영향 없음).
  const latestMarkdownRef = useRef('')
  // effect 클린업/onBlur 시점에 "수정 모드 중이었는지"를 정확히 알기 위한 ref.
  // (edit 중인 내용은 draft 가 아니므로 draft 로 저장하면 안 됨)
  const editingMessageRef = useRef(null)

  // Tiptap 에디터 설정
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
      }),
      // [IME 진단 v0.10.2] Placeholder 확장이 한국어 composition transition 중 빈 노드 ↔
      // 채워진 노드 토글로 ProseMirror DOM observer를 흔들어 첫 글자/자모가 사라지는지
      // 확인용으로 임시 비활성화. 검증 후 영구 처리 결정 (옵션 조정 또는 CSS 직접 처리).
      // Placeholder.configure({
      //   placeholder: `${currentRoom.type === 'global' ? '전체 채팅' : currentRoom.nickname}에게 메시지 입력...`,
      // }),
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
      // Enter = 전송, Shift+Enter = 줄바꿈.
      // 단, 커서가 리스트 아이템 / 코드블록 안에 있으면 Tiptap 기본 동작(새 항목 / 개행)을 유지.
      // 리스트에서 빈 항목일 때 Enter 를 누르면 Tiptap 이 리스트에서 빠져나가 일반 문단으로 전환 → 다음 Enter 에서 전송됨.
      handleKeyDown: (view, event) => {
        // IME 조합 중(한국어 입력 등)에는 Enter를 전송으로 처리하지 않음
        if (view.composing || event.isComposing || event.keyCode === 229) return false
        if (event.key === 'Enter' && !event.shiftKey) {
          // 현재 선택 위치의 조상 노드에 리스트 아이템이나 코드블록이 있는지 확인
          const { $from } = view.state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const nodeName = $from.node(depth).type.name
            if (nodeName === 'listItem' || nodeName === 'codeBlock') {
              return false
            }
          }
          event.preventDefault()
          sendMessageRef.current?.()
          return true
        }
        return false
      },
    },
    // 방 전환/최초 마운트로 새 에디터 인스턴스가 생성될 때, 저장된 draft 가 있으면 복원.
    // (조합 로직과 무관 — 조합 도중이 아니라 에디터가 새로 생성되는 시점에만 1회 실행됨)
    onCreate: ({ editor: ed }) => {
      const roomKey = getRoomKey(currentRoom)
      const draftMarkdown = useChatStore.getState().drafts[roomKey]
      if (draftMarkdown) {
        ed.commands.setContent(draftMarkdown)
      }
    },
    // 타이핑 인디케이터
    onUpdate: ({ editor: ed }) => {
      // draft 추적용 — store 에는 쓰지 않고 ref 에만 최신 마크다운을 보관해둔다(순수 대입이라 IME 영향 없음).
      latestMarkdownRef.current = ed.storage.markdown.getMarkdown()

      const now = Date.now()
      if (!ed.isEmpty && now - lastTypingSentAtRef.current > 2000) {
        lastTypingSentAtRef.current = now
        const targetPeerId = currentRoom.type === 'dm' ? currentRoom.peerId : null
        window.electronAPI.sendTyping(targetPeerId).catch(() => {})
      }
    },
    // 창 포커스 이탈(blur) 시에도 draft 를 flush — 방 전환 없이 앱을 벗어나는 경우 대비.
    onBlur: () => {
      if (editingMessageRef.current) return
      const roomKey = getRoomKey(currentRoom)
      useChatStore.getState().setDraft(roomKey, latestMarkdownRef.current)
    },
  }, [currentRoom])

  // editingMessage 최신값을 ref 에도 반영 — draft 저장 시점(effect cleanup/blur)에서
  // "수정 모드였는지"를 정확히 판단하기 위함 (edit 중인 내용을 draft 로 오인해 저장하지 않도록).
  useEffect(() => {
    editingMessageRef.current = editingMessage
  }, [editingMessage])

  // 방을 떠날 때(전환 직전) 작성 중이던 내용을 해당 방의 draft 로 저장.
  // cleanup 클로저가 "이전" currentRoom 을 캡처하므로 정확히 떠나는 방의 roomKey 로 저장된다.
  // latestMarkdownRef 는 에디터 인스턴스와 무관한 순수 ref 라, useEditor 내부 effect(에디터 파괴)와의
  // 실행 순서에 의존하지 않고 항상 안전하게 마지막 값을 읽을 수 있다.
  useEffect(() => {
    return () => {
      if (editingMessageRef.current) return
      const roomKey = getRoomKey(currentRoom)
      useChatStore.getState().setDraft(roomKey, latestMarkdownRef.current)
    }
  }, [currentRoom])

  const keepEditorFocus = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      const editorDom = editor.view?.dom
      if (editorDom && editorDom.contains(document.activeElement)) return
      editor.commands.focus('end')
    })
  }, [editor])

  // 창 포커스 복귀 시 키 입력으로 에디터 자동 포커스
  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229) return
      // 에디터 DOM 내부에서 발생한 키 입력은 절대 강제 focus() 호출 대상이 아니어야 함.
      // 한국어 IME composition 종료/시작 transition 사이 짧은 순간에는 editor.isFocused가
      // 일시적으로 false로 보고되는 경우가 있는데, 그때 focus('end')가 호출되면 ProseMirror
      // selection이 흔들리며 다음 글자 조합이 깨질 수 있음 → 안전 가드.
      const editorDom = editor.view?.dom
      if (editorDom && event.target instanceof Node && editorDom.contains(event.target)) return
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

    // 전송 전 길이 사전 검증 — 초과 시 main 프로세스 왕복 없이 즉시 사용자에게 안내.
    // (에디터 내용은 건드리지 않고 여기서 return — IME/조합 관련 clearContent 순서는 그대로 유지)
    if (content.length > MAX_MESSAGE_LENGTH) {
      window.alert(`메시지가 너무 깁니다 (${content.length}자). 최대 ${MAX_MESSAGE_LENGTH}자까지 전송 가능합니다.`)
      return
    }

    // IPC 응답을 기다린 뒤 초기화하면 사용자가 시작한 다음 한글 조합까지 지워질 수 있다.
    // 전송할 내용을 먼저 보관하고 에디터는 즉시 비워 이전 전송의 후처리가 새 입력을 건드리지 않게 한다.
    editor.commands.clearContent()
    keepEditorFocus()
    // 에디터를 비운 시점에 맞춰 해당 방의 draft 도 함께 비운다(전송 중인 내용이 draft 로 남지 않도록).
    useChatStore.getState().clearDraft(getRoomKey(currentRoom))

    setIsSending(true)
    try {
      let sentMessage
      if (currentRoom.type === 'global') {
        sentMessage = await window.electronAPI.sendGlobalMessage({
          content,
          contentType: 'text',
          format: 'markdown',
        })
      } else {
        sentMessage = await window.electronAPI.sendDM({
          recipientPeerId: currentRoom.peerId,
          content,
          contentType: 'text',
          format: 'markdown',
        })
      }
      // main 이 입력 검증 실패 시 { ok: false, error } 를 반환한다 — 스토어에 넣지 않고 안전하게 처리.
      if (!sentMessage || sentMessage.ok === false) {
        window.alert('메시지 전송에 실패했습니다.')
        return
      }
      if (currentRoom.type === 'global') useChatStore.getState().addGlobalMessage(sentMessage)
      else useChatStore.getState().addDMMessage(currentRoom.peerId, sentMessage)
    } finally {
      setIsSending(false)
    }
  }, [editor, isSending, currentRoom, editingMessage, keepEditorFocus])

  // sendMessage를 ref에 저장 (handleKeyDown에서 참조)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // 단일 파일 전송 (isSending 상태는 호출부에서 관리).
  // saveFile 응답 형식: { ok: true, url, fileName } 또는 { ok: false, error, ... }.
  async function sendFile(file) {
    // HEIC/HEIF 는 Chromium 디코딩이 플랫폼·버전마다 들쭉날쭉 → 송신 단계에서 JPEG 로
    // 변환해 모든 수신측이 표시 가능하게 한다. 변환 실패 시 원본 그대로 보내고 (수신측이
    // 가능하면 시도, 못하면 file-load failed 로 보임).
    let uploadFile = file
    if (isHeicFile(file)) {
      const converted = await convertHeicToJpeg(file)
      if (converted) {
        uploadFile = converted
      } else {
        // 변환 실패 — file (다운로드 attachment) 로 보낸다. 적어도 손에 받을 수 있게.
        // contentType 결정은 아래 getFileContentType 가 type 보고 처리.
        uploadFile = new File([file], file.name, { type: 'application/octet-stream' })
      }
    }
    const arrayBuffer = await uploadFile.arrayBuffer()
    const saveResult = await window.electronAPI.saveFile(arrayBuffer, uploadFile.name)
    if (!saveResult || !saveResult.ok) {
      // 사이즈 초과 / 마스터키 미설정 / 디스크 에러 — 사용자에게 즉시 알림 + 송신 중단.
      if (saveResult?.error === 'tooLarge') {
        const maxMb = Math.floor(saveResult.maxBytes / (1024 * 1024))
        const sizeMb = (saveResult.size / (1024 * 1024)).toFixed(1)
        window.alert(`파일이 너무 큽니다 (${sizeMb}MB). 최대 ${maxMb}MB 까지 전송 가능합니다.`)
      } else if (saveResult?.error === 'noMasterKey') {
        window.alert('파일 전송 준비가 안 됐습니다. 다시 로그인 후 시도해 주세요.')
      } else {
        window.alert('파일 저장에 실패했습니다.')
      }
      return
    }
    const contentType = getFileContentType(uploadFile)
    const payload = { content: null, contentType, fileUrl: saveResult.url, fileName: uploadFile.name }
    let sentMessage
    if (currentRoom.type === 'global') {
      sentMessage = await window.electronAPI.sendGlobalMessage(payload)
    } else {
      sentMessage = await window.electronAPI.sendDM({ recipientPeerId: currentRoom.peerId, ...payload })
    }
    // main 이 입력 검증 실패 시 { ok: false, error } 를 반환한다 — 스토어에 넣지 않고 안전하게 처리.
    if (!sentMessage || sentMessage.ok === false) {
      window.alert('메시지 전송에 실패했습니다.')
      return
    }
    if (currentRoom.type === 'global') useChatStore.getState().addGlobalMessage(sentMessage)
    else useChatStore.getState().addDMMessage(currentRoom.peerId, sentMessage)
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
