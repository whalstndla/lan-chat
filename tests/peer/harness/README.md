# Peer 통합 테스트 하네스

두 개의 격리된 "노드"를 한 프로세스에서 띄워 실제 WebSocket으로 통신시키는 테스트 인프라.

## 설계

- `jest.isolateModules`로 각 노드가 독립된 `wsClient`/`discovery`/`broadcastDiscovery` 모듈 인스턴스를 갖는다 (전역 상태 충돌 방지)
- `electron` 모듈은 `mockElectron.js`로 스텁 (ipcMain / app / Notification / shell / clipboard / dialog)
- 실제 mDNS / UDP / HTTP 파일서버는 스텁 — `fakeDiscovery.emitPeerFound(info)`로 테스트가 수동 제어
- 각 노드는 고유한 임시 디렉토리 + in-memory SQLite
- `sendToRenderer` 는 `messageHandler.js` 등에서 destructure import 되기 때문에 몽키패치 불가.
  대신 `mainWindow.webContents.send` 를 intercept 해서 모든 렌더러 이벤트를 수집.

## 사용 예

```js
const { createNode, emitDiscovery } = require('../harness')

describe('my scenario', () => {
  let nodeA, nodeB
  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
  })

  it('works', async () => {
    nodeA = await createNode({ peerId: 'a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'b', nickname: '밥' })

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')

    emitDiscovery(nodeA, nodeB)

    // ... assertions
  })
})
```

## API

### createNode(opts)
- `opts.peerId` (string)
- `opts.nickname` (string)
- Returns: `{ peerId, nickname, ctx, db, port, handlers, fakeDiscovery, fakeBroadcast, rendererEvents, getRendererEvents, clearRendererEvents, callIpc, getOutboundConnections, hasOutboundConnection, getInboundConnections, hasAnyConnection, shutdown }`

### emitDiscovery(fromNode, toNode)
`toNode`의 wsServer 정보를 `fromNode`의 fakeDiscovery 콜백으로 전달.

### Node 인스턴스 API
- `callIpc(channel, payload)` — 등록된 IPC 핸들러 직접 호출
- `getRendererEvents(channel?)` — sendToRenderer 로그 조회
- `clearRendererEvents()` — 로그 초기화
- `hasAnyConnection(peerId)` — outbound or inbound 연결 확인
- `hasOutboundConnection(peerId)` — outbound 연결만 확인
- `shutdown()` — cleanup (discoveryEpoch 증가 + 소켓 종료 + DB close + 임시 디렉토리 삭제)

## 등록된 IPC 핸들러

하네스는 실제 Electron 환경과 달리 선택적 핸들러만 등록한다 (electron-updater 등 회피):

- peer (start-peer-discovery, stop-peer-discovery, ...)
- message (send-global-message, send-dm, send-typing, delete-message, edit-message)
- readStatus (send-read-receipt, get-unread-dm-ids)
- reaction (toggle-reaction)
- history (get-global-history, get-dm-history, get-dm-peers, search-messages)
- user (get-my-info, update-nickname, ...)

## 알려진 제약

- 실제 mDNS/UDP 통신은 테스트하지 않는다 — fake 로 대체. 실제 네트워크 테스트는
  `tests/peer/realNetwork.e2e.test.js` (별도 테스트 파일, 수동 실행)에서 다룬다.
- Phase 1 에서 PeerSession/Manager 로 리팩토링되면 하네스의 일부 내부 로직
  (예: `ctx.state.peerPublicKeyMap` 직접 조회)이 바뀔 수 있다. 공개 API
  (`callIpc`/`getRendererEvents`)는 유지.
