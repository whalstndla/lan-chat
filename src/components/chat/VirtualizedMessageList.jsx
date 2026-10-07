import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Virtuoso } from 'react-virtuoso'

// 이전 메시지를 장기간 prepend해도 0 아래로 내려가지 않도록 충분히 큰 기준값에서 시작한다.
export const INITIAL_FIRST_ITEM_INDEX = 1_000_000

const EMPTY_ITEMS = []
const EMPTY_COMPONENTS = {}
const DEFAULT_ITEM_HEIGHT = 96
const DEFAULT_VIEWPORT_OVERSCAN = { top: 400, bottom: 600 }
const DEFAULT_SCROLL_OVERSCAN = { main: 200, reverse: 200 }

function getPrimaryMessageId(item) {
  return item?.message?.id ?? null
}

function getMessageIds(item) {
  const messageIds = []
  const primaryMessageId = getPrimaryMessageId(item)
  if (primaryMessageId !== null) messageIds.push(primaryMessageId)

  for (const image of item?.extraImages || []) {
    if (image?.id !== null && image?.id !== undefined) messageIds.push(image.id)
  }

  return messageIds
}

// 연속 이미지 묶음의 보조 이미지도 같은 렌더 행에 있으므로 메시지 ID 검색에 포함한다.
export function findMessageRowIndex(items, messageId) {
  if (messageId === null || messageId === undefined) return -1

  return items.findIndex(item => (
    getPrimaryMessageId(item) === messageId ||
    item?.extraImages?.some(image => image?.id === messageId)
  ))
}

export function calculateNextFirstItemIndex({
  previousFirstItemIndex,
  previousItems,
  nextItems,
  roomChanged,
}) {
  if (roomChanged || previousItems.length === 0 || nextItems.length === 0) {
    return INITIAL_FIRST_ITEM_INDEX
  }

  const nextMessageRows = new Map()
  nextItems.forEach((item, rowIndex) => {
    getMessageIds(item).forEach(messageId => {
      if (!nextMessageRows.has(messageId)) nextMessageRows.set(messageId, rowIndex)
    })
  })

  // 첫 행이 교체되더라도 공통 메시지가 하나라도 남아 있으면 그 메시지의 절대 위치를
  // 앵커로 삼는다. prepend, head trim, 이미지 그룹 경계 변경을 같은 계산으로 처리한다.
  for (let previousRowIndex = 0; previousRowIndex < previousItems.length; previousRowIndex += 1) {
    for (const messageId of getMessageIds(previousItems[previousRowIndex])) {
      const nextRowIndex = nextMessageRows.get(messageId)
      if (nextRowIndex === undefined) continue

      return Math.max(
        1,
        previousFirstItemIndex + previousRowIndex - nextRowIndex
      )
    }
  }

  // 공통 메시지가 없는 전체 교체는 새 목록으로 취급한다.
  return INITIAL_FIRST_ITEM_INDEX
}

export function createVirtualizedMessageListHandle({
  items,
  virtuosoRef,
}) {
  return {
    hasMessage(messageId) {
      return findMessageRowIndex(items, messageId) >= 0
    },

    scrollToMessage(messageId, options = {}) {
      const rowIndex = findMessageRowIndex(items, messageId)
      const virtuoso = virtuosoRef.current
      if (rowIndex < 0 || !virtuoso) return false

      virtuoso.scrollToIndex({
        // scrollToIndex는 firstItemIndex가 아닌 현재 data의 0-based 행 인덱스를 받는다.
        index: rowIndex,
        align: options.align ?? 'center',
        behavior: options.behavior ?? 'auto',
      })
      return true
    },

    scrollToBottom(options = {}) {
      const virtuoso = virtuosoRef.current
      if (!virtuoso) return false

      virtuoso.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: options.behavior ?? 'auto',
      })
      return true
    },

    autoscrollToBottom() {
      const virtuoso = virtuosoRef.current
      if (!virtuoso || typeof virtuoso.autoscrollToBottom !== 'function') return false

      virtuoso.autoscrollToBottom()
      return true
    },
  }
}

function setExternalRef(externalRef, value) {
  if (typeof externalRef === 'function') {
    externalRef(value)
    return
  }
  if (externalRef) externalRef.current = value
}

function computeMessageItemKey(index, item) {
  return getPrimaryMessageId(item) ?? `message-row-${index}`
}

const VirtualizedMessageList = forwardRef(function VirtualizedMessageList({
  items = EMPTY_ITEMS,
  roomKey,
  itemContent,
  components = EMPTY_COMPONENTS,
  context,
  scrollerRef,
  defaultItemHeight = DEFAULT_ITEM_HEIGHT,
  increaseViewportBy = DEFAULT_VIEWPORT_OVERSCAN,
  overscan = DEFAULT_SCROLL_OVERSCAN,
  style,
  ...virtuosoProps
}, forwardedRef) {
  const normalizedItems = Array.isArray(items) ? items : EMPTY_ITEMS
  const virtuosoRef = useRef(null)
  const [storedListState, setStoredListState] = useState(() => ({
    firstItemIndex: INITIAL_FIRST_ITEM_INDEX,
    items: normalizedItems,
    roomKey,
  }))

  let listState = storedListState
  if (storedListState.items !== normalizedItems || storedListState.roomKey !== roomKey) {
    listState = {
      firstItemIndex: calculateNextFirstItemIndex({
        previousFirstItemIndex: storedListState.firstItemIndex,
        previousItems: storedListState.items,
        nextItems: normalizedItems,
        roomChanged: storedListState.roomKey !== roomKey,
      }),
      items: normalizedItems,
      roomKey,
    }

    // 렌더 중 파생 상태를 함께 갱신해 data만 먼저 커밋되는 중간 프레임을 만들지 않는다.
    setStoredListState(listState)
  }

  useImperativeHandle(
    forwardedRef,
    () => createVirtualizedMessageListHandle({
      items: listState.items,
      virtuosoRef,
    }),
    [listState.items]
  )

  const handleScrollerRef = useCallback(
    scroller => setExternalRef(scrollerRef, scroller),
    [scrollerRef]
  )

  return (
    <Virtuoso
      {...virtuosoProps}
      ref={virtuosoRef}
      data={listState.items}
      firstItemIndex={listState.firstItemIndex}
      computeItemKey={computeMessageItemKey}
      itemContent={itemContent}
      components={components}
      context={context}
      scrollerRef={handleScrollerRef}
      defaultItemHeight={defaultItemHeight}
      increaseViewportBy={increaseViewportBy}
      overscan={overscan}
      style={{ height: '100%', ...style }}
    />
  )
})

export default VirtualizedMessageList
