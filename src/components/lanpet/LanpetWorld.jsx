import React, { useEffect, useRef, useState } from 'react'
import LanpetAvatar from './LanpetAvatar'
import LanpetScene from './LanpetScene'
import { ReadyTime, usePetClock } from './LanpetNotice'

const branchLabels = { care: '정성 · 먹이와 돌봄', active: '모험 · 열매와 놀이', social: '우정 · 케이크와 교류' }
const foodIcons = ['🍓', '🍙', '🧁']
const foodNames = ['반짝 열매', '동글 주먹밥', '우정 컵케이크']

export function PetRoom({ pet, peers = [], room = {}, roaming = false, resting = false, effect }) {
  const residents = [pet, ...peers.slice(0, 3)].filter(Boolean)
  return <div className="lanpet-room pet-room-three" data-wall={room.wall || 'cream'} aria-label="랜펫 놀이방">
    <LanpetScene residents={residents} room={room} roaming={roaming} resting={resting} effect={effect} />
    <div className="pet-room-caption"><span>{resting ? '포근한 휴식 시간' : '작은 친구들의 하루'}</span><strong>{peers.length ? '함께라서 좋아! ♡' : '오늘도 만나서 반가워'}</strong></div>
    <div className="pet-resident-tags">{residents.map((resident, index) => <span key={resident.petId || resident.peerId || index}><i style={{ background: ['#e6a4bc', '#8bbabc', '#b4a0d0', '#d2b777'][index] }} />{resident.petName || resident.name}</span>)}</div>
  </div>
}

export function EvolutionTree({ pet, species = [] }) {
  if (!pet.tree) return null
  const requirement = pet.growthRequirement
  return <section className="pet-tree"><span className="lanpet-eyebrow">함께 만든 나만의 모습</span><h3>{pet.speciesName}의 성장 나무</h3><p>먹이·돌봄·놀이·교류로 경로가 달라져요. 최종 진화 때 가장 높은 성향이 고정돼요.</p><div className="pet-tree-branches">{pet.tree.map(branch => <article key={branch.id} className={branch.leading ? 'is-leading' : ''}><LanpetAvatar stage="grown" appearanceId={branch.appearanceId} small /><strong>{branch.name}</strong><small>{branchLabels[branch.id]}</small><span>{branch.score}점 {branch.leading ? '· 현재 경로' : ''}</span></article>)}</div>
    {requirement && <p className="lanpet-secondary">다음 성장까지 · 성장 {pet.growthPoints}/{requirement.growthPoints} · 유대 {pet.bond}/{requirement.bond} · 업무시간 {Math.floor((pet.growthAgeMinutes || 0) / 60)}/{Math.ceil(requirement.minimumGrowthAgeMinutes / 60)}시간</p>}
    <details className="pet-species-book"><summary>만날 수 있는 기본 친구 6종</summary><div>{species.map(value => <article key={value.id}><LanpetAvatar stage="young" appearanceId={`young-${value.id}-base`} small /><strong>{value.name}</strong></article>)}</div></details>
  </section>
}

export function WorldShop({ snapshot, command, busy, effect }) {
  const now = usePetClock(snapshot.serverNow)
  const world = snapshot.world
  if (!world) return null
  const disabled = busy || !snapshot.enabled || !snapshot.isWorkingTime || snapshot.pet.lifecycleState !== 'active'
  return <div className="pet-world-shop"><div className="pet-shop-heading"><div><span className="lanpet-eyebrow">작은 취향을 모아요</span><h2>반짝 상점</h2><p>간식 하나, 꽃 한 송이. 우리 방에 행복을 더해요.</p></div><strong className="pet-wallet">✦ {world.balance} 코인</strong></div>
    <PetRoom pet={snapshot.pet} room={world.room} resting={!snapshot.isWorkingTime} effect={effect} />
    <h3>오늘의 간식</h3><div className="pet-shop-grid">{world.foods.map(food => <article key={food.id}><span className="pet-item-icon">{food.icon}</span><strong>{food.name}</strong><small>돌봄 +{food.care} · 즐거움 +{food.joy} · 에너지 +{food.energy}</small><small>{branchLabels[food.branch]} · 가방 {world.bag[food.id] || 0}개</small><button className="lanpet-button" disabled={disabled || world.balance < food.price || world.bag[food.id] >= 99} onClick={() => command({ type: 'buy', itemId: food.id })}>{food.price} 코인 · 구매</button><button className="lanpet-button is-primary" disabled={disabled || world.feedReadyAt > now || !(world.bag[food.id] > 0)} onClick={() => command({ type: 'feed', itemId: food.id })}>먹이 주기</button>{world.balance < food.price && <small>구매하려면 {food.price - world.balance} 코인이 더 필요해요.</small>}{!world.bag[food.id] && <small>먹이를 먼저 구매해 주세요.</small>}</article>)}</div>
    <div className="pet-limit-explanation"><p>먹이는 종류와 관계없이 5분마다 줄 수 있어요. 무료 간식은 1시간마다 한 번이며, 다른 먹이를 준 뒤에도 5분은 기다려요.</p><ReadyTime at={world.feedReadyAt} now={now} label="먹이 가능" /><ReadyTime at={world.snackReadyAt} now={now} label="무료 간식 가능" /></div>
    <button className="lanpet-button" disabled={disabled || world.snackReadyAt > now} onClick={() => command({ type: 'feed', itemId: 'snack' })}>무료 간식 주기</button>
    <h3>우리 방 꾸미기</h3><p className="lanpet-secondary">구매한 장식은 영구 보관돼요. 방에 놓기를 누르면 바로 바뀌어요.</p><div className="pet-shop-grid">{world.decorations.map(item => {
      const owned = world.owned.includes(item.id)
      const equipped = world.room[item.slot] === item.id
      let label = `${item.price} 코인 · 구매`
      if (owned) label = '방에 놓기'
      if (equipped) label = '사용 중'
      return <article key={item.id}><span className="pet-item-icon">{item.icon}</span><strong>{item.name}</strong><button className="lanpet-button" disabled={disabled || equipped || (!owned && world.balance < item.price)} onClick={() => command({ type: owned ? 'equip' : 'buy', itemId: item.id })}>{label}</button>{!owned && world.balance < item.price && <small>{item.price - world.balance} 코인이 더 필요해요.</small>}</article>
    })}</div>
  </div>
}

