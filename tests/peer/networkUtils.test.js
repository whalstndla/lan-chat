const {
  buildPeerConnectHostCandidates,
  collectLocalIpv4Addresses,
  normalizeAdvertisedAddresses,
  selectPrimaryLocalIpv4,
} = require('../../electron/peer/networkUtils')

describe('피어 네트워크 유틸', () => {
  it('광고된 IPv4 문자열을 정규화함', () => {
    expect(normalizeAdvertisedAddresses('192.168.0.20, 10.0.0.3, , invalid')).toEqual([
      '192.168.0.20',
      '10.0.0.3',
    ])
  })

  it('가상 어댑터보다 실제 LAN 인터페이스 주소를 우선 선택함', () => {
    const networkInterfaces = {
      utun4: [{ family: 'IPv4', internal: false, address: '10.10.10.2' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.0.100' }],
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    }

    expect(collectLocalIpv4Addresses(networkInterfaces)).toEqual([
      '192.168.0.100',
      '10.10.10.2',
    ])
    expect(selectPrimaryLocalIpv4(networkInterfaces)).toBe('192.168.0.100')
  })

  it('연결 후보를 만들 때 광고된 주소를 mDNS hostname보다 우선함', () => {
    expect(buildPeerConnectHostCandidates({
      host: 'MacBook-Pro.local.',
      addresses: ['169.254.8.8'],
      advertisedAddresses: ['192.168.0.44', '10.0.0.8'],
      refererAddress: '192.168.0.45',
    })).toEqual([
      '192.168.0.44',
      '10.0.0.8',
      '192.168.0.45',
      'MacBook-Pro.local',
      '169.254.8.8',
    ])
  })

  it('호스트가 IPv4면 중복 없이 후보에 포함함', () => {
    expect(buildPeerConnectHostCandidates({
      host: '192.168.0.77',
      addresses: ['::ffff:192.168.0.77'],
      advertisedAddresses: ['192.168.0.77'],
    })).toEqual(['192.168.0.77'])
  })
})
