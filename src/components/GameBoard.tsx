import { useState, useMemo, useEffect, useRef } from 'react';
import { useGameRoom } from '../context/GameRoomContext';
import { CardView } from './CardView';
import { canChow, canSapaw, calculateHandScore, extractMelds, isValidMeld, getChowEligibleCards } from '../lib/gameLogic';
import type { Card } from '../lib/gameLogic';
import { supabase } from '../lib/supabase';
import { playSound } from '../lib/sound';

export const GameBoard = () => {
  const { room, players, hand, myPlayerId, drawCard, chowCard, discard, dropMeld, sapawMeld, callDraw, respondToFight, leaveRoom, restartGame, playerNames, playerAvatars, myAvatarUrl, chatMessages, sendChatMessage } = useGameRoom();
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [customGroups, setCustomGroups] = useState<Card[][]>([]);
  const [finalScores, setFinalScores] = useState<any[] | null>(null);
  const [showDiscardsModal, setShowDiscardsModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat & track unread
  useEffect(() => {
    if (chatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (chatMessages.length > 0) {
      setUnreadCount(prev => prev + 1);
    }
  }, [chatMessages]);

  const isMyTurn = room?.current_turn_player_id === myPlayerId;
  
  // Auto-fix phase if stuck (e.g. dealer starts with 13 cards but is in draw phase)
  useEffect(() => {
    if (room && isMyTurn && room.turn_phase === 'draw' && hand.length >= 13) {
      supabase.from('rooms').update({ turn_phase: 'action' }).eq('id', room.id).then();
    }
  }, [room?.turn_phase, isMyTurn, hand.length]);

  useEffect(() => {
    if (room?.status === 'finished') {
      const fetchScores = async () => {
        const playerIds = players.map(p => p.id);
        const { data: hands } = await supabase.from('player_hands').select('*').in('player_id', playerIds);
        if (hands) {
          const scores = players.map(p => {
            const h = hands.find((handRow: any) => handRow.player_id === p.id);
            const cards = h ? h.hand : [];
            const { unmatched: rawUnmatched } = extractMelds(cards);
            const score = calculateHandScore(rawUnmatched);
            const folded = room.board_melds.some(m => m.type === 'fight_response' && m.playerId === p.id && m.isFold);
            const caller = room.board_melds.some(m => m.type === 'fight_caller' && m.playerId === p.id);
            return {
              ...p,
              score,
              folded,
              caller,
              cards: rawUnmatched
            };
          });

          // Find winner
          let winner = null;
          let minScore = Infinity;
          for (const s of scores) {
            if (!s.folded && s.score < minScore) {
              minScore = s.score;
              winner = s.id;
            } else if (!s.folded && s.score === minScore) {
               if (!s.caller) winner = s.id;
            }
          }
          
          if (winner === myPlayerId) playSound.win();
          else playSound.error();

          setFinalScores(scores.map(s => ({ ...s, isWinner: s.id === winner })));
        }
      };
      fetchScores();
    }
  }, [room?.status, players]);

  if (!room) return null;
  
  const ghostPlayerIds = (room.board_melds || [])
    .filter(m => m.type === 'ghost')
    .map(m => m.playerId);
    
  const opponents = players.filter(p => p.id !== myPlayerId && !ghostPlayerIds.includes(p.id));

  // Full hand analysis for scoring and burned check
  const { melds: allMelds, unmatched: allUnmatched } = useMemo(() => extractMelds(hand), [hand]);

  // Sync custom groups with current hand (remove cards no longer in hand)
  const activeCustomGroups = useMemo(() => {
    return customGroups
      .map(group => group.filter(gc => hand.some(hc => hc.suit === gc.suit && hc.rank === gc.rank)))
      .filter(group => group.length >= 2);
  }, [customGroups, hand]);

  // Set of card keys that are in custom groups
  const customGroupedKeys = useMemo(() => {
    return new Set(activeCustomGroups.flat().map(c => `${c.rank}-${c.suit}`));
  }, [activeCustomGroups]);

  // Auto-detected melds excluding cards already in custom groups
  const displayMelds = useMemo(() => {
    return allMelds
      .map(meld => meld.filter(c => !customGroupedKeys.has(`${c.rank}-${c.suit}`)))
      .filter(meld => meld.length > 0);
  }, [allMelds, customGroupedKeys]);

  // Unmatched cards excluding cards in custom groups
  const displayUnmatched = useMemo(() => {
    return allUnmatched.filter(c => !customGroupedKeys.has(`${c.rank}-${c.suit}`));
  }, [allUnmatched, customGroupedKeys]);

  const handleAutoSort = async () => {
    playSound.click();
    // Exclude custom-grouped cards from sorting
    const groupedKeys = new Set(activeCustomGroups.flat().map(c => `${c.rank}-${c.suit}`));
    const nonGroupedCards = hand.filter(c => !groupedKeys.has(`${c.rank}-${c.suit}`));
    
    const { melds: newMelds, unmatched: newUnmatched } = extractMelds(nonGroupedCards);
    
    const suitOrder = { spades: 1, hearts: 2, clubs: 3, diamonds: 4 } as any;
    const rankValue = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 } as any;
    
    const sortedUnmatched = [...newUnmatched].sort((a, b) => {
      const vA = rankValue[a.rank];
      const vB = rankValue[b.rank];
      if (vA !== vB) return vA - vB;
      return suitOrder[a.suit] - suitOrder[b.suit];
    });

    // Custom grouped cards first, then sorted non-grouped cards
    const groupedCards = activeCustomGroups.flat();
    const flattened = [...groupedCards, ...newMelds.flat(), ...sortedUnmatched];
    // Update DB to persist sort
    await supabase.from('player_hands').update({ hand: flattened }).eq('player_id', myPlayerId);
  };

  const handleGroupCards = () => {
    if (selectedCards.length < 2) return;
    playSound.click();
    // Remove selected cards from any existing custom groups
    const cleanedGroups = customGroups
      .map(group => group.filter(gc => !selectedCards.find(s => s.suit === gc.suit && s.rank === gc.rank)))
      .filter(group => group.length >= 2);
    // Add new group
    setCustomGroups([...cleanedGroups, [...selectedCards]]);
    setSelectedCards([]);
  };

  const handleUngroupCards = () => {
    playSound.click();
    // Find which group contains the first selected card and remove it
    const firstCard = selectedCards[0];
    const groupIndex = customGroups.findIndex(group =>
      group.some(gc => gc.suit === firstCard.suit && gc.rank === firstCard.rank)
    );
    if (groupIndex !== -1) {
      const newGroups = [...customGroups];
      newGroups.splice(groupIndex, 1);
      setCustomGroups(newGroups);
    }
    setSelectedCards([]);
  };

  // Check if the current selection exactly matches a custom group
  const isSelectionAGroup = selectedCards.length >= 2 && activeCustomGroups.some(group =>
    group.length === selectedCards.length &&
    group.every(gc => selectedCards.find(s => s.suit === gc.suit && s.rank === gc.rank))
  );



  const toggleSelectCard = (card: Card) => {
    playSound.click();

    // During draw phase with chow available: individual selection of eligible cards only
    if (isMyTurn && room?.turn_phase === 'draw' && showChow) {
      if (!chowEligibleKeys.has(`${card.rank}-${card.suit}`)) return; // Ignore non-eligible cards
      const isSelected = selectedCards.find(c => c.suit === card.suit && c.rank === card.rank);
      if (isSelected) {
        setSelectedCards(selectedCards.filter(c => !(c.suit === card.suit && c.rank === card.rank)));
      } else {
        setSelectedCards([...selectedCards, card]);
      }
      return;
    }
    
    // Check if the card belongs to a custom group
    const parentGroup = activeCustomGroups.find(group => 
      group.some(gc => gc.suit === card.suit && gc.rank === card.rank)
    );

    // Check if the card belongs to an auto-detected meld (balay)
    const parentMeld = !parentGroup ? displayMelds.find(meld =>
      meld.some(mc => mc.suit === card.suit && mc.rank === card.rank)
    ) : null;

    const groupToToggle = parentGroup || parentMeld;
    
    if (groupToToggle) {
      // If any card in the group/meld is already selected, deselect all of them
      const isGroupSelected = groupToToggle.some(gc => 
        selectedCards.find(c => c.suit === gc.suit && c.rank === gc.rank)
      );
      if (isGroupSelected) {
        setSelectedCards(selectedCards.filter(c => 
          !groupToToggle.find(gc => gc.suit === c.suit && gc.rank === c.rank)
        ));
      } else {
        setSelectedCards([...selectedCards, ...groupToToggle]);
      }
    } else {
      // Normal single card toggle (unmatched cards)
      const isSelected = selectedCards.find(c => c.suit === card.suit && c.rank === card.rank);
      if (isSelected) {
        setSelectedCards(selectedCards.filter(c => !(c.suit === card.suit && c.rank === card.rank)));
      } else {
        setSelectedCards([...selectedCards, card]);
      }
    }
  };

  const handleDropMeld = () => {
    playSound.cardDrop();
    dropMeld(selectedCards);
    setSelectedCards([]);
  };

  const handleDiscard = () => {
    if (selectedCards.length === 1) {
      playSound.cardDrop();
      discard(selectedCards[0]);
      setSelectedCards([]);
    } else {
      playSound.error();
    }
  };

  const handleSapaw = (meldIndex: number) => {
    if (!isMyTurn || room.turn_phase !== 'action' || selectedCards.length === 0) return;
    const targetMeldObj = room.board_melds[meldIndex];
    if (targetMeldObj.type && targetMeldObj.type !== 'meld') return;
    const targetMeld = targetMeldObj.cards || [];
    if (canSapaw(selectedCards, targetMeld)) {
      playSound.cardDrop();
      sapawMeld(selectedCards, meldIndex);
      setSelectedCards([]);
    } else {
      playSound.error();
      alert("Invalid Sapaw! These cards do not fit the meld.");
    }
  };

  const showChow = isMyTurn && room.turn_phase === 'draw' && room.discard_pile.length > 0 && canChow(room.discard_pile[room.discard_pile.length - 1], hand.filter(c => !customGroupedKeys.has(`${c.rank}-${c.suit}`)));

  const topDiscard = room.discard_pile.length > 0 ? room.discard_pile[room.discard_pile.length - 1] : null;

  // Chow-eligible cards (excluding grouped cards)
  const chowEligibleCards = useMemo(() => {
    if (!showChow || !topDiscard) return [];
    const nonGroupedHand = hand.filter(c => !customGroupedKeys.has(`${c.rank}-${c.suit}`));
    return getChowEligibleCards(topDiscard, nonGroupedHand);
  }, [showChow, topDiscard, hand, customGroupedKeys]);

  const chowEligibleKeys = useMemo(() => {
    return new Set(chowEligibleCards.map(c => `${c.rank}-${c.suit}`));
  }, [chowEligibleCards]);

  // Check if selected cards + discard form a valid chow meld
  const canConfirmChow = showChow && selectedCards.length >= 2 && topDiscard && isValidMeld([topDiscard, ...selectedCards]);

  const fightCaller = room.board_melds.find(m => m.type === 'fight_caller');
  const fightCallerPlayer = players.find(p => p.id === fightCaller?.playerId);

  const isFightActive = room.board_melds.some(m => m.type === 'fight_caller');

  // Check if player is Burned (Sunog)
  const hasDroppedMeld = room.board_melds.some(m => m.playerId === myPlayerId && (!m.type || m.type === 'meld'));
  const hasSecret4 = allMelds.some(m => m.length === 4 && m[0].rank === m[1].rank && m[1].rank === m[2].rank);
  const isBurned = !hasDroppedMeld && !hasSecret4;

  return (
    <div className="game-board">
      
      {/* Top Center Controls (POT and Leave) */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', zIndex: 100 }}>
        <div className="room-id-badge" style={{ position: 'relative', top: 0, left: 0, transform: 'none' }}>
          POT: {room.code}
        </div>
        <button 
          className="mobile-btn btn-red" 
          style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '15px' }}
          onClick={leaveRoom}
        >
          Leave Match
        </button>
      </div>

      {/* Opponents Layer */}
      <div className="opponents-layer">
        {opponents.map((op, index) => {
          const isOp1 = index === 0;
          const isDisconnected = room.board_melds?.some(m => m.type === 'player_disconnected' && m.playerId === op.id);
          return (
            <div 
              key={op.id} 
              style={{ 
                position: 'absolute', top: 20, [isOp1 ? 'left' : 'right']: 20, 
                pointerEvents: 'auto', display: 'flex', flexDirection: 'column', 
                alignItems: isOp1 ? 'flex-start' : 'flex-end',
                opacity: isDisconnected ? 0.6 : 1
              }}
            >
              <div className={`opponent-box ${room.current_turn_player_id === op.id && !isDisconnected ? 'active-turn' : ''}`} style={{ position: 'relative', background: 'transparent', border: 'none', flexDirection: 'row', gap: '15px' }}>
                {isOp1 && (
                  <div style={{ position: 'relative' }}>
                    <div className="avatar" style={{ filter: isDisconnected ? 'grayscale(100%)' : 'none' }}>
                      <img src={playerAvatars[op.user_id] || `https://api.dicebear.com/7.x/avataaars/svg?seed=${op.id}`} alt="avatar" style={{width:'100%', height:'100%', objectFit: 'cover'}} />
                    </div>
                    <div className="card-badge" style={{ right: -10 }}>{op.card_count}</div>
                  </div>
                )}
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOp1 ? 'flex-start' : 'flex-end', justifyContent: 'center' }}>
                  <div className="op-name" style={{ color: isDisconnected ? '#9ca3af' : 'white' }}>
                    {isDisconnected ? 'Disconnected' : (playerNames[op.user_id] || `Player ${op.position}`)}
                  </div>
                  <div className="op-coins">🪙 100,000</div>
                </div>

                {!isOp1 && (
                  <div style={{ position: 'relative' }}>
                    <div className="avatar" style={{ filter: isDisconnected ? 'grayscale(100%)' : 'none' }}>
                      <img src={playerAvatars[op.user_id] || `https://api.dicebear.com/7.x/avataaars/svg?seed=${op.id}`} alt="avatar" style={{width:'100%', height:'100%', objectFit: 'cover'}} />
                    </div>
                    <div className="card-badge" style={{ left: -10 }}>{op.card_count}</div>
                  </div>
                )}
              </div>
              
              {/* Opponent's Dropped Melds */}
              <div style={{ display: 'flex', flexDirection: 'row', gap: '5px', marginTop: '10px', alignItems: 'center' }}>
                {room.board_melds.map((meldObj, i) => (meldObj.playerId === op.id && (!meldObj.type || meldObj.type === 'meld')) ? (
                  <div key={i} className="meld-group" onClick={() => handleSapaw(i)} style={{ cursor: selectedCards.length > 0 && isMyTurn && room.turn_phase === 'action' && !isFightActive ? 'pointer' : 'default' }}>
                    {meldObj.cards?.map((c, j) => (
                      <CardView key={j} card={c} small />
                    ))}
                  </div>
                ) : null)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="center-table">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="deck-and-discard">
            
            <div className="pile-container" onClick={() => { 
              if (isMyTurn && room.turn_phase === 'draw' && !isFightActive) {
                playSound.cardDraw();
                drawCard(); 
              }
            }}>
              <div className={`deck-stack ${isMyTurn && room.turn_phase === 'draw' && !isFightActive ? 'pulse' : ''}`}>
                <span className="deck-count">{room.deck.length}</span>
              </div>
              <span className="pile-label">Deck</span>
            </div>

            <div className="pile-container" onClick={() => { 
              if (showChow && !isFightActive) {
                if (canConfirmChow) {
                  // Chow with player's selected cards
                  playSound.cardDraw();
                  chowCard(selectedCards);
                  setSelectedCards([]);
                } else if (selectedCards.length === 0) {
                  // Auto-chow if no cards selected
                  playSound.cardDraw();
                  chowCard(); 
                }
              }
            }}>
              {room.discard_pile.length > 0 ? (
                <div style={{position: 'relative'}}>
                  <CardView card={room.discard_pile[room.discard_pile.length - 1]} />
                  {showChow && !isFightActive && <div style={{position: 'absolute', top: -10, right: -10, background: 'var(--btn-yellow)', color: 'black', padding: '2px 8px', borderRadius: 10, fontWeight: 'bold', fontSize: '0.8rem', zIndex: 10}}>CHOW!</div>}
                </div>
              ) : (
                <div className="discard-slot"></div>
              )}
              <span className="pile-label">Discard</span>
            </div>

          </div>

          {room.discard_pile.length > 0 && (
            <button 
              onClick={(e) => { e.stopPropagation(); setShowDiscardsModal(true); }}
              className="view-history-arrow"
            >
              <svg viewBox="0 0 24 24" fill="url(#yellow-grad)" stroke="#854d0e" strokeWidth="1" style={{ filter: 'drop-shadow(2px 2px 2px rgba(0,0,0,0.5))' }}>
                <defs>
                  <linearGradient id="yellow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fef08a" />
                    <stop offset="100%" stopColor="#ca8a04" />
                  </linearGradient>
                </defs>
                <polygon points="5,3 21,12 5,21" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Player Hand & Actions Bottom Area */}
      <div className="player-bottom-area">
        
        {/* Action Bar (Top of hand) */}
        <div className="action-bar">
          {room.status === 'waiting' && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: '1.2rem', padding: '10px 20px', background: 'rgba(0,0,0,0.5)', borderRadius: '20px' }}>
                Waiting for players... ({players.length}/3)
              </div>
              <button 
                className="mobile-btn btn-red" 
                style={{ padding: '10px 20px', fontSize: '1.1rem' }}
                onClick={leaveRoom}
              >
                Leave Room
              </button>
            </div>
          )}

          {isMyTurn && room.status === 'playing' && !isFightActive && (
            <>
              {room.turn_phase === 'draw' && (
                <>
                  <button 
                    className="mobile-btn btn-yellow" 
                    onClick={() => { playSound.fight(); callDraw(); }} 
                    disabled={!room.board_melds.some(m => m.playerId === myPlayerId && (!m.type || m.type === 'meld'))}
                  >
                    Fight
                  </button>
                  <button className="mobile-btn btn-blue" onClick={() => { playSound.cardDraw(); drawCard(); }}>
                    Draw
                  </button>
                  {canConfirmChow && (
                    <button className="mobile-btn btn-green" onClick={() => {
                      playSound.cardDraw();
                      chowCard(selectedCards);
                      setSelectedCards([]);
                    }}>
                      Chow
                    </button>
                  )}
                </>
              )}
              {room.turn_phase === 'action' && (
                <>
                  <button className="mobile-btn btn-red" onClick={handleDropMeld} disabled={selectedCards.length < 3}>
                    Drop
                  </button>
                  <button className="mobile-btn btn-yellow" onClick={() => { playSound.fight(); callDraw(); }} disabled={!room.board_melds.some(m => m.playerId === myPlayerId && (!m.type || m.type === 'meld'))}>
                    Fight
                  </button>
                  <button className="mobile-btn btn-green" onClick={() => { playSound.click(); handleAutoSort(); }}>
                    Sort
                  </button>
                  {selectedCards.length >= 2 && (
                    isSelectionAGroup ? (
                      <button className="mobile-btn btn-orange" onClick={handleUngroupCards}>
                        Ungroup
                      </button>
                    ) : (
                      <button className="mobile-btn btn-orange" onClick={handleGroupCards}>
                        Group
                      </button>
                    )
                  )}
                  <button className="mobile-btn btn-purple" onClick={handleDiscard} disabled={selectedCards.length !== 1}>
                    Dump
                  </button>
                </>
              )}
            </>
          )}

          {room.status === 'finished' && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: '1.2rem', padding: '10px 20px', background: 'rgba(0,0,0,0.5)', borderRadius: '20px' }}>
                Game Over!
              </div>
              <button 
                className="mobile-btn btn-blue" 
                onClick={() => restartGame(myPlayerId!)}
                disabled={players.length < 2}
              >
                {players.length < 2 ? 'Need more players to restart' : 'Play Again'}
              </button>
              <button 
                className="mobile-btn btn-red" 
                onClick={leaveRoom}
              >
                Leave Room
              </button>
            </div>
          )}
        </div>

        {/* My Dropped Melds */}
        <div style={{ display: 'flex', gap: '15px', pointerEvents: 'auto', marginBottom: '10px' }}>
          {room.board_melds.map((meldObj, i) => (meldObj.playerId === myPlayerId && (!meldObj.type || meldObj.type === 'meld')) ? (
            <div key={i} className="meld-group" onClick={() => handleSapaw(i)} style={{ cursor: selectedCards.length > 0 && isMyTurn && room.turn_phase === 'action' && !isFightActive ? 'pointer' : 'default' }}>
              {meldObj.cards?.map((c, j) => (
                <CardView key={j} card={c} small />
              ))}
            </div>
          ) : null)}
        </div>

        {/* The Hand */}
        <div className="hand-container">
          
          <div className={`player-info ${isMyTurn ? 'active-turn' : ''}`} style={{ position: 'relative' }}>
            <div className="avatar">
              <img src={myAvatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${myPlayerId}`} alt="avatar" style={{width:'100%', height:'100%', objectFit: 'cover'}} />
            </div>
            <div className="op-coins">🪙 100,000</div>
          </div>

          {/* Render user custom groups */}
          {activeCustomGroups.map((group, index) => (
            <div key={`custom-group-${index}`} className="hand-group" style={{ borderBottom: '3px solid #f97316', borderRadius: '0 0 8px 8px', paddingBottom: '4px' }}>
              {group.map((card, idx) => (
                <CardView 
                  key={`cg-${card.rank}-${card.suit}-${idx}`} 
                  card={card} 
                  selected={!!selectedCards.find(c => c.suit === card.suit && c.rank === card.rank)}
                  highlighted={chowEligibleKeys.has(`${card.rank}-${card.suit}`)}
                  onClick={toggleSelectCard}
                />
              ))}
            </div>
          ))}

          {/* Render auto-detected melds (excluding custom grouped cards) */}
          {displayMelds.map((meldGroup, index) => (
            <div key={`meld-group-${index}`} className="hand-group">
              {meldGroup.map((card, idx) => (
                <CardView 
                  key={`meld-${card.rank}-${card.suit}-${idx}`} 
                  card={card} 
                  selected={!!selectedCards.find(c => c.suit === card.suit && c.rank === card.rank)}
                  highlighted={chowEligibleKeys.has(`${card.rank}-${card.suit}`)}
                  onClick={toggleSelectCard}
                />
              ))}
            </div>
          ))}

          {/* Render remaining unmatched cards */}
          {displayUnmatched.length > 0 && (
            <div className="hand-group">
              {displayUnmatched.map((card, idx) => (
                <CardView 
                  key={`unmatch-${card.rank}-${card.suit}-${idx}`} 
                  card={card} 
                  selected={!!selectedCards.find(c => c.suit === card.suit && c.rank === card.rank)}
                  highlighted={chowEligibleKeys.has(`${card.rank}-${card.suit}`)}
                  onClick={toggleSelectCard}
                />
              ))}
            </div>
          )}
          
          <div className="points-badge">
            <span>Point</span>
            <strong>{calculateHandScore(allUnmatched)}</strong>
          </div>

        </div>
      </div>

      {/* Fight Modal */}
      {isFightActive && room.status === 'playing' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', 
          justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px'
        }}>
          <h1 style={{ fontSize: '3rem', color: 'var(--btn-red)', textShadow: '0 5px 15px rgba(0,0,0,0.8)', marginBottom: '10px' }}>
            FIGHT CALLED
          </h1>
          <p style={{ color: 'white', fontSize: '1.5rem', marginBottom: '40px' }}>
            {fightCallerPlayer ? (playerNames[fightCallerPlayer.user_id] || `Player ${fightCallerPlayer.position}`) : 'Someone'} has called a Draw!
          </p>
          
          {isMyTurn ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
              {isBurned && (
                <div style={{ color: '#ef4444', fontSize: '1.2rem', fontWeight: 'bold', background: 'rgba(0,0,0,0.6)', padding: '10px 20px', borderRadius: '10px' }}>
                  🔥 You are BURNED! You have no dropped melds or special 4-of-a-kind.
                </div>
              )}
              <div style={{ display: 'flex', gap: '20px' }}>
                <button className="mobile-btn btn-red" style={{ fontSize: '1.5rem', padding: '15px 40px' }} onClick={() => { playSound.click(); respondToFight(true); }}>
                  {isBurned ? 'FOLD (Burned)' : 'FOLD'}
                </button>
                {!isBurned && (
                  <button className="mobile-btn btn-yellow" style={{ fontSize: '1.5rem', padding: '15px 40px' }} onClick={() => { playSound.fight(); respondToFight(false); }}>
                    FIGHT!
                  </button>
                )}
              </div>
            </div>
          ) : (
             <div style={{ color: '#fef08a', fontSize: '1.2rem', padding: '20px', background: 'rgba(0,0,0,0.5)', borderRadius: '20px' }}>
                Waiting for {players.find(p => p.id === room.current_turn_player_id) ? (playerNames[players.find(p => p.id === room.current_turn_player_id)!.user_id] || `Player ${players.find(p => p.id === room.current_turn_player_id)!.position}`) : 'opponent'} to respond...
             </div>
          )}
        </div>
      )}

      {/* Game Over Scoreboard */}
      {room.status === 'finished' && finalScores && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', 
          justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px'
        }}>
          <h1 style={{ fontSize: '4rem', color: 'var(--btn-yellow)', textShadow: '0 5px 15px rgba(0,0,0,0.8)', marginBottom: '20px' }}>
            {finalScores.find(s => s.isWinner)?.id === myPlayerId ? '🎉 YOU WIN! 🎉' : 'GAME OVER'}
          </h1>
          
          <div style={{ background: '#1e293b', padding: '30px', borderRadius: '20px', width: '100%', maxWidth: '600px', marginBottom: '40px' }}>
            {finalScores.map(scoreObj => (
              <div key={scoreObj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderBottom: '1px solid #334155', background: scoreObj.isWinner ? 'rgba(254, 240, 138, 0.1)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div className="avatar" style={{ transform: 'scale(0.8)' }}>P{scoreObj.position}</div>
                  <span style={{ color: 'white', fontSize: '1.2rem', fontWeight: scoreObj.isWinner ? 'bold' : 'normal' }}>
                    {scoreObj.id === myPlayerId ? 'You' : (playerNames[scoreObj.user_id] || `Player ${scoreObj.position}`)} 
                    {scoreObj.caller && ' (Caller)'}
                  </span>
                </div>
                
                <div style={{ color: scoreObj.folded ? '#ef4444' : '#fef08a', fontSize: '1.5rem', fontWeight: 'bold' }}>
                  {scoreObj.folded ? 'FOLDED' : `${scoreObj.score} PTS`}
                  {scoreObj.isWinner && ' 🏆'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '20px' }}>
            <button 
              className="mobile-btn btn-blue" 
              style={{ fontSize: '1.5rem', padding: '15px 40px' }}
              onClick={leaveRoom}
            >
              Leave Room
            </button>
            <button 
              className="mobile-btn btn-green" 
              style={{ fontSize: '1.5rem', padding: '15px 40px' }}
              onClick={() => {
                const winner = finalScores?.find(s => s.isWinner);
                if (winner) {
                  restartGame(winner.id);
                }
              }}
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* Discards Modal */}
      {showDiscardsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', 
          justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px'
        }}>
          <h2 style={{ color: 'white', marginBottom: '30px', fontSize: '2rem' }}>Discarded Cards History</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'center', maxWidth: '90%', maxHeight: '60vh', overflowY: 'auto', padding: '20px' }}>
            {room.discard_pile.map((c, i) => (
              <CardView key={i} card={c} />
            ))}
          </div>
          <button className="mobile-btn btn-red" style={{ marginTop: '30px', padding: '15px 40px', fontSize: '1.2rem' }} onClick={() => setShowDiscardsModal(false)}>
            Close
          </button>
        </div>
      )}

      {/* Chat Box - Collapsible */}
      <div className={`chat-box-container ${chatOpen ? 'chat-open' : 'chat-closed'}`}>
        <div className="chat-toggle" onClick={() => { setChatOpen(!chatOpen); if (!chatOpen) setUnreadCount(0); }}>
          {chatOpen ? '▼ Chat' : `💬 Chat${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
        </div>
        {chatOpen && (
          <>
            <div className="chat-messages">
              {chatMessages.map((msg) => (
                <div key={msg.id} className="chat-message">
                  <span className="chat-sender">{msg.senderName}:</span>
                  <span className="chat-text">{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form className="chat-input-area" onSubmit={(e) => {
              e.preventDefault();
              sendChatMessage(chatInput);
              setChatInput('');
            }}>
              <input 
                type="text" 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)} 
                placeholder="Type a message..." 
                maxLength={100}
              />
              <button type="submit" disabled={!chatInput.trim()}>Send</button>
            </form>
          </>
        )}
      </div>

    </div>
  );
};
