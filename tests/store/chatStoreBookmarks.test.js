// tests/store/chatStoreBookmarks.test.js
// useChatStore.bookmarks(#34) — 로컬 전용 북마크 토글/영속/resetAll 로직 검증.
// jest testEnvironment 는 'node' 라 localStorage 가 기본 제공되지 않으므로, 영속 확인이
// 필요한 테스트에서는 간단한 in-memory Storage 모킹을 사용한다.
import useChatStore from '../../src/store/useChatStore'

describe('useChatStore — bookmarks (in-memory, localStorage 미가용)', () => {
  beforeEach(() => {
    useChatStore.setState({ bookmarks: {} })
  })

  it('toggleBookmark — 처음 호출 시 북마크를 추가한다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '안녕하세요')

    const { bookmarks } = useChatStore.getState()
    expect(bookmarks['msg-1']).toBeDefined()
    expect(bookmarks['msg-1'].roomKey).toBe('global')
    expect(bookmarks['msg-1'].preview).toBe('안녕하세요')
    expect(typeof bookmarks['msg-1'].savedAt).toBe('number')
  })

  it('toggleBookmark — 이미 북마크된 메시지를 다시 호출하면 제거한다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '안녕하세요')
    useChatStore.getState().toggleBookmark('msg-1', 'global', '안녕하세요')

    expect(useChatStore.getState().bookmarks['msg-1']).toBeUndefined()
  })

  it('isBookmarked — 북마크 여부를 정확히 반환한다', () => {
    expect(useChatStore.getState().isBookmarked('msg-1')).toBe(false)
    useChatStore.getState().toggleBookmark('msg-1', 'peer-1', '파일 전송함')
    expect(useChatStore.getState().isBookmarked('msg-1')).toBe(true)
  })

  it('여러 메시지의 북마크가 서로 독립적으로 유지된다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '메시지1')
    useChatStore.getState().toggleBookmark('msg-2', 'peer-1', '메시지2')
    useChatStore.getState().toggleBookmark('msg-1', 'global', '메시지1')

    const { bookmarks } = useChatStore.getState()
    expect(bookmarks['msg-1']).toBeUndefined()
    expect(bookmarks['msg-2']).toBeDefined()
    expect(bookmarks['msg-2'].roomKey).toBe('peer-1')
  })

  it('resetAll — bookmarks 도 초기화된다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '내용')
    useChatStore.getState().resetAll()

    expect(useChatStore.getState().bookmarks).toEqual({})
  })

  it('setPendingScrollMessageId / clearPendingScrollMessageId — 북마크 이동 대상 관리', () => {
    useChatStore.getState().setPendingScrollMessageId('msg-1')
    expect(useChatStore.getState().pendingScrollMessageId).toBe('msg-1')

    useChatStore.getState().clearPendingScrollMessageId()
    expect(useChatStore.getState().pendingScrollMessageId).toBeNull()
  })

  it('resetAll — pendingScrollMessageId 도 초기화된다', () => {
    useChatStore.getState().setPendingScrollMessageId('msg-1')
    useChatStore.getState().resetAll()

    expect(useChatStore.getState().pendingScrollMessageId).toBeNull()
  })
})

describe('useChatStore — bookmarks (localStorage 영속)', () => {
  beforeEach(() => {
    const memoryStore = {}
    global.localStorage = {
      getItem: (key) => (key in memoryStore ? memoryStore[key] : null),
      setItem: (key, value) => { memoryStore[key] = String(value) },
      removeItem: (key) => { delete memoryStore[key] },
    }
    useChatStore.setState({ bookmarks: {} })
  })

  afterEach(() => {
    delete global.localStorage
  })

  it('toggleBookmark 로 추가하면 localStorage 에도 반영된다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '저장 테스트')

    const saved = JSON.parse(global.localStorage.getItem('bookmarks'))
    expect(saved['msg-1'].roomKey).toBe('global')
    expect(saved['msg-1'].preview).toBe('저장 테스트')
  })

  it('resetAll 호출 시 localStorage 의 북마크도 비워진다', () => {
    useChatStore.getState().toggleBookmark('msg-1', 'global', '저장 테스트')
    useChatStore.getState().resetAll()

    const saved = JSON.parse(global.localStorage.getItem('bookmarks'))
    expect(saved).toEqual({})
  })
})
