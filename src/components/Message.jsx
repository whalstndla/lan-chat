// src/components/Message.jsx
import React, { useState, useEffect, useMemo } from 'react'
import { Paperclip, Trash2, Clock, Check, CheckCheck, SmilePlus, Pencil, Loader2 } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import LinkPreviewCard from './LinkPreviewCard'
import MarkdownRenderer from './MarkdownRenderer'
import ImageLightbox from './message/ImageLightbox'
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

// 이미지 소스 폴백 체인 — ws 캐시 → DB 캐시 → HTTP 원본 순으로 후보를 만들고
// 현재 후보가 onError 일 때 다음으로 넘어간다.
// 후보 배열 + 인덱스 방식이라 무한 루프나 race condition 이 발생하지 않는다.
function useImageSrcWithFallback(messageId, httpUrl, wsFileCachedUrl) {
  const [dbCachedUrl, setDbCachedUrl] = useState(null)
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState('loading') // 'loading' | 'loaded' | 'failed'

  // 마운트 / 메시지 변경 시 DB 캐시 선조회. wsFileCachedUrl 이 이미 있으면 생략.
  useEffect(() => {
    if (!messageId || wsFileCachedUrl) { setDbCachedUrl(null); return }
    let cancelled = false
    window.electronAPI.getCachedFileUrl(messageId)
      .then(cached => { if (!cancelled) setDbCachedUrl(cached || null) })
      .catch(() => { if (!cancelled) setDbCachedUrl(null) })
    return () => { cancelled = true }
  }, [messageId, wsFileCachedUrl])

  // 후보 배열 — 빈 값은 제거, 중복 제거. 순서: ws 캐시 → DB 캐시 → HTTP 원본.
  const candidates = useMemo(() => {
    const list = []
    if (wsFileCachedUrl) list.push(wsFileCachedUrl)
    if (dbCachedUrl && !list.includes(dbCachedUrl)) list.push(dbCachedUrl)
    if (httpUrl && !list.includes(httpUrl)) list.push(httpUrl)
    return list
  }, [wsFileCachedUrl, dbCachedUrl, httpUrl])

  // 후보 배열이 바뀌면 인덱스/상태 초기화 (앞쪽에 더 우선순위 높은 후보가 추가되었을 수 있음)
  useEffect(() => {
    setIndex(0)
    setStatus(candidates.length > 0 ? 'loading' : 'failed')
  }, [candidates])

  const src = candidates[index] || null
  const onLoad = () => setStatus('loaded')
  const onError = () => {
    if (index + 1 < candidates.length) {
      setIndex(index + 1)
      setStatus('loading')
    } else {
      setStatus('failed')
    }
  }

  return { src, status, onLoad, onError }
}

// 그룹 내 추가 이미지 썸네일 — 폴백 체인 + 로딩/실패 상태 표시
function ExtraImageThumb({ imageMessage, onClick }) {
  const rawUrl = imageMessage.fileUrl || imageMessage.file_url
  const wsFileCachedUrl = useChatStore(state => state.cachedFileUrls[imageMessage.id])
  const { src, status, onLoad, onError } = useImageSrcWithFallback(imageMessage.id, rawUrl, wsFileCachedUrl)

  if (!src && status !== 'failed') return null
  return (
    <div className="relative rounded overflow-hidden border border-vsc-border w-32 h-32 bg-vsc-bg" onClick={() => status === 'loaded' && onClick(src)}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-vsc-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
      {status === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center text-vsc-muted text-[10px] text-center px-1">
          이미지<br />불러오기 실패
        </div>
      )}
      {status !== 'failed' && src && (
        <img
          src={src}
          alt={imageMessage.fileName || imageMessage.file_name || '이미지'}
          className={`w-32 h-32 object-cover ${status === 'loaded' ? 'block cursor-pointer' : 'invisible'}`}
          onLoad={onLoad}
          onError={onError}
        />
      )}
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

  // 이미지/비디오 URL — 폴백 체인 (ws 캐시 → DB 캐시 → HTTP 원본) 관리
  const wsFileCachedUrl = useChatStore(state => state.cachedFileUrls[message.id])
  const { src: resolvedFileUrl, status: imgStatus, onLoad: onImgLoad, onError: onImgError } =
    useImageSrcWithFallback(message.id, fileUrl, wsFileCachedUrl)

  // 발신자 아바타 URL 계산
  const senderPeer = onlinePeers.find(p => p.peerId === senderId)
  const avatarUrl = isMyMessage ? myProfileImageUrl : senderPeer?.profileImageUrl

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
      <div
        data-message-id={message.id}
        className={`flex gap-3 px-4 ${isGrouped ? 'py-0.5' : 'py-1.5'} hover:bg-vsc-hover group ${isMyMessage ? 'flex-row-reverse' : ''} ${message.pending ? 'opacity-60' : ''} ${isHighlighted ? 'bg-yellow-500/10 border-l-2 border-yellow-400 transition-colors duration-300' : 'transition-colors duration-300'}`}
      >
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

            {contentType === 'image' && (resolvedFileUrl || imgStatus === 'failed') && (
              <div className="flex flex-wrap gap-1 max-w-md">
                <div
                  className={`relative rounded overflow-hidden border border-vsc-border bg-vsc-bg ${imgStatus === 'loaded' ? 'cursor-pointer' : ''} ${extraImages.length > 0 ? 'w-32 h-32' : 'min-w-[128px] min-h-[96px]'}`}
                  onClick={() => imgStatus === 'loaded' && setLightboxUrl(resolvedFileUrl)}
                >
                  {imgStatus === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center text-vsc-muted">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  )}
                  {imgStatus === 'failed' && (
                    <div className="flex items-center justify-center text-vsc-muted text-xs p-4 w-32 h-32">
                      이미지 불러오기 실패
                    </div>
                  )}
                  {imgStatus !== 'failed' && resolvedFileUrl && (
                    <img
                      src={resolvedFileUrl}
                      alt={fileName || '이미지'}
                      className={`${extraImages.length > 0 ? 'w-32 h-32 object-cover' : 'max-w-xs max-h-64 object-contain'} ${imgStatus === 'loaded' ? 'block' : 'invisible'}`}
                      onLoad={onImgLoad}
                      onError={onImgError}
                    />
                  )}
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
                  onError={onImgError}
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

      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </>
  )
}
