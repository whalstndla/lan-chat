// 라이브 IPC는 camelCase, DB 기록은 snake_case이며 구버전 기록은 원래 시각을 사용한다.
export function getMessageSortTimestamp(message) {
  return message?.sortTimestamp ?? message?.sort_timestamp ?? message?.timestamp
}
