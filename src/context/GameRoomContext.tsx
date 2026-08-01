import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { generateDeck, shuffleDeck, isValidMeld, extractMelds, calculateHandScore, getValidChowMeld } from '../lib/gameLogic';
import type { Card } from '../lib/gameLogic';

export type RoomStatus = 'waiting' | 'playing' | 'fight' | 'finished';
export type TurnPhase = 'draw' | 'action';

export interface RoomMeld {
  playerId: string;
  cards?: Card[];
  type?: 'meld' | 'fight_caller' | 'fight_response' | 'player_disconnected' | 'ghost';
  isFold?: boolean;
}

export interface Room {
  id: string;
  code?: string;
  status: RoomStatus;
  turn_phase: TurnPhase;
  current_turn_player_id: string | null;
  deck: Card[];
  discard_pile: Card[];
  board_melds: RoomMeld[];
}

export interface Player {
  id: string;
  room_id: string;
  user_id: string;
  position: number;
  card_count: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface GameRoomContextProps {
  userId: string | null;
  authError: string | null;
  room: Room | null;
  players: Player[];
  hand: Card[];
  myPlayerId: string | null;
  createRoom: () => Promise<void>;
  joinRoom: (roomId: string) => Promise<void>;
  startGame: () => Promise<void>;
  drawCard: () => Promise<void>;
  chowCard: (selectedHandCards?: Card[]) => Promise<void>;
  discard: (card: Card) => Promise<void>;
  dropMeld: (cards: Card[]) => Promise<void>;
  sapawMeld: (cards: Card[], targetMeldIndex: number) => Promise<void>;
  callDraw: () => Promise<void>;
  respondToFight: (isFold: boolean) => Promise<void>;
  leaveRoom: () => Promise<void>;
  restartGame: (winnerId: string) => Promise<void>;
  playerNames: Record<string, string>;
  playerAvatars: Record<string, string>;
  myDisplayName: string;
  myAvatarUrl: string;
  chatMessages: ChatMessage[];
  sendChatMessage: (text: string) => void;
}

const GameRoomContext = createContext<GameRoomContextProps | undefined>(undefined);

export const GameRoomProvider = ({ children }: { children: ReactNode }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [hand, setHand] = useState<Card[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [authError] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});
  
  const [myDisplayName, setMyDisplayName] = useState<string>('');
  const [myAvatarUrl, setMyAvatarUrl] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // Realtime channel reference for chat broadcasting
  const [roomChannel, setRoomChannel] = useState<any>(null);

