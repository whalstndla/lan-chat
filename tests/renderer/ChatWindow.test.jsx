import { act, fireEvent, render, screen } from '@testing-library/react'
import ChatWindow from '../../src/components/ChatWindow'
import useChatStore from '../../src/store/useChatStore'
import useUserStore from '../../src/store/useUserStore'

// 이 테스트는 ChatWindow 의 스크롤/메시지 판정만 검증하므로 무거운 자식 컴포넌트는 최소 UI로 대체한다.
jest.mock('../../src/components/Message', () => ({
  __esModule: true,
  default: ({ message, extraImages = [], isHighlighted }) => (
    <div data-message-id={message.id} data-highlighted={isHighlighted ? 'true' : 'false'}>
      {message.content}
      {extraImages.map(image => (
        <span key={image.id} data-message-id={image.id}>{image.content}</span>
      ))}
    </div>
  ),
}))

jest.mock('../../src/components/MessageInput', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function MockMessageInput() {
      return <div data-testid="message-input" />
    }),
  }
})

jest.mock('../../src/components/chat/ChatSearchBar', () => ({
  __esModule: true,
  default: ({ onResultClick, onSearch, onClose, searchResults, isSearching }) => (
    <div>
      <button onClick={() => onResultClick({ id: 'search-target', timestamp: 1000 })}>
        검색 결과 열기
      </button>
      <button onClick={() => onSearch('첫 검색')}>첫 검색 실행</button>
      <button onClick={() => onSearch('두 번째 검색')}>두 번째 검색 실행</button>
      <button onClick={onClose}>검색 닫기</button>
      <span data-testid="search-state">
        {isSearching ? '검색 중' : searchResults.map(result => result.content).join(',')}
      </span>
    </div>
  ),
}))

