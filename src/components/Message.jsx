// src/components/Message.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Paperclip, Trash2, X, Clock, Check, CheckCheck, SmilePlus, Pencil, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import LinkPreviewCard from './LinkPreviewCard'
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

// 그룹 내 추가 이미지 썸네일 (캐시 URL 자동 해결)
function ExtraImageThumb({ imageMessage, onClick }) {
  const rawUrl = imageMessage.fileUrl || imageMessage.file_url
  const [url, setUrl] = useState(rawUrl)
  useEffect(() => {
    if (!imageMessage.id) return
    window.electronAPI.getCachedFileUrl(imageMessage.id).then(cached => {
      if (cached) setUrl(cached)
    }).catch(() => {})
  }, [imageMessage.id])
  if (!url) return null
  return (
    <div className="rounded overflow-hidden border border-vsc-border cursor-pointer" onClick={() => onClick(url)}>
      <img src={url} alt={imageMessage.fileName || imageMessage.file_name || '이미지'} className="w-32 h-32 object-cover bg-vsc-bg" onError={(e) => { e.target.style.display = 'none' }} />
    </div>
  )
}

// 텍스트에서 첫 번째 URL 추출
const URL_EXTRACT_PATTERN = /https?:\/\/[^\s]+/
function extractFirstUrl(text) {
  if (!text) return null
  const match = text.match(URL_EXTRACT_PATTERN)
  return match ? match[0] : null
}

