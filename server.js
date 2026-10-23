// ==========================================
// OMOK - Single & Online Multi Server (server.js)
// No external dependencies required: run with `node server.js`
// ==========================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3010;
const BOARD_SIZE = 15;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ==========================================
// Windows Desktop Shortcut Check & Creation Helper
// ==========================================
function getShortcutScript(action, targetUrl, iconPath) {
  if (action === 'check') {
    return `
      $desktop = [Environment]::GetFolderPath('Desktop')
      $names = @('OMOK.lnk', 'OMOK.url', '오목.lnk', '오목.url')
      $exists = $false
      foreach ($n in $names) {
        if (Test-Path (Join-Path $desktop $n)) { $exists = $true; break }
      }
      if ($exists) { Write-Output 'EXISTS' } else { Write-Output 'NONE' }
    `;
  }
  const safeUrl = String(targetUrl || `http://localhost:${PORT}`).replace(/'/g, '');
  const safeIcon = String(iconPath || path.join(__dirname, 'favicon.ico')).replace(/'/g, '');
  return `
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'OMOK.lnk'
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($lnkPath)
    $edgePaths = @(
      "\${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe",
      "\${env:ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe"
    )
    $chromePaths = @(
      "\${env:ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe",
      "\${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",
      "\${env:LocalAppData}\\Google\\Chrome\\Application\\chrome.exe"
    )
    $browserExe = $null
    foreach ($p in ($chromePaths + $edgePaths)) {
      if ($p -and (Test-Path $p)) { $browserExe = $p; break }
    }
    if ($browserExe) {
      $sc.TargetPath = $browserExe
      $sc.Arguments = "--app=${safeUrl}"
    } else {
      $sc.TargetPath = "${safeUrl}"
    }
    $sc.WorkingDirectory = "${__dirname.replace(/\\/g, '\\\\')}"
    $sc.IconLocation = "${safeIcon},0"
    $sc.Description = "OMOK - Single & Online Multi"
    $sc.Save()
    Write-Output 'CREATED'
  `;
}

function checkWindowsDesktopShortcut(callback) {
  if (process.platform !== 'win32') {
    callback(false);
    return;
  }
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', getShortcutScript('check')],
    { timeout: 4000 },
    (err, stdout) => {
      if (err) {
        callback(false);
        return;
      }
      callback(String(stdout).trim().includes('EXISTS'));
    }
  );
}

function createWindowsDesktopShortcut(targetUrl, callback) {
  if (process.platform !== 'win32') {
    callback(false, 'Not Windows');
    return;
  }
  const iconPath = path.join(__dirname, 'favicon.ico');
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      getShortcutScript('create', targetUrl, iconPath)
    ],
    { timeout: 6000 },
    (err, stdout) => {
      if (err) {
        callback(false, err.message);
        return;
      }
      callback(String(stdout).trim().includes('CREATED'));
    }
  );
}

// ==========================================
// HTTP Static Server + Shortcut API
// ==========================================
const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  if (reqUrl === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK');
    return;
  }

  if (reqUrl === '/api/shortcut-status' && req.method === 'GET') {
    checkWindowsDesktopShortcut((exists) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ exists, platform: process.platform }));
    });
    return;
  }

  if (reqUrl === '/api/create-shortcut' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let targetUrl = `http://localhost:${PORT}`;
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.url) targetUrl = parsed.url;
      } catch (e) {}
      createWindowsDesktopShortcut(targetUrl, (ok, errMsg) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok, error: errMsg || null }));
      });
    });
    return;
  }

  let filePathReq = reqUrl === '/' ? '/index.html' : reqUrl;
  const safePath = path.normalize(filePathReq).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

// ==========================================
// Lightweight RFC 6455 WebSocket Implementation
// ==========================================
const clients = new Map();
const rooms = new Map();
let nextClientId = 1;
let nextRoomId = 1;

