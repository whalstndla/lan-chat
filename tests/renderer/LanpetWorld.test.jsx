import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LanpetDrawer from '../../src/components/lanpet/LanpetDrawer'
import { EvolutionTree, WorldShop } from '../../src/components/lanpet/LanpetWorld'
import { SPECIES, FOODS, DECORATIONS } from '../../electron/lanpet/world'

function snapshot() {
  return { enabled: true, sharingEnabled: true, isWorkingTime: true, pet: { petId: 'own', name: '내 친구', energy: 80, stage: 'young', lifecycleState: 'active', appearanceId: 'young-fox-base' }, world: { balance: 100, bag: { rice: 2 }, owned: ['cream', 'parquet', 'plant'], room: {}, foods: FOODS, decorations: DECORATIONS }, invitations: [], sessions: [], peers: [
    { peerId: 'one', petName: '첫 친구', available: true, activities: ['race'] },
    { peerId: 'two', petName: '다른 방 친구', available: true, activities: ['race'] },
    { peerId: 'private', petName: '비공개 친구', available: false, activities: [] },
  ] }
}
test('drawer displays only the current DM companion and cleans up the window expansion', async () => {
  const state = snapshot()
  window.electronAPI = { lanpet: { getSnapshot: jest.fn(async () => state), onChanged: () => () => {}, setDrawerExpanded: jest.fn(async () => true), command: jest.fn(async () => ({ ok: true, snapshot: state })) } }
  const view = render(<LanpetDrawer currentRoom={{ type: 'dm', peerId: 'one' }} />)
  expect(window.electronAPI.lanpet.getSnapshot).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /랜펫 놀이방/ }))
  await waitFor(() => expect(screen.getAllByText('첫 친구').length).toBeGreaterThan(0))
  expect(screen.queryByText('다른 방 친구')).not.toBeInTheDocument()
  expect(screen.queryByText('비공개 친구')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '경주 초대' }))
  await waitFor(() => expect(window.electronAPI.lanpet.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', peerId: 'one', activity: 'race' })))
  view.rerender(<LanpetDrawer currentRoom={{ type: 'dm', peerId: 'two' }} />)
  expect(screen.queryByText('첫 친구')).not.toBeInTheDocument()
  expect(screen.getAllByText('다른 방 친구').length).toBeGreaterThan(0)
  view.unmount()
  expect(window.electronAPI.lanpet.setDrawerExpanded).toHaveBeenLastCalledWith(false)
})
test('shop only sends catalog ids and disables unaffordable items', () => {
  const state = snapshot()
  const command = jest.fn()
  render(<WorldShop snapshot={state} command={command} busy={false} />)
  expect(screen.getByRole('button', { name: '180 코인 · 구매' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '8 코인 · 구매' }))
  expect(command).toHaveBeenCalledWith({ type: 'buy', itemId: 'rice' })
})
test.each(SPECIES)('shows three branches for $name and all six base species', species => {
  const pet = { speciesName: species.name, tree: species.branches.map((name, index) => ({ name, id: ['care', 'active', 'social'][index], score: index, appearanceId: `grown-${species.id}-care` })) }
  render(<EvolutionTree pet={pet} species={SPECIES} />)
  species.branches.forEach(name => expect(screen.getByText(name)).toBeInTheDocument())
  SPECIES.forEach(value => expect(screen.getByText(value.name)).toBeInTheDocument())
})
