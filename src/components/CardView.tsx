import type { Card as CardType } from '../lib/gameLogic';
import { motion } from 'framer-motion';

// Use Vite's glob import to load all card images statically
const cardImages = import.meta.glob('../assets/PNG-cards-1.3/*.png', { eager: true });

interface CardViewProps {
  card: CardType;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (card: CardType) => void;
  small?: boolean;
}

export const CardView = ({ card, selected, highlighted, onClick, small }: CardViewProps) => {
  const selectedClass = selected ? 'selected' : '';
  const sizeClass = small ? 'small' : '';

  const rankMap: Record<string, string> = { 'A': 'ace', 'J': 'jack', 'Q': 'queen', 'K': 'king' };
  const rankName = rankMap[card.rank] || card.rank;
  const filename = `../assets/PNG-cards-1.3/${rankName}_of_${card.suit}.png`;
  const imgSrc = (cardImages[filename] as any)?.default;

  return (
    <motion.div 
      layout
      layoutId={`card-${card.rank}-${card.suit}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1, y: selected ? -25 : 0 }}
      whileHover={!selected ? { y: -15 } : {}}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className={`card-container ${selectedClass} ${sizeClass}`}
      onClick={() => onClick && onClick(card)}
      style={{
        background: 'transparent',
        boxShadow: selected 
          ? '0 0 0 3px var(--btn-yellow), -2px 5px 15px rgba(0,0,0,0.6)' 
          : highlighted 
            ? '0 0 8px 3px rgba(56, 189, 248, 0.8), 0 0 20px 5px rgba(56, 189, 248, 0.4)' 
            : 'none',
        border: 'none',
        overflow: 'hidden' // ensure the image doesn't bleed out of rounded corners if any
      }}
    >
      {imgSrc ? (
        <img 
          src={imgSrc} 
          alt={`${card.rank} of ${card.suit}`} 
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      ) : (
        <div style={{background: 'white', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          {card.rank}
        </div>
      )}
    </motion.div>
  );
};