function encodeWsFrame(dataStr) {
  const payload = Buffer.from(dataStr, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendJson(client, obj) {
  if (!client || !client.socket || client.socket.destroyed) return;
  try {
    const frame = encodeWsFrame(JSON.stringify(obj));
    client.socket.write(frame);
  } catch (e) {}
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];
  socket.write(headers.join('\r\n'));

  const clientId = String(nextClientId++);
  const client = {
    id: clientId,
    nickname: `P${clientId}`,
    stats: { wins: 0, losses: 0, draws: 0 },
    socket,
    roomId: null,
    buffer: Buffer.alloc(0)
  };
  clients.set(clientId, client);

  sendJson(client, { type: 'welcome', clientId, rooms: getPublicRoomList() });

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    processBuffer(client);
  });

  socket.on('close', () => handleDisconnect(client));
  socket.on('error', () => handleDisconnect(client));
});

function processBuffer(client) {
  while (client.buffer.length >= 2) {
    const firstByte = client.buffer[0];
    const secondByte = client.buffer[1];
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (client.buffer.length < 4) return;
      payloadLen = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (client.buffer.length < 10) return;
      payloadLen = Number(client.buffer.readBigUInt64BE(2));
      offset = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = offset + maskLen + payloadLen;
    if (client.buffer.length < totalFrameLen) return;

    let payload = client.buffer.subarray(offset + maskLen, totalFrameLen);
    if (isMasked) {
      const mask = client.buffer.subarray(offset, offset + 4);
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    client.buffer = client.buffer.subarray(totalFrameLen);

    if (opcode === 0x8) {
      client.socket.end();
      handleDisconnect(client);
      return;
    } else if (opcode === 0x9) {
      const pong = Buffer.from([0x8a, 0x00]);
      client.socket.write(pong);
    } else if (opcode === 0x1) {
      try {
        const msg = JSON.parse(payload.toString('utf8'));
        handleClientMessage(client, msg);
      } catch (e) {}
    }
  }
}

// ==========================================
// Omok Board & Win Check Logic
// ==========================================
function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function checkFiveWin(board, r, c, color) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  for (const [dr, dc] of dirs) {
    const line = [[r, c]];
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
      line.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
    nr = r - dr;
    nc = c - dc;
    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
      line.unshift([nr, nc]);
      nr -= dr;
      nc -= dc;
    }
    if (line.length >= 5) {
      return line.slice(0, 5);
    }
  }
  return null;
}

// ==========================================
// Lobby & Room Management
// ==========================================
function sanitizeStats(s) {
  if (!s || typeof s !== 'object') return { wins: 0, losses: 0, draws: 0 };
  return {
    wins: Math.max(0, Number(s.wins) || 0),
    losses: Math.max(0, Number(s.losses) || 0),
    draws: Math.max(0, Number(s.draws) || 0)
  };
}

function getPublicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    list.push({
      id: room.id,
      title: room.title,
      hostName: room.players[0] ? room.players[0].nickname : '-',
      playerCount: room.players.length,
      maxPlayers: 2,
      status: room.status
    });
  }
  return list;
}

function broadcastRoomList() {
  const roomList = getPublicRoomList();
  for (const c of clients.values()) {
    if (!c.roomId) {
      sendJson(c, { type: 'room_list', rooms: roomList });
    }
  }
}

function resetRoomMatchState(room, swapFirstPlayer = false) {
  room.board = createEmptyBoard();
  room.moveCount = 0;
  room.lastMove = null;
  room.winLine = null;
  if (swapFirstPlayer && room.players.length === 2) {
    room.blackIndex = room.blackIndex === 0 ? 1 : 0;
  } else if (typeof room.blackIndex !== 'number') {
    room.blackIndex = 0;
  }
  room.turnColor = 1; // 1 = Black, 2 = White
  room.status = room.players.length === 2 ? 'playing' : 'waiting';
}

