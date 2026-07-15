// tests/renderer/Message.test.jsx
// Message 컴포넌트 스모크 테스트 — 기본 props(zustand store 기본 상태) 로 크래시 없이
// 렌더링되는지만 확인한다(상호작용/IPC 통합까지는 다루지 않음, 과한 커버리지 지양).
// message.format 이 'markdown' 이 아닌 일반 텍스트 경로를 사용해 react-markdown(ESM 전용 패키지)
// 의존 없이 렌더링되도록 한다.
import { render, screen } from '@testing-library/react'
import Message from '../../src/components/Message'
import useUserStore from '../../src/store/useUserStore'
import useChatStore from '../../src/store/useChatStore'
import usePeerStore from '../../src/store/usePeerStore'

// MarkdownRenderer 는 react-markdown/remark-*/rehype-* (전부 ESM 전용 패키지) 체인을 가져온다.
// 이 스모크 테스트는 message.format !== 'markdown' 경로(일반 텍스트)만 다루므로 실제로
// 렌더링되지는 않지만, Message.jsx 가 정적으로 import 하기 때문에 목킹하지 않으면 모듈 로드
// 시점에 "Unexpected token 'export'" 로 실패한다. Jest 를 ESM 대응으로 바꾸는 대신 이 스모크
// 테스트 범위에서는 가볍게 목킹한다(마크다운 렌더링 자체는 이 테스트의 대상이 아님).
jest.mock('../../src/components/MarkdownRenderer', () => ({
  __esModule: true,
  default: ({ content }) => <div data-testid="markdown-renderer">{content}</div>,
}))

// Message 는 클릭 핸들러 내부에서만 window.electronAPI 를 사용한다(렌더 시점엔 미사용).
// 그래도 과제 지침에 따라 안전하게 목킹해둔다.
beforeEach(() => {
  window.electronAPI = {
    cancelFileTransfer: jest.fn(),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    toggleReaction: jest.fn().mockResolvedValue({ action: 'added' }),
    downloadFile: jest.fn().mockResolvedValue({ canceled: true }),
    showItemInFolder: jest.fn(),
  }

  // 각 테스트 전 store 상태 초기화
  useUserStore.getState().reset()
  usePeerStore.getState().clearAllPeers()
  useChatStore.getState().resetAll()
})

function buildMessage(overrides = {}) {
  return {
    id: 'msg-1',
    content: '안녕하세요, 테스트 메시지입니다',
    timestamp: Date.now(),
    fromId: 'peer-1',
    from: '홍길동',
    type: 'global',
    ...overrides,
  }
}

describe('Message', () => {
  it('상대방의 일반 텍스트 메시지를 크래시 없이 렌더링한다', () => {
    render(<Message message={buildMessage()} />)

    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('안녕하세요, 테스트 메시지입니다')).toBeInTheDocument()
  })

  it('내가 보낸 메시지는 발신자 이름 대신 "나"로 표시하고 수정/삭제 버튼을 노출한다', () => {
    useUserStore.getState().initialize('peer-1', '홍길동', null)

    render(<Message message={buildMessage()} />)

    expect(screen.getByText('나')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메시지 수정' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메시지 삭제' })).toBeInTheDocument()
  })

  it('pending 메시지는 전송 대기 아이콘을 표시한다', () => {
    render(<Message message={buildMessage({ pending: true })} />)

    expect(screen.getByTitle('전송 대기 중')).toBeInTheDocument()
  })

  it('복호화 실패 메시지는 안내 문구만 표시하고 본문을 렌더링하지 않는다', () => {
    render(<Message message={buildMessage({ decryptionFailed: true })} />)

    expect(screen.getByText('🔒 복호화할 수 없는 메시지')).toBeInTheDocument()
    expect(screen.queryByText('안녕하세요, 테스트 메시지입니다')).not.toBeInTheDocument()
  })
})
