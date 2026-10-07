import { createRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { VirtuosoMockContext } from 'react-virtuoso'
import VirtualizedMessageList, {
  INITIAL_FIRST_ITEM_INDEX,
  calculateNextFirstItemIndex,
  createVirtualizedMessageListHandle,
  findMessageRowIndex,
} from '../../src/components/chat/VirtualizedMessageList'

function createItem(id, extraImageIds = []) {
  return {
    message: { id, content: id },
    extraImages: extraImageIds.map(imageId => ({ id: imageId, content: imageId })),
  }
}

describe('VirtualizedMessageList', () => {
  it.each([300, 301, 600, 5000])('keeps at most 300 rows mounted for %i loaded messages', async (messageCount) => {
    const items = Array.from({ length: messageCount }, (_, index) => createItem(`message-${index}`))
    const scrollerRef = jest.fn()

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
        <VirtualizedMessageList
          data-testid="virtualized-message-list"
          aria-label="테스트 메시지 목록"
          items={items}
          roomKey="global"
          role="log"
          scrollerRef={scrollerRef}
          itemContent={(_index, item) => (
            <div data-testid="mounted-message-row">{item.message.content}</div>
          )}
        />
      </VirtuosoMockContext.Provider>
    )

    const messageList = screen.getByRole('log', { name: '테스트 메시지 목록' })
    expect(messageList).toHaveAttribute('data-testid', 'virtualized-message-list')
    expect(scrollerRef).toHaveBeenCalledWith(messageList)
    await waitFor(() => {
      const mountedRows = screen.getAllByTestId('mounted-message-row')
      expect(mountedRows.length).toBeGreaterThan(0)
      expect(mountedRows.length).toBeLessThanOrEqual(300)
    })
  })

  it('prepend 시 기존 첫 행의 절대 인덱스를 유지한다', () => {
    const previousItems = [createItem('message-10'), createItem('message-11')]
    const nextItems = [
      createItem('message-8'),
      createItem('message-9'),
      ...previousItems,
    ]

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX,
      previousItems,
      nextItems,
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX - 2)
  })

  it('앞부분 trim 시 새 첫 행의 기존 절대 인덱스를 이어 쓴다', () => {
    const previousItems = [
      createItem('message-8'),
      createItem('message-9'),
      createItem('message-10'),
    ]
    const nextItems = previousItems.slice(2)

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX,
      previousItems,
      nextItems,
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX + 2)
  })

  it('prepend로 이미지 그룹 경계가 합쳐져도 기존 첫 메시지 행을 앵커로 쓴다', () => {
    const previousItems = [createItem('image-2'), createItem('message-3')]
    const nextItems = [createItem('image-1', ['image-2']), createItem('message-3')]

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX,
      previousItems,
      nextItems,
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX)
  })

  it('방 전환이나 공통 앵커가 없는 전체 교체는 기준 인덱스를 초기화한다', () => {
    const previousItems = [createItem('message-1')]
    const nextItems = [createItem('message-2')]

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX - 20,
      previousItems,
      nextItems,
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX)

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX - 20,
      previousItems,
      nextItems: previousItems,
      roomChanged: true,
    })).toBe(INITIAL_FIRST_ITEM_INDEX)
  })

  it('첫 행이 교체돼도 공통 tail 메시지의 절대 위치를 유지한다', () => {
    const previousItems = [
      createItem('message-1'),
      createItem('message-2'),
      createItem('message-3'),
      createItem('message-4'),
    ]
    const nextItems = [
      createItem('delayed-message'),
      createItem('message-2'),
      createItem('message-3'),
      createItem('message-4'),
      createItem('latest-message'),
    ]

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX - 20,
      previousItems,
      nextItems,
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX - 20)

    expect(calculateNextFirstItemIndex({
      previousFirstItemIndex: INITIAL_FIRST_ITEM_INDEX + 37,
      previousItems,
      nextItems: [
        createItem('delayed-message'),
        createItem('message-3'),
        createItem('message-4'),
        createItem('latest-message'),
      ],
      roomChanged: false,
    })).toBe(INITIAL_FIRST_ITEM_INDEX + 38)
  })

  it('보조 이미지 ID도 같은 행의 메시지로 찾는다', () => {
    const items = [createItem('message-1'), createItem('message-2', ['image-2', 'image-3'])]

    expect(findMessageRowIndex(items, 'image-3')).toBe(1)
    expect(findMessageRowIndex(items, 'missing-message')).toBe(-1)
  })

  it('imperative API가 보조 이미지의 data 행과 목록 끝으로 이동한다', () => {
    const scrollToIndex = jest.fn()
    const autoscrollToBottom = jest.fn()
    const items = [createItem('message-1'), createItem('message-2', ['image-2'])]
    const handle = createVirtualizedMessageListHandle({
      items,
      virtuosoRef: { current: { autoscrollToBottom, scrollToIndex } },
    })

    expect(handle.hasMessage('image-2')).toBe(true)
    expect(handle.scrollToMessage('image-2', {
      align: 'start',
      behavior: 'smooth',
    })).toBe(true)
    expect(scrollToIndex).toHaveBeenLastCalledWith({
      index: 1,
      align: 'start',
      behavior: 'smooth',
    })

    expect(handle.scrollToMessage('missing-message')).toBe(false)
    expect(handle.hasMessage('missing-message')).toBe(false)

    expect(handle.scrollToBottom({ behavior: 'smooth' })).toBe(true)
    expect(scrollToIndex).toHaveBeenLastCalledWith({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth',
    })

    expect(handle.autoscrollToBottom()).toBe(true)
    expect(autoscrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('forwardRef로 실제 imperative API를 노출한다', () => {
    const listRef = createRef()

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 120, itemHeight: 60 }}>
        <VirtualizedMessageList
          ref={listRef}
          items={[createItem('message-1')]}
          roomKey="global"
          itemContent={(_index, item) => <div>{item.message.content}</div>}
        />
      </VirtuosoMockContext.Provider>
    )

    act(() => {
      expect(listRef.current.hasMessage('message-1')).toBe(true)
      expect(listRef.current.hasMessage('missing-message')).toBe(false)
    })
  })

  it('큰 firstItemIndex에서도 메시지 이동은 현재 data 행 인덱스를 사용한다', async () => {
    const listRef = createRef()
    const scrollTo = jest.fn()
    let unmount = () => {}
    const originalDescriptors = {
      offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
      scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
      getBoundingClientRect: Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'getBoundingClientRect'
      ),
      scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo'),
    }
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame

    function restoreProperty(name, descriptor) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
      else delete HTMLElement.prototype[name]
    }

    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: {
        configurable: true,
        get: () => 120,
      },
      scrollHeight: {
        configurable: true,
        get: () => 600,
      },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 320,
          bottom: 120,
          width: 320,
          height: 120,
          toJSON: () => ({}),
        }),
      },
      scrollTo: {
        configurable: true,
        writable: true,
        value: scrollTo,
      },
    })
    window.requestAnimationFrame = callback => (
      window.setTimeout(() => callback(Date.now()), 0)
    )
    window.cancelAnimationFrame = timerId => window.clearTimeout(timerId)

    try {
      const rendered = render(
        <VirtuosoMockContext.Provider value={{ viewportHeight: 120, itemHeight: 60 }}>
          <VirtualizedMessageList
            ref={listRef}
            items={Array.from({ length: 10 }, (_, index) => createItem(`message-${index}`))}
            roomKey="global"
            style={{ height: '120px' }}
            defaultItemHeight={60}
            increaseViewportBy={0}
            overscan={0}
            itemContent={(_index, item) => (
              <div data-testid="measured-message-row">{item.message.content}</div>
            )}
          />
        </VirtuosoMockContext.Provider>
      )
      unmount = rendered.unmount

      await waitFor(() => {
        expect(listRef.current).not.toBeNull()
        expect(screen.getAllByTestId('measured-message-row').length).toBeGreaterThan(0)
      })
      scrollTo.mockClear()

      act(() => {
        expect(listRef.current.scrollToMessage('message-1', {
          align: 'start',
          behavior: 'auto',
        })).toBe(true)
      })

      await waitFor(() => {
        expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 60 })
      })
      expect(scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 480 }))
    } finally {
      unmount()
      restoreProperty('offsetHeight', originalDescriptors.offsetHeight)
      restoreProperty('scrollHeight', originalDescriptors.scrollHeight)
      restoreProperty('getBoundingClientRect', originalDescriptors.getBoundingClientRect)
      restoreProperty('scrollTo', originalDescriptors.scrollTo)
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })
})
