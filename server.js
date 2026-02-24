const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ROOM MANAGEMENT ──────────────────────────────────
// rooms[code] = { players: {white: ws, black: ws}, game: {...}, names: {white, black} }
const rooms = new Map();

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function initGame() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  const set = (i, c, n) => { points[i] = { color: c, count: n }; };
  set(23,'white',2); set(12,'white',5); set(7,'white',3);  set(5,'white',5);
  set(0,'black',2);  set(11,'black',5); set(16,'black',3); set(18,'black',5);
  return {
    points,
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
    turn: 'white',
    dice: [],
    rolledDice: [],
    rolled: false,
    gameOver: false,
    winner: null,
    scores: { white: 0, black: 0 },
  };
}

function broadcast(room, msg) {
  const str = JSON.stringify(msg);
  for (const ws of Object.values(room.players)) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(str);
    }
  }
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── WEBSOCKET HANDLER ────────────────────────────────
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.color = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create': {
        const code = genCode();
        rooms.set(code, {
          players: { white: ws, black: null },
          names: { white: msg.name || 'Oyuncu1', black: null },
          game: null,
        });
        ws.roomCode = code;
        ws.color = 'white';
        sendTo(ws, { type: 'created', code, color: 'white' });
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { sendTo(ws, { type: 'error', msg: 'Oda bulunamadı!' }); return; }
        if (room.players.black) { sendTo(ws, { type: 'error', msg: 'Oda dolu!' }); return; }

        room.players.black = ws;
        room.names.black = msg.name || 'Oyuncu2';
        ws.roomCode = code;
        ws.color = 'black';

        // Both players ready — start game
        room.game = initGame();
        sendTo(room.players.white, {
          type: 'start',
          color: 'white',
          names: room.names,
          game: room.game,
        });
        sendTo(ws, {
          type: 'start',
          color: 'black',
          names: room.names,
          game: room.game,
        });
        broadcast(room, { type: 'toast', msg: 'Oyun başladı! Beyaz başlar 🎲' });
        break;
      }

      case 'roll': {
        const room = rooms.get(ws.roomCode);
        if (!room || !room.game) return;
        const g = room.game;
        if (g.rolled || g.gameOver) return;
        if (g.turn !== ws.color) return; // not your turn

        const d1 = Math.ceil(Math.random() * 6);
        const d2 = Math.ceil(Math.random() * 6);
        g.rolledDice = [d1, d2];
        g.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
        g.rolled = true;
        broadcast(room, { type: 'rolled', dice: g.dice, rolledDice: g.rolledDice, turn: g.turn });
        break;
      }

      case 'move': {
        const room = rooms.get(ws.roomCode);
        if (!room || !room.game) return;
        const g = room.game;
        if (g.gameOver || g.turn !== ws.color) return;

        const { from, to, die } = msg;
        const color = g.turn;
        const opp = color === 'white' ? 'black' : 'white';

        // Validate & apply move
        if (from === 'bar') {
          if (g.bar[color] <= 0) return;
          g.bar[color]--;
        } else {
          if (typeof from !== 'number' || from < 0 || from > 23) return;
          if (!g.points[from] || g.points[from].color !== color || g.points[from].count <= 0) return;
          g.points[from].count--;
          if (!g.points[from].count) g.points[from].color = null;
        }

        let hit = false;
        if (to === 'off') {
          g.borneOff[color]++;
        } else {
          if (typeof to !== 'number' || to < 0 || to > 23) return;
          const dest = g.points[to];
          if (dest.color && dest.color !== color && dest.count === 1) {
            g.bar[opp]++;
            g.points[to] = { color, count: 1 };
            hit = true;
          } else {
            if (!dest.color) g.points[to].color = color;
            g.points[to].count++;
          }
        }

        // Remove used die
        const di = g.dice.indexOf(die);
        if (di !== -1) g.dice.splice(di, 1);

        // Check win
        if (g.borneOff[color] >= 15) {
          g.gameOver = true;
          g.winner = color;
          g.scores[color]++;
        }

        broadcast(room, {
          type: 'moved',
          from, to, die, color, hit,
          game: g,
        });

        // Auto end turn if no dice left or no moves
        if (!g.gameOver && (g.dice.length === 0 || !serverHasMoves(g))) {
          setTimeout(() => {
            g.turn = g.turn === 'white' ? 'black' : 'white';
            g.dice = []; g.rolledDice = []; g.rolled = false;
            broadcast(room, { type: 'turn', game: g });
          }, g.dice.length > 0 ? 700 : 100);
        }
        break;
      }

      case 'endturn': {
        // Client explicitly ends turn (shouldn't normally be needed but safety valve)
        const room = rooms.get(ws.roomCode);
        if (!room || !room.game) return;
        const g = room.game;
        if (g.turn !== ws.color || g.gameOver) return;
        g.turn = g.turn === 'white' ? 'black' : 'white';
        g.dice = []; g.rolledDice = []; g.rolled = false;
        broadcast(room, { type: 'turn', game: g });
        break;
      }

      case 'rematch': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (!room.rematch) room.rematch = {};
        room.rematch[ws.color] = true;
        if (room.rematch.white && room.rematch.black) {
          room.game = initGame();
          room.rematch = {};
          broadcast(room, { type: 'rematch', game: room.game });
        } else {
          sendTo(ws, { type: 'toast', msg: 'Rematch isteği gönderildi...' });
        }
        break;
      }

      case 'ping':
        sendTo(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    // Notify opponent
    const opp = ws.color === 'white' ? 'black' : 'white';
    sendTo(room.players[opp], { type: 'opponent_left' });
    // Clean up room after delay
    setTimeout(() => {
      const r = rooms.get(ws.roomCode);
      if (r && (!r.players.white || r.players.white.readyState !== WebSocket.OPEN) &&
               (!r.players.black || r.players.black.readyState !== WebSocket.OPEN)) {
        rooms.delete(ws.roomCode);
      }
    }, 30000);
  });
});

