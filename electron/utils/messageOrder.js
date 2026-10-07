const { getGlobalHistory, getDMHistory } = require('../storage/queries')

// PC별 시계 차이가 있어도 라이브 답장이 이전 메시지 앞으로 들어가지 않게 한다.
// 원래 timestamp는 통신/신선도/히스토리 동기화에 그대로 쓰고, 표시 순서만 로컬에서 보정한다.
function withMessageOrder(ctx, message, { historical = false } = {}) {
  const database = ctx.state.database
  let sortTimestamp = message.timestamp
  if (!database) return { ...message, sortTimestamp }
  try {
    const existing = database.prepare('SELECT COALESCE(sort_timestamp, timestamp) AS sortTimestamp FROM messages WHERE id = ?').get(message.id)
    if (existing) return { ...message, sortTimestamp: existing.sortTimestamp }
    // 오프라인 큐와 과거 동기화는 원래 위치에 삽입해야 하므로 라이브 보정을 적용하지 않는다.
    if (historical || message.deferred === true) return { ...message, sortTimestamp }
    let latest
    if (message.type === 'dm') {
      const remotePeerId = message.fromId === ctx.state.peerId ? message.to : message.fromId
      latest = getDMHistory(database, ctx.state.peerId, remotePeerId, 1)[0]
    } else {
      latest = getGlobalHistory(database, 1)[0]
    }
    const latestTimestamp = latest?.sort_timestamp ?? latest?.timestamp
    if (Number.isFinite(latestTimestamp) && Number.isFinite(sortTimestamp)) {
      sortTimestamp = Math.max(sortTimestamp, latestTimestamp + 1)
    }
  } catch {
    // 저장소가 일시적으로 사용 불가해도 기존처럼 메시지 전달은 계속한다.
  }
  return { ...message, sortTimestamp }
}

module.exports = { withMessageOrder }
