import React, { useEffect, useState } from 'react'
import LanpetAvatar from './LanpetAvatar'

const branchLabels = { care: '정성 · 먹이와 돌봄', active: '모험 · 열매와 놀이', social: '우정 · 케이크와 교류' }
const foodIcons = ['🍓', '🍙', '🧁']
const laneLabels = ['왼쪽', '가운데', '오른쪽']

export function PetRoom({ pet, peers = [], room = {}, roaming = false, resting = false }) {
  const furnitureIcons = { plant: '🪴', sofa: '🛋️', piano: '🎹', castle: '🏰' }
  return <div className={`lanpet-room wall-${room.wall || 'cream'} floor-${room.floor || 'parquet'} ${roaming && !resting ? 'is-roaming' : ''}`} aria-label="랜펫 놀이방">
    <div className="pet-room-molding" /><div className="pet-room-window is-left"><i /><b /></div><div className="pet-room-window is-right"><i /><b /></div>
    <div className="pet-room-picture" aria-hidden="true">☀️</div><div className="pet-room-floor" /><div className="pet-room-rug" />
    <span className="pet-room-furniture" aria-hidden="true">{furnitureIcons[room.furniture] || '🪴'}</span>
    <div className="pet-room-residents">{[pet, ...peers.slice(0, 3)].filter(Boolean).map((resident, index) => <div key={resident.petId || resident.peerId || index} className={`pet-room-resident resident-${index}`}><LanpetAvatar stage={resident.stage} appearanceId={resident.appearanceId} resting={resting} /><span>{resident.petName || resident.name}</span></div>)}</div>
    {peers.length > 0 && <span className="pet-room-bubble">같이 놀아서 좋아! ♡</span>}
  </div>
}

export function EvolutionTree({ pet, species = [] }) {
  if (!pet.tree) return null
  const requirement = pet.growthRequirement
  return <section className="pet-tree"><h3>{pet.speciesName}의 성장 나무</h3><p>함께한 경험이 다음 모습을 결정해요. 마지막 진화 때 가장 높은 성향이 고정돼요.</p><div className="pet-tree-branches">{pet.tree.map(branch => <article key={branch.id} className={branch.leading ? 'is-leading' : ''}><LanpetAvatar stage="grown" appearanceId={branch.appearanceId} small /><strong>{branch.name}</strong><small>{branchLabels[branch.id]}</small><span>{branch.score}점 {branch.leading ? '· 현재 경로' : ''}</span></article>)}</div>
    {requirement && <p className="lanpet-secondary">다음 성장까지 · 성장 {pet.growthPoints}/{requirement.growthPoints} · 유대 {pet.bond}/{requirement.bond} · 업무시간 {Math.floor((pet.growthAgeMinutes || 0) / 60)}/{Math.ceil(requirement.minimumGrowthAgeMinutes / 60)}시간</p>}
    <details className="pet-species-book"><summary>만날 수 있는 기본 친구 6종</summary><div>{species.map(value => <article key={value.id}><LanpetAvatar stage="young" appearanceId={`young-${value.id}-base`} small /><strong>{value.name}</strong></article>)}</div></details>
  </section>
}

export function WorldShop({ snapshot, command, busy }) {
  const world = snapshot.world
  if (!world) return null
  const disabled = busy || !snapshot.enabled || !snapshot.isWorkingTime || snapshot.pet.lifecycleState !== 'active'
  return <div className="pet-world-shop"><div className="pet-shop-heading"><div><span className="lanpet-eyebrow">어서 오세요!</span><h2>반짝 상점</h2><p>간식을 골라 주고, 좋아하는 물건으로 방을 채워요.</p></div><strong className="pet-wallet">✦ {world.balance} 코인</strong></div>
    <PetRoom pet={snapshot.pet} room={world.room} resting={!snapshot.isWorkingTime} />
    <h3>오늘의 간식</h3><div className="pet-shop-grid">{world.foods.map(food => <article key={food.id}><span className="pet-item-icon">{food.icon}</span><strong>{food.name}</strong><small>돌봄 +{food.care} · 기분 +{food.joy} · 에너지 +{food.energy}</small><small>{branchLabels[food.branch]} · 가방 {world.bag[food.id] || 0}개</small><button className="lanpet-button" disabled={disabled || world.balance < food.price} onClick={() => command({ type: 'buy', itemId: food.id })}>{food.price} 코인 · 구매</button><button className="lanpet-button is-primary" disabled={disabled || !(world.bag[food.id] > 0)} onClick={() => command({ type: 'feed', itemId: food.id })}>먹이 주기</button></article>)}</div>
    <p className="lanpet-secondary">먹이는 5분마다 줄 수 있어요. 코인이 없어도 무료 간식을 1시간마다 줄 수 있어요.</p><button className="lanpet-button" disabled={disabled} onClick={() => command({ type: 'feed', itemId: 'snack' })}>무료 간식 주기</button>
    <h3>우리 방 꾸미기</h3><div className="pet-shop-grid">{world.decorations.map(item => {
      const owned = world.owned.includes(item.id)
      const equipped = world.room[item.slot] === item.id
      let label = `${item.price} 코인 · 구매`
      if (owned) label = '방에 놓기'
      if (equipped) label = '사용 중'
      return <article key={item.id}><span className="pet-item-icon">{item.icon}</span><strong>{item.name}</strong><button className="lanpet-button" disabled={disabled || equipped || (!owned && world.balance < item.price)} onClick={() => command({ type: owned ? 'equip' : 'buy', itemId: item.id })}>{label}</button></article>
    })}</div>
  </div>
}

