import { useState, useEffect } from 'react';
import { useGameRoom } from '../context/GameRoomContext';
import { supabase } from '../lib/supabase';
import type { Room } from '../context/GameRoomContext';
import { Profile } from './Profile';
import { playSound } from '../lib/sound';

const ChromaKeyImage = ({ src, className }: { src: string, className?: string }) => {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Remove neon green pixels
        if (g > 150 && r < 120 && b < 120) {
          data[i + 3] = 0; // fully transparent
        }
      }
      ctx.putImageData(imgData, 0, 0);
      setDataUrl(canvas.toDataURL('image/png'));
    };
    img.src = src;
  }, [src]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt="Character" className={className} />;
};

export const Lobby = () => {
  const { createRoom, joinRoom, userId, myDisplayName, myAvatarUrl } = useGameRoom();
  const [loading, setLoading] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [showRoomsModal, setShowRoomsModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (!userId) return;

    const fetchRooms = async () => {
      const { data } = await supabase.from('rooms').select('*').eq('status', 'waiting').order('created_at', { ascending: false });
      if (data) setAvailableRooms(data);
    };

    fetchRooms();

    const sub = supabase.channel('available_rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchRooms)
      .subscribe();

    const interval = setInterval(fetchRooms, 3000);

    return () => {
      supabase.removeChannel(sub);
      clearInterval(interval);
    };
  }, [userId]);

  const handleCreate = async () => {
    playSound.click();
    setLoading(true);
    await createRoom();
    setLoading(false);
  };

  const handleJoin = async (code: string) => {
    playSound.click();
    setLoading(true);
    await joinRoom(code);
    setLoading(false);
  };

  const handleQuickPlay = () => {
    playSound.click();
    if (availableRooms.length > 0 && availableRooms[0].code) {
      handleJoin(availableRooms[0].code);
    } else {
      handleCreate();
    }
  };

  const showComingSoon = (feature: string) => {
    playSound.click();
    setToastMsg(`${feature} coming soon!`);
    setTimeout(() => setToastMsg(''), 2000);
  };

  const userName = myDisplayName || (userId ? 'Player' : 'Guest');
  const shortId = userId ? userId.substring(0, 8) : '00000000';
  const avatarImage = myAvatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;

  return (
    <div className="lobby-fullscreen">

      {/* Top Bar */}
      <div className="lobby-topbar">
        <div className="lobby-logo">TONGITS GO</div>
        <div className="lobby-user-panel" onClick={() => { playSound.click(); setShowProfile(true); }} style={{ cursor: 'pointer' }}>
          <div className="lobby-avatar">
            <img src={avatarImage} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="lobby-user-info">
            <span className="lobby-user-name">{userName} <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>⚙️</span></span>
            <span className="lobby-user-id">ID {shortId}</span>
          </div>
          <div className="lobby-currency">
            <div className="currency-badge" style={{ color: '#fde047' }}>
              🪙 110,000 <div className="plus-btn">+</div>
            </div>
            <div className="currency-badge" style={{ color: '#38bdf8' }}>
              💎 40 <div className="plus-btn">+</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="lobby-main">
        {/* Decorative Character (Green Screen removed dynamically) */}
        <ChromaKeyImage src="/assets/lobby_char.png" className="lobby-character" />

        {/* Left Grid */}
        <div className="lobby-grid-left">
          <div className="lobby-grid-row">
            <button className="btn-3d btn-tongits" onClick={handleQuickPlay} disabled={loading}>
              <div className="btn-icon">♠️</div>
              Tongits
            </button>
            <button className="btn-3d btn-pusoy" onClick={() => showComingSoon('Pusoy')} disabled={loading}>
              <div className="btn-icon">🎴</div>
              Pusoy
            </button>
          </div>
          <div className="lobby-grid-row">
            <button className="btn-3d btn-poker" onClick={() => showComingSoon('Poker')} disabled={loading}>
              <div className="btn-icon">🃏</div>
              Poker
            </button>
          </div>
          <div className="lobby-grid-row" style={{ marginTop: '10px' }}>
            <button className="btn-3d btn-tournament" onClick={() => showComingSoon('Tournament')} disabled={loading}>
              <div className="btn-icon">🏆</div>
              Tournament
            </button>
            <button className="btn-3d btn-sitgo" onClick={() => showComingSoon('Sit & Go')} disabled={loading}>
              <div className="btn-icon">🎯</div>
              Sit & Go
            </button>
          </div>
        </div>

        {/* Right Grid */}
        <div className="lobby-grid-right">
          <div className="lobby-grid-row">
            <button className="btn-3d btn-club" onClick={() => showComingSoon('Club')} disabled={loading}>
              <div className="btn-icon">🛡️</div>
              Club
            </button>
            <button className="btn-3d btn-homegame" onClick={() => { playSound.click(); setShowRoomsModal(true); }} disabled={loading}>
              <div className="btn-icon">🏠</div>
              Room List
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="lobby-bottom-nav">
        <div className="nav-item" onClick={() => showComingSoon('Store')}>
          <div className="nav-icon">🛒</div>
          <span className="nav-label">Store</span>
        </div>
        <div className="nav-item" onClick={() => showComingSoon('History')}>
          <div className="nav-icon">📜</div>
          <span className="nav-label">History</span>
        </div>
        <div className="nav-item" onClick={() => showComingSoon('Friends')}>
          <div className="nav-icon">👥</div>
          <span className="nav-label">Friends</span>
        </div>
        <div className="nav-item" onClick={() => showComingSoon('Activity')}>
          <div className="nav-icon">📋</div>
          <span className="nav-label">Activity</span>
        </div>
      </div>

      {/* Toast Message */}
      {toastMsg && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '20px', zIndex: 9999, fontWeight: 'bold' }}>
          {toastMsg}
        </div>
      )}

      {/* Rooms Modal */}
      {showRoomsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div style={{ background: '#1e293b', width: '500px', borderRadius: '15px', padding: '20px', border: '2px solid #475569', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ color: 'white', margin: 0 }}>Available Rooms</h2>
              <button onClick={() => { playSound.click(); setShowRoomsModal(false); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              {availableRooms.length === 0 ? (
                <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>No open rooms available.</p>
              ) : (
                availableRooms.map(room => (
                  <div key={room.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.4)', padding: '15px', borderRadius: '10px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#fef08a' }}>Room {room.code}</span>
                    <button className="mobile-btn btn-blue" onClick={() => room.code && handleJoin(room.code)} disabled={loading} style={{ margin: 0, padding: '8px 16px', fontSize: '1rem' }}>
                      Join
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button className="mobile-btn btn-green" onClick={handleCreate} disabled={loading} style={{ padding: '10px 30px', fontSize: '1.2rem' }}>
                Create New Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {showProfile && (
        <Profile onClose={() => setShowProfile(false)} />
      )}

    </div>
  );
};