export default function Message({ message, onStartEdit, isHighlighted = false, isGrouped = false, extraImages = [] }) {
  const myPeerId = useUserStore(state => state.myPeerId)
  const myProfileImageUrl = useUserStore(state => state.myProfileImageUrl)
  // 리액션 로컬 상태 — 스토어 구독 없이 관리
  const [reactions, setReactions] = useState({})
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [lightboxZoom, setLightboxZoom] = useState(1)
  const [lightboxPos, setLightboxPos] = useState({ x: 0, y: 0 })
  const lightboxDragRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null) // { x, y } 우클릭 메뉴 위치

  const sender = message.from || message.from_name
  const contentType = message.contentType || message.content_type
  const fileUrl = message.fileUrl || message.file_url
  const fileName = message.fileName || message.file_name
  const senderId = message.fromId || message.from_id

  // 텍스트 메시지에서 첫 번째 URL 추출 (링크 프리뷰용)
  const firstUrl = useMemo(() => {
    if (contentType && contentType !== 'text') return null
    return extractFirstUrl(message.content)
  }, [message.content, contentType])

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
    const allMessages = extraImages.length > 0
      ? [message, ...extraImages]
      : [message]
    const confirmText = allMessages.length > 1
      ? `이미지 ${allMessages.length}장을 모두 삭제하시겠습니까?`
      : '이 메시지를 삭제하시겠습니까?'
    if (!window.confirm(confirmText)) return

    // DM 메시지이면 대화 상대 peerId, 전체 채팅이면 null
    const targetPeerId = (message.type === 'dm')
      ? (message.to || message.to_id)
      : null

    for (const msg of allMessages) {
      await window.electronAPI.deleteMessage(msg.id, targetPeerId)
      if (targetPeerId) {
        useChatStore.getState().removeDMMessage(targetPeerId, msg.id)
      } else {
        useChatStore.getState().removeGlobalMessage(msg.id)
      }
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
      <div className={`flex gap-3 px-4 ${isGrouped ? 'py-0.5' : 'py-1.5'} hover:bg-vsc-hover group ${isMyMessage ? 'flex-row-reverse' : ''} ${message.pending ? 'opacity-60' : ''} ${isHighlighted ? 'bg-yellow-500/10 border-l-2 border-yellow-400' : ''}`}>
        {/* 아바타 */}
        {isGrouped ? (
          <div className="w-8 shrink-0" />
        ) : (
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
        )}

        <div className={`flex flex-col max-w-[70%] ${isMyMessage ? 'items-end' : ''}`}>
          {/* 닉네임 + 시간 + pending 아이콘 + 수정/삭제 버튼 */}
          {!isGrouped && (
          <div className={`flex items-baseline gap-2 mb-0.5 ${isMyMessage ? 'flex-row-reverse' : ''}`}>
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
          </div>
          )}

          {/* 메시지 내용 + 리액션 버튼 (말풍선 옆) */}
          <div className={`flex items-center gap-1 ${isMyMessage ? 'flex-row-reverse' : ''}`}>
            {(contentType === 'text' || !contentType) && (
              <div className="select-text bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed break-words min-w-0 overflow-hidden">
                {message.format === 'markdown' ? (
                  <MarkdownRenderer content={message.content} />
                ) : (
                  <span className="whitespace-pre-wrap">{parseLinksInText(message.content || '')}</span>
                )}
              </div>
            )}

            {contentType === 'image' && resolvedFileUrl && (
              <div className="flex flex-wrap gap-1 max-w-md">
                <div
                  className="rounded overflow-hidden border border-vsc-border cursor-pointer"
                  onClick={() => setLightboxUrl(resolvedFileUrl)}
                >
                  <img
                    src={resolvedFileUrl}
                    alt={fileName || '이미지'}
                    className={`object-cover bg-vsc-bg ${extraImages.length > 0 ? 'w-32 h-32' : 'max-w-xs max-h-64 object-contain'}`}
                    onError={(event) => {
                      if (resolvedFileUrl === fileUrl) handleFileError()
                      else event.target.style.display = 'none'
                    }}
                  />
                </div>
                {extraImages.map(extra => (
                  <ExtraImageThumb key={extra.id} imageMessage={extra} onClick={(url) => setLightboxUrl(url)} />
                ))}
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

            {/* 액션 버튼 (말풍선 옆) */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* 수정 버튼 */}
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
              {/* 삭제 버튼 */}
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
              {/* 리액션 추가 버튼 */}
              <div className="relative group/reaction">
                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-vsc-muted hover:text-vsc-accent cursor-pointer" aria-label="리액션 추가">
                  <SmilePlus size={14} />
                </button>
                <div className={`hidden group-hover/reaction:flex absolute bottom-full pb-2 z-10 ${isMyMessage ? 'right-0' : 'left-0'}`}>
                  <div className="flex bg-vsc-sidebar border border-vsc-border rounded-lg shadow-lg p-1 gap-0.5">
                    {quickEmojis.map(e => (
                      <button key={e} onClick={() => handleReaction(e)} className="p-1 hover:bg-vsc-hover rounded cursor-pointer text-sm">{e}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 그룹된 메시지 시간 (액션버튼 반대쪽) */}
            {isGrouped && (
              <span className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {formatTime(message.timestamp)}
              </span>
            )}
          </div>

          {/* 링크 프리뷰 카드 — 텍스트 메시지의 첫 번째 URL만 표시 */}
          {firstUrl && (
            <LinkPreviewCard url={firstUrl} />
          )}

          {/* 리액션 배지 표시 */}
          {Object.keys(reactions).length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
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
            </div>
          )}
        </div>
      </div>

      {/* 이미지 라이트박스 (확대/축소/드래그 지원) */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center overflow-hidden"
          onClick={() => { setLightboxUrl(null); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }); setContextMenu(null) }}
          onWheel={(event) => {
            event.preventDefault()
            setLightboxZoom(prev => Math.min(Math.max(prev + (event.deltaY > 0 ? -0.2 : 0.2), 0.5), 5))
          }}
        >
          <button
            onClick={() => { setLightboxUrl(null); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }) }}
            className="absolute top-4 right-4 text-white/70 hover:text-white cursor-pointer z-10"
            aria-label="닫기"
          >
            <X size={28} />
          </button>
          {/* 확대/축소 컨트롤 */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => setLightboxZoom(prev => Math.max(prev - 0.25, 0.5))}
              disabled={lightboxZoom <= 0.5}
              className="p-1.5 text-white/70 hover:text-white disabled:text-white/30 cursor-pointer disabled:cursor-not-allowed"
              aria-label="축소"
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-white/80 text-xs min-w-[40px] text-center select-none">
              {Math.round(lightboxZoom * 100)}%
            </span>
            <button
              onClick={() => setLightboxZoom(prev => Math.min(prev + 0.25, 5))}
              disabled={lightboxZoom >= 5}
              className="p-1.5 text-white/70 hover:text-white disabled:text-white/30 cursor-pointer disabled:cursor-not-allowed"
              aria-label="확대"
            >
              <ZoomIn size={18} />
            </button>
            {lightboxZoom !== 1 && (
              <button
                onClick={() => { setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }) }}
                className="p-1.5 text-white/70 hover:text-white cursor-pointer ml-0.5"
                aria-label="원래 크기"
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>
          <img
            src={lightboxUrl}
            alt="이미지 미리보기"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded select-none"
            style={{
              transform: `scale(${lightboxZoom}) translate(${lightboxPos.x}px, ${lightboxPos.y}px)`,
              cursor: lightboxZoom > 1 ? 'grab' : 'zoom-in',
              transition: lightboxDragRef.current ? 'none' : 'transform 0.1s ease',
            }}
            draggable={false}
            onClick={(event) => {
              event.stopPropagation()
              setContextMenu(null)
              // 드래그 직후 클릭은 무시
              if (lightboxDragRef.current === 'dragged') { lightboxDragRef.current = null; return }
              if (lightboxZoom === 1) {
                // 클릭 지점으로 2배 확대 — 이미지 중심 기준 오프셋 계산
                const rect = event.currentTarget.getBoundingClientRect()
                const centerX = rect.left + rect.width / 2
                const centerY = rect.top + rect.height / 2
                const targetZoom = 2
                const offsetX = (centerX - event.clientX) / targetZoom
                const offsetY = (centerY - event.clientY) / targetZoom
                setLightboxZoom(targetZoom)
                setLightboxPos({ x: offsetX, y: offsetY })
              } else {
                // 확대 상태에서 클릭 → 원래 크기로 복귀
                setLightboxZoom(1)
                setLightboxPos({ x: 0, y: 0 })
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setContextMenu({ x: event.clientX, y: event.clientY })
            }}
            onMouseDown={(event) => {
              if (lightboxZoom <= 1) return
              event.preventDefault()
              event.stopPropagation()
              const startX = event.clientX
              const startY = event.clientY
              const startPos = { ...lightboxPos }
              lightboxDragRef.current = true

              let dragged = false
              const handleMouseMove = (moveEvent) => {
                dragged = true
                const dx = (moveEvent.clientX - startX) / lightboxZoom
                const dy = (moveEvent.clientY - startY) / lightboxZoom
                setLightboxPos({ x: startPos.x + dx, y: startPos.y + dy })
              }
              const handleMouseUp = () => {
                // 드래그가 실제로 발생했으면 'dragged' 플래그 남김 → onClick에서 줌 토글 방지
                lightboxDragRef.current = dragged ? 'dragged' : null
                window.removeEventListener('mousemove', handleMouseMove)
                window.removeEventListener('mouseup', handleMouseUp)
              }
              window.addEventListener('mousemove', handleMouseMove)
              window.addEventListener('mouseup', handleMouseUp)
            }}
          />
          {/* 우클릭 컨텍스트 메뉴 — 이미지 복사 */}
          {contextMenu && (
            <div
              className="fixed z-[60] bg-vsc-panel border border-vsc-border rounded-md shadow-lg py-1 min-w-[140px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-1.5 text-sm text-vsc-text hover:bg-vsc-hover cursor-pointer"
                onClick={async () => {
                  const success = await window.electronAPI.copyImageToClipboard(lightboxUrl)
                  setContextMenu(null)
                  if (!success) console.warn('이미지 복사 실패')
                }}
              >
                이미지 복사
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
