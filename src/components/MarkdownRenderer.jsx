// src/components/MarkdownRenderer.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import { ChevronDown, ChevronUp } from 'lucide-react'
import CopyButton from './message/CopyButton'
import { highlightMentions } from '../utils/highlightMentions'
import 'highlight.js/styles/github-dark.css'

// 접힘 기준 높이 (px). 이 값을 넘으면 기본 접힘 상태로 렌더하고 더보기 버튼 노출.
const COLLAPSED_MAX_HEIGHT = 200

// 긴 코드블록을 접기/펼치기로 보여주는 래퍼.
// pre 내부 높이를 측정해 임계값을 넘으면 max-height 로 자르고 하단에 페이드 + 토글 버튼을 추가.
function CollapsibleCodeBlock({ children }) {
  const preRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [hiddenLines, setHiddenLines] = useState(0)

  useEffect(() => {
    const preElement = preRef.current
    if (!preElement) return
    const checkOverflow = () => {
      const fullHeight = preElement.scrollHeight
      setOverflowing(fullHeight > COLLAPSED_MAX_HEIGHT + 16)
      // 숨겨진 줄 수 추정 — (전체높이 - 접힘높이) / 한 줄 높이
      // 한 줄 높이는 fontSize 13px × lineHeight 1.5 ≈ 20px 로 근사
      const codeEl = preElement.querySelector('code.hljs')
      const lineHeight = codeEl ? parseFloat(getComputedStyle(codeEl).lineHeight) || 20 : 20
      const hidden = Math.max(0, Math.round((fullHeight - COLLAPSED_MAX_HEIGHT) / lineHeight))
      setHiddenLines(hidden)
    }
    checkOverflow()
    // 폰트/이미지 로드 등으로 높이가 나중에 변하는 경우 대응
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(preElement)
    return () => observer.disconnect()
  }, [children])

  const shouldCollapse = overflowing && !expanded
  return (
    <div className="my-1 group/codeblock">
      <div className="relative">
        <pre
          ref={preRef}
          style={shouldCollapse ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
          className={`rounded-t text-[13px] font-mono [&>code.hljs]:block [&>code.hljs]:p-3 [&>code.hljs]:rounded-t [&>code.hljs]:whitespace-pre-wrap [&>code.hljs]:break-all ${overflowing ? '' : 'rounded-b [&>code.hljs]:rounded-b'} ${shouldCollapse ? 'overflow-hidden' : ''}`}
        >
          {children}
        </pre>
        {/* 코드 원문 복사 버튼 — 실제 렌더된 pre 텍스트를 그대로 읽어 복사(하이라이트 span 무관하게 정확한 원문) */}
        <CopyButton
          getText={() => preRef.current?.innerText || ''}
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/40 text-vsc-muted opacity-0 group-hover/codeblock:opacity-100 hover:text-white hover:bg-black/60 transition-opacity cursor-pointer"
        />
        {shouldCollapse && (
          // 하단 페이드 — 코드가 잘려있음을 시각적으로 암시
          <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-12 bg-gradient-to-t from-[#0d1117] to-transparent" />
        )}
      </div>
      {overflowing && (
        // 풀너비 토글 버튼 — 코드블록 하단에 바로 붙여 명확한 액션 영역 제공
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-b bg-[#161b22] border-t border-vsc-border text-xs font-medium text-vsc-accent hover:bg-vsc-hover hover:text-white transition-colors cursor-pointer"
        >
          {expanded ? (
            <>
              <ChevronUp size={14} />
              <span>접기</span>
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              <span>더 보기{hiddenLines > 0 ? ` (${hiddenLines}줄)` : ''}</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

// 멘션(#29) — 마크다운 트리의 텍스트 리프에만 하이라이트를 적용한다. children 은 문자열
// 하나이거나(단순 텍스트), 문자열/React 엘리먼트가 섞인 배열이다(굵게/링크 등이 함께 있을 때).
// 이미 컴포넌트로 렌더된 엘리먼트(예: strong 안에서 이미 처리된 결과, code/a 등)는 각자의
// 컴포넌트 오버라이드가 스스로 처리하므로 여기서는 문자열 리프만 재귀적으로 변환한다.
function applyMentionHighlight(children, mentionedNicknames) {
  if (mentionedNicknames.length === 0) return children
  if (typeof children === 'string') return highlightMentions(children, mentionedNicknames)
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === 'string'
        ? <React.Fragment key={index}>{highlightMentions(child, mentionedNicknames)}</React.Fragment>
        : child
    )
  }
  return children
}

// 마크다운 렌더링 커스텀 컴포넌트 (보안 + 스타일링) — mentionedNicknames 에 따라 텍스트를
// 담는 컴포넌트(p/li/blockquote/strong/em/del)만 멘션 하이라이트를 적용해 재생성한다.
// mentionedNicknames 가 없는(=멘션 없는) 압도적 다수의 메시지는 매 렌더마다 재생성 비용을
// 줄이도록 MarkdownRenderer 쪽에서 useMemo 로 캐싱한다.
function buildMarkdownComponents(mentionedNicknames) {
  return {
    // 링크 — http/https만 허용, 외부 브라우저로 열기
    a: ({ href, children }) => {
      if (!/^https?:\/\//i.test(href || '')) return <span>{children}</span>
      return (
        <a
          href={href}
          className="text-vsc-accent underline hover:opacity-80 break-all"
          onClick={(event) => {
            event.preventDefault()
            window.electronAPI.openExternal(href)
          }}
        >
          {children}
        </a>
      )
    },
    // 이미지 — 마크다운 내 이미지 비활성화 (파일 첨부로만 전송)
    img: () => null,
    // 인라인 코드 — pre > code에서도 호출되므로 인라인 스타일만 적용.
    // rehype-highlight이 코드블록 code 요소에 'hljs' 클래스를 붙이는데, 이를 감지해 인라인 스타일을 건너뛴다.
    code: ({ children, className, ...props }) => {
      const isBlock = typeof className === 'string' && className.includes('hljs')
      if (isBlock) {
        return <code className={className} {...props}>{children}</code>
      }
      return (
        <code className="bg-vsc-bg text-vsc-accent px-1 py-0.5 rounded text-xs font-mono" {...props}>
          {children}
        </code>
      )
    },
    // 코드 블록 — 긴 경우 접힘 상태로 렌더하는 래퍼 컴포넌트로 대체.
    pre: ({ children }) => <CollapsibleCodeBlock>{children}</CollapsibleCodeBlock>,
    // 불릿 리스트 — list-outside + 좌측 패딩으로 래핑 시 들여쓰기 유지
    ul: ({ children }) => <ul className="list-disc list-outside pl-5 my-1 space-y-0.5">{children}</ul>,
    // 번호 리스트 — list-outside + 좌측 패딩
    ol: ({ children }) => <ol className="list-decimal list-outside pl-5 my-1 space-y-0.5">{children}</ol>,
    // 리스트 아이템 — 마커와 내용 사이 간격 약간
    li: ({ children }) => <li className="pl-1">{applyMentionHighlight(children, mentionedNicknames)}</li>,
    // 인용
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-vsc-accent/50 pl-2 my-1 text-vsc-muted italic">
        {applyMentionHighlight(children, mentionedNicknames)}
      </blockquote>
    ),
    // 단락 — 여백 최소화 (채팅 말풍선이라 조밀해야 함)
    p: ({ children }) => <p className="my-0.5 first:mt-0 last:mb-0">{applyMentionHighlight(children, mentionedNicknames)}</p>,
    // 굵게
    strong: ({ children }) => <strong className="font-bold">{applyMentionHighlight(children, mentionedNicknames)}</strong>,
    // 기울임
    em: ({ children }) => <em className="italic">{applyMentionHighlight(children, mentionedNicknames)}</em>,
    // 취소선
    del: ({ children }) => <del className="line-through text-vsc-muted">{applyMentionHighlight(children, mentionedNicknames)}</del>,
  }
}

export default function MarkdownRenderer({ content, mentionedNicknames = [] }) {
  const components = useMemo(() => buildMarkdownComponents(mentionedNicknames), [mentionedNicknames])
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={components}
    >
      {content || ''}
    </ReactMarkdown>
  )
}
