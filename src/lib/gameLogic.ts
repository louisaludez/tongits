export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // A=1...K=13 for checking straights
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const generateDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      deck.push({
        suit,
        rank: RANKS[i],
        value: i + 1
      });
    }
  }
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const isValidMeld = (cards: Card[]): boolean => {
  if (cards.length < 3) return false;

  const isOfAKind = cards.every(card => card.rank === cards[0].rank);
  if (isOfAKind && cards.length <= 4) return true;

  const isSameSuit = cards.every(card => card.suit === cards[0].suit);
  
  if (isSameSuit) {
    const sorted = [...cards].sort((a, b) => a.value - b.value);
    let isStraight = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].value !== sorted[i - 1].value + 1) {
        isStraight = false;
        break;
      }
    }
    if (isStraight) return true;
  }

  return false;
};

// Calculate penalty score of unmatched cards
export const calculateHandScore = (hand: Card[]): number => {
  return hand.reduce((total, card) => {
    if (['J', 'Q', 'K'].includes(card.rank)) return total + 10;
    if (card.rank === '10') return total + 10;
    if (card.rank === 'A') return total + 1;
    return total + parseInt(card.rank, 10);
  }, 0);
};

// Check if a discarded card can form a valid meld with some cards in the hand
export const canChow = (discardedCard: Card, hand: Card[]): boolean => {
  // A naive but effective approach for small hands: 
  // Generate all combinations of 2 or more cards from the hand
  // and see if discardedCard + combo forms a valid meld.
  
  const getCombinations = (arr: Card[], min: number): Card[][] => {
    const result: Card[][] = [];
    const f = (prefix: Card[], cards: Card[]) => {
      if (prefix.length >= min) result.push(prefix);
      for (let i = 0; i < cards.length; i++) {
        f([...prefix, cards[i]], cards.slice(i + 1));
      }
    };
    f([], arr);
    return result;
  };

  const handCombos = getCombinations(hand, 2);
  for (const combo of handCombos) {
    if (isValidMeld([discardedCard, ...combo])) {
      return true;
    }
  }
  return false;
};

// Get all cards in hand that could participate in any valid chow meld with the discarded card
export const getChowEligibleCards = (discardedCard: Card, hand: Card[]): Card[] => {
  const eligibleKeys = new Set<string>();

  const getCombinations = (arr: Card[], min: number): Card[][] => {
    const result: Card[][] = [];
    const f = (prefix: Card[], cards: Card[]) => {
      if (prefix.length >= min) result.push(prefix);
      for (let i = 0; i < cards.length; i++) {
        f([...prefix, cards[i]], cards.slice(i + 1));
      }
    };
    f([], arr);
    return result;
  };

  const handCombos = getCombinations(hand, 2);
  for (const combo of handCombos) {
    if (isValidMeld([discardedCard, ...combo])) {
      for (const card of combo) {
        eligibleKeys.add(`${card.rank}-${card.suit}`);
      }
    }
  }

  return hand.filter(c => eligibleKeys.has(`${c.rank}-${c.suit}`));
};

// Retrieve the actual meld that can be formed from Chow
export const getValidChowMeld = (discardedCard: Card, hand: Card[]): Card[] | null => {
  const getCombinations = (arr: Card[], min: number): Card[][] => {
    const result: Card[][] = [];
    const f = (prefix: Card[], cards: Card[]) => {
      if (prefix.length >= min) result.push(prefix);
      for (let i = 0; i < cards.length; i++) {
        f([...prefix, cards[i]], cards.slice(i + 1));
      }
    };
    f([], arr);
    return result;
  };

  const handCombos = getCombinations(hand, 2);
  
  // Sort combos by length descending to prefer larger melds
  handCombos.sort((a, b) => b.length - a.length);

  for (const combo of handCombos) {
    if (isValidMeld([discardedCard, ...combo])) {
      return [discardedCard, ...combo];
    }
  }
  return null;
};

// Check if selected cards can be added to an existing meld on the table
export const canSapaw = (cardsToAdd: Card[], targetMeld: Card[]): boolean => {
  return isValidMeld([...targetMeld, ...cardsToAdd]);
};

// Automatically extract valid melds from the hand (Optimal algorithm)
export const extractMelds = (hand: Card[]): { melds: Card[][], unmatched: Card[] } => {
  const getCombinations = (arr: Card[], min: number): Card[][] => {
    const result: Card[][] = [];
    const f = (prefix: Card[], cards: Card[]) => {
      if (prefix.length >= min) result.push(prefix);
      for (let i = 0; i < cards.length; i++) {
        f([...prefix, cards[i]], cards.slice(i + 1));
      }
    };
    f([], arr);
    return result;
  };

  const allSubsets = getCombinations(hand, 3);
  const possibleMelds = allSubsets.filter(subset => isValidMeld(subset));

  let bestUnmatchedScore = Infinity;
  let bestMelds: Card[][] = [];
  let bestUnmatchedCards: Card[] = [];

  const dfs = (index: number, currentMelds: Card[][], remainingCards: Card[]) => {
    const score = calculateHandScore(remainingCards);
    if (score < bestUnmatchedScore) {
      bestUnmatchedScore = score;
      bestMelds = [...currentMelds];
      bestUnmatchedCards = [...remainingCards];
    }
    
    if (bestUnmatchedScore === 0) return;

    for (let i = index; i < possibleMelds.length; i++) {
      const meld = possibleMelds[i];
      let newRemaining = [...remainingCards];
      let canForm = true;
      
      for (const mc of meld) {
        const idx = newRemaining.findIndex(rc => rc.suit === mc.suit && rc.rank === mc.rank);
        if (idx !== -1) {
          newRemaining.splice(idx, 1);
        } else {
          canForm = false;
          break;
        }
      }
      
      if (canForm) {
        dfs(i + 1, [...currentMelds, meld], newRemaining);
      }
    }
  };

  dfs(0, [], hand);

  return { melds: bestMelds, unmatched: bestUnmatchedCards };
};
