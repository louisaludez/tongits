import { GameRoomProvider, useGameRoom } from './context/GameRoomContext';
import { Lobby } from './components/Lobby';
import { GameBoard } from './components/GameBoard';
import { Login } from './components/Login';
import './index.css';

import { supabase } from './lib/supabase';

const Main = () => {
  const { room, userId } = useGameRoom();
  
  if (!supabase) {
    return (
      <div className="lobby-container">
        <div className="glass-panel text-center">
          <h1 className="title" style={{color: '#ef4444'}}>Configuration Error</h1>
          <p className="subtitle">Supabase URL is missing or invalid.</p>
          <p style={{marginTop: '20px'}}>Please paste your Supabase URL and Anon Key into the <strong>.env.local</strong> file and restart the development server.</p>
        </div>
      </div>
    );
  }

  if (!userId) {
    return <Login />;
  }

  if (!room) {
    return <Lobby />;
  }

  return <GameBoard />;
};

function App() {
  return (
    <GameRoomProvider>
      <Main />
    </GameRoomProvider>
  );
}

export default App;
