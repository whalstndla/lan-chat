// src/components/Message.jsx
import React, { useState, useEffect } from 'react'
import { Paperclip, Trash2, X, Clock, Check, CheckCheck, SmilePlus, Pencil } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import MarkdownRenderer from './MarkdownRenderer'
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

// 빠른 이모지 선택 목록
const quickEmojis = ['👍', '❤️', '😂', '🎉', '😮', '😢']

export default function Message({ message, onStartEdit, isHighlighted = false }) {
  const myPeerId = useUserStore(state => state.myPeerId)
  const myProfileImageUrl = useUserStore(state => state.myProfileImageUrl)
  // 리액션 로컬 상태 — 스토어 구독 없이 관리
  const [reactions, setReactions] = useState({})
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
  const [lightboxUrl, setLightboxUrl] = useState(null)

  const sender = message.from || message.from_name
  const contentType = message.contentType || message.content_type
  const fileUrl = message.fileUrl || message.file_url
  const fileName = message.fileName || message.file_name
  const senderId = message.fromId || message.from_id

  // 캐시 URL 폴백 — 원본 URL 로드 실패 시 로컬 캐시로 전환
  const [resolvedFileUrl, setResolvedFileUrl] = useState(fileUrl)
  useEffect(() => { setResolvedFileUrl(fileUrl) }, [fileUrl])

  async function handleFileError() {
    const cachedUrl = await window.electronAPI.getCachedFileUrl(message.id)
    if (cachedUrl) setResolvedFileUrl(cachedUrl)
  }

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
      useChatStore.getState().removeDMMessage(targetPeerId, message.id)
    } else {
      useChatStore.getState().removeGlobalMessage(message.id)
    }
  }

  // 이모지 리액션 토글 — 내 리액션을 추가하거나 제거
  async function handleReaction(emoji) {
    const targetPeerId = (message.type === 'dm')
      ? (isMyMessage ? (message.to || message.to_id) : senderId) : null
    const result = await window.electronAPI.toggleReaction({ messageId: message.id, emoji, targetPeerId })
    // 로컬 리액션 상태 업데이트
    setReactions(prev => {
      const updated = { ...prev }
      const reactors = [...(updated[emoji] || [])]
      if (result.action === 'add' && !reactors.includes(myPeerId)) reactors.push(myPeerId)
      else if (result.action === 'remove') {
        const idx = reactors.indexOf(myPeerId)
        if (idx !== -1) reactors.splice(idx, 1)
      }
      if (reactors.length === 0) delete updated[emoji]
      else updated[emoji] = reactors
      return updated
    })
  }

  return (
    <>
      <div className={`flex gap-3 px-4 py-1.5 hover:bg-vsc-hover group ${isMyMessage ? 'flex-row-reverse' : ''} ${message.pending ? 'opacity-60' : ''} ${isHighlighted ? 'bg-yellow-500/10 border-l-2 border-yellow-400' : ''}`}>
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
            {/* 수정된 메시지 표시 */}
            {message.edited_at && (
              <span className="text-vsc-muted text-xs opacity-70">(수정됨)</span>
            )}
            {message.pending && (
              <Clock size={11} className="text-vsc-muted" title="전송 대기 중" />
            )}
            {/* DM 읽음/안읽음 표시 — 내 메시지에만 */}
            {isMyMessage && !message.pending && message.type === 'dm' && (
              message.read
                ? <CheckCheck size={12} className="text-blue-400" title="읽음" />
                : <Check size={12} className="text-vsc-muted" title="안읽음" />
            )}
            {/* 수정 버튼 — 내 텍스트 메시지에만 표시 */}
            {isMyMessage && !message.pending && (contentType === 'text' || !contentType) && (
              <button
                onClick={() => onStartEdit?.(message)}
                aria-label="메시지 수정"
                title="메시지 수정"
                className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-accent hover:bg-vsc-hover"
              >
                <Pencil size={12} />
              </button>
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
            <div className="select-text bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed break-words max-w-full">
              {message.format === 'markdown' ? (
                <MarkdownRenderer content={message.content} />
              ) : (
                <span className="whitespace-pre-wrap">{parseLinksInText(message.content || '')}</span>
              )}
            </div>
          )}

          {contentType === 'image' && resolvedFileUrl && (
            <div
              className="rounded overflow-hidden border border-vsc-border cursor-pointer"
              onClick={() => setLightboxUrl(resolvedFileUrl)}
            >
              <img
                src={resolvedFileUrl}
                alt={fileName || '이미지'}
                className="max-w-xs max-h-64 object-contain bg-vsc-bg"
                onError={(event) => {
                  if (resolvedFileUrl === fileUrl) handleFileError()
                  else event.target.style.display = 'none'
                }}
              />
            </div>
          )}

          {contentType === 'video' && resolvedFileUrl && (
            <div className="rounded overflow-hidden border border-vsc-border">
              <video
                src={resolvedFileUrl}
                controls
                className="max-w-xs max-h-64"
                onError={() => {
                  if (resolvedFileUrl === fileUrl) handleFileError()
                }}
              />
            </div>
          )}

          {contentType === 'file' && resolvedFileUrl && (
            <a
              href={resolvedFileUrl}
              download={fileName}
              className="cursor-pointer flex items-center gap-2 bg-vsc-panel rounded px-3 py-2 text-sm text-vsc-accent hover:opacity-80 border border-vsc-border transition-opacity duration-150"
            >
              <Paperclip size={14} className="shrink-0" />
              {fileName || '파일'}
            </a>
          )}

          {/* 리액션 표시 + 추가 버튼 */}
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {Object.entries(reactions).map(([emoji, peerIds]) => (
              <button key={emoji} onClick={() => handleReaction(emoji)}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${
                  peerIds.includes(myPeerId)
                    ? 'bg-vsc-accent/20 border-vsc-accent text-vsc-accent'
                    : 'bg-vsc-panel border-vsc-border text-vsc-muted hover:border-vsc-accent'
                }`}>
                <span>{emoji}</span><span>{peerIds.length}</span>
              </button>
            ))}
            <div className="relative group/reaction">
              <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-vsc-muted hover:text-vsc-accent cursor-pointer" aria-label="리액션 추가">
                <SmilePlus size={14} />
              </button>
              <div className="hidden group-hover/reaction:flex absolute bottom-full left-0 mb-1 bg-vsc-sidebar border border-vsc-border rounded-lg shadow-lg p-1 gap-0.5 z-10">
                {quickEmojis.map(e => (
                  <button key={e} onClick={() => handleReaction(e)} className="p-1 hover:bg-vsc-hover rounded cursor-pointer text-sm">{e}</button>
                ))}
              </div>
            </div>
          </div>
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