// ── SERVER-SIDE MOVE VALIDATION HELPERS ─────────────
function serverHasMoves(g) {
  const color = g.turn;
  const uniqueDice = [...new Set(g.dice)];
  for (const die of uniqueDice) {
    if (g.bar[color] > 0) {
      const entry = color === 'white' ? 24 - die : die - 1;
      if (entry >= 0 && entry < 24) {
        const p = g.points[entry];
        if (!p.color || p.color === color || p.count === 1) return true;
      }
      continue;
    }
    for (let i = 0; i < 24; i++) {
      const p = g.points[i];
      if (p.color !== color || !p.count) continue;
      if (serverMovesFrom(g, i, [die]).length > 0) return true;
    }
    if (serverCanBearOff(g, color)) {
      const hs = color === 'white' ? 18 : 0;
      const he = color === 'white' ? 23 : 5;
      for (let i = hs; i <= he; i++) {
        if (g.points[i].color === color && g.points[i].count > 0) {
          if (serverMovesFrom(g, i, [die]).some(m => m.to === 'off')) return true;
        }
      }
    }
  }
  return false;
}

function serverMovesFrom(g, from, diceArr) {
  const color = g.turn;
  const moves = [];
  for (const die of [...new Set(diceArr)]) {
    const dir = color === 'white' ? -1 : 1;
    const to = from + dir * die;
    if (to < 0 || to > 23) {
      if (serverCanBearOff(g, color)) {
        if (color === 'white' && from - die < 0) {
          if (from - die === -1 || serverIsHighest(g, from, color)) moves.push({ die, to: 'off' });
        } else if (color === 'black' && from + die > 23) {
          if (from + die === 24 || serverIsHighest(g, from, color)) moves.push({ die, to: 'off' });
        }
      }
      continue;
    }
    const d = g.points[to];
    if (!d.color || d.color === color || d.count === 1) moves.push({ die, to });
  }
  return moves;
}

function serverCanBearOff(g, color) {
  if (g.bar[color] > 0) return false;
  const hs = color === 'white' ? 18 : 0;
  const he = color === 'white' ? 23 : 5;
  for (let i = 0; i < 24; i++) {
    if (i < hs || i > he) {
      if (g.points[i].color === color && g.points[i].count > 0) return false;
    }
  }
  return true;
}

function serverIsHighest(g, from, color) {
  if (color === 'white') {
    for (let i = 18; i < from; i++) if (g.points[i].color === 'white' && g.points[i].count > 0) return false;
  } else {
    for (let i = from + 1; i <= 5; i++) if (g.points[i].color === 'black' && g.points[i].count > 0) return false;
  }
  return true;
}

// Cleanup empty rooms every 10 minutes
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    const wAlive = room.players.white?.readyState === WebSocket.OPEN;
    const bAlive = room.players.black?.readyState === WebSocket.OPEN;
    if (!wAlive && !bAlive) rooms.delete(code);
  }
}, 600000);

server.listen(PORT, () => {
  console.log(`🎲 Tavla server running on port ${PORT}`);
});
