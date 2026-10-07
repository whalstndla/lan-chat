import { getUnreadMessages, isFirstUnreadMessage } from '../../src/utils/unreadDivider'

it('marks a later reply unread even when the sender clock is behind', () => {
  const sent = { fromId: 'local', timestamp: 10000, sortTimestamp: 10000 }
  const reply = { fromId: 'remote', timestamp: 9500, sortTimestamp: 10001 }
  expect(isFirstUnreadMessage(reply, sent, 10000, false)).toBe(true)
  expect(getUnreadMessages([sent, reply], 10000, 'local')).toEqual([reply])
})

it('keeps an already-read reply read after loading its DB representation', () => {
  const reply = { from_id: 'remote', timestamp: 9500, sort_timestamp: 10001 }
  expect(getUnreadMessages([reply], 10001, 'local')).toEqual([])
})
