// src/components/Message.jsx
import React, { useState, useEffect } from 'react'
import { Paperclip, Trash2, X, Clock } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import useUserStore from '../store/useUserStore'
import useChatStore from '../store/useChatStore'
import usePeerStore from '../store/usePeerStore'

// timestamp → "오후 2:30" 형식
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Message({ message }) {
  const myPeerId = useUserStore(state => state.myPeerId)
  const myProfileImageUrl = useUserStore(state => state.myProfileImageUrl)
  const { removeGlobalMessage, removeDMMessage } = useChatStore()
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
  const [lightboxUrl, setLightboxUrl] = useState(null)

  const sender = message.from || message.from_name
  const contentType = message.contentType || message.content_type
  const fileUrl = message.fileUrl || message.file_url
  const fileName = message.fileName || message.file_name
  const senderId = message.fromId || message.from_id

  // 발신자 아바타 URL 계산
  const senderPeer = onlinePeers.find(p => p.peerId === senderId)
  const avatarUrl = isMyMessage ? myProfileImageUrl : senderPeer?.profileImageUrl

  // Escape 키로 라이트박스 닫기
  useEffect(() => {
    if (!lightboxUrl) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxUrl])

  async function handleDelete() {
    // DM 메시지이면 대화 상대 peerId, 전체 채팅이면 null
    const targetPeerId = (message.type === 'dm')
      ? (message.to || message.to_id)
      : null

    await window.electronAPI.deleteMessage(message.id, targetPeerId)

    // 로컬 스토어에서 즉시 제거
    if (targetPeerId) {
      removeDMMessage(targetPeerId, message.id)
    } else {
      removeGlobalMessage(message.id)
    }
  }

  return (
    <>
      <div className={`flex gap-3 px-4 py-1.5 hover:bg-vsc-hover group ${isMyMessage ? 'flex-row-reverse' : ''} ${message.pending ? 'opacity-60' : ''}`}>
        {/* 아바타 */}
        <div className="relative w-8 h-8 shrink-0 mt-0.5">
          <div className="w-8 h-8 rounded bg-vsc-border flex items-center justify-center text-xs text-vsc-accent font-bold">
            {sender?.[0]?.toUpperCase() || '?'}
          </div>
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt={sender}
              className="absolute inset-0 w-8 h-8 rounded object-cover"
              onError={(e) => { e.target.style.display = 'none' }}
            />
          )}
        </div>

        <div className={`flex flex-col max-w-[70%] ${isMyMessage ? 'items-end' : ''}`}>
          {/* 닉네임 + 시간 + pending 아이콘 + 삭제 버튼 */}
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={`text-xs font-semibold ${isMyMessage ? 'text-vsc-accent' : 'text-vsc-text'}`}>
              {isMyMessage ? '나' : sender}
            </span>
            <span className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              {formatTime(message.timestamp)}
            </span>
            {message.pending && (
              <Clock size={11} className="text-vsc-muted" title="전송 대기 중" />
            )}
            {isMyMessage && !message.pending && (
              <button
                onClick={handleDelete}
                aria-label="메시지 삭제"
                title="메시지 삭제"
                className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-red-400 hover:bg-vsc-hover"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>

          {/* 메시지 내용 */}
          {(contentType === 'text' || !contentType) && (
            <div className="select-text bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed whitespace-pre-wrap break-words max-w-full">
              {parseLinksInText(message.content || '')}
            </div>
          )}

          {contentType === 'image' && fileUrl && (
            <div
              className="rounded overflow-hidden border border-vsc-border cursor-pointer"
              onClick={() => setLightboxUrl(fileUrl)}
            >
              <img
                src={fileUrl}
                alt={fileName || '이미지'}
                className="max-w-xs max-h-64 object-contain bg-vsc-bg"
                onError={(event) => { event.target.style.display = 'none' }}
              />
            </div>
          )}

          {contentType === 'video' && fileUrl && (
            <div className="rounded overflow-hidden border border-vsc-border">
              <video
                src={fileUrl}
                controls
                className="max-w-xs max-h-64"
              />
            </div>
          )}

          {contentType === 'file' && fileUrl && (
            <a
              href={fileUrl}
              download={fileName}
              className="cursor-pointer flex items-center gap-2 bg-vsc-panel rounded px-3 py-2 text-sm text-vsc-accent hover:opacity-80 border border-vsc-border transition-opacity duration-150"
            >
              <Paperclip size={14} className="shrink-0" />
              {fileName || '파일'}
            </a>
          )}
        </div>
      </div>

      {/* 이미지 라이트박스 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white cursor-pointer"
            aria-label="닫기"
          >
            <X size={28} />
          </button>
          <img
            src={lightboxUrl}
            alt="이미지 미리보기"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
