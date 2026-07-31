import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameRoom } from '../context/GameRoomContext';

interface ProfileProps {
  onClose: () => void;
}

export const Profile = ({ onClose }: ProfileProps) => {
  const { userId } = useGameRoom();
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const avatarOptions = [
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`,
    `https://api.dicebear.com/7.x/micah/svg?seed=${userId}`,
    `https://api.dicebear.com/7.x/pixel-art/svg?seed=${userId}`,
    `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`,
    `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${userId}`,
  ];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }: any) => {
      if (user) {
        setDisplayName(user.user_metadata?.display_name || '');
        setAvatarUrl(user.user_metadata?.avatar_url || avatarOptions[0]);
      }
    });
  }, [userId]);

  const handleSaveProfile = async () => {
    setLoading(true);
    setMsg({ text: '', type: '' });
    
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          display_name: displayName,
          avatar_url: avatarUrl
        }
      });
      
      if (error) throw error;
      setMsg({ text: 'Profile updated successfully!', type: 'success' });
      
      // Auto close after 1s
      setTimeout(() => {
        onClose();
        // Reload page to reflect metadata changes in presence easily
        window.location.reload(); 
      }, 1000);
      
    } catch (err: any) {
      setMsg({ text: err.message, type: 'error' });
    }
    setLoading(false);
  };

  const handleChangePassword = async () => {
    if (password !== confirmPassword) {
      setMsg({ text: 'Passwords do not match', type: 'error' });
      return;
    }
    if (password.length < 6) {
      setMsg({ text: 'Password must be at least 6 characters', type: 'error' });
      return;
    }
    
    setLoading(true);
    setMsg({ text: '', type: '' });
    
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMsg({ text: 'Password updated successfully!', type: 'success' });
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setMsg({ text: err.message, type: 'error' });
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #1e293b, #0f172a)',
        width: '500px', borderRadius: '20px', padding: '30px',
        border: '2px solid #334155', boxShadow: '0 20px 50px rgba(0,0,0,0.9)',
        color: 'white', position: 'relative'
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: '15px', right: '20px', background: 'transparent',
          border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer'
        }}>✕</button>

        <h2 style={{ textAlign: 'center', margin: '0 0 20px 0', color: '#fde047', textShadow: '0 2px 5px rgba(0,0,0,0.5)' }}>My Profile</h2>

        {msg.text && (
          <div style={{
            background: msg.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: msg.type === 'success' ? '#4ade80' : '#f87171',
            padding: '10px', borderRadius: '8px', textAlign: 'center', marginBottom: '20px', border: `1px solid ${msg.type === 'success' ? '#4ade80' : '#f87171'}`
          }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Avatar Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '10px', color: '#cbd5e1', fontWeight: 600 }}>Select Avatar</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginBottom: '10px' }}>
              {avatarOptions.map((opt, i) => (
                <img 
                  key={i} 
                  src={opt} 
                  alt="Avatar Option" 
                  onClick={() => setAvatarUrl(opt)}
                  style={{
                    width: '60px', height: '60px', borderRadius: '50%', cursor: 'pointer',
                    background: '#cbd5e1',
                    border: avatarUrl === opt ? '3px solid #fde047' : '2px solid transparent',
                    boxShadow: avatarUrl === opt ? '0 0 15px rgba(253, 224, 71, 0.5)' : 'none',
                    transition: 'all 0.2s'
                  }}
                />
              ))}
            </div>
            <input 
              type="text" 
              placeholder="Or paste custom image URL..." 
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569',
                background: '#0f172a', color: 'white', boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Name Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '5px', color: '#cbd5e1', fontWeight: 600 }}>Display Name</label>
            <input 
              type="text" 
              placeholder="Enter your name" 
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569',
                background: '#0f172a', color: 'white', boxSizing: 'border-box'
              }}
            />
          </div>

          <button onClick={handleSaveProfile} disabled={loading} style={{
            background: 'linear-gradient(to bottom, #38bdf8, #0369a1)', color: 'white', padding: '12px',
            border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)', marginTop: '5px'
          }}>
            {loading ? 'Saving...' : 'Save Profile Settings'}
          </button>

          <hr style={{ border: 'none', borderTop: '1px solid #334155', margin: '15px 0' }} />

          {/* Password Change */}
          <div>
            <label style={{ display: 'block', marginBottom: '5px', color: '#cbd5e1', fontWeight: 600 }}>Change Password</label>
            <input 
              type="password" 
              placeholder="New Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569',
                background: '#0f172a', color: 'white', boxSizing: 'border-box', marginBottom: '10px'
              }}
            />
            <input 
              type="password" 
              placeholder="Confirm New Password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #475569',
                background: '#0f172a', color: 'white', boxSizing: 'border-box'
              }}
            />
          </div>

          <button onClick={handleChangePassword} disabled={loading} style={{
            background: 'linear-gradient(to bottom, #ef4444, #b91c1c)', color: 'white', padding: '12px',
            border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
          }}>
            Update Password
          </button>
        </div>
      </div>
    </div>
  );
};
