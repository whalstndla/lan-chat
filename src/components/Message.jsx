// src/components/Message.jsx
import React, { useState, useEffect, useMemo } from 'react'
import { Paperclip, Trash2, Clock, Check, CheckCheck, Bookmark, Pencil, Loader2, Download, FolderOpen, Reply } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import { parseReplyPreview } from '../utils/replyPreview'
import LinkPreviewCard from './LinkPreviewCard'
import MarkdownRenderer from './MarkdownRenderer'
import ImageLightbox from './message/ImageLightbox'
import CopyButton from './message/CopyButton'
import ReactionPicker from './message/ReactionPicker'
import ReactionBadges from './message/ReactionBadges'
import useUserStore from '../store/useUserStore'
import useChatStore from '../store/useChatStore'
import usePeerStore from '../store/usePeerStore'
import useFileDownload from '../hooks/useFileDownload'
import { highlightText } from '../utils/highlightText'

// timestamp → "오후 2:30" 형식
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// timestamp → "2026년 7월 14일 오후 2:30:15" 형식 — hover 시에만 보이던 시간 표시를
// title 속성으로도 제공해(#43) 스크린리더/키보드 사용자도 전체 날짜시간을 확인할 수 있게 한다.
function formatFullDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// 이미지 소스 폴백 체인 — lanchat:// (앱 내부 복호화 채널) 만 사용한다.
// 디스크 파일이 모두 ciphertext 라 file:// 직접 표시는 무용. lanchat:// 는 main
// 프로세스 핸들러가 메모리에서 복호화해 응답하므로 외부 노출 0.
//
// 후보 순서:
//   1) wsFileCachedUrl — file-cached 이벤트 도착 시 cache buster 포함 lanchat:// URL
//      (첫 후보와 다른 string → React 가 새 fetch 강제)
//   2) lanchat://file/<messageId> — 기본 표시 경로 (이미 캐시된 경우 즉시 200)
//
// loadError: main 에서 file-request-error 를 받으면 'failed' 로 즉시 전환 → spinner 무한 대기 방지.
function useImageSrcWithFallback(messageId, _httpUrl, wsFileCachedUrl, loadError) {
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState('loading') // 'loading' | 'loaded' | 'failed'

  const candidates = useMemo(() => {
    const list = []
    if (messageId) list.push(`lanchat://file/${encodeURIComponent(messageId)}`)
    if (wsFileCachedUrl && !list.includes(wsFileCachedUrl)) list.push(wsFileCachedUrl)
    return list
  }, [messageId, wsFileCachedUrl])

  // 후보 배열이 바뀌면 인덱스/상태 초기화 (앞쪽에 더 우선순위 높은 후보가 추가되었을 수 있음).
  // 단, 이미 loaded 상태에서 wsFileCachedUrl 이 추가되더라도 (정상 표시 중) 강제 재로드 하지 않음.
  useEffect(() => {
    setIndex(0)
    setStatus(candidates.length > 0 ? 'loading' : 'failed')
  }, [candidates])

  // 송신측에서 명시적 실패 통보를 받으면 spinner → failed 로 즉시 전환.
  useEffect(() => {
    if (loadError && status !== 'loaded') {
      setStatus('failed')
    }
  }, [loadError, status])

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
  const loadError = useChatStore(state => state.fileLoadErrors[imageMessage.id])
  const { src, status, onLoad, onError } = useImageSrcWithFallback(imageMessage.id, rawUrl, wsFileCachedUrl, loadError)

  if (!src && status !== 'failed') return null
  return (
    <div className="relative rounded overflow-hidden border border-vsc-border w-32 h-32 bg-vsc-bg" onClick={() => status === 'loaded' && onClick(src, imageMessage.id)}>
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
          loading="lazy"
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

// 북마크 목록(#34)에 표시할 미리보기 문자열 계산 — 첨부 타입은 텍스트 대신 안내 문구.
const BOOKMARK_PREVIEW_MAX_LENGTH = 100
function getBookmarkPreview(message, contentType, fileName) {
  if (contentType === 'image') return '사진'
  if (contentType === 'video') return '동영상'
  if (contentType === 'file') return `📎 ${fileName || '파일'}`
  const content = message.content || ''
  return content.length > BOOKMARK_PREVIEW_MAX_LENGTH
    ? `${content.slice(0, BOOKMARK_PREVIEW_MAX_LENGTH)}…`
    : content
}

function Message({ message, onStartEdit, onReply, onQuoteClick, isHighlighted = false, isGrouped = false, extraImages = [], searchQuery = '' }) {
  const myPeerId = useUserStore(state => state.myPeerId)
  const myProfileImageUrl = useUserStore(state => state.myProfileImageUrl)
  // 리액션 — 스토어의 reactions 맵을 구독 (하이드레이션 + 실시간 갱신 반영)
  const reactions = useChatStore(state => state.reactions[message.id]) || {}
  // 북마크(#34) 여부 — 스토어의 bookmarks 맵을 구독
  const isBookmarked = useChatStore(state => !!state.bookmarks[message.id])
  const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
  const senderId = message.fromId || message.from_id
  // 발신자 아바타 URL — onlinePeers 배열 전체가 아니라 "이 발신자의 프로필 이미지 URL"(primitive)만
  // 좁게 구독한다. 이렇게 하면 무관한 피어 한 명의 상태 변화에 모든 메시지가 리렌더되던 문제가
  // 사라지고, React.memo 와 결합해 실제로 이 발신자의 아바타가 바뀔 때만 리렌더된다.
  const senderProfileImageUrl = usePeerStore(state =>
    isMyMessage ? null : state.onlinePeers.find(p => p.peerId === senderId)?.profileImageUrl
  )
  const [lightboxData, setLightboxData] = useState(null) // { url, messageId }
  const { downloadFile, savedPath, revealInFolder } = useFileDownload()

  const sender = message.from || message.from_name
  const contentType = message.contentType || message.content_type
  const fileUrl = message.fileUrl || message.file_url
  const fileName = message.fileName || message.file_name

  // 답장(#28) — 원본 messageId + 비정규화 인용 스냅샷. 라이브(camelCase)/DB(snake_case,
  // reply_preview 는 JSON 문자열) 양쪽 경로를 모두 허용한다. 필드가 없으면 인용 미표시(하위호환).
  const replyToId = message.replyToId || message.reply_to_id || null
  const replyPreview = useMemo(
    () => parseReplyPreview(message.replyPreview ?? message.reply_preview),
    [message.replyPreview, message.reply_preview]
  )

  // 텍스트 메시지에서 첫 번째 URL 추출 (링크 프리뷰용)
  const firstUrl = useMemo(() => {
    if (contentType && contentType !== 'text') return null
    return extractFirstUrl(message.content)
  }, [message.content, contentType])

  // 이미지/비디오 URL — 폴백 체인 (ws 캐시 → DB 캐시 → HTTP 원본) 관리
  const wsFileCachedUrl = useChatStore(state => state.cachedFileUrls[message.id])
  const loadError = useChatStore(state => state.fileLoadErrors[message.id])
  const { src: resolvedFileUrl, status: imgStatus, onLoad: onImgLoad, onError: onImgError } =
    useImageSrcWithFallback(message.id, fileUrl, wsFileCachedUrl, loadError)

  // 발신자 아바타 URL 계산 — 내 메시지는 내 프로필, 상대는 위에서 좁게 구독한 프로필 URL 사용
  const avatarUrl = isMyMessage ? myProfileImageUrl : senderProfileImageUrl

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

  // 이모지 리액션 토글 — 내 리액션을 추가하거나 제거. 결과는 스토어에 직접 반영
  // (상대방의 리액션은 onReactionUpdated 구독을 통해 별도로 스토어에 반영됨)
  async function handleReaction(emoji) {
    const targetPeerId = (message.type === 'dm')
      ? (isMyMessage ? (message.to || message.to_id) : senderId) : null
    const result = await window.electronAPI.toggleReaction({ messageId: message.id, emoji, targetPeerId })
    useChatStore.getState().updateReaction(message.id, emoji, myPeerId, result.action)
  }

  // 북마크 토글(#34) — 피어 전파 없이 이 기기에만 로컬로 저장. roomKey 는 북마크 목록에서
  // "어느 방의 메시지인지" 표시/이동에 사용된다(전체 채팅은 'global', DM 은 상대 peerId).
  function handleToggleBookmark() {
    const roomKey = (message.type === 'dm')
      ? (isMyMessage ? (message.to || message.to_id) : senderId)
      : 'global'
    const preview = getBookmarkPreview(message, contentType, fileName)
    useChatStore.getState().toggleBookmark(message.id, roomKey, preview)
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
            <span
              className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
              title={formatFullDateTime(message.timestamp)}
            >
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

          {/* 답장 인용 블록(#28) — reply_to_id 가 있으면 말풍선 위에 원본 발신자+스니펫 표시.
              클릭 시 원본이 화면(DOM)에 있으면 스크롤+하이라이트, 없으면 조용히 무시(ChatWindow). */}
          {replyToId && replyPreview && (
            <button
              type="button"
              onClick={() => onQuoteClick?.(replyToId)}
              title="원본 메시지로 이동"
              className={`flex flex-col gap-0.5 mb-1 max-w-full text-left border-l-2 border-vsc-accent bg-vsc-panel/60 rounded px-2 py-1 hover:bg-vsc-hover cursor-pointer transition-colors ${isMyMessage ? 'items-end' : 'items-start'}`}
            >
              <span className="text-xs font-semibold text-vsc-accent truncate max-w-full">
                {replyPreview.fromName}
              </span>
              <span className="text-xs text-vsc-muted truncate max-w-full">
                {replyPreview.snippet || '내용 없음'}
              </span>
            </button>
          )}

          {/* 메시지 내용 + 리액션 버튼 (말풍선 옆) */}
          <div className={`flex items-center gap-1 ${isMyMessage ? 'flex-row-reverse' : ''}`}>
            {/* 복호화 실패 메시지 — 키 교환 이전에 보내졌거나 손상된 DM. 빈 말풍선 대신 안내 표시 */}
            {message.decryptionFailed && (
              <div className="select-text bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-muted italic leading-relaxed break-words min-w-0 overflow-hidden">
                🔒 복호화할 수 없는 메시지
              </div>
            )}

            {!message.decryptionFailed && (contentType === 'text' || !contentType) && (
              <div className="select-text bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed break-words min-w-0 overflow-hidden">
                {message.format === 'markdown' ? (
                  <MarkdownRenderer content={message.content} />
                ) : (
                  <span className="whitespace-pre-wrap">
                    {searchQuery.trim()
                      // 검색 중에는 검색어 하이라이트를 우선한다(#37) — 링크 파싱과 동시에
                      // 적용하려면 별도 처리가 필요해, 검색 바가 열려있는 동안에는 텍스트
                      // 안의 링크가 일시적으로 클릭 불가능해지는 단순한 트레이드오프를 택했다.
                      ? highlightText(message.content || '', searchQuery)
                      : parseLinksInText(message.content || '')}
                  </span>
                )}
              </div>
            )}

            {!message.decryptionFailed && contentType === 'image' && (resolvedFileUrl || imgStatus === 'failed') && (
              <div className="flex flex-wrap gap-1 max-w-md">
                <div
                  className={`relative rounded overflow-hidden border border-vsc-border bg-vsc-bg ${imgStatus === 'loaded' ? 'cursor-pointer' : ''} ${extraImages.length > 0 ? 'w-32 h-32' : 'min-w-[128px] min-h-[96px]'}`}
                  onClick={() => imgStatus === 'loaded' && setLightboxData({ url: resolvedFileUrl, messageId: message.id })}
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
                      loading="lazy"
                      onLoad={onImgLoad}
                      onError={onImgError}
                    />
                  )}
                </div>
                {extraImages.map(extra => (
                  <ExtraImageThumb key={extra.id} imageMessage={extra} onClick={(url, messageId) => setLightboxData({ url, messageId })} />
                ))}
              </div>
            )}

            {!message.decryptionFailed && contentType === 'video' && resolvedFileUrl && (
              <div className="relative rounded overflow-hidden border border-vsc-border group/video">
                <video
                  src={resolvedFileUrl}
                  controls
                  preload="metadata"
                  className="max-w-xs max-h-64"
                  onError={onImgError}
                />
                <button
                  onClick={() => downloadFile(message.id)}
                  aria-label="비디오 저장"
                  title="비디오 저장"
                  className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover/video:opacity-100 transition-opacity cursor-pointer"
                >
                  <Download size={14} />
                </button>
              </div>
            )}

            {!message.decryptionFailed && contentType === 'file' && resolvedFileUrl && (
              <button
                onClick={() => downloadFile(message.id)}
                className="cursor-pointer flex items-center gap-2 bg-vsc-panel rounded px-3 py-2 text-sm text-vsc-accent hover:opacity-80 border border-vsc-border transition-opacity duration-150"
              >
                <Paperclip size={14} className="shrink-0" />
                {searchQuery.trim() ? highlightText(fileName || '파일', searchQuery) : (fileName || '파일')}
              </button>
            )}

            {/* 액션 버튼 (말풍선 옆) */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* 답장 버튼(#28) — 복호화 실패가 아닌 모든 메시지(내/상대)에 대해 답장 가능.
                  클릭 시 부모(ChatWindow→MessageInput)로 답장 대상 전달. */}
              {!message.decryptionFailed && (
                <button
                  onClick={() => onReply?.(message)}
                  aria-label="답장"
                  title="답장"
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-accent hover:bg-vsc-hover"
                >
                  <Reply size={12} />
                </button>
              )}
              {/* 메시지 복사 버튼 — 텍스트 메시지의 마크다운 원문을 클립보드로 복사 */}
              {!message.decryptionFailed && (contentType === 'text' || !contentType) && (
                <CopyButton
                  getText={() => message.content || ''}
                  title="메시지 복사"
                  copiedTitle="복사됨"
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-accent hover:bg-vsc-hover"
                />
              )}
              {/* 수정 버튼 */}
              {isMyMessage && !message.pending && (contentType === 'text' || !contentType) && (
                <button
                  onClick={() => onStartEdit?.(message)}
                  aria-label="메시지 수정"
                  title="메시지 수정"
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-accent hover:bg-vsc-hover"
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
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-red-400 hover:bg-vsc-hover"
                >
                  <Trash2 size={12} />
                </button>
              )}
              {/* 북마크 토글 버튼(#34) — 로컬 전용, 활성 시 채워진 아이콘으로 표시 */}
              {!message.decryptionFailed && (
                <button
                  onClick={handleToggleBookmark}
                  aria-label={isBookmarked ? '북마크 해제' : '북마크'}
                  title={isBookmarked ? '북마크 해제' : '북마크'}
                  className={`p-0.5 rounded cursor-pointer transition-opacity hover:bg-vsc-hover ${
                    isBookmarked
                      ? 'opacity-100 text-vsc-accent'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-vsc-muted hover:text-vsc-accent'
                  }`}
                >
                  <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
                </button>
              )}
              {/* 리액션 추가 버튼 — 퀵 이모지 + 더보기(전체 피커, #38) */}
              <ReactionPicker onSelect={handleReaction} alignRight={isMyMessage} />
            </div>

            {/* 그룹된 메시지 시간 (액션버튼 반대쪽) */}
            {isGrouped && (
              <span
                className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0"
                title={formatFullDateTime(message.timestamp)}
              >
                {formatTime(message.timestamp)}
              </span>
            )}
          </div>

          {/* 링크 프리뷰 카드 — 텍스트 메시지의 첫 번째 URL만 표시 */}
          {firstUrl && (
            <LinkPreviewCard url={firstUrl} />
          )}

          {/* 리액션 배지 표시 — hover 시 반응자 닉네임 툴팁(#38). onlinePeers/pastDMPeers 구독은
              ReactionBadges 안으로 이동해, 리액션이 있는 메시지에서만 피어 상태를 구독한다. */}
          {Object.keys(reactions).length > 0 && (
            <ReactionBadges reactions={reactions} myPeerId={myPeerId} onReact={handleReaction} />
          )}

          {/* 다운로드 저장 완료 안내 — 클릭 시 폴더에서 보기 */}
          {savedPath && (
            <button
              onClick={revealInFolder}
              className="mt-0.5 flex items-center gap-1 text-xs text-vsc-accent hover:underline cursor-pointer"
            >
              <FolderOpen size={11} />
              저장됨 · 폴더에서 보기
            </button>
          )}
        </div>
      </div>

      {lightboxData && (
        <ImageLightbox
          url={lightboxData.url}
          messageId={lightboxData.messageId}
          onClose={() => setLightboxData(null)}
        />
      )}
    </>
  )
}

// React.memo — ChatWindow 가 넘기는 props(message/onStartEdit/onReply/onQuoteClick/
// isHighlighted/isGrouped/extraImages/searchQuery)가 얕은 비교로 동일하면 부모 리렌더 시에도
// 다시 그리지 않는다. onStartEdit/onReply/onQuoteClick 는 useCallback, extraImages 는 구조
// memo(빈 배열은 공유 상수)로 참조가 안정화돼 있어 새 메시지 도착/무관한 피어 변화 시 기존
// 메시지들이 리렌더되지 않는다.
export default React.memo(Message)
