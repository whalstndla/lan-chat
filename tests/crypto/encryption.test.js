// tests/crypto/encryption.test.js
const crypto = require('crypto')
const { DM암호화, DM복호화, SharedSecret도출 } = require('../../electron/crypto/encryption')

function 테스트키쌍생성() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('DM 암호화/복호화', () => {
  let 앨리스키쌍, 밥키쌍

  beforeEach(() => {
    앨리스키쌍 = 테스트키쌍생성()
    밥키쌍 = 테스트키쌍생성()
  })

  it('앨리스가 암호화한 메시지를 밥이 복호화할 수 있음', () => {
    const 원본 = { content: '안녕 밥!', contentType: 'text', fileUrl: null, fileName: null }

    const sharedSecret앨리스 = SharedSecret도출(앨리스키쌍.privateKey, 밥키쌍.publicKey)
    const 암호문 = DM암호화(원본, sharedSecret앨리스)

    const sharedSecret밥 = SharedSecret도출(밥키쌍.privateKey, 앨리스키쌍.publicKey)
    const 복호화결과 = DM복호화(암호문, sharedSecret밥)

    expect(복호화결과.content).toBe('안녕 밥!')
    expect(복호화결과.contentType).toBe('text')
  })

  it('잘못된 키로 복호화 시 에러가 발생함', () => {
    const 다른키쌍 = 테스트키쌍생성()
    const 원본 = { content: '비밀', contentType: 'text', fileUrl: null, fileName: null }

    const sharedSecret앨리스 = SharedSecret도출(앨리스키쌍.privateKey, 밥키쌍.publicKey)
    const 암호문 = DM암호화(원본, sharedSecret앨리스)

    const 엉뚱한SharedSecret = SharedSecret도출(다른키쌍.privateKey, 앨리스키쌍.publicKey)
    expect(() => DM복호화(암호문, 엉뚱한SharedSecret)).toThrow()
  })

  it('같은 내용이라도 매번 다른 암호문 생성 (IV 랜덤화)', () => {
    const 원본 = { content: '반복 메시지', contentType: 'text', fileUrl: null, fileName: null }
    const sharedSecret = SharedSecret도출(앨리스키쌍.privateKey, 밥키쌍.publicKey)

    const 암호문1 = DM암호화(원본, sharedSecret)
    const 암호문2 = DM암호화(원본, sharedSecret)

    expect(암호문1).not.toBe(암호문2)
  })
})