export function WorldGames({ snapshot, command, busy }) {
  const world = snapshot.world
  const game = world?.game
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setReady(false)
    const timer = setTimeout(() => setReady(true), 1100)
    return () => clearTimeout(timer)
  }, [game?.id, game?.round])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!world) return null
  const disabled = busy || !snapshot.enabled || !snapshot.isWorkingTime || snapshot.pet.lifecycleState !== 'active'
  const active = game?.status === 'playing' && now <= game.expiresAt
  const lotteryReady = !world.lotteryReadyAt || now >= world.lotteryReadyAt
  let cue = '무엇이었을까요?'
  if (game?.kind === 'race') cue = `안전한 길: ${laneLabels[game.target]}`
  else if (game && !ready) cue = foodIcons[game.target]
  return <div className="pet-games"><div className="pet-shop-heading"><div><span className="lanpet-eyebrow">잠깐의 놀이, 작은 보상</span><h2>반짝 놀이터</h2></div><strong className="pet-wallet">✦ {world.balance} 코인</strong></div>
    <div className="pet-game-cards"><article><span className="pet-item-icon">🏁</span><h3>장애물 경주</h3><p>안전한 길을 골라 다섯 구간을 달려요.</p><button className="lanpet-button is-primary" disabled={disabled || active || !world.gamePlaysRemaining} onClick={() => command({ type: 'gameStart', kind: 'race' })}>혼자 경주 시작</button></article><article><span className="pet-item-icon">🍓</span><h3>간식 짝맞추기</h3><p>잠깐 보이는 간식을 기억하고 골라요.</p><button className="lanpet-button is-primary" disabled={disabled || active || !world.gamePlaysRemaining} onClick={() => command({ type: 'gameStart', kind: 'memory' })}>짝맞추기 시작</button></article></div>
    <p className="lanpet-secondary">최근 24시간 도전 {world.gamePlaysRemaining}회 남음 · 두 게임 합계 5회 · 제한 60초 · 완주 5코인 + 정답당 3코인</p>
    {active && <section className="pet-active-game" aria-label="진행 중인 미니게임"><h3>{game.kind === 'race' ? '안전한 길로 달려요!' : '어떤 간식이었을까요?'}</h3><p>5구간 중 {game.round + 1}구간 · 정답 {game.score}개 · {Math.max(0, Math.ceil((game.expiresAt - now) / 1000))}초</p>
      <div className="pet-race-track"><div style={{ left: `${8 + game.round * 16}%` }}><LanpetAvatar stage={snapshot.pet.stage} appearanceId={snapshot.pet.appearanceId} small /></div><span>🏁</span></div>
      <div className="pet-game-cue" role="status">{cue}</div><div className="lanpet-move-grid">{[0, 1, 2].map(choice => <button className="lanpet-button" key={choice} disabled={disabled || !ready} onClick={() => command({ type: 'gameAction', gameId: game.id, round: game.round, choice })}>{game.kind === 'race' ? laneLabels[choice] : foodIcons[choice]}</button>)}</div>
    </section>}
    {game?.status === 'completed' && <p className="pet-prize" role="status">완주했어요! 정답 {game.score}개 · {game.reward} 코인을 받았어요.</p>}
    {game && !active && game.status !== 'completed' && <p role="status">게임 시간이 끝났어요. 다음 도전에서 만나요!</p>}
    <section className="pet-lottery"><span className="pet-item-icon">🎟️</span><div><h3>무료 행운 복권</h3><p>24시간마다 한 장, 꽝 없이 선물을 받아요.</p><small>10코인 60% · 20코인 30% · 50코인 9% · 100코인 1%</small><p className="lanpet-secondary">현금 구매·환전·코인 베팅은 없어요.</p><button className="lanpet-button is-primary" disabled={disabled || !lotteryReady} onClick={() => command({ type: 'lottery' })}>{lotteryReady ? '무료 복권 열기' : '다음 복권을 기다리는 중'}</button>{world.lotteryPrize && <p className="pet-prize">최근 선물: {world.lotteryPrize} 코인</p>}</div></section>
    <details><summary>최근 코인 내역</summary><ul className="pet-ledger">{world.ledger.map((entry, index) => <li key={index}>{entry.reason}<strong>{entry.amount > 0 ? '+' : ''}{entry.amount} 코인</strong></li>)}</ul></details>
  </div>
}
