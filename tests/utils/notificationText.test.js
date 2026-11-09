jest.mock('../../electron/storage/profile', () => ({ getProfile: jest.fn() }))
jest.mock('../../electron/utils/appUtils', () => ({ isRoomMuted: () => false }))

const { resolveNotificationDecision } = require('../../electron/utils/notificationPolicy')

describe('notification message text', () => {
  const context = { state: { database: null } }

  test('renders markdown escapes, links and entities as readable notification text', () => {
    const result = resolveNotificationDecision(context, {
      roomType: 'dm', roomKey: 'peer', format: 'markdown',
      fallbackBody: String.raw`\> \< **hello** &#x20; [site](https://example.com)`,
    })
    expect(result.body).toBe('> < hello site')
  })

  test('preserves genuine backslashes and entity text in legacy plain messages', () => {
    const text = String.raw`C:\notes\test > &#x20;`
    expect(resolveNotificationDecision(context, {
      roomType: 'dm', roomKey: 'peer', fallbackBody: text,
    }).body).toBe(text)
  })
})
