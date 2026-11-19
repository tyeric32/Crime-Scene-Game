import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection } from 'firebase/firestore';
import { AlertTriangle, Search, MessageSquare, Skull, Users, ShieldAlert, Gavel, User, CheckCircle, LogOut, Share2, Copy } from 'lucide-react';

// --- Firebase Setup ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'crime-scene-default-app';

const CLUES = [
  "A muddy bootprint (size 10) found near the backdoor.",
  "Security cameras were disabled exactly at midnight.",
  "A half-empty cup of coffee laced with an unknown substance.",
  "A shredded document with the word 'Project' visible.",
  "An anonymous text message sent from a burner phone.",
  "Traces of rare blue fabric caught on the window frame."
];

export default function CrimeSceneGame() {
  const [user, setUser] = useState(null);
  
  // App State
  const [roomId, setRoomId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // UI State
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [voteTarget, setVoteTarget] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [copied, setCopied] = useState(false);
  
  const chatRef = useRef(null);
  const codeInputRef = useRef(null);

  // 1. Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Room & Chat Listeners
  useEffect(() => {
    if (!user || !roomId) return;

    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');

    // Room Listener
    const unsubRoom = onSnapshot(doc(roomsRef, roomId), (docSnap) => {
      if (docSnap.exists()) {
        setRoomData(docSnap.data());
      } else {
        setErrorMsg("Room was closed or does not exist.");
        setRoomId('');
        setRoomData(null);
      }
    }, (err) => console.error("Room sync error:", err));

    // Messages Listener (Fetch all and filter in memory)
    const unsubMessages = onSnapshot(messagesRef, (snapshot) => {
      const msgs = [];
      snapshot.forEach(d => {
        const data = d.data();
        if (data.roomId === roomId) {
          msgs.push({ id: d.id, ...data });
        }
      });
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);
    }, (err) => console.error("Chat sync error:", err));

    return () => {
      unsubRoom();
      unsubMessages();
    };
  }, [user, roomId]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);


  // --- Actions ---

  const handleCreateGame = async () => {
    if (!user) return;
    setErrorMsg('');
    const newCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    
    try {
      await setDoc(doc(roomsRef, newCode), {
        hostId: user.uid,
        status: 'lobby',
        players: {},
        evidence: CLUES.sort(() => 0.5 - Math.random()).slice(0, 4),
        votes: {},
        createdAt: Date.now()
      });
      setRoomId(newCode);
    } catch (err) {
      setErrorMsg("Failed to create room.");
    }
  };

  const handleJoinGame = async (e) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg('');
    const code = joinCodeInput.trim().toUpperCase();
    if (code.length !== 4) return setErrorMsg("Code must be 4 characters.");

    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    try {
      const snap = await getDoc(doc(roomsRef, code));
      if (snap.exists()) {
        const data = snap.data();
        if (data.status !== 'lobby' && !data.players[user.uid]) {
          return setErrorMsg("Game already started.");
        }
        setRoomId(code);
      } else {
        setErrorMsg("Invalid room code.");
      }
    } catch (err) {
      setErrorMsg("Failed to join room.");
    }
  };

  const handleSetName = async (e) => {
    e.preventDefault();
    if (!playerNameInput.trim()) return;
    
    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    try {
      await updateDoc(doc(roomsRef, roomId), {
        [`players.${user.uid}`]: { name: playerNameInput.trim(), role: null }
      });
    } catch (err) {
      setErrorMsg("Failed to join lobby.");
    }
  };

  const handleStartGame = async () => {
    if (!roomData || roomData.hostId !== user.uid) return;
    const playerIds = Object.keys(roomData.players);
    
    // Removed minimum player limit to allow for testing with 1 or 2 players!

    const criminalId = playerIds[Math.floor(Math.random() * playerIds.length)];
    const updatedPlayers = { ...roomData.players };
    playerIds.forEach(id => {
      updatedPlayers[id].role = (id === criminalId) ? 'Criminal' : 'Suspect';
    });

    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    await updateDoc(doc(roomsRef, roomId), {
      status: 'playing',
      players: updatedPlayers
    });
    
    // System message
    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    await setDoc(doc(messagesRef), {
      roomId, senderId: 'SYSTEM', text: "The investigation has begun. Discuss the evidence and find the criminal.", timestamp: Date.now(), isSystem: true
    });
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || roomData.status !== 'playing') return;

    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    try {
      await setDoc(doc(messagesRef), {
        roomId,
        senderId: user.uid,
        senderName: roomData.players[user.uid]?.name || 'Unknown',
        text: chatInput.trim(),
        timestamp: Date.now()
      });
      setChatInput('');
    } catch (err) {
      console.error(err);
    }
  };

  const handlePanic = async () => {
    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    await updateDoc(doc(roomsRef, roomId), { status: 'voting' });

    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    await setDoc(doc(messagesRef), {
      roomId, senderId: 'SYSTEM', text: `🚨 PANIC BUTTON PRESSED by ${roomData.players[user.uid]?.name}. Voting initiated!`, timestamp: Date.now(), isSystem: true
    });
  };

  const handleSubmitVote = async (e) => {
    e.preventDefault();
    if (!voteTarget) return;

    const roomsRef = collection(db, 'artifacts', appId, 'public', 'data', 'rooms');
    const updatedVotes = { ...roomData.votes, [user.uid]: voteTarget };
    
    await updateDoc(doc(roomsRef, roomId), { votes: updatedVotes });

    // Auto-finish if all voted
    if (Object.keys(updatedVotes).length === Object.keys(roomData.players).length) {
      await updateDoc(doc(roomsRef, roomId), { status: 'finished' });
    }
  };

  const handleLeave = () => {
    setRoomId('');
    setRoomData(null);
    setMessages([]);
    setErrorMsg('');
    setInfoMsg('');
    setCopied(false);
  };

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(roomId);
        setInfoMsg("Room Code copied to clipboard!");
      } else {
        // Fallback for older browsers or restricted iframes
        if (codeInputRef.current) {
          codeInputRef.current.select();
          const successful = document.execCommand('copy');
          if (successful) {
            setInfoMsg("Room Code copied to clipboard!");
          } else {
            setInfoMsg("Unable to copy automatically. Please copy the code manually.");
          }
        }
      }
    } catch (err) {
      console.error("Copy failed", err);
      setInfoMsg("Unable to copy automatically. Please copy the code manually.");
    }
    
    // Clear the notification after 4 seconds
    setTimeout(() => setInfoMsg(''), 4000);
  };

  // --- Rendering ---

  if (!user) {
    return <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">Connecting to server...</div>;
  }

  // SCREEN 1: HOME
  if (!roomId) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4">
        <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-gray-700">
          <div className="flex justify-center mb-6"><Search size={48} className="text-indigo-500" /></div>
          <h1 className="text-3xl font-bold text-center mb-2 tracking-wide text-white">Crime Scene</h1>
          <p className="text-gray-400 text-center mb-8">A real-time multiplayer investigation.</p>
          
          {errorMsg && <div className="bg-red-900/50 text-red-200 p-3 rounded mb-6 text-sm border border-red-500">{errorMsg}</div>}

          <button onClick={handleCreateGame} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded mb-6 transition-colors">
            Create Game
          </button>

          <div className="relative flex items-center py-2 mb-6">
            <div className="flex-grow border-t border-gray-700"></div>
            <span className="flex-shrink-0 mx-4 text-gray-500 text-sm">OR</span>
            <div className="flex-grow border-t border-gray-700"></div>
          </div>

          <form onSubmit={handleJoinGame} className="flex gap-2">
            <input 
              type="text" value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-600 rounded px-4 py-2 text-white uppercase focus:border-indigo-500 outline-none"
              placeholder="Room Code" maxLength={4}
            />
            <button type="submit" className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded transition-colors">
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  // SCREEN 2: LOBBY
  if (roomData && roomData.status === 'lobby') {
    const isHost = roomData.hostId === user.uid;
    const hasJoined = !!roomData.players[user.uid];
    const playersList = Object.entries(roomData.players);

    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4">
        <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-lg border border-gray-700">
          <div className="flex justify-between items-center mb-6 pb-6 border-b border-gray-700">
            <h2 className="text-2xl font-bold">Investigation Lobby</h2>
            <div className="flex flex-col items-end gap-2">
              <span className="text-xs text-gray-400 block font-semibold tracking-wider">ROOM CODE</span>
              <div className="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded p-1 shadow-inner">
                <input 
                  ref={codeInputRef}
                  type="text" 
                  value={roomId} 
                  readOnly 
                  className="bg-transparent text-2xl font-mono font-bold tracking-widest text-indigo-400 w-24 text-center outline-none selection:bg-indigo-500/30"
                />
                <button 
                  onClick={handleCopyCode}
                  className="bg-gray-700 hover:bg-indigo-600 p-2 rounded text-white transition-colors flex items-center justify-center"
                  title="Copy Room Code"
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>
          </div>

          {errorMsg && <div className="bg-red-900/50 text-red-200 p-3 rounded mb-6 text-sm border border-red-500">{errorMsg}</div>}
          {infoMsg && <div className="bg-green-900/50 text-green-200 p-3 rounded mb-6 text-sm border border-green-500">{infoMsg}</div>}

          {!hasJoined ? (
            <form onSubmit={handleSetName} className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">Enter your Agent Name:</label>
              <div className="flex gap-2">
                <input 
                  type="text" value={playerNameInput} onChange={e => setPlayerNameInput(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-600 rounded px-4 py-2 text-white focus:border-indigo-500 outline-none"
                  placeholder="Your Name" required maxLength={15}
                />
                <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 px-6 rounded font-bold transition-colors">Join</button>
              </div>
            </form>
          ) : (
            <div className="mb-8">
              <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Agents Waiting ({playersList.length})</h3>
              <div className="grid grid-cols-2 gap-3">
                {playersList.map(([id, p]) => (
                  <div key={id} className="bg-gray-900 p-3 rounded flex items-center gap-2 border border-gray-700">
                    <User size={16} className={id === roomData.hostId ? 'text-yellow-500' : 'text-gray-400'} />
                    <span>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-4 border-t border-gray-700 pt-6">
            {isHost && hasJoined && (
              <button 
                onClick={handleStartGame} 
                className="w-full bg-green-600 hover:bg-green-500 text-white text-xl font-black py-4 px-6 rounded-lg transition-all shadow-[0_0_15px_rgba(22,163,74,0.4)] uppercase tracking-widest animate-pulse"
              >
                START GAME
              </button>
            )}
            
            <div className="flex justify-between items-center">
              <button onClick={handleLeave} className="text-gray-400 hover:text-white flex items-center gap-1"><LogOut size={16}/> Leave Room</button>
              {!isHost && hasJoined && <span className="text-yellow-500 font-semibold animate-pulse">Waiting for host to start...</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 3: GAME / VOTING / RESULTS
  if (!roomData || !roomData.players[user.uid]) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading game data...</div>;

  const myPlayer = roomData.players[user.uid];
  const allPlayers = Object.entries(roomData.players);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col h-screen overflow-hidden">
      
      {/* Header */}
      <header className="bg-gray-950 border-b border-gray-800 p-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-bold tracking-wide uppercase">
            <Search size={20} className="text-indigo-500" /> Crime Scene
          </div>
          <div className="bg-gray-800 px-3 py-1 rounded text-sm font-mono text-gray-400 border border-gray-700">Code: {roomId}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className={`px-4 py-1.5 rounded font-bold text-sm border ${myPlayer.role === 'Criminal' ? 'bg-red-900/30 border-red-500 text-red-400' : 'bg-blue-900/30 border-blue-500 text-blue-400'}`}>
            Role: {myPlayer.role}
          </div>
          <button 
            onClick={handlePanic}
            disabled={roomData.status !== 'playing'}
            className={`flex items-center gap-2 px-4 py-1.5 rounded font-bold transition-all ${roomData.status === 'playing' ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]' : 'bg-gray-800 text-gray-500 opacity-50 cursor-not-allowed'}`}
          >
            <AlertTriangle size={18} /> PANIC BUTTON
          </button>
        </div>
      </header>

      {/* Main Area */}
      <main className="flex-1 flex overflow-hidden relative">
        
        {/* Evidence Board */}
        <div className="w-1/3 min-w-[300px] border-r border-gray-800 flex flex-col bg-gray-900/50">
          <div className="p-4 border-b border-gray-800 bg-gray-900">
            <h2 className="text-lg font-bold flex items-center gap-2 text-gray-200"><Gavel size={18} /> Evidence Board</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {roomData.evidence?.map((clue, idx) => (
              <div key={idx} className="bg-gray-800 p-4 rounded border border-gray-700 shadow-sm text-sm text-gray-300 leading-relaxed">
                {clue}
              </div>
            ))}
          </div>
        </div>

        {/* Interrogation Chat */}
        <div className="flex-1 flex flex-col bg-gray-950">
          <div className="p-4 border-b border-gray-800 bg-gray-900">
            <h2 className="text-lg font-bold flex items-center gap-2 text-gray-200"><MessageSquare size={18} /> Interrogation Chat</h2>
          </div>
          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.isSystem ? 'items-center my-6' : msg.senderId === user.uid ? 'items-end' : 'items-start'}`}>
                {msg.isSystem ? (
                  <div className="bg-gray-800/80 border border-gray-700 text-gray-400 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider text-center max-w-[80%]">
                    {msg.text}
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-gray-500 mb-1 px-1">{msg.senderName}</span>
                    <div className={`px-4 py-2 rounded-lg max-w-[80%] text-sm ${msg.senderId === user.uid ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-none'}`}>
                      {msg.text}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={handleSendMessage} className="p-4 bg-gray-900 border-t border-gray-800 flex gap-2 shrink-0">
            <input 
              type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              disabled={roomData.status !== 'playing'}
              placeholder={roomData.status === 'playing' ? "Type a message..." : "Game paused."}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2.5 text-white focus:border-indigo-500 outline-none disabled:opacity-50"
            />
            <button type="submit" disabled={!chatInput.trim() || roomData.status !== 'playing'} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-6 rounded font-bold transition-colors">
              Send
            </button>
          </form>
        </div>

        {/* Voting Overlay */}
        {roomData.status === 'voting' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border-2 border-red-900 rounded-xl p-8 max-w-md w-full shadow-2xl">
              <div className="text-center mb-6">
                <ShieldAlert size={48} className="text-red-500 mx-auto mb-4 animate-pulse" />
                <h2 className="text-2xl font-bold text-white uppercase tracking-wider">Voting Phase</h2>
                <p className="text-gray-400 mt-2 text-sm">A panic button was pressed. Cast your vote.</p>
              </div>
              
              {roomData.votes[user.uid] ? (
                <div className="text-center py-6">
                  <CheckCircle size={40} className="text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-white mb-2">Vote Cast</h3>
                  <p className="text-gray-400 text-sm">Waiting for remaining agents...</p>
                </div>
              ) : (
                <form onSubmit={handleSubmitVote} className="space-y-4">
                  <div>
                    <label className="block text-gray-300 text-sm font-semibold mb-2">Who is the Criminal?</label>
                    <select 
                      value={voteTarget} onChange={e => setVoteTarget(e.target.value)} required
                      className="w-full bg-gray-800 border border-gray-600 rounded px-4 py-3 text-white focus:border-red-500 outline-none"
                    >
                      <option value="" disabled>Select a suspect...</option>
                      {allPlayers.map(([id, p]) => (
                        <option key={id} value={id}>{p.name} {id === user.uid ? '(You)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded mt-4 transition-colors">
                    Submit Vote
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Results Overlay */}
        {roomData.status === 'finished' && (
          <div className="absolute inset-0 bg-gray-900/95 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 max-w-2xl w-full shadow-2xl my-8">
              <div className="text-center mb-8 border-b border-gray-700 pb-6">
                <Skull size={48} className="text-red-500 mx-auto mb-4" />
                <h2 className="text-3xl font-black text-white uppercase tracking-wider mb-2">Case Closed</h2>
                {allPlayers.map(([id, p]) => {
                  if (p.role === 'Criminal') {
                    return <div key={id} className="text-lg text-gray-300 mt-2">The true criminal was <span className="font-bold text-red-400">{p.name}</span>.</div>
                  }
                  return null;
                })}
              </div>

              <h3 className="text-xl font-bold text-gray-200 mb-4">Voting Results</h3>
              <div className="space-y-3 mb-8">
                {allPlayers.map(([voterId, voterData]) => {
                  const targetId = roomData.votes[voterId];
                  const targetName = targetId ? roomData.players[targetId]?.name : 'No one';
                  return (
                    <div key={voterId} className="bg-gray-900 p-4 rounded border border-gray-700/50 flex justify-between items-center">
                      <span className="font-bold text-indigo-400">{voterData.name}</span>
                      <span className="text-gray-400 text-sm">voted for <span className="font-bold text-red-400 ml-1">{targetName}</span></span>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-center">
                <button onClick={handleLeave} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-8 rounded transition-colors">
                  Return to Home
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}