import { act, render } from '@testing-library/react'
import useChatSubscriptions from '../../src/hooks/useChatSubscriptions'
import useChatStore from '../../src/store/useChatStore'
import usePeerStore from '../../src/store/usePeerStore'
import useUserStore from '../../src/store/useUserStore'

jest.mock('../../src/hooks/useNotificationSound', () => ({
  __esModule: true,
  default: () => ({ play: jest.fn() }),
}))

function ChatSubscriptionsHarness({ setPatchNotesHighlight, setShowPatchNotes }) {
  useChatSubscriptions({
    authStatus: 'authenticated',
    authenticatedNickname: '테스트 사용자',
    setPatchNotesHighlight,
    setShowPatchNotes,
  })
  return null
}

describe('useChatSubscriptions', () => {
  beforeEach(() => {
    useChatStore.getState().resetAll()
    usePeerStore.setState({ onlinePeers: [], pastDMPeers: [], keyChangedPeers: {} })
    useUserStore.getState().reset()
  })

  it('컴포넌트 해제 뒤 도착한 초기 히스토리 응답을 무시한다', async () => {
    let resolveHistory
    const delayedHistory = new Promise(resolve => {
      resolveHistory = resolve
    })
    window.electronAPI = {
      getMyInfo: jest.fn().mockResolvedValue({
        peerId: 'old-peer',
        nickname: '이전 사용자',
        profileImageUrl: null,
      }),
      getRoomReadState: jest.fn().mockResolvedValue({}),
      getGlobalHistory: jest.fn().mockReturnValue(delayedHistory),
      unsubscribeAll: jest.fn(),
    }

    const setPatchNotesHighlight = jest.fn()
    const setShowPatchNotes = jest.fn()
    const { unmount } = render(
      <ChatSubscriptionsHarness
        setPatchNotesHighlight={setPatchNotesHighlight}
        setShowPatchNotes={setShowPatchNotes}
      />
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(window.electronAPI.getGlobalHistory).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      resolveHistory([{
        id: 'stale-history-message',
        type: 'message',
        content: '해제 뒤 반영되면 안 되는 메시지',
        timestamp: 1000,
        fromId: 'other-peer',
        from: '상대방',
      }])
      await delayedHistory
    })

    expect(useChatStore.getState().globalMessages).toEqual([])
    expect(usePeerStore.getState().pastDMPeers).toEqual([])
    expect(window.electronAPI.unsubscribeAll).toHaveBeenCalledTimes(1)
  })
})