export function DiceResult({ own, peer, ownLabel = '내 펫', peerLabel = '친구 펫' }) {
  return <div className="pet-dice-results" aria-label="지난 턴 주사위 결과">{[[ownLabel, own], [peerLabel, peer]].map(([label, value]) => <div key={label}><span>{label}</span><b aria-label={`${value || 0}칸`}>{value ? ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value] : '·'}</b><strong>{value ? `+${value}칸` : '굴리기 전'}</strong></div>)}</div>
}

export function WorldGames({ snapshot, command, busy, effect }) {
  const gameSection = useRef(null)
  const world = snapshot.world
  const game = world?.game
  const now = usePetClock(snapshot.serverNow)
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(false); const timer = setTimeout(() => setReady(true), 1100); return () => clearTimeout(timer) }, [game?.id, game?.round])
  useEffect(() => { if (game?.status === 'playing') gameSection.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }) }, [game?.id])
  if (!world) return null
  const disabled = busy || !snapshot.enabled || !snapshot.isWorkingTime || snapshot.pet.lifecycleState !== 'active'
  const active = game?.status === 'playing' && now <= game.expiresAt
  const lotteryReady = !world.lotteryReadyAt || now >= world.lotteryReadyAt
  const rewardReady = world.gamePlaysRemaining > 0 || (world.gameReadyAt > 0 && now >= world.gameReadyAt)
  const race = game?.kind === 'race'
  const rival = { name: '연습 친구', stage: 'young', appearanceId: 'young-rabbit-base' }
  return <div className="pet-games"><div className="pet-shop-heading"><div><span className="lanpet-eyebrow">오늘의 작은 모험</span><h2>반짝 놀이터</h2><p>굴리고, 기억하고, 함께 웃어요.</p></div><strong className="pet-wallet">✦ {world.balance} 코인</strong></div>
    <div className="pet-game-cards"><article><span className="pet-item-icon">🎲</span><h3>주사위 경주</h3><p>다섯 번 굴려서 어디까지 갈까요? 매턴 1~6칸씩 전진해요.</p><button className="lanpet-button is-primary" disabled={disabled || active || !rewardReady} onClick={() => command({ type: 'gameStart', kind: 'race' })}>혼자 경주 시작</button></article><article><span className="pet-item-icon">🍓</span><h3>간식 짝맞추기</h3><p>1.1초 동안 보이는 간식을 기억하고 세 카드에서 찾아요.</p><button className="lanpet-button is-primary" disabled={disabled || active || !rewardReady} onClick={() => command({ type: 'gameStart', kind: 'memory' })}>짝맞추기 시작</button></article></div>
    <div className="pet-limit-explanation"><strong>최근 24시간 도전 {world.gamePlaysRemaining}회 남음 · 두 게임 합계 5회</strong><p>게임당 60초, 중도 종료도 1회로 계산돼요. 경주는 완주 10코인 + 이동 3칸당 1코인(최대 20), 짝맞추기는 완주 5코인 + 정답당 3코인이에요.</p><ReadyTime at={world.gameReadyAt} now={now} label="도전 1회 회복" /></div>
    {(active || game?.status === 'completed') && <section ref={gameSection} className={`pet-active-game ${race ? 'is-dice-race' : 'is-memory'}`} aria-label="진행 중인 미니게임"><div className="pet-game-heading"><h3>{race ? '한 칸씩, 작은 모험' : '어떤 간식이었을까요?'}</h3><span className="lanpet-badge">{active ? `${Math.max(0, Math.ceil((game.expiresAt - now) / 1000))}초 남음` : '완료'}</span></div>
      <LanpetScene mode={race ? 'race' : 'memory'} residents={race ? [snapshot.pet, rival] : [snapshot.pet]} room={world.room} distances={[game.distance, game.rivalDistance]} die={game.lastRoll?.own} cue={!ready && active && !race ? game.target : null} effect={game.round ? { id: `${game.id}:${game.round}`, kind: game.status === 'completed' ? 'win' : 'roll' } : null} label={race ? '주사위 경주 3D 트랙' : '간식 기억 놀이 3D 장면'} />
      {race && <><div className="pet-distance-bar"><span>내 펫 <b>{game.distance}칸</b></span><span>연습 친구 <b>{game.rivalDistance}칸</b></span></div><DiceResult own={game.lastRoll?.own} peer={game.lastRoll?.rival} peerLabel="연습 친구" /></>}
      {active && <><p className="pet-game-step">{Math.min(5, game.round + 1)}/5턴 {race ? '· 주사위는 1~6이 같은 확률로 나와요.' : `· 정답 ${game.score}개`}</p>
        {race ? <button className="pet-dice-button" disabled={disabled || !ready} onClick={() => command({ type: 'gameAction', gameId: game.id, round: game.round, choice: 'roll' })}><span aria-hidden="true">⚄</span>{ready ? '주사위 굴리기' : '주사위가 멈추는 중…'}</button> : <><div className="pet-game-cue" role="status">{ready ? '기억한 간식을 골라 주세요' : `${foodIcons[game.target]} ${foodNames[game.target]}을 기억해요`}</div><div className="pet-memory-cards">{foodIcons.map((icon, choice) => <button className="pet-memory-card" key={choice} disabled={disabled || !ready} onClick={() => command({ type: 'gameAction', gameId: game.id, round: game.round, choice })}><span>{icon}</span><small>{foodNames[choice]}</small></button>)}</div>{game.round > 0 && <p role="status">{game.lastCorrect ? '맞았어요! 반짝 기억 성공 ✦' : '아쉬워요. 다음 간식을 기억해 봐요!'}</p>}</>}
      </>}
      {game.status === 'completed' && <div className="pet-prize" role="status"><strong>{race && game.distance > game.rivalDistance ? '먼저 도착했어요!' : '멋지게 완주했어요!'}</strong><p>{race ? `다섯 번 굴려 ${game.distance}칸 이동했어요.` : `간식 ${game.score}개를 기억했어요.`} {game.reward} 코인을 받았어요.</p></div>}
    </section>}
    {game && !active && game.status !== 'completed' && <div className="pet-limit-explanation" role="status"><strong>{game.upgraded ? '경주 방식이 새로워졌어요' : '60초 도전 시간이 끝났어요'}</strong><p>{game.upgraded ? '이전 방식의 진행 중 경주는 종료됐어요. 새 주사위 경주를 시작해 주세요.' : '시작할 때 도전 횟수 1회를 사용했어요. 완주 보상은 지급되지 않지만 남은 횟수로 다시 도전할 수 있어요.'}</p></div>}
    <section className="pet-lottery"><span className="pet-item-icon">🎟️</span><div><h3>무료 행운 복권</h3><p>24시간마다 한 장, 꽝 없이 선물을 받아요.</p><small>10코인 60% · 20코인 30% · 50코인 9% · 100코인 1%</small><p className="lanpet-secondary">현금 구매·환전·코인 베팅은 없어요.</p><button className="lanpet-button is-primary" disabled={disabled || !lotteryReady} onClick={() => command({ type: 'lottery' })}>{lotteryReady ? '무료 복권 열기' : '다음 복권을 기다리는 중'}</button><ReadyTime at={world.lotteryReadyAt} now={now} label="복권 열기" />{world.lotteryPrize && <p className={`pet-prize ${effect?.kind === 'lottery' ? 'is-new-prize' : ''}`}>최근 선물: {world.lotteryPrize} 코인</p>}</div></section>
    <details><summary>최근 코인 내역</summary><ul className="pet-ledger">{world.ledger.map((entry, index) => <li key={index}>{entry.reason}<strong>{entry.amount > 0 ? '+' : ''}{entry.amount} 코인</strong></li>)}</ul></details>
  </div>
}
