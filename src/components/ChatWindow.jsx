// src/components/ChatWindow.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, ChevronDown, Search } from 'lucide-react'
import useChatStore, { getRoomKey } from '../store/useChatStore'
import useUserStore from '../store/useUserStore'
import Message from './Message'
import MessageInput from './MessageInput'
import ChatSearchBar from './chat/ChatSearchBar'
import { getUnreadMessages } from '../utils/unreadDivider'
import { buildMessageRenderItems } from '../utils/buildMessageRenderItems'

const MAX_MESSAGE_PREVIEW_LENGTH = 120
const EMPTY_LIVE_MESSAGE_EVENTS = []

function getScrollBehavior() {
  if (typeof window.matchMedia !== 'function') return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function getMessagePreview(message) {
  const contentType = message.contentType || message.content_type
  let preview = message.content || ''
  if (contentType === 'image') preview = '사진을 보냈습니다'
  if (contentType === 'video') preview = '동영상을 보냈습니다'
  if (contentType === 'file') preview = `파일 · ${message.fileName || message.file_name || '이름 없음'}`
  if (preview.length <= MAX_MESSAGE_PREVIEW_LENGTH) return preview
  return `${preview.slice(0, MAX_MESSAGE_PREVIEW_LENGTH)}…`
}

function getMessagesForRoom(state, room) {
  return room.type === 'global'
    ? state.globalMessages
    : (state.dmMessages[room.peerId] || [])
}

// 검색 히스토리가 도착하기 전에 수신된 메시지를 전체 교체로 잃지 않도록 현재 목록과 병합한다.
// 같은 id 는 현재 메모리의 메시지를 우선해 실시간으로 보강된 필드를 유지한다.
function mergeMessagesById(historyMessages, loadedMessages) {
  const mergedMessages = []
  const messageIndexes = new Map()

  for (const message of [...historyMessages, ...loadedMessages]) {
    if (message?.id && messageIndexes.has(message.id)) {
      mergedMessages[messageIndexes.get(message.id)] = message
      continue
    }
    if (message?.id) messageIndexes.set(message.id, mergedMessages.length)
    mergedMessages.push(message)
  }

  return mergedMessages.sort((firstMessage, secondMessage) => {
    const firstTimestamp = Number(firstMessage?.timestamp)
    const secondTimestamp = Number(secondMessage?.timestamp)
    if (!Number.isFinite(firstTimestamp) || !Number.isFinite(secondTimestamp)) return 0
    return firstTimestamp - secondTimestamp
  })
}

function normalizeSearchHistoryResult(result) {
  if (Array.isArray(result)) return { messages: result, nextMessageId: null }
  return {
    messages: Array.isArray(result?.messages) ? result.messages : [],
    nextMessageId: result?.nextMessageId || null,
  }
}

export default function ChatWindow() {
  const currentRoom = useChatStore(state => state.currentRoom)
  const roomKey = getRoomKey(currentRoom)
  const globalMessages = useChatStore(state => state.globalMessages)
  const dmMessages = useChatStore(state => state.dmMessages)
  const currentLiveMessageEvents = useChatStore(
    state => state.liveMessageEvents[roomKey] || EMPTY_LIVE_MESSAGE_EVENTS
  )
  const chatSessionEpoch = useChatStore(state => state.chatSessionEpoch)
  const typingUsers = useChatStore(state => state.typingUsers)
  const myPeerId = useUserStore(state => state.myPeerId)
  const scrollEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const isNearBottomRef = useRef(true)
  const previousMessagesRef = useRef([])
  const currentRoomKeyRef = useRef(null)
  const messageInputRef = useRef(null)
  const dragCounterRef = useRef(0)
  const loadingMoreRef = useRef(false)
  // prepend와 검색 점프는 같은 목록/스크롤을 변경하므로 하나의 세대로 직렬화한다.
  const messageListRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const roomSessionRef = useRef(0)
  const lastProcessedLiveSequenceRef = useRef(0)
  // 방 진입 후 첫 메시지 로드 시 맨 아래로 스냅 — 이미지/비디오 async 로드로 레이아웃이
  // 커져도 "중간에 멈춤" 현상 방지 (여러 번 재스크롤 + ResizeObserver)
  const pendingInitialScrollRef = useRef(false)
  const initialScrollTimersRef = useRef([])
  const initialScrollGenerationRef = useRef(0)
  const resizeObserverRef = useRef(null)
  // 검색 결과 점프(#36)로 히스토리를 일괄 로드하는 동안, 자동 스크롤 스냅/무한스크롤
  // 트리거가 우리가 계산한 목표 스크롤 위치와 경쟁하지 않도록 억제하는 플래그
  const pendingJumpScrollRef = useRef(false)

  const [newMessageToast, setNewMessageToast] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  // 스크롤이 맨 아래에서 벗어나 있는지(#39 안읽음 점프 버튼 표시 조건) — handleScroll 에서 갱신.
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false)
  // 검색 상태 (로컬 — 스토어 구독 없음)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState(null)
  // 무한 스크롤 상태
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [historyLoadError, setHistoryLoadError] = useState(false)
  // 오래된 검색 결과를 제한된 창으로 불러왔을 때 현재 최신 tail 사이의 생략 구간 경계.
  const [searchHistoryGapAfterId, setSearchHistoryGapAfterId] = useState(null)
  // DB 기반 안읽음 구분선과 별개로, 현재 방에서 사용자가 점프 안내를 확인했는지 관리한다.
  const [isUnreadJumpDismissed, setIsUnreadJumpDismissed] = useState(false)

  const mutedRooms = useChatStore(state => state.mutedRooms)
  const toggleRoomMute = useChatStore(state => state.toggleRoomMute)
  // 북마크(#34) 목록에서 메시지를 열었을 때 스크롤해야 할 대상 — BookmarksPanel 이 설정한다.
  const pendingScrollMessageId = useChatStore(state => state.pendingScrollMessageId)
  // 방별 마지막 읽은 지점(#39) — DB 에 영속되어 재시작 후에도 유지된다.
  const lastReadTimestamps = useChatStore(state => state.lastReadTimestamps)

  const currentMessages = currentRoom.type === 'global'
    ? globalMessages
    : (dmMessages[currentRoom.peerId] || [])

  const isMuted = !!mutedRooms[roomKey]
  const lastReadTimestamp = lastReadTimestamps[roomKey]
  // 안읽음 점프 버튼(#39)용 — 구분선 렌더링과 동일한 순수 함수로 계산해 기준이 어긋나지 않게 한다.
  const unreadMessages = getUnreadMessages(currentMessages, lastReadTimestamp, myPeerId)
  const firstUnreadMessageId = unreadMessages[0]?.id || null

  // 수정 시작 핸들러 — 매 렌더마다 새 함수가 생기면 Message 의 React.memo 가 무력화되므로
  // ref 기반으로 안정화한다(messageInputRef 는 렌더 간 동일 참조라 의존성이 없다).
  const handleStartEdit = useCallback((msg) => messageInputRef.current?.startEdit(msg), [])
  // 답장 시작 핸들러(#28) — handleStartEdit 와 동일한 ref 패턴으로 MessageInput 에 답장 대상 전달.
  const handleStartReply = useCallback((msg) => messageInputRef.current?.startReply(msg), [])

  // 렌더 아이템 목록(날짜/안읽음 구분선 + 연속 이미지 그룹 구조)을 구조가 바뀔 때만 재계산한다.
  // 자주 바뀌는 isHighlighted/searchQuery 는 여기 넣지 않고 렌더 시 각 Message 에 props 로 전달한다.
  const renderItems = useMemo(
    () => buildMessageRenderItems(currentMessages, lastReadTimestamp, myPeerId),
    [currentMessages, lastReadTimestamp, myPeerId]
  )

  const chatTitle = currentRoom.type === 'global'
    ? '전체 채팅'
    : `${currentRoom.nickname} (DM)`

  // typingUsers 는 발신자 peerId 를 키로 저장되며 to 필드로 대상(전체채팅=null, DM=수신자 peerId)을 구분.
  // DM 방에서는 상대가 "나에게" 보낸 typing(to === myPeerId) 인 경우에만 표시해야 한다.
  // 그렇지 않으면 상대가 전체채팅에 입력 중인데도 DM 방에 "입력 중"이 잘못 표시된다.
  const typingUserList = currentRoom.type === 'global'
    ? Object.values(typingUsers).filter(u => u.to === null)
    : (typingUsers[currentRoom.peerId]?.to === myPeerId ? [typingUsers[currentRoom.peerId]] : [])

  function handleScroll() {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const nearBottom = scrollHeight - scrollTop - clientHeight <= 50
    isNearBottomRef.current = nearBottom
    if (nearBottom) {
      setNewMessageToast(null)
      // 방 진입 직후 자동 스냅은 사용자의 확인으로 간주하지 않는다.
      if (!pendingInitialScrollRef.current) setIsUnreadJumpDismissed(true)
    }
    // 안읽음 점프 버튼(#39) 표시 조건 — 맨 아래에 있으면 안읽음 메시지도 이미 화면에 보이므로 숨긴다.
    setIsAwayFromBottom(!nearBottom)

    // 무한 스크롤 — 상단 도달 시 이전 메시지 로드 (검색 결과 점프 로딩 중에는 건너뜀, #36)
    if (
      scrollTop < 50 &&
      !loadingMoreRef.current &&
      hasMore &&
      !historyLoadError &&
      !pendingJumpScrollRef.current
    ) {
      loadOlderMessages()
    }
  }

  async function loadOlderMessages() {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    const requestId = ++messageListRequestRef.current
    const requestRoom = currentRoom
    const requestRoomKey = roomKey
    const requestRoomSession = roomSessionRef.current
    const requestChatSessionEpoch = chatSessionEpoch
    const isCurrentRequest = () => (
      messageListRequestRef.current === requestId &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )
    const isSameRoomSession = () => (
      roomSessionRef.current === requestRoomSession &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )
    setLoadingMore(true)
    setHistoryLoadError(false)
    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0
    const prevScrollTop = container?.scrollTop || 0

    try {
      const PAGE_SIZE = 50
      let older = []
      const oldestMessageId = currentMessages[0]?.id
      if (requestRoom.type === 'global') {
        older = oldestMessageId && typeof window.electronAPI.getGlobalHistoryBeforeMessage === 'function'
          ? await window.electronAPI.getGlobalHistoryBeforeMessage(oldestMessageId, PAGE_SIZE)
          : await window.electronAPI.getGlobalHistory({ limit: PAGE_SIZE, offset: currentMessages.length })
      } else {
        older = oldestMessageId && typeof window.electronAPI.getDMHistoryBeforeMessage === 'function'
          ? await window.electronAPI.getDMHistoryBeforeMessage(requestRoom.peerId, oldestMessageId, PAGE_SIZE)
          : await window.electronAPI.getDMHistory(myPeerId, requestRoom.peerId, PAGE_SIZE, currentMessages.length)
      }
      if (!isCurrentRequest()) return

      if (older.length < PAGE_SIZE) setHasMore(false)
      if (older.length > 0) {
        const { prependGlobalMessages, prependDMMessages } = useChatStore.getState()
        if (requestRoom.type === 'global') {
          prependGlobalMessages(older)
        } else {
          prependDMMessages(requestRoom.peerId, older)
        }

        // 리액션은 별도로 하이드레이션해 실패/지연이 히스토리 로드 잠금을 붙잡지 않게 한다.
        window.electronAPI.getReactions(older.map(m => m.id))
          .then(reactionRows => {
            if (isSameRoomSession()) useChatStore.getState().setReactions(reactionRows)
          })
          .catch(() => { /* 메시지 본문은 이미 로드됐으므로 리액션만 생략 */ })

        // React가 prepend를 커밋한 다음 높이 차이를 반영해 사용자가 보던 위치를 복원한다.
        // 이 프레임까지 잠금을 유지해 다음 페이지 요청이 복원 작업을 앞지르지 않게 한다.
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (container && isCurrentRequest()) {
          container.scrollTop = prevScrollTop + container.scrollHeight - prevScrollHeight
        }
      }
    } catch {
      if (isCurrentRequest()) setHistoryLoadError(true)
    } finally {
      if (isCurrentRequest()) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }

  function scrollToBottom() {
    isNearBottomRef.current = true
    scrollEndRef.current?.scrollIntoView({ behavior: getScrollBehavior() })
    setNewMessageToast(null)
    setIsUnreadJumpDismissed(true)
  }

  // 방 진입 후 첫 메시지 로드 시: 이미지/비디오 async 로딩으로 레이아웃이 커지는 것을
  // 따라잡기 위해 여러 번 즉시 스크롤 + 컨테이너 크기 변화 관찰.
  function snapToBottomInstant() {
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }

  function cancelInitialScrollSnap() {
    initialScrollGenerationRef.current += 1
    initialScrollTimersRef.current.forEach(timer => clearTimeout(timer))
    initialScrollTimersRef.current = []
    pendingInitialScrollRef.current = false
  }

  function runInitialScrollSnap() {
    cancelInitialScrollSnap()
    const scrollGeneration = initialScrollGenerationRef.current
    const isCurrentScrollGeneration = () => (
      initialScrollGenerationRef.current === scrollGeneration
    )
    const snapIfCurrent = () => {
      if (isCurrentScrollGeneration()) snapToBottomInstant()
    }
    pendingInitialScrollRef.current = true
    // 즉시 + 여러 시점 재스크롤 (이미지 로드 타이밍 분산 대응)
    snapToBottomInstant()
    requestAnimationFrame(snapIfCurrent)
    const t1 = setTimeout(snapIfCurrent, 100)
    const t2 = setTimeout(snapIfCurrent, 400)
    const t3 = setTimeout(() => {
      if (!isCurrentScrollGeneration()) return
      snapToBottomInstant()
      // 마지막 프로그램 스크롤 이벤트가 처리된 다음에만 사용자 스크롤 판정을 다시 활성화한다.
      requestAnimationFrame(() => {
        if (!isCurrentScrollGeneration()) return
        requestAnimationFrame(() => {
          if (isCurrentScrollGeneration()) pendingInitialScrollRef.current = false
        })
      })
    }, 1200)
    initialScrollTimersRef.current = [t1, t2, t3]
  }

  function handleDragEnter(event) {
    dragCounterRef.current += 1
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave() {
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  function handleDrop(event) {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const { files } = event.dataTransfer
    if (files && files.length > 0) {
      messageInputRef.current?.handleDroppedFiles(files)
    }
  }

  function handleToggleSearch() {
    if (showSearch) {
      searchRequestRef.current += 1
      setShowSearch(false)
      setSearchQuery('')
      setSearchResults([])
      setIsSearching(false)
      setHighlightedMessageId(null)
    } else {
      setShowSearch(true)
    }
  }

  // 검색 결과 클릭 / 답장 인용 클릭(#28) → 해당 메시지로 스크롤 + 하이라이트.
  // 답장 인용에서 재사용하려고 useCallback 으로 참조를 안정화한다(Message 의 React.memo 유지).
  // 원본이 화면(DOM)에 없으면 조용히 무시 — 과한 히스토리 로드를 하지 않는다(#28 설계 결정).
  const scrollToMessage = useCallback((messageId) => {
    setHighlightedMessageId(messageId)
    // DOM에서 해당 메시지 요소 찾아 스크롤
    requestAnimationFrame(() => {
      const element = messagesContainerRef.current?.querySelector(`[data-message-id="${messageId}"]`)
      if (element) {
        element.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' })
      }
    })
    // 3초 후 하이라이트 제거
    setTimeout(() => setHighlightedMessageId(null), 3000)
  }, [])

  function handleNewMessageToastClick() {
    const messageId = newMessageToast?.messageId
    const latestMessageId = currentMessages.at(-1)?.id
    if (!messageId || messageId === latestMessageId) {
      scrollToBottom()
      return
    }

    // 송신자 시계가 느려 중간에 삽입된 실시간 메시지는 맨 아래가 아닌 실제 메시지로 이동한다.
    setNewMessageToast(null)
    setIsUnreadJumpDismissed(true)
    scrollToMessage(messageId)
  }

  // 검색 결과 클릭 처리(#36) — 이미 화면(DOM)에 로드되어 있으면 바로 스크롤하고,
  // 아직 없는 과거 결과라면 대상 메시지 ID부터 최신까지 원자적으로 불러온 뒤 점프한다.
  async function handleResultClick(result) {
    const messageId = result.id
    // 검색 클릭 자체가 진행 중인 prepend/이전 검색보다 최신 목록 작업이다.
    const requestId = ++messageListRequestRef.current
    const requestRoom = currentRoom
    const requestRoomKey = roomKey
    const requestRoomSession = roomSessionRef.current
    const requestChatSessionEpoch = chatSessionEpoch
    const isCurrentRequest = () => (
      messageListRequestRef.current === requestId &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )
    const isSameRoomSession = () => (
      roomSessionRef.current === requestRoomSession &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )

    pendingJumpScrollRef.current = false
    loadingMoreRef.current = false
    setLoadingMore(false)
    setHistoryLoadError(false)

    const existingElement = messagesContainerRef.current?.querySelector(`[data-message-id="${messageId}"]`)
    if (existingElement) {
      scrollToMessage(messageId)
      return
    }

    loadingMoreRef.current = true
    pendingJumpScrollRef.current = true
    isNearBottomRef.current = false
    setIsAwayFromBottom(true)
    setLoadingMore(true)
    let history = []
    try {
      let fetchedHistory = []
      if (requestRoom.type === 'global') {
        const result = normalizeSearchHistoryResult(
          await window.electronAPI.getGlobalHistoryThroughMessage(messageId)
        )
        if (!isCurrentRequest()) return
        fetchedHistory = result.messages
        if (!fetchedHistory.some(message => message.id === messageId)) throw new Error('searchTargetMissing')
        const loadedMessages = getMessagesForRoom(useChatStore.getState(), requestRoom)
        const loadedMessageIds = new Set(loadedMessages.map(message => message.id))
        setSearchHistoryGapAfterId(
          result.nextMessageId && !loadedMessageIds.has(result.nextMessageId)
            ? fetchedHistory.at(-1)?.id || null
            : null
        )
        history = mergeMessagesById(
          fetchedHistory,
          loadedMessages
        )
        previousMessagesRef.current = history
        useChatStore.getState().setGlobalHistory(history)
      } else {
        const result = normalizeSearchHistoryResult(
          await window.electronAPI.getDMHistoryThroughMessage(requestRoom.peerId, messageId)
        )
        if (!isCurrentRequest()) return
        fetchedHistory = result.messages
        if (!fetchedHistory.some(message => message.id === messageId)) throw new Error('searchTargetMissing')
        const loadedMessages = getMessagesForRoom(useChatStore.getState(), requestRoom)
        const loadedMessageIds = new Set(loadedMessages.map(message => message.id))
        setSearchHistoryGapAfterId(
          result.nextMessageId && !loadedMessageIds.has(result.nextMessageId)
            ? fetchedHistory.at(-1)?.id || null
            : null
        )
        history = mergeMessagesById(
          fetchedHistory,
          loadedMessages
        )
        previousMessagesRef.current = history
        useChatStore.getState().setDMHistory(requestRoom.peerId, history)
      }
      // 대상보다 오래된 메시지가 남아 있을 수 있으므로 상단 페이지네이션을 계속 허용한다.
      setHasMore(true)
      if (history.length > 0) {
        window.electronAPI.getReactions(history.map(m => m.id))
          .then(reactionRows => {
            if (isSameRoomSession()) useChatStore.getState().setReactions(reactionRows)
          })
          .catch(() => { /* 검색 점프는 계속 진행하고 리액션만 생략 */ })
      }
    } catch {
      if (isCurrentRequest()) {
        loadingMoreRef.current = false
        pendingJumpScrollRef.current = false
        setLoadingMore(false)
      }
      return
    }
    if (!isCurrentRequest()) return
    loadingMoreRef.current = false
    setLoadingMore(false)

    // React 커밋 + 브라우저 페인트 이후에 스크롤해야 대상 메시지 DOM 이 실제로 존재한다.
    requestAnimationFrame(() => {
      if (!isCurrentRequest()) return
      requestAnimationFrame(() => {
        if (!isCurrentRequest()) return
        scrollToMessage(messageId)
        // 점프 스크롤 애니메이션이 끝날 때까지 자동 스크롤 로직을 잠시 더 억제
        setTimeout(() => {
          if (isCurrentRequest()) pendingJumpScrollRef.current = false
        }, 500)
      })
    })
  }

  async function handleSearch(query) {
    const requestId = ++searchRequestRef.current
    const requestRoom = currentRoom
    const requestRoomKey = roomKey
    const requestChatSessionEpoch = chatSessionEpoch
    const isCurrentSearch = () => (
      searchRequestRef.current === requestId &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )

    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    try {
      let results = []
      if (requestRoom.type === 'dm') {
        // DM 은 암호화 저장이라 FTS 인덱싱이 불가능 → main 프로세스가 상대와 나눈 전체 기간의
        // DM 을 복호화하며 검색한다(#35). 과거엔 이미 화면에 로드된 메시지만 클라이언트에서
        // 필터링해 스크롤로 불러오지 않은 과거 DM 은 검색되지 않는 비대칭이 있었다.
        results = await window.electronAPI.searchDMMessages({ peerId: requestRoom.peerId, query })
      } else {
        results = await window.electronAPI.searchMessages({ query, type: 'message' })
      }
      if (isCurrentSearch()) setSearchResults(results)
    } catch {
      if (isCurrentSearch()) setSearchResults([])
    }
    if (isCurrentSearch()) setIsSearching(false)
  }

  // 방 진입 시 처리 — 전체채팅·DM 공용(#39). 이 방을 DB 에 영속된 lastRead 기록이 아직
  // 없는 상태로 처음 진입하는 경우에만 현재 마지막 메시지 타임스탬프를 lastRead 로 캡처해
  // 구분선 위치를 정한다(이미 DB 값이 있으면 그 값을 그대로 사용 — 재시작 후 위치 유지).
  // DM 은 추가로 읽음 확인 전송을 수행한다. 히스토리 조회는 목록 요청 세대와 직렬화해 아래에서 처리한다.
  useEffect(() => {
    if (!myPeerId) return
    const key = getRoomKey(currentRoom)

    if (useChatStore.getState().lastReadTimestamps[key] === undefined) {
      const messagesInRoom = currentRoom.type === 'global'
        ? useChatStore.getState().globalMessages
        : (useChatStore.getState().dmMessages[currentRoom.peerId] || [])
      const lastMessage = messagesInRoom[messagesInRoom.length - 1]
      const timestamp = lastMessage ? lastMessage.timestamp : null
      useChatStore.getState().setLastReadTimestamp(key, timestamp)
      window.electronAPI.setRoomReadTimestamp(key, timestamp).catch(() => {})
    }

    useChatStore.getState().resetUnread(key)

    if (currentRoom.type === 'dm') {
      const requestRoomKey = key
      const requestChatSessionEpoch = chatSessionEpoch
      window.electronAPI.getUnreadDMIds(currentRoom.peerId)
        .then(unreadIds => {
          const isSameRoomSession = (
            useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
            getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
          )
          if (isSameRoomSession && unreadIds.length > 0) {
            window.electronAPI.sendReadReceipt(currentRoom.peerId, unreadIds).catch(() => {})
          }
        })
        .catch(() => { /* 읽음 확인 조회 실패는 다음 진입 시 다시 시도 */ })
    }
  }, [currentRoom, myPeerId, chatSessionEpoch])

  // 방 이탈 시 lastRead 갱신 + 영속화(#39) — 과거엔 DM 전용 in-memory ref 였으나, 전체채팅도
  // 동일하게 적용하고 DB(room_read_state)에 저장해 재시작 후에도 구분선 위치가 유지되게 한다.
  useEffect(() => {
    const roomChatSessionEpoch = chatSessionEpoch
    return () => {
      // 전체 삭제/로그아웃으로 세션이 바뀐 뒤에는 이전 방의 읽음 상태를 새 세션에 되살리지 않는다.
      if (useChatStore.getState().chatSessionEpoch !== roomChatSessionEpoch) return
      const key = getRoomKey(currentRoom)
      const messagesInRoom = currentRoom.type === 'global'
        ? useChatStore.getState().globalMessages
        : (useChatStore.getState().dmMessages[currentRoom.peerId] || [])
      const lastMessage = messagesInRoom[messagesInRoom.length - 1]
      const timestamp = lastMessage ? lastMessage.timestamp : null
      useChatStore.getState().setLastReadTimestamp(key, timestamp)
      window.electronAPI.setRoomReadTimestamp(key, timestamp).catch(() => {})
    }
  }, [currentRoom, chatSessionEpoch])

  // 새 메시지 처리 + 초기 로드 시 맨 아래 스냅
  useEffect(() => {
    const isRoomChange = currentRoomKeyRef.current !== roomKey
    const latestLiveSequence = currentLiveMessageEvents.at(-1)?.sequence || 0
    const acknowledgeLiveEvents = () => {
      if (latestLiveSequence > 0) {
        useChatStore.getState().ackLiveMessageEvents(roomKey, latestLiveSequence)
      }
    }

    if (isRoomChange) {
      currentRoomKeyRef.current = roomKey
      previousMessagesRef.current = currentMessages
      // 다른 방에서 이미 도착한 메시지는 입장 시 과거 알림으로 재생하지 않는다.
      lastProcessedLiveSequenceRef.current = latestLiveSequence
      acknowledgeLiveEvents()
      // 방 진입 시점에 이미 메시지가 있으면 즉시 스냅. 비어있으면 아래의 첫 로드 감지 경로에서 처리.
      if (currentMessages.length > 0) {
        runInitialScrollSnap()
      }
      return
    }

    const previousMessages = previousMessagesRef.current
    previousMessagesRef.current = currentMessages

    // 방 진입 후 첫 메시지 로드 (0 → N) 감지 시 맨 아래로 스냅
    if (previousMessages.length === 0 && currentMessages.length > 0) {
      lastProcessedLiveSequenceRef.current = latestLiveSequence
      acknowledgeLiveEvents()
      runInitialScrollSnap()
      return
    }

    const pendingLiveEvents = currentLiveMessageEvents.filter(
      event => event.sequence > lastProcessedLiveSequenceRef.current
    )
    lastProcessedLiveSequenceRef.current = Math.max(
      lastProcessedLiveSequenceRef.current,
      latestLiveSequence
    )
    acknowledgeLiveEvents()
    if (pendingLiveEvents.length === 0) return

    // 메모리 tail 상한을 넘긴 대량 수신도 실제 도착 건수에는 포함되도록 이벤트 전체를 처리한다.
    const appendedMessages = pendingLiveEvents.map(event => event.message)

    const lastMessage = appendedMessages[appendedMessages.length - 1]

    if (isNearBottomRef.current || pendingInitialScrollRef.current) {
      scrollEndRef.current?.scrollIntoView({
        behavior: pendingInitialScrollRef.current ? 'auto' : getScrollBehavior(),
      })
      setNewMessageToast(null)
    } else {
      const isMyMessage = lastMessage.fromId === myPeerId || lastMessage.from_id === myPeerId
      if (isMyMessage) {
        scrollEndRef.current?.scrollIntoView({ behavior: getScrollBehavior() })
        setNewMessageToast(null)
        setIsUnreadJumpDismissed(true)
        return
      }

      const incomingMessages = appendedMessages.filter(message => (
        message.fromId !== myPeerId && message.from_id !== myPeerId
      ))
      if (incomingMessages.length === 0) return

      const latestIncomingMessage = incomingMessages[incomingMessages.length - 1]
      const sender = latestIncomingMessage.from || latestIncomingMessage.from_name || '알 수 없음'
      const preview = getMessagePreview(latestIncomingMessage)
      setNewMessageToast(previousToast => ({
        sender,
        preview,
        messageId: latestIncomingMessage.id,
        count: (previousToast?.count || 0) + incomingMessages.length,
      }))
    }
  }, [currentMessages, currentLiveMessageEvents, roomKey, myPeerId, chatSessionEpoch])

  // 채팅방 변경 시 상태 초기화 (스크롤은 위의 useEffect 에서 메시지 로드 타이밍에 맞춰 처리)
  useEffect(() => {
    roomSessionRef.current += 1
    isNearBottomRef.current = true
    loadingMoreRef.current = false
    messageListRequestRef.current += 1
    searchRequestRef.current += 1
    pendingJumpScrollRef.current = false
    setNewMessageToast(null)
    setHasMore(true)
    setLoadingMore(false)
    setHistoryLoadError(false)
    setSearchHistoryGapAfterId(null)
    setIsAwayFromBottom(false)
    setIsUnreadJumpDismissed(false)
    setSearchQuery('')
    setSearchResults([])
    setIsSearching(false)
    setHighlightedMessageId(null)
  }, [roomKey, chatSessionEpoch])

  // 방/세션 전환과 컴포넌트 해제 시 늦은 목록 응답·스크롤 프레임을 모두 무효화한다.
  useEffect(() => () => {
    messageListRequestRef.current += 1
    searchRequestRef.current += 1
    roomSessionRef.current += 1
    cancelInitialScrollSnap()
  }, [roomKey, chatSessionEpoch])

  // DM 진입 히스토리도 prepend/검색과 같은 목록 요청 세대를 사용한다. 응답 사이에 실시간
  // 메시지가 도착하면 현재 목록과 병합해 전체 교체로 지우지 않는다.
  useEffect(() => {
    if (!myPeerId || currentRoom.type !== 'dm') return

    const requestId = ++messageListRequestRef.current
    const requestRoom = currentRoom
    const requestRoomKey = roomKey
    const requestRoomSession = roomSessionRef.current
    const requestChatSessionEpoch = chatSessionEpoch
    const isCurrentRequest = () => (
      messageListRequestRef.current === requestId &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )
    const isSameRoomSession = () => (
      roomSessionRef.current === requestRoomSession &&
      useChatStore.getState().chatSessionEpoch === requestChatSessionEpoch &&
      getRoomKey(useChatStore.getState().currentRoom) === requestRoomKey
    )

    window.electronAPI.getDMHistory(myPeerId, requestRoom.peerId)
      .then(history => {
        if (!isCurrentRequest()) return
        const mergedHistory = mergeMessagesById(
          history,
          getMessagesForRoom(useChatStore.getState(), requestRoom)
        )
        useChatStore.getState().setDMHistory(requestRoom.peerId, mergedHistory)

        if (history.length > 0) {
          window.electronAPI.getReactions(history.map(message => message.id))
            .then(reactionRows => {
              if (isSameRoomSession()) useChatStore.getState().setReactions(reactionRows)
            })
            .catch(() => { /* 메시지 본문은 유지하고 리액션만 생략 */ })
        }
      })
      .catch(() => { /* 캐시된 DM 목록은 그대로 유지 */ })
  }, [roomKey, myPeerId, chatSessionEpoch])

  // 컨테이너 크기 변화 감지 — 초기 스크롤 snap 기간 동안 이미지/비디오가 로드되어
  // 레이아웃이 커지면 자동으로 아래로 재스크롤. pendingInitialScrollRef 가 false 가 되면 비활성화.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (pendingInitialScrollRef.current) snapToBottomInstant()
    })
    observer.observe(container)
    // 내부 자식들도 관찰 — 이미지 하나하나의 크기 변화까지 캐치
    Array.from(container.querySelectorAll('img, video')).forEach(el => observer.observe(el))
    resizeObserverRef.current = observer
    return () => {
      observer.disconnect()
      resizeObserverRef.current = null
    }
  }, [roomKey])

  // 북마크(#34) 목록에서 메시지를 열었을 때: 이미 화면(DOM)에 로드돼 있으면 스크롤+하이라이트.
  // 방을 막 전환한 직후라 히스토리가 아직 로드 중일 수 있으므로 currentMessages 가 바뀔 때마다
  // 재시도하고, 너무 오래된(아직 무한스크롤로 불러오지 않은) 메시지라면 일정 시간 후 조용히
  // 포기한다 — 기존 검색 점프 로직(#36)의 방/스크롤 레이스 처리는 건드리지 않는 순수 추가 effect.
  useEffect(() => {
    if (!pendingScrollMessageId) return
    const element = messagesContainerRef.current?.querySelector(`[data-message-id="${pendingScrollMessageId}"]`)
    if (element) {
      scrollToMessage(pendingScrollMessageId)
      useChatStore.getState().clearPendingScrollMessageId()
      return
    }
    const timer = setTimeout(() => useChatStore.getState().clearPendingScrollMessageId(), 4000)
    return () => clearTimeout(timer)
  }, [pendingScrollMessageId, currentMessages])

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* 헤더 */}
      <div className="border-b border-vsc-border shrink-0">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
          <div className="flex items-center gap-1">
            {/* 알림 뮤트 토글 버튼 */}
            <button
              onClick={() => {
                toggleRoomMute(roomKey)
                // 토글 직후 main 프로세스에 뮤트 집합을 재동기화 — 소리/OS알림 억제 판정용(#4)
                const updatedMutedRooms = useChatStore.getState().mutedRooms
                window.electronAPI.setMutedRooms(
                  Object.keys(updatedMutedRooms).filter((key) => updatedMutedRooms[key])
                )
              }}
              className="p-2 rounded text-vsc-muted hover:bg-vsc-hover transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent"
              title={isMuted ? '알림 켜기' : '알림 끄기'}
              aria-label="채팅방 알림 음소거"
              aria-pressed={isMuted}
            >
              {isMuted ? <BellOff size={15} /> : <Bell size={15} />}
            </button>
            {/* 메시지 검색 버튼 */}
            <button
              onClick={handleToggleSearch}
              className={`p-2 rounded hover:bg-vsc-hover transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent ${showSearch ? 'text-vsc-accent' : 'text-vsc-muted'}`}
              title="메시지 검색"
              aria-label="메시지 검색"
              aria-expanded={showSearch}
            >
              <Search size={15} />
            </button>
          </div>
        </div>

        {showSearch && (
          <ChatSearchBar
            key={`${roomKey}:${chatSessionEpoch}`}
            searchResults={searchResults}
            isSearching={isSearching}
            onSearch={handleSearch}
            onResultClick={handleResultClick}
            onClose={handleToggleSearch}
          />
        )}
      </div>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-hidden relative">
        {isDragOver && (
          <div className="absolute inset-0 z-40 bg-vsc-bg/80 flex items-center justify-center border-2 border-dashed border-vsc-accent rounded-lg m-2">
            <p className="text-vsc-accent text-sm font-semibold">파일을 여기에 놓으세요</p>
          </div>
        )}
        {/* aria-busy log 내부의 변경은 보조기기가 보류할 수 있어 로딩 상태는 형제 live region으로 알린다. */}
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {loadingMore ? '메시지를 불러오는 중...' : ''}
        </span>
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          role="log"
          aria-label={`${chatTitle} 메시지 목록`}
          aria-live={isAwayFromBottom ? 'off' : 'polite'}
          aria-busy={loadingMore}
          className="h-full overflow-y-auto py-2"
        >
          {currentMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-vsc-muted text-sm">아직 메시지가 없습니다.</p>
            </div>
          ) : (
            <>
            {historyLoadError && (
              <div role="alert" className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-vsc-muted">
                <span>이전 메시지를 불러오지 못했습니다.</span>
                <button
                  onClick={loadOlderMessages}
                  className="rounded px-2 py-1 font-semibold text-vsc-text underline decoration-vsc-accent hover:bg-vsc-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent"
                >
                  다시 시도
                </button>
              </div>
            )}
            {loadingMore && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-vsc-muted">메시지를 불러오는 중...</span>
              </div>
            )}
            {renderItems.map(item => (
              <React.Fragment key={item.message.id}>
                {/* 날짜 구분선: 이전 메시지와 날짜가 다르면 표시 */}
                {item.showDateDivider && (
                  <div className="flex items-center gap-2 px-4 py-2 my-1">
                    <div className="flex-1 border-t border-vsc-border" />
                    <span className="text-xs text-vsc-muted shrink-0">{item.dateLabel}</span>
                    <div className="flex-1 border-t border-vsc-border" />
                  </div>
                )}
                {/* 안읽음 구분선(#39) */}
                {item.showUnreadDivider && (
                  <div className="flex items-center gap-2 px-4 py-1 my-1">
                    <div className="flex-1 border-t border-red-400/50" />
                    <span className="text-xs text-red-400 font-semibold shrink-0">여기서부터 새 메시지</span>
                    <div className="flex-1 border-t border-red-400/50" />
                  </div>
                )}
                <Message
                  message={item.message}
                  onStartEdit={handleStartEdit}
                  onReply={handleStartReply}
                  onQuoteClick={scrollToMessage}
                  isHighlighted={
                    highlightedMessageId === item.message.id ||
                    item.extraImages.some(image => image.id === highlightedMessageId)
                  }
                  isGrouped={item.isGrouped}
                  extraImages={item.extraImages}
                  searchQuery={showSearch ? searchQuery : ''}
                />
                {(item.message.id === searchHistoryGapAfterId ||
                  item.extraImages.some(image => image.id === searchHistoryGapAfterId)) && (
                  <div className="mx-4 my-3 flex items-center justify-center gap-3 rounded border border-vsc-border bg-vsc-panel px-3 py-2 text-xs text-vsc-muted">
                    <span>성능을 위해 중간 메시지는 생략했습니다.</span>
                    <button
                      onClick={scrollToBottom}
                      className="rounded px-2 py-1 font-semibold text-vsc-text hover:bg-vsc-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent"
                    >
                      최근 메시지로 이동
                    </button>
                  </div>
                )}
              </React.Fragment>
            ))}
            </>
          )}

          {typingUserList.length > 0 && (
            <div className="px-4 py-1 flex items-center gap-1.5 text-vsc-muted text-xs">
              <span className="flex gap-0.5 items-end">
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce motion-reduce:animate-none" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce motion-reduce:animate-none" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-vsc-muted animate-bounce motion-reduce:animate-none" style={{ animationDelay: '300ms' }} />
              </span>
              <span>
                {typingUserList.map(user => user.nickname).join(', ')}
                {typingUserList.length === 1 ? '님이 입력 중...' : '님들이 입력 중...'}
              </span>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* 안읽음 점프 버튼(#39) — 구분선이 있는데(=안읽음 존재) 맨 아래에서 벗어나 있을 때만 표시.
            newMessageToast 와 동시에 뜨면 하단 pill 이 겹치므로 그 동안은 숨긴다(순수 추가, 기존
            새 메시지 토스트/scrollToMessage 로직은 그대로 재사용만 한다). */}
        {firstUnreadMessageId && isAwayFromBottom && !isUnreadJumpDismissed && !newMessageToast && (
          <button
            onClick={() => {
              setIsUnreadJumpDismissed(true)
              scrollToMessage(firstUnreadMessageId)
            }}
            aria-label={`첫 번째 새 메시지로 이동, 총 ${unreadMessages.length}개`}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full border border-vsc-accent bg-vsc-sidebar text-vsc-text shadow-lg cursor-pointer hover:bg-vsc-hover transition-colors max-w-[80%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent"
          >
            <ChevronDown size={14} className="shrink-0 text-vsc-accent" />
            <span className="text-xs font-semibold">새 메시지 {unreadMessages.length}개</span>
          </button>
        )}

        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {newMessageToast ? `새 메시지 ${newMessageToast.count}개` : ''}
        </span>

        {newMessageToast && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[80%]">
            <button
              onClick={handleNewMessageToastClick}
              aria-label={`${newMessageToast.count}개의 새 메시지, 최근 메시지 ${newMessageToast.sender}: ${newMessageToast.preview}. 최근 새 메시지로 이동`}
              className="flex w-full items-center gap-2 rounded-full border border-vsc-border bg-vsc-sidebar px-4 py-2 text-vsc-text shadow-lg cursor-pointer hover:bg-vsc-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vsc-accent"
            >
              <ChevronDown size={14} className="shrink-0 text-vsc-accent" />
              <span className="text-xs font-semibold shrink-0">새 메시지 {newMessageToast.count}개</span>
              <span className="text-xs text-vsc-text truncate">
                {newMessageToast.sender}: {newMessageToast.preview}
              </span>
            </button>
          </div>
        )}
      </div>

      <MessageInput ref={messageInputRef} />
    </div>
  )
}
