// tests/utils/mentions.test.js
// @멘션(#29) 순수 로직 단위 테스트 — 실시간 자동완성 없이 전송 시점에 텍스트에서
// "@닉네임" 토큰을 파싱하는 parseMentions() 와 저장/조회 정규화 헬퍼를 검증한다.
import { parseMentions, parseStoredMentions, resolveMentionNickname } from '../../src/utils/mentions'

describe('parseMentions', () => {
  const peers = [
    { peerId: 'peer-1', nickname: '민수' },
    { peerId: 'peer-2', nickname: '철수' },
  ]

  it('정확일치 — 알려진 닉네임을 멘션하면 peerId 를 반환한다', () => {
    expect(parseMentions('@민수 안녕하세요', peers)).toEqual(['peer-1'])
  })

  it('여러 명을 멘션하면 등장 순서대로 모두 반환한다', () => {
    expect(parseMentions('@민수 그리고 @철수 도 확인해줘', peers)).toEqual(['peer-1', 'peer-2'])
  })

  it('알려지지 않은 닉네임(@)은 매칭하지 않는다', () => {
    expect(parseMentions('@홍길동 안녕', peers)).toEqual([])
  })

  it('메시지에 @ 가 없으면 빈 배열을 반환한다', () => {
    expect(parseMentions('그냥 텍스트입니다', peers)).toEqual([])
  })

  it('닉네임이 다른 닉네임의 접두사면(모호함) 최장일치를 우선한다', () => {
    const prefixPeers = [
      { peerId: 'peer-short', nickname: '김' },
      { peerId: 'peer-long', nickname: '김민수' },
    ]
    expect(parseMentions('@김민수 님 안녕하세요', prefixPeers)).toEqual(['peer-long'])
  })

  it('닉네임에 공백이 포함돼도 매칭한다', () => {
    const spacedPeers = [{ peerId: 'peer-space', nickname: '김 민수' }]
    expect(parseMentions('@김 민수 반가워요', spacedPeers)).toEqual(['peer-space'])
  })

  it('닉네임 뒤에 단어 연장 문자가 바로 이어지면 오매칭으로 보지 않는다', () => {
    // "밥" 이 닉네임이어도 "@밥은맛있다" 는 "밥" 뒤에 한글 음절이 바로 이어지므로 매칭 제외.
    const bobPeers = [{ peerId: 'peer-bob', nickname: '밥' }]
    expect(parseMentions('@밥은맛있다', bobPeers)).toEqual([])
    // 뒤에 공백/문장부호가 오면 정상 매칭.
    expect(parseMentions('@밥 먹었어?', bobPeers)).toEqual(['peer-bob'])
    expect(parseMentions('@밥!', bobPeers)).toEqual(['peer-bob'])
  })

  it('excludePeerId 로 지정한 peerId(자기 자신)는 멘션 결과에서 제외한다', () => {
    const withSelf = [...peers, { peerId: 'me', nickname: '나닉네임' }]
    expect(parseMentions('@나닉네임 @민수', withSelf, { excludePeerId: 'me' })).toEqual(['peer-1'])
  })

  it('동일 peerId 를 여러 번 멘션해도 결과에는 한 번만 포함한다', () => {
    expect(parseMentions('@민수 @민수 @민수', peers)).toEqual(['peer-1'])
  })

  it('빈 텍스트/닉네임 목록이면 빈 배열을 반환한다', () => {
    expect(parseMentions('', peers)).toEqual([])
    expect(parseMentions('@민수', [])).toEqual([])
    expect(parseMentions(null, peers)).toEqual([])
  })

  it('닉네임이 없는(빈 문자열) 피어 항목은 매칭 후보에서 제외한다', () => {
    const withBlank = [...peers, { peerId: 'peer-blank', nickname: '' }]
    expect(parseMentions('@민수', withBlank)).toEqual(['peer-1'])
  })
})

describe('parseStoredMentions', () => {
  it('falsy 값은 빈 배열을 반환한다', () => {
    expect(parseStoredMentions(null)).toEqual([])
    expect(parseStoredMentions(undefined)).toEqual([])
    expect(parseStoredMentions('')).toEqual([])
  })

  it('배열은 그대로 반환한다 (라이브 경로)', () => {
    expect(parseStoredMentions(['peer-1', 'peer-2'])).toEqual(['peer-1', 'peer-2'])
  })

  it('JSON 문자열은 파싱해 배열로 반환한다 (DB/히스토리 경로)', () => {
    expect(parseStoredMentions(JSON.stringify(['peer-1']))).toEqual(['peer-1'])
  })

  it('깨진 JSON 문자열은 빈 배열을 반환한다', () => {
    expect(parseStoredMentions('{not json')).toEqual([])
  })

  it('배열이 아닌 JSON(예: 객체)이 파싱되면 빈 배열을 반환한다', () => {
    expect(parseStoredMentions(JSON.stringify({ a: 1 }))).toEqual([])
  })
})

describe('resolveMentionNickname', () => {
  const context = {
    myPeerId: 'me',
    myNickname: '내닉네임',
    onlinePeers: [{ peerId: 'peer-1', nickname: '민수' }],
    pastDMPeers: [{ peerId: 'peer-2', nickname: '철수' }],
  }

  it('내 peerId 면 "나" 가 아니라 실제 내 닉네임을 반환한다 (메시지 원문 매칭용)', () => {
    expect(resolveMentionNickname('me', context)).toBe('내닉네임')
  })

  it('온라인 피어의 닉네임을 반환한다', () => {
    expect(resolveMentionNickname('peer-1', context)).toBe('민수')
  })

  it('과거 DM 상대(오프라인)의 닉네임을 반환한다', () => {
    expect(resolveMentionNickname('peer-2', context)).toBe('철수')
  })

  it('알 수 없는 peerId 면 null 을 반환한다', () => {
    expect(resolveMentionNickname('unknown', context)).toBeNull()
  })
})