  // Listen for auth state changes
  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session?.user?.is_anonymous) {
        supabase.auth.signOut();
        setUserId(null);
      } else {
        setUserId(session?.user?.id || null);
        if (session?.user) {
          const email = session.user.email || '';
          const namePrefix = email.split('@')[0];
          const fallbackName = namePrefix ? namePrefix.charAt(0).toUpperCase() + namePrefix.slice(1) : `Player`;
          setMyDisplayName(session.user.user_metadata?.display_name || fallbackName);
          setMyAvatarUrl(session.user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`);
        }
      }
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user?.is_anonymous) {
        setUserId(null);
      } else {
        setUserId(session?.user?.id || null);
        if (session?.user) {
          const email = session.user.email || '';
          const namePrefix = email.split('@')[0];
          const fallbackName = namePrefix ? namePrefix.charAt(0).toUpperCase() + namePrefix.slice(1) : `Player`;
          setMyDisplayName(session.user.user_metadata?.display_name || fallbackName);
          setMyAvatarUrl(session.user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Reconnect logic on refresh
  useEffect(() => {
    if (!userId || room) return;
    
    const tryReconnect = async () => {
      // Find if player is in a room (just check recent ones)
      const { data: player } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false })
        .limit(1)
        .single();
        
      if (player) {
        // Check if room is still active
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', player.room_id)
          .single();
          
        if (existingRoom && existingRoom.status !== 'finished') {
          const isDisconnected = existingRoom.board_melds?.some((m: any) => 
            (m.type === 'player_disconnected' || m.type === 'ghost') && m.playerId === player.id
          );
          if (!isDisconnected) {
            setMyPlayerId(player.id);
            setRoom(existingRoom as Room);
          } else {
            // I was disconnected — clean up my own records so I'm fully removed from the room
            await supabase.from('player_hands').delete().eq('player_id', player.id);
            await supabase.from('players').delete().eq('id', player.id);
            
            // Remove my disconnected/ghost flag from board_melds
            const cleanMelds = (existingRoom.board_melds || []).filter((m: any) => m.playerId !== player.id);
            await supabase.from('rooms').update({ board_melds: cleanMelds }).eq('id', existingRoom.id);
            
            // Check if room is now empty
            const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('room_id', existingRoom.id);
            if (count === 0) {
              await supabase.from('rooms').delete().eq('id', existingRoom.id);
            }
          }
        }
      }
    };
    
    tryReconnect();
  }, [userId]);

  // Listen to room changes
  useEffect(() => {
    if (!room?.id) return;
    
    const roomSub = supabase.channel('room_updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, (payload: any) => {
        setRoom(payload.new as Room);
      })
      .subscribe();

    const playersSub = supabase.channel(`players_updates_${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async () => {
        // We listen to all events globally to bypass the REPLICA IDENTITY issue for DELETE events
        const { data } = await supabase.from('players').select('*').eq('room_id', room.id).order('position');
        if (data) setPlayers(data);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomSub);
      supabase.removeChannel(playersSub);
    }
  }, [room?.id]);

  // Handle Player Presence for Names and Avatars
  useEffect(() => {
    if (!room?.id || !userId) return;
    
    let presenceChannel: any = null;

    supabase.auth.getUser().then(({ data: { user } }: any) => {
      if (!user) return;
      const email = user.email || '';
      const metadataName = user.user_metadata?.display_name;
      const metadataAvatar = user.user_metadata?.avatar_url;

      const namePrefix = email.split('@')[0];
      const fallbackName = namePrefix ? namePrefix.charAt(0).toUpperCase() + namePrefix.slice(1) : `Player ${userId.substring(0,4)}`;
      const name = metadataName || fallbackName;
      const avatar = metadataAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;
      
      presenceChannel = supabase.channel(`presence_${room.id}`);
      
      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel.presenceState();
          const newNames: Record<string, string> = {};
          const newAvatars: Record<string, string> = {};
          for (const id in state) {
            const presences = state[id] as any[];
            if (presences.length > 0) {
              newNames[presences[0].userId] = presences[0].name;
              newAvatars[presences[0].userId] = presences[0].avatar;
            }
          }
          setPlayerNames(prev => ({ ...prev, ...newNames }));
          setPlayerAvatars(prev => ({ ...prev, ...newAvatars }));
        })
        .on('broadcast', { event: 'chat_message' }, (payload: any) => {
          setChatMessages((prev) => [...prev, payload.payload as ChatMessage]);
          if (payload.payload.senderId !== userId) {
            import('../lib/sound').then(({ playSound }) => playSound.click()); // Quick blip for incoming chat
          }
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await presenceChannel.track({
              userId: userId,
              name: name,
              avatar: avatar
            });
          }
        });
        
      setRoomChannel(presenceChannel);
    });

    return () => {
      if (presenceChannel) {
        supabase.removeChannel(presenceChannel);
      }
    };
  }, [room?.id, userId]);

  // Polling fallback to guarantee player list is always synced even if Realtime drops DELETE events
  useEffect(() => {
    if (!room?.id) return;
    const interval = setInterval(async () => {
      const { data } = await supabase.from('players').select('*').eq('room_id', room.id).order('position');
      if (data) setPlayers(data);
    }, 2500);
    return () => clearInterval(interval);
  }, [room?.id]);

  // Bot Auto-Play Logic
  useEffect(() => {
    if (!room || !myPlayerId || !players.length) return;
    
    const disconnectedPlayerIds = (room.board_melds || [])
      .filter(m => m.type === 'player_disconnected')
      .map(m => m.playerId);
      
    if (!disconnectedPlayerIds.includes(room.current_turn_player_id || '')) return;
    
    // Determine Host (active player with lowest position)
    const activePlayers = players.filter(p => !disconnectedPlayerIds.includes(p.id)).sort((a, b) => a.position - b.position);
    if (activePlayers.length === 0) return;
    if (activePlayers[0].id !== myPlayerId) return; // Only Host runs the bot
    
    const autoPlayBot = async () => {
      const botId = room.current_turn_player_id!;
      const botPlayer = players.find(p => p.id === botId);
      let nextPos = (botPlayer?.position || 1) + 1;
      if (nextPos > players.length) nextPos = 1;
      const nextPlayer = players.find(p => p.position === nextPos);
      
      // Check if a fight is active — bot auto-folds
      const isFightActive = (room.board_melds || []).some(m => m.type === 'fight_caller');
      if (isFightActive) {
        const newMelds: RoomMeld[] = [...room.board_melds, { type: 'fight_response', playerId: botId, isFold: true }];
        const fightCallerEvent = room.board_melds.find(m => m.type === 'fight_caller');
        
        if (fightCallerEvent && nextPlayer?.id === fightCallerEvent.playerId) {
          // Fight cycle is complete
          await supabase.from('rooms').update({ 
            status: 'finished',
            board_melds: newMelds
          }).eq('id', room.id);
        } else {
          // Pass to next player to respond
          await supabase.from('rooms').update({ 
            board_melds: newMelds,
            current_turn_player_id: nextPlayer?.id
          }).eq('id', room.id);
        }
        return;
      }

      if (room.turn_phase === 'draw') {
        if (room.deck.length === 0) {
          await supabase.from('rooms').update({ status: 'finished' }).eq('id', room.id);
          return;
        }
        
        // RLS prevents reading other players' hands. 
        // So the bot will just instantly draw from the deck, throw that same card away, and pass the turn!
        const newDeck = [...room.deck];
        const drawnCard = newDeck.shift()!;
        
        await supabase.from('rooms').update({ 
          deck: newDeck,
          discard_pile: [...room.discard_pile, drawnCard],
          turn_phase: 'draw',
          current_turn_player_id: nextPlayer?.id
        }).eq('id', room.id);
        
      } else if (room.turn_phase === 'action') {
        // If they disconnected during their action phase, just pass the turn.
        await supabase.from('rooms').update({ 
          turn_phase: 'draw',
          current_turn_player_id: nextPlayer?.id
        }).eq('id', room.id);
      }
    };
    
    const timer = setTimeout(() => {
      autoPlayBot();
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [room?.current_turn_player_id, room?.turn_phase, myPlayerId, players]);

  // Auto-start game when room is full (3 active players)
  useEffect(() => {
    if (room?.status === 'waiting') {
      const disconnectedPlayerIds = (room.board_melds || [])
        .filter(m => m.type === 'player_disconnected' || m.type === 'ghost')
        .map(m => m.playerId);
      
      const activePlayers = players.filter(p => !disconnectedPlayerIds.includes(p.id));
      
      if (activePlayers.length === 3) {
        const me = activePlayers.find(p => p.id === myPlayerId);
        // Only the host (lowest position) starts it
        const hostPos = Math.min(...activePlayers.map(p => p.position));
        if (me?.position === hostPos) {
          startGame();
        }
      }
    }
  }, [players, room?.status, myPlayerId, room?.board_melds]);

  // Clean up disconnected players when game finishes
  useEffect(() => {
    if (room?.status === 'finished' && myPlayerId && players.length > 0) {
      const disconnectedPlayerIds = (room.board_melds || [])
        .filter(m => m.type === 'player_disconnected' || m.type === 'ghost')
        .map(m => m.playerId);
        
      if (disconnectedPlayerIds.length === 0) return;
      
      const activePlayers = players.filter(p => !disconnectedPlayerIds.includes(p.id)).sort((a, b) => a.position - b.position);
      if (activePlayers.length > 0 && activePlayers[0].id === myPlayerId) {
        // I am the host, I will sweep the disconnected players
        const sweep = async () => {
          // Attempt to delete (may fail due to RLS, which is fine)
          for (const botId of disconnectedPlayerIds) {
            await supabase.from('player_hands').delete().eq('player_id', botId);
            await supabase.from('players').delete().eq('id', botId);
          }
          
          // Keep only disconnected/ghost flags, clear ALL fight/meld data
          const cleanMelds = (room.board_melds || [])
            .filter(m => m.type === 'player_disconnected' || m.type === 'ghost');
          
          if (activePlayers.length < 3) {
            await supabase.from('rooms').update({ status: 'waiting', board_melds: cleanMelds, discard_pile: [] }).eq('id', room.id);
          } else {
            await supabase.from('rooms').update({ board_melds: cleanMelds, discard_pile: [] }).eq('id', room.id);
          }
        };
        sweep();
      }
    }
  }, [room?.status, myPlayerId, players]);

  // Listen to hand changes
  useEffect(() => {
    if (!myPlayerId) return;
    
    const handSub = supabase.channel('hand_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_hands', filter: `player_id=eq.${myPlayerId}` }, (payload: any) => {
        setHand(payload.new.hand || []);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(handSub);
    }
  }, [myPlayerId]);

  const sendChatMessage = (text: string) => {
    if (!roomChannel || !userId || !text.trim()) return;
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      senderId: userId,
      senderName: myDisplayName || `Player ${userId.substring(0,4)}`,
      text: text.trim(),
      timestamp: Date.now()
    };
    roomChannel.send({
      type: 'broadcast',
      event: 'chat_message',
      payload: msg
    });
    // Add locally immediately
    setChatMessages((prev) => [...prev, msg]);
  };

  const generateRoomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const createRoom = async () => {
    if (!userId) return;
    const newCode = generateRoomCode();
    
    const { data: roomData, error } = await supabase.from('rooms').insert([{ 
      status: 'waiting', 
      turn_phase: 'draw',
      deck: [], 
      discard_pile: [], 
      board_melds: [],
      code: newCode
    }]).select().single();
    
    if (error) {
      console.error("Error creating room:", error);
      return;
    }
    
    await joinRoomByUuid(roomData.id);
  };

  const joinRoom = async (codeStr: string) => {
    if (!userId) return;
    
    // Look up room by 5-character code, sanitize it
    const cleanCode = codeStr.trim().toUpperCase();
    const { data: roomData, error: roomError } = await supabase.from('rooms').select('*').eq('code', cleanCode).single();
    
    if (roomError || !roomData) {
      console.error("Room not found (Make sure you typed the 5-character code correctly!):", roomError);
      alert("Room not found! Please check the code and try again.");
      return;
    }
    
    await joinRoomByUuid(roomData.id);
  };

  const joinRoomByUuid = async (roomId: string) => {
    const { data: existingPlayers } = await supabase.from('players').select('*').eq('room_id', roomId);
    
    // Check if player is already in room
    const existingMe = existingPlayers?.find((p: any) => p.user_id === userId);
    
    let pid: string | null = null;
    if (existingMe) {
      pid = existingMe.id;
      setMyPlayerId(pid);
      
      const { data: handData } = await supabase.from('player_hands').select('hand').eq('player_id', pid).single();
      if (handData) setHand(handData.hand);
      
      const { data: currentRoom } = await supabase.from('rooms').select('board_melds').eq('id', roomId).single();
      if (currentRoom) {
        const newMelds = (currentRoom.board_melds || []).filter((m: any) => !(m.type === 'player_disconnected' && m.playerId === pid));
        await supabase.from('rooms').update({ board_melds: newMelds }).eq('id', roomId);
      }
    } else {
      const position = existingPlayers ? existingPlayers.length + 1 : 1;
      if (position > 3) {
        alert('Room is full!');
        return;
      }

      const { data: newPlayer, error } = await supabase.from('players').insert({
        room_id: roomId,
        user_id: userId,
        position: position,
        card_count: 0
      }).select().single();

      if (error) {
        console.error("Join Room Error:", error);
        return;
      }

      pid = newPlayer.id;
      setMyPlayerId(pid);

      await supabase.from('player_hands').insert({
        player_id: pid,
        user_id: userId,
        hand: []
      });
    }

    const { data: roomData } = await supabase.from('rooms').select('*').eq('id', roomId).single();
    if (roomData) setRoom(roomData);
    
    const { data: pData } = await supabase.from('players').select('*').eq('room_id', roomId).order('position');
    if (pData) setPlayers(pData);
  };

  const startGame = async () => {
    if (!room) return;
    
    // Fetch latest players to prevent race conditions (e.g. dealing to a swept bot)
    const { data: latestPlayers } = await supabase.from('players').select('*').eq('room_id', room.id).order('position');
    if (!latestPlayers) return;

    // Strictly exclude anyone who was marked as disconnected or ghost
    const disconnectedPlayerIds = (room.board_melds || [])
      .filter(m => m.type === 'player_disconnected' || m.type === 'ghost')
      .map(m => m.playerId);
    
    const activeLatestPlayers = latestPlayers.filter((p: any) => !disconnectedPlayerIds.includes(p.id));
    if (activeLatestPlayers.length < 2) return;
    
    let deck = shuffleDeck(generateDeck());
    const roomUpdates = [];
    
    // Deal 12 to players, 13 to dealer (lowest active position)
    const dealerPos = Math.min(...activeLatestPlayers.map((p: any) => p.position));
    for (const p of activeLatestPlayers) {
      const numCards = p.position === dealerPos ? 13 : 12;
      const playerHand = deck.splice(0, numCards);
      roomUpdates.push({
        player_id: p.id,
        hand: playerHand
      });
    }

    const dealer = activeLatestPlayers.find((p: any) => p.position === dealerPos);
    
    // Use an RPC function to bypass RLS so the dealer can give cards to opponents
    await supabase.rpc('deal_cards_to_room', {
      room_updates: roomUpdates,
      target_room_id: room.id,
      new_deck: deck,
      dealer_id: dealer?.id
    });

    // The dealer starts with 13 cards, so they skip the draw phase!
    // Also clear old fight/meld data but preserve disconnected/ghost flags
    const preservedMelds = (room.board_melds || [])
      .filter(m => m.type === 'player_disconnected' || m.type === 'ghost');
    
    await supabase.from('rooms').update({ 
      turn_phase: 'action',
      board_melds: preservedMelds,
      discard_pile: []
    }).eq('id', room.id);
  };

  const restartGame = async (winnerId: string) => {
    if (!room) return;
    
    // Fetch latest players to prevent race conditions
    const { data: latestPlayers } = await supabase.from('players').select('*').eq('room_id', room.id).order('position');
    if (!latestPlayers) return;

    // Strictly exclude anyone who was marked as disconnected or ghost
    const disconnectedPlayerIds = (room.board_melds || [])
      .filter(m => m.type === 'player_disconnected' || m.type === 'ghost')
      .map(m => m.playerId);
    
    const activeLatestPlayers = latestPlayers.filter((p: any) => !disconnectedPlayerIds.includes(p.id));
    if (activeLatestPlayers.length < 2) return;
    
    let deck = shuffleDeck(generateDeck());
    const roomUpdates = [];
    
    // Deal 13 to winner, 12 to others
    for (const p of activeLatestPlayers) {
      const numCards = p.id === winnerId ? 13 : 12;
      const playerHand = deck.splice(0, numCards);
      roomUpdates.push({
        player_id: p.id,
        hand: playerHand
      });
    }

    await supabase.rpc('deal_cards_to_room', {
      room_updates: roomUpdates,
      target_room_id: room.id,
      new_deck: deck,
      dealer_id: winnerId
    });

    // Convert disconnected players to 'ghost' so they vanish in the new game
    const disconnectedMelds = (room.board_melds || [])
      .filter(m => m.type === 'player_disconnected' || m.type === 'ghost')
      .map(m => ({ type: 'ghost', playerId: m.playerId }));

    await supabase.from('rooms').update({ 
      status: 'playing',
      board_melds: disconnectedMelds,
      discard_pile: [],
      turn_phase: 'action',
      current_turn_player_id: winnerId
    }).eq('id', room.id);
  };

  const drawCard = async () => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'draw') return;
    
    // SAFEGUARD: You can never draw if you already have 13 cards (e.g. you are the dealer)
    if (hand.length >= 13) {
      await supabase.from('rooms').update({ turn_phase: 'action' }).eq('id', room.id);
      return;
    }

    if (room.deck.length === 0) {
      // Handle deck exhaustion (game end)
      await supabase.from('rooms').update({ status: 'finished' }).eq('id', room.id);
      return;
    }

    const newDeck = [...room.deck];
    const drawn = newDeck.shift()!;
    const newHand = [...hand, drawn];
    
    await supabase.from('player_hands').update({ hand: newHand }).eq('player_id', myPlayerId);
    await supabase.from('players').update({ card_count: newHand.length }).eq('id', myPlayerId);
    
    await supabase.from('rooms').update({ deck: newDeck, turn_phase: 'action' }).eq('id', room.id);
  };

  const chowCard = async (selectedHandCards?: Card[]) => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'draw' || room.discard_pile.length === 0) return;
    
    // SAFEGUARD: You can never chow if you already have 13 cards
    if (hand.length >= 13) {
      await supabase.from('rooms').update({ turn_phase: 'action' }).eq('id', room.id);
      return;
    }

    const topDiscard = room.discard_pile[room.discard_pile.length - 1];
    
    let meld: Card[];
    if (selectedHandCards && selectedHandCards.length >= 2) {
      // Use player-selected cards
      const candidateMeld = [topDiscard, ...selectedHandCards];
      if (!isValidMeld(candidateMeld)) return;
      meld = candidateMeld;
    } else {
      // Auto-pick best meld
      const autoMeld = getValidChowMeld(topDiscard, hand);
      if (!autoMeld) return;
      meld = autoMeld;
    }
    
    const newDiscard = room.discard_pile.slice(0, -1);
    
    // Remove the meld cards from hand (excluding the discard card)
    const handCardsToRemove = meld.filter(c => !(c.suit === topDiscard.suit && c.rank === topDiscard.rank));
    let newHand = [...hand];
    for (const c of handCardsToRemove) {
      const idx = newHand.findIndex(hc => hc.suit === c.suit && hc.rank === c.rank);
      if (idx !== -1) newHand.splice(idx, 1);
    }
    
    const newBoardMelds = [...room.board_melds, { playerId: myPlayerId, cards: meld, type: 'meld' }];
    
    await supabase.from('player_hands').update({ hand: newHand }).eq('player_id', myPlayerId);
    await supabase.from('players').update({ card_count: newHand.length }).eq('id', myPlayerId);
    
    if (newHand.length === 0) {
      await supabase.from('rooms').update({ 
        discard_pile: newDiscard, 
        board_melds: newBoardMelds,
        status: 'finished' 
      }).eq('id', room.id);
    } else {
      await supabase.from('rooms').update({ 
        discard_pile: newDiscard, 
        board_melds: newBoardMelds,
        turn_phase: 'action' 
      }).eq('id', room.id);
    }
  };

  const discard = async (card: Card) => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'action') return;
    
    const newHand = hand.filter(c => !(c.suit === card.suit && c.rank === card.rank));
    const newDiscard = [...room.discard_pile, card];
    
    await supabase.from('player_hands').update({ hand: newHand }).eq('player_id', myPlayerId);
    await supabase.from('players').update({ card_count: newHand.length }).eq('id', myPlayerId);
    
    // Check for Tongits (Win condition)
    const { unmatched } = extractMelds(newHand);
    const score = calculateHandScore(unmatched);
    
    if (newHand.length === 0 || score === 0) {
      await supabase.from('rooms').update({ discard_pile: newDiscard, status: 'finished' }).eq('id', room.id);
      return;
    }

    // Check if deck is exhausted. If so, game ends immediately after this discard!
    if (room.deck.length === 0) {
      await supabase.from('rooms').update({ discard_pile: newDiscard, status: 'finished' }).eq('id', room.id);
      return;
    }

    // Determine next player
    const me = players.find(p => p.id === myPlayerId);
    const myPos = me?.position || 1;
    let nextPos = myPos + 1;
    if (nextPos > players.length) nextPos = 1;
    const nextPlayer = players.find(p => p.position === nextPos);

    await supabase.from('rooms').update({ 
      discard_pile: newDiscard,
      current_turn_player_id: nextPlayer?.id,
      turn_phase: 'draw'
    }).eq('id', room.id);
  };

  const dropMeld = async (cards: Card[]) => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'action') return;
    
    if (!isValidMeld(cards)) return; // Double check

    let newHand = [...hand];
    for (const card of cards) {
      const idx = newHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
      if (idx !== -1) newHand.splice(idx, 1);
    }

    await supabase.from('player_hands').update({ hand: newHand }).eq('player_id', myPlayerId);
    await supabase.from('players').update({ card_count: newHand.length }).eq('id', myPlayerId);

    const newMelds = [...room.board_melds, { playerId: myPlayerId, cards: cards }];
    
    // Check for Tongits (Win condition)
    if (newHand.length === 0) {
      await supabase.from('rooms').update({ board_melds: newMelds, status: 'finished' }).eq('id', room.id);
      return;
    }

    await supabase.from('rooms').update({ board_melds: newMelds }).eq('id', room.id);
  };

  // Add sapaw method
  const sapawMeld = async (cards: Card[], targetMeldIndex: number) => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'action') return;
    
    let newHand = [...hand];
    for (const card of cards) {
      const idx = newHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
      if (idx !== -1) newHand.splice(idx, 1);
    }

    await supabase.from('player_hands').update({ hand: newHand }).eq('player_id', myPlayerId);
    await supabase.from('players').update({ card_count: newHand.length }).eq('id', myPlayerId);

    const newMelds = [...room.board_melds];
    newMelds[targetMeldIndex] = {
      ...newMelds[targetMeldIndex],
      cards: [...(newMelds[targetMeldIndex].cards || []), ...cards]
    };

    // Check for Tongits (Win condition)
    if (newHand.length === 0) {
      await supabase.from('rooms').update({ board_melds: newMelds, status: 'finished' }).eq('id', room.id);
      return;
    }

    await supabase.from('rooms').update({ board_melds: newMelds }).eq('id', room.id);
  };

  // Add callDraw method
  const callDraw = async () => {
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || room.turn_phase !== 'draw') return;
    
    // Determine next player
    const me = players.find(p => p.id === myPlayerId);
    const myPos = me?.position || 1;
    let nextPos = myPos + 1;
    if (nextPos > players.length) nextPos = 1;
    const nextPlayer = players.find(p => p.position === nextPos);

    const newMelds: RoomMeld[] = [...room.board_melds, { type: 'fight_caller', playerId: myPlayerId }];
    
    await supabase.from('rooms').update({ 
      board_melds: newMelds,
      current_turn_player_id: nextPlayer?.id
    }).eq('id', room.id);
  };

  const respondToFight = async (isFold: boolean) => {
    const isFightActive = room?.board_melds.some(m => m.type === 'fight_caller');
    if (!room || !myPlayerId || room.current_turn_player_id !== myPlayerId || !isFightActive) return;
    
    const newMelds: RoomMeld[] = [...room.board_melds, { type: 'fight_response', playerId: myPlayerId, isFold }];
    
    // Determine next player
    const me = players.find(p => p.id === myPlayerId);
    const myPos = me?.position || 1;
    let nextPos = myPos + 1;
    if (nextPos > players.length) nextPos = 1;
    const nextPlayer = players.find(p => p.position === nextPos);

    // Is the next player the original fight caller?
    const fightCallerEvent = room.board_melds.find(m => m.type === 'fight_caller');
    
    if (fightCallerEvent && nextPlayer?.id === fightCallerEvent.playerId) {
      // Fight cycle is complete
      await supabase.from('rooms').update({ 
        status: 'finished',
        board_melds: newMelds
      }).eq('id', room.id);
    } else {
      // Pass turn to next person to respond
      await supabase.from('rooms').update({ 
        board_melds: newMelds,
        current_turn_player_id: nextPlayer?.id
      }).eq('id', room.id);
    }
  };

  const leaveRoom = async () => {
    if (!room || !myPlayerId) return;
    
    try {
      if (room.status === 'playing' || room.status === 'fight') {
        // Disconnect but leave bot running
        const newMelds: RoomMeld[] = [...(room.board_melds || []), { type: 'player_disconnected', playerId: myPlayerId }];
        await supabase.from('rooms').update({ board_melds: newMelds }).eq('id', room.id);
      } else {
        // Normal leave (waiting or finished)
        await supabase.from('player_hands').delete().eq('player_id', myPlayerId);
        await supabase.from('players').delete().eq('id', myPlayerId);
        
        // Check remaining players
        const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('room_id', room.id);
        
        // If no players left, delete the room
        if (count === 0) {
          await supabase.from('rooms').delete().eq('id', room.id);
        }
      }
    } catch (e) {
      console.error("Failed to leave room cleanly:", e);
    }
    
    // 4. Finally reset local state so we exit to Lobby
    setRoom(null);
    setPlayers([]);
    setHand([]);
    setMyPlayerId(null);
  };

  // Optional: Attempt to leave room on beforeunload (tab close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (room && myPlayerId) {
        // We use navigator.sendBeacon or a synchronous fetch if possible, 
        // but regular async fetch is unreliable in beforeunload.
        // However, a simple fetch without await often works in modern browsers.
        leaveRoom(); 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [room, myPlayerId]);

  return (
    <GameRoomContext.Provider value={{ userId, authError, room, players, hand, myPlayerId, createRoom, joinRoom, startGame, drawCard, chowCard, discard, dropMeld, sapawMeld, callDraw, 
        respondToFight,
        leaveRoom,
        restartGame,
        playerNames,
        playerAvatars,
        myDisplayName,
        myAvatarUrl,
        chatMessages,
        sendChatMessage
      }}
    >  {children}
    </GameRoomContext.Provider>
  );
};

export const useGameRoom = () => {
  const context = useContext(GameRoomContext);
  if (context === undefined) throw new Error('useGameRoom must be used within a GameRoomProvider');
  return context;
};