function sendRoomStateToPlayers(room) {
  for (let idx = 0; idx < room.players.length; idx++) {
    const p = room.players[idx];
    const oppIdx = idx === 0 ? 1 : 0;
    const opp = room.players[oppIdx] || null;
    const myColor = idx === room.blackIndex ? 1 : 2;
    const oppColor = myColor === 1 ? 2 : 1;

    sendJson(p, {
      type: 'room_update',
      room: {
        id: room.id,
        title: room.title,
        status: room.status,
        turnColor: room.turnColor,
        board: room.board,
        lastMove: room.lastMove,
        winLine: room.winLine,
        me: {
          id: p.id,
          nickname: p.nickname,
          color: myColor,
          stats: p.stats
        },
        opp: opp
          ? {
              id: opp.id,
              nickname: opp.nickname,
              color: oppColor,
              stats: opp.stats
            }
          : null
      }
    });
  }
}

function handleClientMessage(client, msg) {
  switch (msg.type) {
    case 'set_profile': {
      const clean = String(msg.nickname || '').trim().slice(0, 12);
      if (clean) client.nickname = clean;
      if (msg.stats) client.stats = sanitizeStats(msg.stats);
      if (client.roomId && rooms.has(client.roomId)) {
        sendRoomStateToPlayers(rooms.get(client.roomId));
      } else {
        sendJson(client, { type: 'room_list', rooms: getPublicRoomList() });
      }
      break;
    }

    case 'get_rooms': {
      sendJson(client, { type: 'room_list', rooms: getPublicRoomList() });
      break;
    }

    case 'create_room': {
      if (client.roomId) leaveCurrentRoom(client);
      if (msg.nickname) {
        const clean = String(msg.nickname).trim().slice(0, 12);
        if (clean) client.nickname = clean;
      }
      if (msg.stats) client.stats = sanitizeStats(msg.stats);

      const roomTitle = String(msg.title || `${client.nickname}'S ROOM`).trim().slice(0, 24);
      const roomId = `room_${nextRoomId++}`;
      const room = {
        id: roomId,
        title: roomTitle,
        players: [client],
        blackIndex: 0,
        turnColor: 1,
        status: 'waiting',
        board: createEmptyBoard(),
        moveCount: 0,
        lastMove: null,
        winLine: null
      };
      client.roomId = roomId;
      rooms.set(roomId, room);
      resetRoomMatchState(room, false);

      sendRoomStateToPlayers(room);
      broadcastRoomList();
      break;
    }

    case 'join_room': {
      if (client.roomId) leaveCurrentRoom(client);
      if (msg.nickname) {
        const clean = String(msg.nickname).trim().slice(0, 12);
        if (clean) client.nickname = clean;
      }
      if (msg.stats) client.stats = sanitizeStats(msg.stats);

      const room = rooms.get(msg.roomId);
      if (!room) {
        sendJson(client, { type: 'error', message: 'ROOM NOT FOUND' });
        sendJson(client, { type: 'room_list', rooms: getPublicRoomList() });
        return;
      }
      if (room.players.length >= 2) {
        sendJson(client, { type: 'error', message: 'ROOM IS FULL' });
        sendJson(client, { type: 'room_list', rooms: getPublicRoomList() });
        return;
      }

      room.players.push(client);
      client.roomId = room.id;
      room.blackIndex = 0;
      resetRoomMatchState(room, false);

      sendRoomStateToPlayers(room);
      broadcastRoomList();
      break;
    }

    case 'place_stone': {
      const room = rooms.get(client.roomId);
      if (!room || room.status !== 'playing' || room.players.length < 2) return;

      const playerIdx = room.players.findIndex((p) => p.id === client.id);
      if (playerIdx === -1) return;
      const myColor = playerIdx === room.blackIndex ? 1 : 2;
      if (room.turnColor !== myColor) return;

      const r = Number(msg.r);
      const c = Number(msg.c);
      if (
        !Number.isInteger(r) ||
        !Number.isInteger(c) ||
        r < 0 ||
        r >= BOARD_SIZE ||
        c < 0 ||
        c >= BOARD_SIZE
      ) {
        return;
      }
      if (room.board[r][c] !== 0) return;

      room.board[r][c] = myColor;
      room.moveCount += 1;
      room.lastMove = { r, c, color: myColor };

      const winLine = checkFiveWin(room.board, r, c, myColor);
      if (winLine) {
        room.status = 'finished';
        room.winLine = winLine;

        const oppIdx = playerIdx === 0 ? 1 : 0;
        const winner = room.players[playerIdx];
        const loser = room.players[oppIdx];

        winner.stats.wins += 1;
        loser.stats.losses += 1;

        for (const p of room.players) {
          sendJson(p, {
            type: 'stone_placed',
            r,
            c,
            color: myColor,
            turnColor: room.turnColor,
            winLine
          });
        }

        sendJson(winner, {
          type: 'match_over',
          result: 'win',
          winnerColor: myColor,
          winLine,
          meStats: winner.stats,
          oppStats: loser.stats
        });
        sendJson(loser, {
          type: 'match_over',
          result: 'lose',
          winnerColor: myColor,
          winLine,
          meStats: loser.stats,
          oppStats: winner.stats
        });
        broadcastRoomList();
        return;
      }

      if (room.moveCount >= BOARD_SIZE * BOARD_SIZE) {
        room.status = 'finished';
        const p1 = room.players[0];
        const p2 = room.players[1];
        p1.stats.draws += 1;
        p2.stats.draws += 1;

        for (const p of room.players) {
          sendJson(p, {
            type: 'stone_placed',
            r,
            c,
            color: myColor,
            turnColor: room.turnColor,
            winLine: null
          });
        }

        sendJson(p1, {
          type: 'match_over',
          result: 'draw',
          winnerColor: 0,
          winLine: null,
          meStats: p1.stats,
          oppStats: p2.stats
        });
        sendJson(p2, {
          type: 'match_over',
          result: 'draw',
          winnerColor: 0,
          winLine: null,
          meStats: p2.stats,
          oppStats: p1.stats
        });
        broadcastRoomList();
        return;
      }

      room.turnColor = myColor === 1 ? 2 : 1;
      for (const p of room.players) {
        sendJson(p, {
          type: 'stone_placed',
          r,
          c,
          color: myColor,
          turnColor: room.turnColor,
          winLine: null
        });
      }
      break;
    }

    case 'play_again': {
      const room = rooms.get(client.roomId);
      if (!room || room.players.length < 2) return;
      if (msg.stats) client.stats = sanitizeStats(msg.stats);
      resetRoomMatchState(room, true);
      sendRoomStateToPlayers(room);
      broadcastRoomList();
      break;
    }

    case 'leave_room': {
      leaveCurrentRoom(client);
      sendJson(client, { type: 'left_room', rooms: getPublicRoomList() });
      break;
    }
  }
}