describe('ChatWindow', () => {
  let originalRequestAnimationFrame
  let originalScrollIntoView
  let scrollIntoViewMock

  beforeEach(() => {
    jest.useFakeTimers()
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    scrollIntoViewMock = jest.fn()
    window.requestAnimationFrame = (callback) => {
      callback()
      return 1
    }
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

    window.electronAPI = {
      setRoomReadTimestamp: jest.fn().mockResolvedValue(undefined),
      getReactions: jest.fn().mockResolvedValue([]),
      getGlobalHistoryThroughMessage: jest.fn().mockResolvedValue([]),
      getDMHistoryThroughMessage: jest.fn().mockResolvedValue([]),
    }

    useChatStore.getState().resetAll()
    useUserStore.getState().reset()
    useUserStore.getState().initialize('my-peer', '나', null)
    useChatStore.getState().setGlobalHistory([
      {
        id: 'latest-message',
        content: '이미 있던 최신 메시지',
        timestamp: 2000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
    ])
  })

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers()
    })
    window.requestAnimationFrame = originalRequestAnimationFrame
    if (originalScrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      delete window.HTMLElement.prototype.scrollIntoView
    }
    jest.useRealTimers()
  })

  function moveAwayFromBottom() {
    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    fireEvent.scroll(messageLog)
  }

  it('하단에서 벗어난 상태에서 과거 메시지를 prepend해도 새 메시지 토스트를 표시하지 않는다', () => {
    render(<ChatWindow />)

    // 방 진입 직후의 초기 하단 스냅 보호 시간이 끝난 뒤 사용자가 위로 스크롤한 상황을 만든다.
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    moveAwayFromBottom()

    act(() => {
      useChatStore.getState().prependGlobalMessages([
        {
          id: 'older-message',
          content: '과거 메시지',
          timestamp: 1000,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
      ])
    })

    expect(screen.getByText('과거 메시지')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /상대방.*이미 있던 최신 메시지/ })
    ).not.toBeInTheDocument()
  })

  it('이전 페이지는 OFFSET 대신 현재 최상단 메시지 ID를 커서로 조회한다', async () => {
    window.electronAPI.getGlobalHistoryBeforeMessage = jest.fn().mockResolvedValue([{
      id: 'cursor-older-message',
      content: '커서로 불러온 과거 메시지',
      timestamp: 1000,
      fromId: 'other-peer',
      from: '상대방',
      type: 'global',
    }])

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.electronAPI.getGlobalHistoryBeforeMessage).toHaveBeenCalledWith('latest-message', 50)
    expect(screen.getByText('커서로 불러온 과거 메시지')).toBeInTheDocument()
  })

  it('송신자 시계가 느려 중간 삽입된 실시간 메시지도 안내하고 해당 메시지로 이동한다', () => {
    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'delayed-middle-message',
        content: '늦게 도착한 과거 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })

    expect(screen.getByText('늦게 도착한 과거 메시지')).toBeInTheDocument()
    const toastButton = screen.getByRole('button', {
      name: /1개의 새 메시지, 최근 메시지 상대방: 늦게 도착한 과거 메시지/,
    })
    fireEvent.click(toastButton)

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(screen.queryByRole('button', { name: /개의 새 메시지, 최근 메시지/ })).not.toBeInTheDocument()
  })

  it('deferred 과거 재전송은 새 메시지 토스트에 포함하지 않는다', () => {
    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'deferred-message',
        content: '오프라인 과거 재전송',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
        deferred: true,
      })
    })

    expect(screen.getByText('오프라인 과거 재전송')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /개의 새 메시지, 최근 메시지/ })).not.toBeInTheDocument()
  })

  it('하단에서 벗어난 동안 실제로 도착한 새 메시지 수와 최신 미리보기를 누적한다', () => {
    render(<ChatWindow />)

    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'new-message-1',
        content: '첫 번째 새 메시지',
        timestamp: 3000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })
    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'new-message-2',
        content: '두 번째 새 메시지',
        timestamp: 4000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })

    expect(screen.getByText('새 메시지 2개', { selector: 'span[role="status"]' })).toBeInTheDocument()
    expect(screen.getByText('상대방: 두 번째 새 메시지')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2개의 새 메시지/ })).toBeInTheDocument()
  })

  it('한 렌더 사이에 메시지 tail 상한을 넘는 새 메시지가 도착해도 개수와 순서를 모두 보존한다', () => {
    render(<ChatWindow />)

    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()

    act(() => {
      for (let messageIndex = 1; messageIndex <= 501; messageIndex += 1) {
        useChatStore.getState().addGlobalMessage({
          id: `batched-message-${messageIndex}`,
          content: `배치 메시지 ${messageIndex}`,
          timestamp: 2000 + messageIndex,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        })
      }
    })

    expect(screen.getByText('새 메시지 501개', { selector: 'span[role="status"]' })).toBeInTheDocument()
    expect(screen.getByText('상대방: 배치 메시지 501')).toBeInTheDocument()
    expect(useChatStore.getState().globalMessages).toHaveLength(500)
    expect(useChatStore.getState().liveMessageEvents.global).toBeUndefined()
  })

  it('안읽음 점프 안내를 확인한 뒤 다시 위로 스크롤해도 같은 안내를 반복 표시하지 않는다', () => {
    useChatStore.getState().setLastReadTimestamp('global', 1000)
    render(<ChatWindow />)

    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()

    const unreadJumpButton = screen.getByRole('button', {
      name: '첫 번째 새 메시지로 이동, 총 1개',
    })
    fireEvent.click(unreadJumpButton)
    act(() => {
      useChatStore.getState().setCurrentRoom({ type: 'global' })
    })
    act(() => {
      useChatStore.getState().setLastReadTimestamp('global', 1000)
    })
    moveAwayFromBottom()

    expect(screen.queryByRole('button', {
      name: '첫 번째 새 메시지로 이동, 총 1개',
    })).not.toBeInTheDocument()
  })

  it('초기 스냅 도중 메시지가 추가돼도 이후 하단 이탈 상태의 새 메시지를 놓치지 않는다', () => {
    render(<ChatWindow />)

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'during-initial-snap',
        content: '초기 스냅 중 메시지',
        timestamp: 3000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()
    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'after-leaving-bottom',
        content: '하단 이탈 후 메시지',
        timestamp: 4000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })

    expect(screen.getByText('상대방: 하단 이탈 후 메시지')).toBeInTheDocument()
  })

  it('이전 메시지 로드 실패를 알리고 사용자가 다시 시도할 수 있다', async () => {
    window.electronAPI.getGlobalHistory = jest.fn()
      .mockRejectedValueOnce(new Error('history failed'))
      .mockResolvedValueOnce([])

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })

    await act(async () => {
      fireEvent.scroll(messageLog)
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('이전 메시지를 불러오지 못했습니다.')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      await Promise.resolve()
    })

    expect(window.electronAPI.getGlobalHistory).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('리액션 하이드레이션 실패는 성공한 과거 메시지 로드를 실패로 표시하지 않는다', async () => {
    window.electronAPI.getGlobalHistory = jest.fn().mockResolvedValue([
      {
        id: 'older-message',
        content: '리액션 없이 불러온 과거 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
    ])
    window.electronAPI.getReactions = jest.fn().mockRejectedValue(new Error('reaction failed'))

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    await act(async () => {
      fireEvent.scroll(messageLog)
      await Promise.resolve()
    })

    expect(screen.getByText('리액션 없이 불러온 과거 메시지')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('다음 과거 페이지를 불러온 뒤에도 앞 페이지의 늦은 리액션 결과를 반영한다', async () => {
    let resolveFirstPageReactions
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `first-page-${index}`,
      content: `첫 페이지 ${index}`,
      timestamp: 1000 + index,
      fromId: 'other-peer',
      from: '상대방',
      type: 'global',
    }))
    window.electronAPI.getGlobalHistory = jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([])
    window.electronAPI.getReactions = jest.fn()
      .mockReturnValueOnce(new Promise(resolve => { resolveFirstPageReactions = resolve }))

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })

    await act(async () => {
      fireEvent.scroll(messageLog)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.scroll(messageLog)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      resolveFirstPageReactions({
        'first-page-0': [{ emoji: '👍', peer_id: 'other-peer' }],
      })
      await Promise.resolve()
    })

    expect(useChatStore.getState().reactions['first-page-0']).toEqual({
      '👍': ['other-peer'],
    })
  })

  it('이전 방의 늦은 초기 스크롤 프레임이 새 방의 자동 스크롤 보호를 해제하지 않는다', () => {
    const animationFrameCallbacks = []
    window.requestAnimationFrame = (callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    }
    const pendingPromise = new Promise(() => {})
    window.electronAPI.getDMHistory = jest.fn().mockReturnValue(pendingPromise)
    window.electronAPI.getUnreadDMIds = jest.fn().mockReturnValue(pendingPromise)

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    // 기존 방의 즉시 스냅 프레임과 종료용 첫 프레임을 실행해 두 번째 종료 프레임을 대기시킨다.
    act(() => animationFrameCallbacks.shift()())
    act(() => animationFrameCallbacks.shift()())

    act(() => {
      useChatStore.getState().setDMHistory('other-room', [{
        id: 'dm-latest',
        content: '새 방의 기존 메시지',
        timestamp: 2000,
        fromId: 'other-room',
        from: '상대방',
        type: 'dm',
      }])
      useChatStore.getState().setCurrentRoom({
        type: 'dm',
        peerId: 'other-room',
        nickname: '다른 방',
      })
    })

    // 수정 전에는 마지막 항목이 이전 방의 종료 프레임이라 새 방의 pending 상태를 false로 바꿨다.
    act(() => animationFrameCallbacks.shift()())
    act(() => animationFrameCallbacks.pop()())
    moveAwayFromBottom()

    act(() => {
      useChatStore.getState().addDMMessage('other-room', {
        id: 'dm-live-message',
        content: '새 방 실시간 메시지',
        timestamp: 3000,
        fromId: 'other-room',
        from: '상대방',
        type: 'dm',
      })
    })

    expect(screen.queryByText('상대방: 새 방 실시간 메시지')).not.toBeInTheDocument()
  })

  it('검색 점프 처리 중 도착한 실제 새 메시지를 기준 목록에 흡수하지 않는다', async () => {
    let resolveReactions
    const reactionsPromise = new Promise(resolve => { resolveReactions = resolve })
    window.electronAPI.getGlobalHistoryThroughMessage = jest.fn().mockResolvedValue([
      {
        id: 'search-target',
        content: '검색 대상 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
      useChatStore.getState().globalMessages[0],
    ])
    window.electronAPI.getReactions = jest.fn().mockReturnValue(reactionsPromise)

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'live-during-search',
        content: '검색 중 도착한 메시지',
        timestamp: 3000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })

    expect(screen.getByText('상대방: 검색 중 도착한 메시지')).toBeInTheDocument()

    await act(async () => {
      resolveReactions([])
      await Promise.resolve()
    })
  })

  it('검색 히스토리 응답을 기다리는 동안 도착한 새 메시지를 목록에서 보존한다', async () => {
    let resolveHistory
    window.electronAPI.getGlobalHistoryThroughMessage = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveHistory = resolve })
    )

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))
      await Promise.resolve()
    })

    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'live-before-history-response',
        content: '응답 대기 중 도착한 메시지',
        timestamp: 3000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })

    await act(async () => {
      resolveHistory([
        {
          id: 'search-target',
          content: '검색 대상 메시지',
          timestamp: 1000,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
        {
          id: 'latest-message',
          content: '이미 있던 최신 메시지',
          timestamp: 2000,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
      ])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('응답 대기 중 도착한 메시지')).toBeInTheDocument()
    expect(screen.getByText('상대방: 응답 대기 중 도착한 메시지')).toBeInTheDocument()
  })

  it('동일 timestamp 메시지가 있어도 대상 ID 기반 히스토리로 정확히 이동한다', async () => {
    window.electronAPI.getGlobalHistoryThroughMessage = jest.fn().mockResolvedValue([
      {
        id: 'search-target',
        content: 'ID로 찾은 검색 대상',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
      {
        id: 'same-timestamp-message',
        content: '같은 시각의 다음 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
      useChatStore.getState().globalMessages[0],
    ])

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.electronAPI.getGlobalHistoryThroughMessage).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.getGlobalHistoryThroughMessage).toHaveBeenCalledWith('search-target')
    expect(screen.getByText('ID로 찾은 검색 대상')).toBeInTheDocument()
  })

  it('검색 대상과 최신 tail 사이가 500개 창을 넘으면 생략 구간을 명시한다', async () => {
    window.electronAPI.getGlobalHistoryThroughMessage = jest.fn().mockResolvedValue({
      messages: [
        {
          id: 'search-target',
          content: '제한 창의 검색 대상',
          timestamp: 1000,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
        {
          id: 'search-window-edge',
          content: '제한 창의 마지막 메시지',
          timestamp: 1500,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
      ],
      nextMessageId: 'not-loaded-next-message',
    })

    render(<ChatWindow />)
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('성능을 위해 중간 메시지는 생략했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '최근 메시지로 이동' })).toBeInTheDocument()
  })

  it('연속 이미지 그룹의 추가 이미지도 재조회 없이 검색 결과로 이동하고 그룹을 강조한다', async () => {
    useChatStore.getState().setGlobalHistory([
      {
        id: 'image-parent',
        content: '첫 이미지',
        contentType: 'image',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
      {
        id: 'search-target',
        content: '검색 대상 추가 이미지',
        contentType: 'image',
        timestamp: 1001,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
    ])

    render(<ChatWindow />)
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))
    fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(window.electronAPI.getGlobalHistoryThroughMessage).not.toHaveBeenCalled()
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(document.querySelector('[data-message-id="image-parent"]')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('늦게 끝난 이전 검색 응답이 더 최신 검색 결과를 덮어쓰지 않는다', async () => {
    let resolveFirstSearch
    let resolveSecondSearch
    window.electronAPI.searchMessages = jest.fn(({ query }) => {
      if (query === '첫 검색') {
        return new Promise(resolve => { resolveFirstSearch = resolve })
      }
      return new Promise(resolve => { resolveSecondSearch = resolve })
    })

    render(<ChatWindow />)
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))
    fireEvent.click(screen.getByRole('button', { name: '첫 검색 실행' }))
    fireEvent.click(screen.getByRole('button', { name: '두 번째 검색 실행' }))

    await act(async () => {
      resolveSecondSearch([{ id: 'second-result', content: '두 번째 결과' }])
      await Promise.resolve()
    })
    expect(screen.getByTestId('search-state')).toHaveTextContent('두 번째 결과')

    await act(async () => {
      resolveFirstSearch([{ id: 'first-result', content: '첫 번째 결과' }])
      await Promise.resolve()
    })
    expect(screen.getByTestId('search-state')).toHaveTextContent('두 번째 결과')
    expect(screen.getByTestId('search-state')).not.toHaveTextContent('첫 번째 결과')
  })

  it('검색을 닫은 뒤 도착한 응답을 다시 열었을 때 재사용하지 않는다', async () => {
    let resolveSearch
    window.electronAPI.searchMessages = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveSearch = resolve })
    )

    render(<ChatWindow />)
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))
    fireEvent.click(screen.getByRole('button', { name: '첫 검색 실행' }))
    fireEvent.click(screen.getByRole('button', { name: '검색 닫기' }))

    await act(async () => {
      resolveSearch([{ id: 'late-result', content: '닫힌 검색의 늦은 결과' }])
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))
    expect(screen.getByTestId('search-state')).toBeEmptyDOMElement()
  })

  it('검색 점프가 시작되면 진행 중이던 과거 로드의 늦은 결과를 적용하지 않는다', async () => {
    let resolveOlderHistory
    const olderHistoryPromise = new Promise(resolve => { resolveOlderHistory = resolve })
    window.electronAPI.getGlobalHistory = jest.fn().mockReturnValue(olderHistoryPromise)
    window.electronAPI.getGlobalHistoryThroughMessage = jest.fn().mockResolvedValue([
      {
        id: 'search-target',
        content: '검색 대상 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      },
      useChatStore.getState().globalMessages[0],
    ])

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)
    fireEvent.click(screen.getByRole('button', { name: '메시지 검색' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '검색 결과 열기' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      resolveOlderHistory([
        {
          id: 'stale-older-message',
          content: '무효화되어야 할 과거 메시지',
          timestamp: 500,
          fromId: 'other-peer',
          from: '상대방',
          type: 'global',
        },
      ])
      await Promise.resolve()
    })

    expect(screen.getByText('검색 대상 메시지')).toBeInTheDocument()
    expect(screen.queryByText('무효화되어야 할 과거 메시지')).not.toBeInTheDocument()
  })

  it('메시지 로딩 상태를 aria-busy 메시지 목록 바깥에서 알린다', async () => {
    let resolveHistory
    window.electronAPI.getGlobalHistory = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveHistory = resolve })
    )

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)

    const loadingStatus = screen.getByText('메시지를 불러오는 중...', {
      selector: 'span[role="status"]',
    })
    expect(messageLog).toHaveAttribute('aria-busy', 'true')
    expect(messageLog.contains(loadingStatus)).toBe(false)

    await act(async () => {
      resolveHistory([])
      await Promise.resolve()
    })
  })

  it('DM 진입 히스토리가 늦게 끝나도 그 사이 도착한 실시간 DM을 지우지 않는다', async () => {
    let resolveDMHistory
    window.electronAPI.getDMHistory = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveDMHistory = resolve })
    )
    window.electronAPI.getUnreadDMIds = jest.fn().mockResolvedValue([])

    render(<ChatWindow />)
    await act(async () => {
      useChatStore.getState().setCurrentRoom({
        type: 'dm',
        peerId: 'dm-peer',
        nickname: 'DM 상대',
      })
      await Promise.resolve()
    })

    act(() => {
      useChatStore.getState().addDMMessage('dm-peer', {
        id: 'live-dm-during-hydration',
        content: '히스토리 대기 중 도착한 DM',
        timestamp: 3000,
        fromId: 'dm-peer',
        from: 'DM 상대',
        type: 'dm',
      })
    })

    await act(async () => {
      resolveDMHistory([{
        id: 'older-dm-history',
        content: 'DB에서 불러온 이전 DM',
        timestamp: 1000,
        fromId: 'dm-peer',
        from: 'DM 상대',
        type: 'dm',
      }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('DB에서 불러온 이전 DM')).toBeInTheDocument()
    expect(screen.getByText('히스토리 대기 중 도착한 DM')).toBeInTheDocument()
  })

  it('전체 초기화 전에 시작한 과거 로드 응답이 메시지를 되살리지 않는다', async () => {
    let resolveHistory
    window.electronAPI.getGlobalHistory = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveHistory = resolve })
    )

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)

    act(() => {
      useChatStore.getState().resetAll()
    })
    await act(async () => {
      resolveHistory([{
        id: 'stale-after-reset',
        content: '초기화 뒤 되살아나면 안 되는 메시지',
        timestamp: 500,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      }])
      await Promise.resolve()
    })

    expect(useChatStore.getState().globalMessages).toEqual([])
    expect(screen.queryByText('초기화 뒤 되살아나면 안 되는 메시지')).not.toBeInTheDocument()
  })

  it('전체 초기화 시 삭제된 메시지를 가리키는 새 메시지 토스트도 즉시 제거한다', () => {
    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    moveAwayFromBottom()
    act(() => {
      useChatStore.getState().addGlobalMessage({
        id: 'toast-before-reset',
        content: '초기화로 삭제될 미리보기',
        timestamp: 3000,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      })
    })
    expect(screen.getByText('상대방: 초기화로 삭제될 미리보기')).toBeInTheDocument()

    act(() => {
      useChatStore.getState().resetAll()
    })

    expect(screen.queryByText('상대방: 초기화로 삭제될 미리보기')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /개의 새 메시지, 최근 메시지/ })).not.toBeInTheDocument()
  })

  it('로그아웃 세션 초기화 뒤 이전 방의 읽음 상태를 다시 기록하지 않는다', () => {
    render(<ChatWindow />)
    window.electronAPI.setRoomReadTimestamp.mockClear()

    act(() => {
      useChatStore.getState().resetAll()
      useUserStore.getState().reset()
    })

    expect(useChatStore.getState().lastReadTimestamps).toEqual({})
    expect(window.electronAPI.setRoomReadTimestamp).not.toHaveBeenCalled()
  })

  it('컴포넌트 해제 전에 시작한 과거 로드 응답을 적용하지 않는다', async () => {
    let resolveHistory
    window.electronAPI.getGlobalHistory = jest.fn().mockReturnValue(
      new Promise(resolve => { resolveHistory = resolve })
    )

    const { unmount } = render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)
    unmount()

    await act(async () => {
      resolveHistory([{
        id: 'stale-after-unmount',
        content: '해제 뒤 추가되면 안 되는 메시지',
        timestamp: 500,
        fromId: 'other-peer',
        from: '상대방',
        type: 'global',
      }])
      await Promise.resolve()
    })

    expect(useChatStore.getState().globalMessages.map(message => message.id)).toEqual(['latest-message'])
  })

  it('이전 방의 늦은 과거 로드 실패가 새 방의 오류 상태를 오염시키지 않는다', async () => {
    let rejectGlobalHistory
    window.electronAPI.getGlobalHistory = jest.fn().mockReturnValue(
      new Promise((resolve, reject) => { rejectGlobalHistory = reject })
    )
    window.electronAPI.getDMHistory = jest.fn().mockResolvedValue([])
    window.electronAPI.getUnreadDMIds = jest.fn().mockResolvedValue([])
    window.electronAPI.sendReadReceipt = jest.fn().mockResolvedValue(undefined)

    render(<ChatWindow />)
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    const messageLog = screen.getByRole('log')
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(messageLog)

    await act(async () => {
      useChatStore.getState().setCurrentRoom({
        type: 'dm',
        peerId: 'other-room',
        nickname: '다른 방',
      })
      await Promise.resolve()
    })
    await act(async () => {
      rejectGlobalHistory(new Error('late failure'))
      await Promise.resolve()
    })

    expect(screen.getByRole('log', { name: '다른 방 (DM) 메시지 목록' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