function leaveCurrentRoom(client) {
  const roomId = client.roomId;
  if (!roomId) return;
  client.roomId = null;

  const room = rooms.get(roomId);
  if (!room) return;

  const wasPlaying = room.status === 'playing';
  room.players = room.players.filter((p) => p.id !== client.id);

  if (room.players.length === 0) {
    rooms.delete(roomId);
  } else {
    room.blackIndex = 0;
    resetRoomMatchState(room, false);
    sendRoomStateToPlayers(room);
    if (wasPlaying) {
      sendJson(room.players[0], {
        type: 'opponent_left',
        message: 'OPPONENT LEFT'
      });
    }
  }
  broadcastRoomList();
}

function handleDisconnect(client) {
  if (!clients.has(client.id)) return;
  leaveCurrentRoom(client);
  clients.delete(client.id);
}

setInterval(() => {
  for (const c of clients.values()) {
    sendJson(c, { type: 'ping' });
  }
}, 25000);

function getLocalIpAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

server.listen(PORT, () => {
  const ips = getLocalIpAddresses();
  console.log('====================================================');
  console.log(`⚫⚪ OMOK SERVER RUNNING!`);
  console.log(`👉 Local PC URL : http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`👉 LAN / Mobile : http://${ip}:${PORT}`);
  });
  console.log('====================================================');
});
