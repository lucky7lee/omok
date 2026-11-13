// ==========================================
// OMOK - Single (vs AI) & Online Multi (game.js)
// ==========================================

const BOARD_SIZE = 15;
const TURN_LIMIT_SEC = 30;
const HOST_START_LIMIT_SEC = 30;
const STAR_POINTS = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11]
];

const AI_STAGES = [
  { level: 1, name: '초보 목수', randChance: 0.45, topK: 5, depth: 1 },
  { level: 2, name: '견습 기사', randChance: 0.28, topK: 4, depth: 1 },
  { level: 3, name: '도장 수련생', randChance: 0.14, topK: 3, depth: 1 },
  { level: 4, name: '바둑돌 수호자', randChance: 0.05, topK: 2, depth: 1 },
  { level: 5, name: '철벽 전략가', randChance: 0, topK: 1, depth: 1 },
  { level: 6, name: '백전노장', randChance: 0, topK: 6, depth: 2 },
  { level: 7, name: '그림자 고수', randChance: 0, topK: 8, depth: 2 },
  { level: 8, name: '천하제일 검객', randChance: 0, topK: 10, depth: 2 },
  { level: 9, name: '불멸의 마스터', randChance: 0, topK: 12, depth: 2 },
  { level: 10, name: '절대지존 AI', randChance: 0, topK: 14, depth: 2 }
];

const state = {
  screen: 'menu', // 'menu' | 'lobby' | 'game'
  mode: 'single', // 'single' | 'multi'
  nickname: '',
  oppNickname: 'AI',
  oppBadgeLevel: 0,
  bestBadgeLevel: 0, // 0: none, 1: ⭐(Lv.3), 2: ⭐⭐(Lv.5), 3: ⭐⭐⭐(Lv.8), 4: 💎(Lv.10 clear)

  singleStage: 1,
  series: { round: 1, myWins: 0, oppWins: 0, draws: 0 },
  multiStatus: 'waiting', // 'waiting' | 'ready' | 'playing' | 'round_pause' | 'finished'
  isHost: false,
  readySecondsLeft: 0,

  myColor: 1, // 1 = Black, 2 = White
  oppColor: 2,
  turnColor: 1,
  turnSecondsLeft: TURN_LIMIT_SEC,

  board: createEmptyBoard(),
  moveCount: 0,
  lastMove: null,
  winLine: null,
  hoverCell: null,
  isGameOver: false,
  isMatchOver: false,
  isRoundTransition: false,
  isWaitingOpponent: false,
  abandonPenalized: false,
  soundEnabled: true,

  stats: {
    single: {
      me: { wins: 0, losses: 0, draws: 0 },
      ai: { wins: 0, losses: 0, draws: 0 }
    },
    multi: {
      me: { wins: 0, losses: 0, draws: 0 },
      opp: { wins: 0, losses: 0, draws: 0 }
    }
  }
};

let aiTimerId = null;
let turnTimerIntervalId = null;
let multiReturnLobbyTimerId = null;
let readyCountdownIntervalId = null;
let roundTransitionIntervalId = null;
let roundTransitionTimeoutId = null;
let matchOverHandled = false;

function getBadgePrefix(level) {
  if (level >= 4) return '💎 ';
  if (level === 3) return '⭐⭐⭐ ';
  if (level === 2) return '⭐⭐ ';
  if (level === 1) return '⭐ ';
  return '';
}

function getBadgeOnly(level) {
  if (level >= 4) return '💎';
  if (level === 3) return '⭐⭐⭐';
  if (level === 2) return '⭐⭐';
  if (level === 1) return '⭐';
  return '';
}

function formatNameWithBadge(name, badgeLevel) {
  const prefix = getBadgePrefix(badgeLevel || 0);
  return `${prefix}${name || ''}`.trim();
}

function checkAndUpgradeBadge(stageReached, clearedStage10 = false) {
  let target = state.bestBadgeLevel;
  if (clearedStage10) target = Math.max(target, 4);
  else if (stageReached >= 8) target = Math.max(target, 3);
  else if (stageReached >= 5) target = Math.max(target, 2);
  else if (stageReached >= 3) target = Math.max(target, 1);

  if (target > state.bestBadgeLevel) {
    state.bestBadgeLevel = target;
    try {
      localStorage.setItem('omok_rank_badge_v1', String(state.bestBadgeLevel));
    } catch (e) {}
    renderMenuRankBadge();
    updateTopScoreHeader();
    return true;
  }
  return false;
}

function renderMenuRankBadge() {
  const badgeEl = document.getElementById('menu-rank-badge');
  if (!badgeEl) return;
  const icon = getBadgeOnly(state.bestBadgeLevel);
  if (icon) {
    badgeEl.textContent = icon;
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.textContent = '';
    badgeEl.classList.add('hidden');
  }
}

function clearReadyCountdown() {
  if (readyCountdownIntervalId) {
    clearInterval(readyCountdownIntervalId);
    readyCountdownIntervalId = null;
  }
}

function clearRoundTransitionTimers() {
  if (roundTransitionIntervalId) {
    clearInterval(roundTransitionIntervalId);
    roundTransitionIntervalId = null;
  }
  if (roundTransitionTimeoutId) {
    clearTimeout(roundTransitionTimeoutId);
    roundTransitionTimeoutId = null;
  }
  const overlay = document.getElementById('round-transition-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function clearMultiReturnLobbyTimer() {
  if (multiReturnLobbyTimerId) {
    clearTimeout(multiReturnLobbyTimerId);
    multiReturnLobbyTimerId = null;
  }
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function getRandomEmptyCell(board) {
  const empty = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) empty.push({ r, c });
    }
  }
  if (empty.length === 0) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

function clearAiTimer() {
  if (aiTimerId) {
    clearTimeout(aiTimerId);
    aiTimerId = null;
  }
}

function clearTurnCountdown() {
  if (turnTimerIntervalId) {
    clearInterval(turnTimerIntervalId);
    turnTimerIntervalId = null;
  }
}

function isPlayingTurnActive() {
  if (state.screen !== 'game' || state.isGameOver || state.isMatchOver || state.isRoundTransition || state.isWaitingOpponent) {
    return false;
  }
  if (state.mode === 'multi' && state.multiStatus !== 'playing') {
    return false;
  }
  return true;
}

function startTurnCountdown() {
  clearTurnCountdown();
  state.turnSecondsLeft = TURN_LIMIT_SEC;
  renderTurnTimerBadge();

  if (!isPlayingTurnActive()) {
    return;
  }

  turnTimerIntervalId = setInterval(() => {
    if (!isPlayingTurnActive()) {
      clearTurnCountdown();
      renderTurnTimerBadge();
      return;
    }

    state.turnSecondsLeft = Math.max(0, state.turnSecondsLeft - 1);
    renderTurnTimerBadge();

    if (state.turnSecondsLeft <= 5 && state.turnSecondsLeft > 0 && state.turnColor === state.myColor) {
      playTickWarningSound();
    }

    if (state.turnSecondsLeft <= 0) {
      clearTurnCountdown();
      handleTurnTimeoutAutoPlace();
    }
  }, 1000);
}

function renderTurnTimerBadge() {
  const badge = document.getElementById('turn-timer-badge');
  if (!badge) return;
  if (!isPlayingTurnActive()) {
    badge.classList.add('hidden');
    badge.classList.remove('urgent');
    return;
  }
  badge.classList.remove('hidden');
  badge.textContent = `${state.turnSecondsLeft}s`;
  badge.classList.toggle('urgent', state.turnSecondsLeft <= 5);
}

function handleTurnTimeoutAutoPlace() {
  if (!isPlayingTurnActive()) return;

  // When it is my turn and 30 seconds have elapsed, place randomly at any empty spot
  if (state.turnColor === state.myColor) {
    const cell = getRandomEmptyCell(state.board);
    if (!cell) return;
    if (state.mode === 'single') {
      applySinglePlayMove(cell.r, cell.c, state.myColor);
    } else {
      wsSend({ type: 'place_stone', r: cell.r, c: cell.c });
    }
  }
}

// ==========================================
// Web Audio API Sound Effects (Stone Clack & Match Fanfare)
// ==========================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Crisp wooden board + stone clack sound ("착!")
function playStonePlaceSound(isBlack = true) {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1) Short crisp impact noise burst (stone hitting wood)
  const noiseLen = Math.floor(ctx.sampleRate * 0.045);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    const env = Math.exp(-i / (ctx.sampleRate * 0.008));
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(isBlack ? 1850 : 2100, now);
  filter.Q.setValueAtTime(2.4, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.55, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.042);

  noiseSrc.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noiseSrc.start(now);

  // 2) Wooden board resonance knock
  const woodOsc = ctx.createOscillator();
  const woodGain = ctx.createGain();
  woodOsc.type = 'triangle';
  woodOsc.frequency.setValueAtTime(isBlack ? 320 : 360, now);
  woodOsc.frequency.exponentialRampToValueAtTime(95, now + 0.055);

  woodGain.gain.setValueAtTime(0.38, now);
  woodGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  woodOsc.connect(woodGain);
  woodGain.connect(ctx.destination);
  woodOsc.start(now);
  woodOsc.stop(now + 0.065);

  // 3) High ceramic click transient
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'sine';
  clickOsc.frequency.setValueAtTime(isBlack ? 1420 : 1620, now);
  clickOsc.frequency.exponentialRampToValueAtTime(480, now + 0.022);

  clickGain.gain.setValueAtTime(0.22, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickOsc.start(now);
  clickOsc.stop(now + 0.028);
}

function playMatchSound(type) {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const playNote = (freq, delayMs, durMs, wave = 'sine', vol = 0.16) => {
    setTimeout(() => {
      if (!state.soundEnabled) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + durMs / 1000);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durMs / 1000);
    }, delayMs);
  };

  if (type === 'win') {
    playNote(523.25, 0, 120, 'triangle', 0.18);
    playNote(659.25, 100, 120, 'triangle', 0.18);
    playNote(783.99, 200, 140, 'triangle', 0.18);
    playNote(1046.5, 310, 280, 'triangle', 0.22);
  } else if (type === 'lose') {
    playNote(392.0, 0, 150, 'sawtooth', 0.14);
    playNote(349.23, 140, 150, 'sawtooth', 0.14);
    playNote(261.63, 280, 280, 'sawtooth', 0.16);
  } else if (type === 'draw') {
    playNote(440, 0, 130, 'sine', 0.15);
    playNote(440, 150, 180, 'sine', 0.15);
  }
}

function playTickWarningSound() {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.065);
}

// ==========================================
// Stats Persistence & Top Score Header UI
// ==========================================
function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return { wins: 0, losses: 0, draws: 0 };
  return {
    wins: Math.max(0, Number(r.wins) || 0),
    losses: Math.max(0, Number(r.losses) || 0),
    draws: Math.max(0, Number(r.draws) || 0)
  };
}

function loadSavedData() {
  try {
    const sSingle = localStorage.getItem('omok_stats_single_v1');
    if (sSingle) {
      const p = JSON.parse(sSingle);
      state.stats.single.me = sanitizeRecord(p.me);
      state.stats.single.ai = sanitizeRecord(p.ai);
    }
    const sMulti = localStorage.getItem('omok_stats_multi_v1');
    if (sMulti) {
      const p = JSON.parse(sMulti);
      state.stats.multi.me = sanitizeRecord(p.me);
    }
    const savedBadge = Number(localStorage.getItem('omok_rank_badge_v1') || 0);
    state.bestBadgeLevel = Math.max(0, Math.min(4, Number.isFinite(savedBadge) ? savedBadge : 0));
    localStorage.removeItem('omok_nickname_v1');
    localStorage.removeItem('omok_nickname_user_v2');
  } catch (e) {}
  state.nickname = '';
  const input = document.getElementById('input-nickname');
  if (input) input.value = '';
  renderMenuRankBadge();
  updateTopScoreHeader();
}

function saveStatsData() {
  try {
    localStorage.setItem('omok_stats_single_v1', JSON.stringify(state.stats.single));
    localStorage.setItem('omok_stats_multi_v1', JSON.stringify({ me: state.stats.multi.me }));
  } catch (e) {}
  updateTopScoreHeader();
}

function calcWinRate(record) {
  const total = record.wins + record.losses;
  return total > 0 ? Math.round((record.wins / total) * 100) : 0;
}

function updateTopScoreHeader() {
  const isMulti = state.mode === 'multi';
  const myRec = isMulti ? state.stats.multi.me : state.stats.single.me;
  const oppRec = isMulti ? state.stats.multi.opp : state.stats.single.ai;

  const myRate = calcWinRate(myRec);
  const oppRate = calcWinRate(oppRec);

  document.getElementById('my-header-name').textContent = formatNameWithBadge(
    state.nickname || 'ME',
    state.bestBadgeLevel
  );
  document.getElementById('opp-header-name').textContent = isMulti
    ? formatNameWithBadge(state.oppNickname || 'OPP', state.oppBadgeLevel)
    : state.oppNickname || 'AI';

  document.getElementById('my-stone-dot').textContent = state.myColor === 1 ? '⚫' : '⚪';
  document.getElementById('opp-stone-dot').textContent = state.oppColor === 1 ? '⚫' : '⚪';

  document.getElementById('my-stat-w').textContent = myRec.wins;
  document.getElementById('my-stat-l').textContent = myRec.losses;
  document.getElementById('my-stat-d').textContent = myRec.draws;
  document.getElementById('my-stat-r').textContent = `${myRate}%`;

  document.getElementById('opp-stat-w').textContent = oppRec.wins;
  document.getElementById('opp-stat-l').textContent = oppRec.losses;
  document.getElementById('opp-stat-d').textContent = oppRec.draws;
  document.getElementById('opp-stat-r').textContent = `${oppRate}%`;

  const myBox = document.getElementById('header-my-box');
  const oppBox = document.getElementById('header-opp-box');

  if (isPlayingTurnActive()) {
    myBox.classList.toggle('active-turn', state.turnColor === state.myColor);
    oppBox.classList.toggle('active-turn', state.turnColor === state.oppColor);
  } else {
    myBox.classList.remove('active-turn');
    oppBox.classList.remove('active-turn');
  }
  updateBo3Scoreboard();
}

function updateBo3Scoreboard() {
  const oppNameEl = document.getElementById('bo3-opp-name');
  const oppPipsEl = document.getElementById('bo3-opp-pips');
  const oppWinsEl = document.getElementById('bo3-opp-wins');
  const stageTagEl = document.getElementById('bo3-stage-tag');
  const roundTagEl = document.getElementById('bo3-round-tag');
  const meWinsEl = document.getElementById('bo3-me-wins');
  const mePipsEl = document.getElementById('bo3-me-pips');
  const meNameEl = document.getElementById('bo3-me-name');
  if (!oppNameEl) return;

  const s = state.series || { round: 1, myWins: 0, oppWins: 0, draws: 0 };
  const myPips = '●'.repeat(Math.min(2, s.myWins)) + '○'.repeat(Math.max(0, 2 - s.myWins));
  const oppPips = '●'.repeat(Math.min(2, s.oppWins)) + '○'.repeat(Math.max(0, 2 - s.oppWins));

  oppNameEl.textContent =
    state.mode === 'multi'
      ? formatNameWithBadge(state.oppNickname || 'OPP', state.oppBadgeLevel)
      : state.oppNickname || 'AI';
  oppPipsEl.textContent = oppPips;
  oppWinsEl.textContent = String(s.oppWins);

  meNameEl.textContent = formatNameWithBadge(state.nickname || 'ME', state.bestBadgeLevel);
  mePipsEl.textContent = myPips;
  meWinsEl.textContent = String(s.myWins);

  stageTagEl.textContent = state.mode === 'single' ? `STAGE ${state.singleStage}/10` : 'MULTI · BO3';
  roundTagEl.textContent = `R${s.round} (${s.myWins}승 ${s.oppWins}패${s.draws > 0 ? ` ${s.draws}무` : ''})`;
}

function formatSeriesKorean(s) {
  const w = s.myWins || 0;
  const l = s.oppWins || 0;
  const d = s.draws || 0;
  const parts = [];
  if (w > 0) parts.push(`${w}승`);
  if (l > 0) parts.push(`${l}패`);
  if (d > 0) parts.push(`${d}무`);
  if (parts.length === 0) return '0승 0패!';
  return `${parts.join(' ')}!`;
}

function playRoundTransitionOverlay(roundResult, seriesSnapshot, onComplete) {
  clearRoundTransitionTimers();
  state.isRoundTransition = true;
  clearTurnCountdown();
  renderTurnTimerBadge();

  const overlay = document.getElementById('round-transition-overlay');
  const badge = document.getElementById('rt-badge');
  const main = document.getElementById('rt-main');
  const sub = document.getElementById('rt-sub');
  if (!overlay || !badge || !main || !sub) {
    state.isRoundTransition = false;
    if (onComplete) onComplete();
    return;
  }

  playMatchSound(roundResult);
  const roundNum = (seriesSnapshot && seriesSnapshot.round) || state.series.round || 1;
  badge.textContent = `ROUND ${roundNum}`;

  const resultLabel =
    roundResult === 'win' ? '🎉 이겼다!' : roundResult === 'lose' ? '💔 졌다!' : '🤝 비겼다!';
  let sec = 3;
  main.textContent = resultLabel;
  sub.textContent = `${sec}초 후 결과 집계...`;
  overlay.classList.remove('hidden');

  let phase = 1;
  roundTransitionIntervalId = setInterval(() => {
    sec -= 1;
    if (phase === 1) {
      if (sec > 0) {
        sub.textContent = `${sec}초 후 결과 집계...`;
      } else {
        phase = 2;
        sec = 3;
        badge.textContent = '3판 2승제 현황';
        main.textContent = formatSeriesKorean(seriesSnapshot || state.series);
        sub.textContent = `${sec}초 후 진행...`;
      }
    } else {
      if (sec > 0) {
        sub.textContent = `${sec}초 후 진행...`;
      } else {
        clearRoundTransitionTimers();
        state.isRoundTransition = false;
        if (onComplete) onComplete();
      }
    }
  }, 1000);
}

function isActiveMatch() {
  if (state.screen !== 'game') return false;
  if (state.mode === 'single') {
    return !state.isMatchOver;
  }
  return state.multiStatus === 'playing' || state.multiStatus === 'round_pause';
}

function penalizeActiveMatchAbandon(sendLeave = true) {
  if (state.abandonPenalized || !isActiveMatch()) return false;
  state.abandonPenalized = true;

  if (state.mode === 'single') {
    state.stats.single.me.losses += 1;
    state.stats.single.ai.wins += 1;
    saveStatsData();
  } else {
    state.stats.multi.me.losses += 1;
    saveStatsData();
    if (sendLeave) {
      wsSend({ type: 'leave_room', abandoned: true });
    }
  }
  return true;
}

function updateTurnBannerUI() {
  const banner = document.getElementById('turn-banner');
  const icon = document.getElementById('turn-stone-icon');
  const text = document.getElementById('turn-status-text');

  if (state.isWaitingOpponent || (state.mode === 'multi' && state.multiStatus === 'ready')) {
    banner.className = 'turn-banner wait-turn';
    icon.textContent = '⏳';
    text.textContent = state.multiStatus === 'ready' ? 'READY...' : 'WAITING OPP...';
    return;
  }

  if (state.isGameOver || state.isMatchOver) {
    banner.className = 'turn-banner opp-turn';
    icon.textContent = '🏁';
    text.textContent = 'FINISHED';
    return;
  }

  const isMyTurn = state.turnColor === state.myColor;
  icon.textContent = state.turnColor === 1 ? '⚫' : '⚪';
  if (isMyTurn) {
    banner.className = 'turn-banner my-turn';
    text.textContent = 'MY TURN';
  } else {
    banner.className = 'turn-banner opp-turn';
    text.textContent = state.mode === 'single' ? 'AI TURN...' : `${state.oppNickname} TURN`;
  }
}

function showScreen(screenName) {
  const prevScreen = state.screen;
  state.screen = screenName;
  if (screenName !== 'game') {
    clearTurnCountdown();
    clearAiTimer();
    clearMultiReturnLobbyTimer();
    clearReadyCountdown();
    clearRoundTransitionTimers();
    const readyOv = document.getElementById('host-ready-overlay');
    if (readyOv) readyOv.classList.add('hidden');
  }
  document.getElementById('screen-menu').classList.toggle('hidden', screenName !== 'menu');
  document.getElementById('screen-lobby').classList.toggle('hidden', screenName !== 'lobby');
  document.getElementById('screen-game').classList.toggle('hidden', screenName !== 'game');
  document.getElementById('gameover-modal').classList.add('hidden');
  updateTopScoreHeader();
  if (screenName === 'game') {
    if (prevScreen !== 'game') {
      try {
        history.pushState({ omokInGame: true }, '');
      } catch (e) {}
    }
    requestAnimationFrame(() => drawOmokBoard());
  }
}

function syncNickname() {
  const input = document.getElementById('input-nickname');
  const clean = (input ? input.value : '').trim().slice(0, 10);
  state.nickname = clean;
  if (input) input.value = clean;
  if (clean) {
    const pill = document.getElementById('name-input-pill');
    const warn = document.getElementById('id-warning-msg');
    if (pill) pill.classList.remove('input-error');
    if (warn) warn.classList.add('hidden');
  }
  updateTopScoreHeader();
}

function validateNicknameBeforePlay() {
  syncNickname();
  if (state.nickname && state.nickname.length > 0) {
    return true;
  }
  const input = document.getElementById('input-nickname');
  const pill = document.getElementById('name-input-pill');
  const warn = document.getElementById('id-warning-msg');
  if (warn) {
    warn.classList.remove('hidden');
  }
  if (pill) {
    pill.classList.remove('input-error');
    void pill.offsetWidth;
    pill.classList.add('input-error');
  }
  playTickWarningSound();
  if (input) {
    input.focus();
  }
  return false;
}

// ==========================================
// 15x15 Canvas Board Rendering
// ==========================================
function getBoardMetrics(canvas) {
  const size = canvas.width;
  const pad = size * 0.055;
  const gridSpan = size - pad * 2;
  const step = gridSpan / (BOARD_SIZE - 1);
  return { size, pad, step };
}

function drawOmokBoard() {
  const canvas = document.getElementById('omok-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { size, pad, step } = getBoardMetrics(canvas);

  ctx.clearRect(0, 0, size, size);

  // Subtle wood texture lines
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 53, 15, 0.06)';
  ctx.lineWidth = 2;
  for (let y = 8; y < size; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + 4, size * 0.7, y - 4, size, y + 2);
    ctx.stroke();
  }
  ctx.restore();

  // Grid lines
  ctx.strokeStyle = '#5c2d0c';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const pos = pad + i * step;
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(pad, pos);
    ctx.lineTo(size - pad, pos);
    ctx.stroke();
    // Vertical
    ctx.beginPath();
    ctx.moveTo(pos, pad);
    ctx.lineTo(pos, size - pad);
    ctx.stroke();
  }

  // Star points (Hoshi)
  ctx.fillStyle = '#4a2106';
  for (const [sr, sc] of STAR_POINTS) {
    const sx = pad + sc * step;
    const sy = pad + sr * step;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hover preview stone (desktop cursor preview)
  if (
    state.hoverCell &&
    !state.isGameOver &&
    !state.isWaitingOpponent &&
    state.turnColor === state.myColor
  ) {
    const { r, c } = state.hoverCell;
    if (state.board[r][c] === 0) {
      const hx = pad + c * step;
      const hy = pad + r * step;
      ctx.save();
      ctx.globalAlpha = 0.38;
      drawSingleStone(ctx, hx, hy, step * 0.44, state.myColor);
      ctx.restore();
    }
  }

  // Placed stones
  const stoneRadius = step * 0.45;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const color = state.board[r][c];
      if (color !== 0) {
        const x = pad + c * step;
        const y = pad + r * step;
        drawSingleStone(ctx, x, y, stoneRadius, color);
      }
    }
  }

  // Last move marker dot
  if (state.lastMove) {
    const lx = pad + state.lastMove.c * step;
    const ly = pad + state.lastMove.r * step;
    ctx.save();
    ctx.fillStyle = state.lastMove.color === 1 ? '#38bdf8' : '#e11d48';
    ctx.beginPath();
    ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Winning 5-in-a-row highlight line & rings
  if (state.winLine && state.winLine.length >= 5) {
    const first = state.winLine[0];
    const last = state.winLine[state.winLine.length - 1];
    const x1 = pad + first[1] * step;
    const y1 = pad + first[0] * step;
    const x2 = pad + last[1] * step;
    const y2 = pad + last[0] * step;

    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(245, 158, 11, 0.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    for (const [wr, wc] of state.winLine) {
      const wx = pad + wc * step;
      const wy = pad + wr * step;
      ctx.beginPath();
      ctx.arc(wx, wy, stoneRadius * 0.92, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fef08a';
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSingleStone(ctx, x, y, radius, color) {
  ctx.save();

  // Drop shadow
  ctx.shadowColor = 'rgba(40, 18, 5, 0.45)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 1.5;
  ctx.shadowOffsetY = 2.5;

  const grad = ctx.createRadialGradient(
    x - radius * 0.32,
    y - radius * 0.32,
    radius * 0.08,
    x,
    y,
    radius
  );

  if (color === 1) {
    // 3D Glossy Black Stone
    grad.addColorStop(0, '#64748b');
    grad.addColorStop(0.28, '#1e293b');
    grad.addColorStop(0.75, '#090d16');
    grad.addColorStop(1, '#000000');
  } else {
    // 3D Glossy White Stone
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#f8fafc');
    grad.addColorStop(0.85, '#cbd5e1');
    grad.addColorStop(1, '#94a3b8');
  }

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1;
  ctx.strokeStyle = color === 1 ? '#020617' : '#94a3b8';
  ctx.stroke();
  ctx.restore();
}

function getCellFromPointerEvent(e) {
  const canvas = document.getElementById('omok-canvas');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;

  const { pad, step } = getBoardMetrics(canvas);
  const c = Math.round((px - pad) / step);
  const r = Math.round((py - pad) / step);

  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
  const cx = pad + c * step;
  const cy = pad + r * step;
  if (Math.hypot(px - cx, py - cy) > step * 0.62) return null;
  return { r, c };
}

// ==========================================
// Win Check & Smart Single-Player AI
// ==========================================
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

function evaluateDirectionScore(board, r, c, dr, dc, color) {
  let count = 1;
  let openEnds = 0;

  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
    count++;
    nr += dr;
    nc += dc;
  }
  if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 0) {
    openEnds++;
  }

  nr = r - dr;
  nc = c - dc;
  while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === color) {
    count++;
    nr -= dr;
    nc -= dc;
  }
  if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 0) {
    openEnds++;
  }

  if (count >= 5) return 1000000;
  if (count === 4) {
    if (openEnds === 2) return 120000;
    if (openEnds === 1) return 25000;
  }
  if (count === 3) {
    if (openEnds === 2) return 14000;
    if (openEnds === 1) return 1200;
  }
  if (count === 2) {
    if (openEnds === 2) return 650;
    if (openEnds === 1) return 90;
  }
  if (count === 1 && openEnds === 2) return 20;
  return 2;
}

function scoreIntersectionForColor(board, r, c, color) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];
  let total = 0;
  for (const [dr, dc] of dirs) {
    total += evaluateDirectionScore(board, r, c, dr, dc, color);
  }
  return total;
}

function getStageConfig(stage) {
  const idx = Math.max(0, Math.min(AI_STAGES.length - 1, (stage || 1) - 1));
  return AI_STAGES[idx];
}

function getCandidateMoves(board, aiColor, humanColor, stageLevel) {
  const candidates = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 0) continue;

      let hasNeighbor = false;
      for (let dr = -2; dr <= 2 && !hasNeighbor; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (
            nr >= 0 &&
            nr < BOARD_SIZE &&
            nc >= 0 &&
            nc < BOARD_SIZE &&
            board[nr][nc] !== 0
          ) {
            hasNeighbor = true;
            break;
          }
        }
      }
      if (!hasNeighbor) continue;

      const attackScore = scoreIntersectionForColor(board, r, c, aiColor);
      const defendScore = scoreIntersectionForColor(board, r, c, humanColor);

      let combined;
      if (attackScore >= 1000000) {
        combined = 10000000 + attackScore;
      } else if (defendScore >= 1000000) {
        combined = 5000000 + defendScore;
      } else {
        const centerBias = 14 - (Math.abs(r - 7) + Math.abs(c - 7));
        const atkW = stageLevel >= 7 ? 1.15 : 1.08;
        const defW = stageLevel >= 5 ? 1.06 : stageLevel <= 2 ? 0.78 : 1.0;
        combined = attackScore * atkW + defendScore * defW + centerBias + Math.random() * 4;
      }

      candidates.push({ r, c, score: combined, attackScore, defendScore });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function computeBestAiMove(board, aiColor, humanColor) {
  if (state.moveCount === 0) {
    return { r: 7, c: 7 };
  }

  const cfg = getStageConfig(state.singleStage);
  const candidates = getCandidateMoves(board, aiColor, humanColor, cfg.level);
  if (candidates.length === 0) return { r: 7, c: 7 };

  // Immediate win or mandatory block
  if (candidates[0].attackScore >= 1000000 || candidates[0].defendScore >= 1000000) {
    return { r: candidates[0].r, c: candidates[0].c };
  }

  // Lower stages (Lv.1~4): occasional suboptimal move from topK
  if (cfg.depth === 1) {
    if (cfg.randChance > 0 && candidates.length > 1 && Math.random() < cfg.randChance) {
      const poolSize = Math.min(cfg.topK, candidates.length);
      const pick = candidates[Math.floor(Math.random() * poolSize)];
      return { r: pick.r, c: pick.c };
    }
    return { r: candidates[0].r, c: candidates[0].c };
  }

  // Higher stages (Lv.6~10): 2-ply tactical lookahead on topK candidates
  const limit = Math.min(cfg.topK, candidates.length);
  let bestMove = candidates[0];
  let bestNetScore = -Infinity;

  for (let i = 0; i < limit; i++) {
    const m = candidates[i];
    board[m.r][m.c] = aiColor;
    const oppReplies = getCandidateMoves(board, humanColor, aiColor, cfg.level);
    const oppBest = oppReplies.length > 0 ? oppReplies[0].score : 0;
    board[m.r][m.c] = 0;

    const forkBonus = cfg.level >= 8 && m.attackScore >= 28000 ? 60000 : 0;
    const netScore = m.score + forkBonus - oppBest * 0.72;
    if (netScore > bestNetScore) {
      bestNetScore = netScore;
      bestMove = m;
    }
  }

  return { r: bestMove.r, c: bestMove.c };
}

// ==========================================
// Single Play Flow (10 Stages, Best of 3)
// ==========================================
function startSinglePlayStage(stageNum = 1) {
  clearAiTimer();
  clearTurnCountdown();
  clearRoundTransitionTimers();
  syncNickname();

  state.mode = 'single';
  state.singleStage = Math.max(1, Math.min(10, stageNum));
  state.series = { round: 1, myWins: 0, oppWins: 0, draws: 0 };
  state.isMatchOver = false;
  state.abandonPenalized = false;

  checkAndUpgradeBadge(state.singleStage, false);

  const cfg = getStageConfig(state.singleStage);
  state.oppNickname = `Lv.${cfg.level} ${cfg.name}`;
  state.oppBadgeLevel = 0;

  startSinglePlayRound(false);
}

function startSinglePlayRound(swapFirst = false) {
  clearAiTimer();
  clearRoundTransitionTimers();
  state.mode = 'single';

  if (swapFirst) {
    state.myColor = state.myColor === 1 ? 2 : 1;
  } else {
    state.myColor = 1;
  }
  state.oppColor = state.myColor === 1 ? 2 : 1;
  state.turnColor = 1;

  state.board = createEmptyBoard();
  state.moveCount = 0;
  state.lastMove = null;
  state.winLine = null;
  state.hoverCell = null;
  state.isGameOver = false;
  state.isRoundTransition = false;
  state.isWaitingOpponent = false;

  showScreen('game');
  updateTurnBannerUI();
  updateTopScoreHeader();
  startTurnCountdown();
  drawOmokBoard();

  if (state.turnColor === state.oppColor) {
    scheduleAiTurn();
  }
}

function scheduleAiTurn() {
  clearAiTimer();
  aiTimerId = setTimeout(() => {
    if (
      state.mode !== 'single' ||
      state.isGameOver ||
      state.isRoundTransition ||
      state.turnColor !== state.oppColor
    ) {
      return;
    }
    const move = computeBestAiMove(state.board, state.oppColor, state.myColor);
    applySinglePlayMove(move.r, move.c, state.oppColor);
  }, 360);
}

function finishSinglePlayRound(roundResult) {
  state.isGameOver = true;
  renderTurnTimerBadge();
  drawOmokBoard();

  if (roundResult === 'win') {
    state.series.myWins += 1;
    state.stats.single.me.wins += 1;
    state.stats.single.ai.losses += 1;
  } else if (roundResult === 'lose') {
    state.series.oppWins += 1;
    state.stats.single.me.losses += 1;
    state.stats.single.ai.wins += 1;
  } else {
    state.series.draws += 1;
    state.stats.single.me.draws += 1;
    state.stats.single.ai.draws += 1;
  }
  saveStatsData();

  const snapshot = { ...state.series };
  const matchDecided = snapshot.myWins >= 2 || snapshot.oppWins >= 2;

  playRoundTransitionOverlay(roundResult, snapshot, () => {
    if (state.mode !== 'single' || state.screen !== 'game') return;

    if (matchDecided) {
      state.isMatchOver = true;
      const didIWinSeries = snapshot.myWins >= 2;
      if (didIWinSeries) {
        if (state.singleStage >= 10) {
          checkAndUpgradeBadge(10, true);
          showGameOverModal('win', '💎 오목 달인에 등극하였습니다! (10단계 전체 클리어)', {
            primaryText: '🔄 1단계부터',
            primaryAction: () => startSinglePlayStage(1),
            secondaryText: '🏠 메인화면',
            secondaryAction: () => showScreen('menu'),
            customTitle: '👑 오목 달인 등극!'
          });
        } else {
          const nextStage = state.singleStage + 1;
          const unlocked = checkAndUpgradeBadge(nextStage, false);
          const nextCfg = getStageConfig(nextStage);
          const badgeMsg = unlocked
            ? ` · ${getBadgeOnly(state.bestBadgeLevel)} 마크 획득!`
            : '';
          showGameOverModal(
            'win',
            `STAGE ${state.singleStage} 승리! (${snapshot.myWins}승 ${snapshot.oppWins}패)${badgeMsg}`,
            {
              primaryText: `▶ 다음 단계 (Lv.${nextStage} ${nextCfg.name})`,
              primaryAction: () => startSinglePlayStage(nextStage),
              secondaryText: '🏠 메인화면',
              secondaryAction: () => showScreen('menu')
            }
          );
        }
      } else {
        showGameOverModal(
          'lose',
          `STAGE ${state.singleStage} 패배 (${snapshot.myWins}승 ${snapshot.oppWins}패)`,
          {
            primaryText: '🔄 1단계부터 다시 시작',
            primaryAction: () => startSinglePlayStage(1),
            secondaryText: '🏠 메인화면',
            secondaryAction: () => showScreen('menu')
          }
        );
      }
    } else {
      state.series.round += 1;
      startSinglePlayRound(true);
    }
  });
}

function applySinglePlayMove(r, c, color) {
  if (state.isGameOver || state.isRoundTransition || state.board[r][c] !== 0) return;

  clearTurnCountdown();
  state.board[r][c] = color;
  state.moveCount += 1;
  state.lastMove = { r, c, color };
  playStonePlaceSound(color === 1);

  const winLine = checkFiveWin(state.board, r, c, color);
  if (winLine) {
    state.winLine = winLine;
    const didIWin = color === state.myColor;
    finishSinglePlayRound(didIWin ? 'win' : 'lose');
    return;
  }

  if (state.moveCount >= BOARD_SIZE * BOARD_SIZE) {
    finishSinglePlayRound('draw');
    return;
  }

  state.turnColor = color === 1 ? 2 : 1;
  updateTurnBannerUI();
  updateTopScoreHeader();
  startTurnCountdown();
  drawOmokBoard();

  if (state.turnColor === state.oppColor) {
    scheduleAiTurn();
  }
}

// ==========================================
// Online Multi-Play Engine (Local WS + Serverless Global MQTT Relay)
// ==========================================
let ws = null;
let transportMode = 'none'; // 'server' | 'serverless'
const myClientId = 'omok_' + Math.random().toString(36).slice(2, 10);
const TOPIC_LOBBY = 'omok_global_v1/lobby';
const TOPIC_PEER_PREFIX = 'omok_global_v1/peer/';

const serverlessRooms = new Map();
let hostedRoom = null;
let joinedHostId = null;
let mqttRxBuffer = new Uint8Array(0);
let mqttPingInterval = null;
let hostAnnounceInterval = null;

function ensureWebSocketConnected() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    if (ws.readyState === WebSocket.OPEN) {
      wsSend({ type: 'set_profile', nickname: state.nickname, stats: state.stats.multi.me });
      wsSend({ type: 'get_rooms' });
    }
    return;
  }

  updateWsBadge('connecting', '•••');

  const isLocalServerHost =
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.endsWith('.lhr.life') ||
      window.location.hostname.endsWith('.onrender.com')) &&
    window.location.protocol !== 'file:';

  if (isLocalServerHost) {
    connectLocalServerWithFallback();
  } else {
    connectServerlessRelay();
  }
}

function connectLocalServerWithFallback() {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  let fallbackTriggered = false;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    connectServerlessRelay();
    return;
  }

  const fallbackTimer = setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      fallbackTriggered = true;
      try {
        ws.close();
      } catch (e) {}
      connectServerlessRelay();
    }
  }, 1500);

  ws.onopen = () => {
    if (fallbackTriggered) return;
    clearTimeout(fallbackTimer);
    transportMode = 'server';
    updateWsBadge('connected', 'ONLINE');
    wsSend({ type: 'set_profile', nickname: state.nickname, stats: state.stats.multi.me });
    wsSend({ type: 'get_rooms' });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {}
  };

  ws.onclose = () => {
    if (!fallbackTriggered && transportMode !== 'server') {
      fallbackTriggered = true;
      clearTimeout(fallbackTimer);
      connectServerlessRelay();
      return;
    }
    updateWsBadge('disconnected', 'OFFLINE');
  };

  ws.onerror = () => {
    if (!fallbackTriggered && transportMode !== 'server') {
      fallbackTriggered = true;
      clearTimeout(fallbackTimer);
      connectServerlessRelay();
    }
  };
}

// Serverless MQTT over WSS Relay for static/cloud hosting
function encodeMqttLen(len) {
  const bytes = [];
  do {
    let d = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) d |= 0x80;
    bytes.push(d);
  } while (len > 0);
  return bytes;
}

function encodeMqttUtf8(str) {
  const utf8 = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xff;
  out[1] = utf8.length & 0xff;
  out.set(utf8, 2);
  return out;
}

function buildMqttConnectPacket(clientId) {
  const proto = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
  const idPart = encodeMqttUtf8(clientId);
  const remLen = proto.length + idPart.length;
  const lenBytes = encodeMqttLen(remLen);
  const pkt = new Uint8Array(1 + lenBytes.length + remLen);
  pkt[0] = 0x10;
  pkt.set(lenBytes, 1);
  pkt.set(proto, 1 + lenBytes.length);
  pkt.set(idPart, 1 + lenBytes.length + proto.length);
  return pkt;
}

function buildMqttSubscribePacket(topic, packetId) {
  const topicBytes = encodeMqttUtf8(topic);
  const remLen = 2 + topicBytes.length + 1;
  const lenBytes = encodeMqttLen(remLen);
  const pkt = new Uint8Array(1 + lenBytes.length + remLen);
  pkt[0] = 0x82;
  pkt.set(lenBytes, 1);
  let off = 1 + lenBytes.length;
  pkt[off++] = (packetId >> 8) & 0xff;
  pkt[off++] = packetId & 0xff;
  pkt.set(topicBytes, off);
  pkt[off + topicBytes.length] = 0x00;
  return pkt;
}

function buildMqttPublishPacket(topic, jsonObj) {
  const topicBytes = encodeMqttUtf8(topic);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(jsonObj));
  const remLen = topicBytes.length + payloadBytes.length;
  const lenBytes = encodeMqttLen(remLen);
  const pkt = new Uint8Array(1 + lenBytes.length + remLen);
  pkt[0] = 0x30;
  pkt.set(lenBytes, 1);
  pkt.set(topicBytes, 1 + lenBytes.length);
  pkt.set(payloadBytes, 1 + lenBytes.length + topicBytes.length);
  return pkt;
}

function mqttPublish(topic, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN || transportMode !== 'serverless') return;
  try {
    ws.send(buildMqttPublishPacket(topic, obj));
  } catch (e) {}
}

function connectServerlessRelay() {
  transportMode = 'serverless';
  mqttRxBuffer = new Uint8Array(0);
  if (mqttPingInterval) clearInterval(mqttPingInterval);

  try {
    ws = new WebSocket('wss://broker.emqx.io:8084/mqtt', 'mqtt');
    ws.binaryType = 'arraybuffer';
  } catch (e) {
    updateWsBadge('disconnected', 'OFFLINE');
    return;
  }

  ws.onopen = () => {
    ws.send(buildMqttConnectPacket(myClientId));
  };

  ws.onmessage = (event) => {
    const chunk = new Uint8Array(event.data);
    const merged = new Uint8Array(mqttRxBuffer.length + chunk.length);
    merged.set(mqttRxBuffer, 0);
    merged.set(chunk, mqttRxBuffer.length);
    mqttRxBuffer = merged;
    parseMqttPackets();
  };

  ws.onclose = () => {
    updateWsBadge('disconnected', 'OFFLINE');
    if (transportMode === 'serverless' && state.screen !== 'menu') {
      setTimeout(() => {
        if (state.screen !== 'menu' && (!ws || ws.readyState === WebSocket.CLOSED)) {
          connectServerlessRelay();
        }
      }, 2000);
    }
  };

  ws.onerror = () => {
    updateWsBadge('disconnected', 'OFFLINE');
  };
}

function parseMqttPackets() {
  while (mqttRxBuffer.length >= 2) {
    const type = mqttRxBuffer[0] >> 4;
    let multiplier = 1;
    let remLen = 0;
    let idx = 1;
    let digit = 0;

    do {
      if (idx >= mqttRxBuffer.length) return;
      digit = mqttRxBuffer[idx++];
      remLen += (digit & 127) * multiplier;
      multiplier *= 128;
    } while ((digit & 128) !== 0);

    const totalLen = idx + remLen;
    if (mqttRxBuffer.length < totalLen) return;

    const body = mqttRxBuffer.slice(idx, totalLen);
    mqttRxBuffer = mqttRxBuffer.slice(totalLen);

    if (type === 2) {
      updateWsBadge('connected', 'ONLINE');
      ws.send(buildMqttSubscribePacket(TOPIC_LOBBY, 1));
      ws.send(buildMqttSubscribePacket(TOPIC_PEER_PREFIX + myClientId, 2));
      mqttPublish(TOPIC_LOBBY, { kind: 'discover_rooms', fromId: myClientId });

      if (mqttPingInterval) clearInterval(mqttPingInterval);
      mqttPingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new Uint8Array([0xc0, 0x00]));
        }
      }, 25000);
    } else if (type === 3) {
      const topicLen = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.slice(2, 2 + topicLen));
      const payloadStr = new TextDecoder().decode(body.slice(2 + topicLen));
      try {
        const data = JSON.parse(payloadStr);
        handleServerlessPacket(topic, data);
      } catch (e) {}
    }
  }
}

function getServerlessRoomArray() {
  const now = Date.now();
  const arr = [];
  for (const [id, r] of serverlessRooms.entries()) {
    if (now - r.updatedAt > 15000) {
      serverlessRooms.delete(id);
    } else {
      arr.push(r);
    }
  }
  return arr;
}

function sendToPeer(targetId, serverMsg) {
  if (targetId === myClientId) {
    handleServerMessage(serverMsg);
  } else {
    mqttPublish(TOPIC_PEER_PREFIX + targetId, { kind: 'server_msg', msg: serverMsg });
  }
}

let peerHeartbeatInterval = null;
let oppLastSeenAt = 0;

function stopPeerHeartbeat() {
  if (peerHeartbeatInterval) {
    clearInterval(peerHeartbeatInterval);
    peerHeartbeatInterval = null;
  }
}

function startPeerHeartbeat() {
  stopPeerHeartbeat();
  oppLastSeenAt = Date.now();
  peerHeartbeatInterval = setInterval(() => {
    if (transportMode !== 'serverless' || state.mode !== 'multi' || state.screen !== 'game') {
      stopPeerHeartbeat();
      return;
    }
    if (hostedRoom && hostedRoom.players.length >= 2) {
      const guest = hostedRoom.players[1];
      mqttPublish(TOPIC_PEER_PREFIX + guest.id, { kind: 'peer_hb', fromId: myClientId });
    } else if (joinedHostId && joinedHostId !== myClientId) {
      mqttPublish(TOPIC_PEER_PREFIX + joinedHostId, { kind: 'peer_hb', fromId: myClientId });
    }

    // Detect silent disconnect / force-killed browser of opponent (10s timeout)
    if (
      (state.multiStatus === 'playing' || state.multiStatus === 'round_pause') &&
      oppLastSeenAt > 0 &&
      Date.now() - oppLastSeenAt > 10500 &&
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      stopPeerHeartbeat();
      if (hostedRoom) {
        closeHostedRoomAfterMatch();
      } else {
        joinedHostId = null;
      }
      state.multiStatus = 'finished';
      state.isMatchOver = true;
      state.stats.multi.me.wins += 1;
      saveStatsData();
      alert('상대방의 연결이 끊어져 1승을 획득했습니다! (OPPONENT DISCONNECTED +1 WIN)');
      state.oppNickname = 'OPP';
      showScreen('lobby');
      wsSend({ type: 'get_rooms' });
    }
  }, 3000);
}

function announceHostedRoom() {
  if (!hostedRoom) return;
  mqttPublish(TOPIC_LOBBY, {
    kind: 'room_announce',
    room: {
      id: hostedRoom.id,
      title: hostedRoom.title,
      hostId: myClientId,
      hostName: hostedRoom.players[0]
        ? formatNameWithBadge(hostedRoom.players[0].nickname, hostedRoom.players[0].badgeLevel)
        : formatNameWithBadge(state.nickname, state.bestBadgeLevel),
      playerCount: hostedRoom.players.length,
      maxPlayers: 2,
      status: hostedRoom.status
    }
  });
}

function clearHostedRoomTimers() {
  if (!hostedRoom) return;
  if (hostedRoom.turnTimer) {
    clearTimeout(hostedRoom.turnTimer);
    hostedRoom.turnTimer = null;
  }
  if (hostedRoom.readyTimer) {
    clearTimeout(hostedRoom.readyTimer);
    hostedRoom.readyTimer = null;
  }
  if (hostedRoom.roundTimer) {
    clearTimeout(hostedRoom.roundTimer);
    hostedRoom.roundTimer = null;
  }
}

function clearHostedRoomTurnTimer() {
  if (hostedRoom && hostedRoom.turnTimer) {
    clearTimeout(hostedRoom.turnTimer);
    hostedRoom.turnTimer = null;
  }
}

function closeHostedRoomAfterMatch() {
  if (!hostedRoom) return;
  clearHostedRoomTimers();
  stopPeerHeartbeat();
  if (hostAnnounceInterval) {
    clearInterval(hostAnnounceInterval);
    hostAnnounceInterval = null;
  }
  mqttPublish(TOPIC_LOBBY, { kind: 'room_remove', roomId: hostedRoom.id });
  serverlessRooms.delete(hostedRoom.id);
  hostedRoom = null;
  joinedHostId = null;
}

function startHostedRoomReadyCountdown() {
  if (!hostedRoom || hostedRoom.players.length < 2) return;
  clearHostedRoomTimers();
  hostedRoom.status = 'ready';
  hostedRoom.readyDeadline = Date.now() + HOST_START_LIMIT_SEC * 1000;
  hostedRoom.readyTimer = setTimeout(() => {
    if (!hostedRoom || hostedRoom.status !== 'ready' || hostedRoom.players.length < 2) return;
    beginHostedRoomMatch();
  }, HOST_START_LIMIT_SEC * 1000);
}

function beginHostedRoomMatch() {
  if (!hostedRoom || hostedRoom.players.length < 2) return;
  clearHostedRoomTimers();
  hostedRoom.series = { round: 1, p0Wins: 0, p1Wins: 0, draws: 0 };
  hostedRoom.blackIndex = 0;
  resetHostedRoomBoardOnly(false);
  hostedRoom.status = 'playing';
  scheduleHostedRoomTurnTimer();
  broadcastHostedRoomState();
}

function scheduleHostedRoomTurnTimer() {
  clearHostedRoomTurnTimer();
  if (!hostedRoom || hostedRoom.status !== 'playing' || hostedRoom.players.length < 2) return;
  hostedRoom.turnTimer = setTimeout(() => {
    if (!hostedRoom || hostedRoom.status !== 'playing' || hostedRoom.players.length < 2) return;
    const cell = getRandomEmptyCell(hostedRoom.board);
    if (!cell) return;
    executeHostedRoomMove(hostedRoom.turnColor, cell.r, cell.c);
  }, TURN_LIMIT_SEC * 1000 + 400);
}

function executeHostedRoomMove(moveColor, r, c) {
  if (!hostedRoom || hostedRoom.status !== 'playing' || hostedRoom.players.length < 2) return;
  if (hostedRoom.board[r][c] !== 0) return;

  clearHostedRoomTurnTimer();
  hostedRoom.board[r][c] = moveColor;
  hostedRoom.moveCount += 1;
  hostedRoom.lastMove = { r, c, color: moveColor };

  const pIdx = moveColor === 1 ? hostedRoom.blackIndex : (hostedRoom.blackIndex === 0 ? 1 : 0);
  const oppIdx = pIdx === 0 ? 1 : 0;

  const winLine = checkFiveWin(hostedRoom.board, r, c, moveColor);
  const isBoardDraw = !winLine && hostedRoom.moveCount >= BOARD_SIZE * BOARD_SIZE;

  if (winLine || isBoardDraw) {
    clearHostedRoomTimers();
    hostedRoom.status = 'round_pause';
    hostedRoom.winLine = winLine || null;

    const p0 = hostedRoom.players[0];
    const p1 = hostedRoom.players[1];

    if (winLine) {
      if (pIdx === 0) hostedRoom.series.p0Wins += 1;
      else hostedRoom.series.p1Wins += 1;
      const winner = hostedRoom.players[pIdx];
      const loser = hostedRoom.players[oppIdx];
      winner.stats.wins += 1;
      loser.stats.losses += 1;
    } else {
      hostedRoom.series.draws += 1;
      p0.stats.draws += 1;
      p1.stats.draws += 1;
    }

    const matchFinished = hostedRoom.series.p0Wins >= 2 || hostedRoom.series.p1Wins >= 2;
    const winnerIdx = hostedRoom.series.p0Wins >= 2 ? 0 : hostedRoom.series.p1Wins >= 2 ? 1 : -1;
    if (matchFinished) {
      hostedRoom.status = 'finished';
    }

    for (let idx = 0; idx < hostedRoom.players.length; idx++) {
      const p = hostedRoom.players[idx];
      const opp = hostedRoom.players[idx === 0 ? 1 : 0];
      const mySeriesWins = idx === 0 ? hostedRoom.series.p0Wins : hostedRoom.series.p1Wins;
      const oppSeriesWins = idx === 0 ? hostedRoom.series.p1Wins : hostedRoom.series.p0Wins;
      const roundResult = !winLine ? 'draw' : idx === pIdx ? 'win' : 'lose';
      const matchResult = !matchFinished ? null : idx === winnerIdx ? 'win' : 'lose';

      sendToPeer(p.id, {
        type: 'stone_placed',
        r,
        c,
        color: moveColor,
        turnColor: hostedRoom.turnColor,
        winLine: winLine || null,
        roundResult,
        matchFinished,
        matchResult,
        series: {
          round: hostedRoom.series.round,
          myWins: mySeriesWins,
          oppWins: oppSeriesWins,
          draws: hostedRoom.series.draws
        },
        meStats: p.stats,
        oppStats: opp.stats
      });
    }

    hostedRoom.roundTimer = setTimeout(() => {
      if (!hostedRoom || hostedRoom.players.length < 2) return;
      if (matchFinished) {
        for (let idx = 0; idx < hostedRoom.players.length; idx++) {
          const p = hostedRoom.players[idx];
          const opp = hostedRoom.players[idx === 0 ? 1 : 0];
          sendToPeer(p.id, {
            type: 'match_over',
            result: idx === winnerIdx ? 'win' : 'lose',
            meStats: p.stats,
            oppStats: opp.stats,
            series: {
              round: hostedRoom.series.round,
              myWins: idx === 0 ? hostedRoom.series.p0Wins : hostedRoom.series.p1Wins,
              oppWins: idx === 0 ? hostedRoom.series.p1Wins : hostedRoom.series.p0Wins,
              draws: hostedRoom.series.draws
            }
          });
        }
        closeHostedRoomAfterMatch();
      } else {
        hostedRoom.series.round += 1;
        resetHostedRoomBoardOnly(true);
        hostedRoom.status = 'playing';
        scheduleHostedRoomTurnTimer();
        broadcastHostedRoomState();
      }
    }, 6200);
    return;
  }

  hostedRoom.turnColor = moveColor === 1 ? 2 : 1;
  scheduleHostedRoomTurnTimer();

  for (const p of hostedRoom.players) {
    sendToPeer(p.id, {
      type: 'stone_placed',
      r,
      c,
      color: moveColor,
      turnColor: hostedRoom.turnColor,
      winLine: null
    });
  }
}

function resetHostedRoomBoardOnly(swapFirst = false) {
  if (!hostedRoom) return;
  clearHostedRoomTurnTimer();
  hostedRoom.board = createEmptyBoard();
  hostedRoom.moveCount = 0;
  hostedRoom.lastMove = null;
  hostedRoom.winLine = null;
  if (swapFirst && hostedRoom.players.length === 2) {
    hostedRoom.blackIndex = hostedRoom.blackIndex === 0 ? 1 : 0;
  } else if (typeof hostedRoom.blackIndex !== 'number') {
    hostedRoom.blackIndex = 0;
  }
  hostedRoom.turnColor = 1;
}

function broadcastHostedRoomState() {
  if (!hostedRoom) return;
  for (let idx = 0; idx < hostedRoom.players.length; idx++) {
    const p = hostedRoom.players[idx];
    const oppIdx = idx === 0 ? 1 : 0;
    const opp = hostedRoom.players[oppIdx] || null;
    const myColor = idx === hostedRoom.blackIndex ? 1 : 2;
    const oppColor = myColor === 1 ? 2 : 1;
    const myWins = idx === 0 ? hostedRoom.series.p0Wins : hostedRoom.series.p1Wins;
    const oppWins = idx === 0 ? hostedRoom.series.p1Wins : hostedRoom.series.p0Wins;

    sendToPeer(p.id, {
      type: 'room_update',
      room: {
        id: hostedRoom.id,
        title: hostedRoom.title,
        status: hostedRoom.status,
        isHost: idx === 0,
        readySecondsLeft:
          hostedRoom.status === 'ready' && hostedRoom.readyDeadline
            ? Math.max(0, Math.ceil((hostedRoom.readyDeadline - Date.now()) / 1000))
            : 0,
        turnColor: hostedRoom.turnColor,
        board: hostedRoom.board,
        lastMove: hostedRoom.lastMove,
        winLine: hostedRoom.winLine,
        series: {
          round: hostedRoom.series.round,
          myWins,
          oppWins,
          draws: hostedRoom.series.draws
        },
        me: {
          id: p.id,
          nickname: p.nickname,
          badgeLevel: p.badgeLevel || 0,
          color: myColor,
          stats: p.stats
        },
        opp: opp
          ? {
              id: opp.id,
              nickname: opp.nickname,
              badgeLevel: opp.badgeLevel || 0,
              color: oppColor,
              stats: opp.stats
            }
          : null
      }
    });
  }
  announceHostedRoom();
}

function handleServerlessPacket(topic, data) {
  if (topic === TOPIC_LOBBY) {
    if (data.kind === 'discover_rooms') {
      if (hostedRoom) announceHostedRoom();
    } else if (data.kind === 'room_announce' && data.room) {
      serverlessRooms.set(data.room.id, { ...data.room, updatedAt: Date.now() });
      if (state.screen === 'lobby') {
        renderLobbyRoomList(getServerlessRoomArray());
      }
    } else if (data.kind === 'room_remove' && data.roomId) {
      serverlessRooms.delete(data.roomId);
      if (state.screen === 'lobby') {
        renderLobbyRoomList(getServerlessRoomArray());
      }
    }
    return;
  }

  if (topic === TOPIC_PEER_PREFIX + myClientId) {
    oppLastSeenAt = Date.now();
    if (data.kind === 'peer_hb') {
      return;
    } else if (data.kind === 'server_msg') {
      handleServerMessage(data.msg);
    } else if (data.kind === 'peer_cmd' && hostedRoom) {
      handleHostPeerCommand(data);
    }
  }
}

function handleHostPeerCommand(data) {
  if (!hostedRoom) return;
  const fromId = data.fromId;
  oppLastSeenAt = Date.now();

  if (data.cmd === 'join_room') {
    if (hostedRoom.players.length >= 2) {
      sendToPeer(fromId, { type: 'error', message: 'ROOM IS FULL' });
      return;
    }
    hostedRoom.players.push({
      id: fromId,
      nickname: data.nickname || 'PLAYER',
      badgeLevel: Number(data.badgeLevel) || 0,
      stats: sanitizeRecord(data.stats)
    });
    hostedRoom.blackIndex = 0;
    hostedRoom.series = { round: 1, p0Wins: 0, p1Wins: 0, draws: 0 };
    resetHostedRoomBoardOnly(false);
    startHostedRoomReadyCountdown();
    broadcastHostedRoomState();
    startPeerHeartbeat();
  } else if (data.cmd === 'start_game') {
    if (fromId !== myClientId || hostedRoom.players.length < 2) return;
    if (hostedRoom.status === 'ready') {
      beginHostedRoomMatch();
    }
  } else if (data.cmd === 'place_stone') {
    if (hostedRoom.status !== 'playing' || hostedRoom.players.length < 2) return;
    const pIdx = hostedRoom.players.findIndex((p) => p.id === fromId);
    if (pIdx === -1) return;
    const myColor = pIdx === hostedRoom.blackIndex ? 1 : 2;
    if (hostedRoom.turnColor !== myColor) return;

    const r = Number(data.r);
    const c = Number(data.c);
    if (
      !Number.isInteger(r) ||
      !Number.isInteger(c) ||
      r < 0 ||
      r >= BOARD_SIZE ||
      c < 0 ||
      c >= BOARD_SIZE ||
      hostedRoom.board[r][c] !== 0
    ) {
      return;
    }

    executeHostedRoomMove(myColor, r, c);
  } else if (data.cmd === 'play_again') {
    if (hostedRoom.players.length < 2) return;
    beginHostedRoomMatch();
  } else if (data.cmd === 'leave_room') {
    const wasActive = hostedRoom.status === 'playing' || hostedRoom.status === 'round_pause';
    const hostPlayer = hostedRoom.players[0];
    closeHostedRoomAfterMatch();
    if (wasActive && hostPlayer) {
      hostPlayer.stats.wins += 1;
      handleServerMessage({
        type: 'opponent_left',
        awardedWin: true,
        meStats: hostPlayer.stats,
        message: '상대방이 나가서 1승을 획득했습니다! (OPPONENT LEFT +1 WIN)'
      });
    } else {
      handleServerMessage({
        type: 'opponent_left',
        awardedWin: false,
        message: '상대방이 방을 나갔습니다.'
      });
    }
    handleServerMessage({ type: 'left_room', rooms: getServerlessRoomArray() });
  }
}

function wsSend(obj) {
  if (transportMode === 'server') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
    return;
  }

  if (transportMode !== 'serverless') return;

  switch (obj.type) {
    case 'get_rooms':
      mqttPublish(TOPIC_LOBBY, { kind: 'discover_rooms', fromId: myClientId });
      renderLobbyRoomList(getServerlessRoomArray());
      break;

    case 'create_room': {
      const roomId = 'room_' + myClientId;
      hostedRoom = {
        id: roomId,
        title: obj.title || `${state.nickname}'S ROOM`,
        players: [
          {
            id: myClientId,
            nickname: state.nickname,
            badgeLevel: state.bestBadgeLevel,
            stats: sanitizeRecord(state.stats.multi.me)
          }
        ],
        blackIndex: 0,
        turnColor: 1,
        status: 'waiting',
        series: { round: 1, p0Wins: 0, p1Wins: 0, draws: 0 },
        board: createEmptyBoard(),
        moveCount: 0,
        lastMove: null,
        winLine: null
      };
      joinedHostId = myClientId;
      resetHostedRoomBoardOnly(false);
      broadcastHostedRoomState();
      if (hostAnnounceInterval) clearInterval(hostAnnounceInterval);
      hostAnnounceInterval = setInterval(() => {
        if (hostedRoom) announceHostedRoom();
      }, 4000);
      break;
    }

    case 'join_room': {
      const targetRoom = serverlessRooms.get(obj.roomId);
      const hostId = targetRoom ? targetRoom.hostId : obj.roomId.replace('room_', '');
      joinedHostId = hostId;
      startPeerHeartbeat();
      mqttPublish(TOPIC_PEER_PREFIX + hostId, {
        kind: 'peer_cmd',
        cmd: 'join_room',
        fromId: myClientId,
        nickname: state.nickname,
        badgeLevel: state.bestBadgeLevel,
        stats: state.stats.multi.me
      });
      break;
    }

    case 'start_game':
      if (hostedRoom) {
        handleHostPeerCommand({ cmd: 'start_game', fromId: myClientId });
      }
      break;

    case 'place_stone':
      if (hostedRoom) {
        handleHostPeerCommand({ cmd: 'place_stone', fromId: myClientId, r: obj.r, c: obj.c });
      } else if (joinedHostId) {
        mqttPublish(TOPIC_PEER_PREFIX + joinedHostId, {
          kind: 'peer_cmd',
          cmd: 'place_stone',
          fromId: myClientId,
          r: obj.r,
          c: obj.c
        });
      }
      break;

    case 'play_again':
      if (hostedRoom) {
        handleHostPeerCommand({ cmd: 'play_again', fromId: myClientId });
      } else if (joinedHostId) {
        mqttPublish(TOPIC_PEER_PREFIX + joinedHostId, {
          kind: 'peer_cmd',
          cmd: 'play_again',
          fromId: myClientId
        });
      }
      break;

    case 'leave_room':
      stopPeerHeartbeat();
      if (hostedRoom) {
        const wasActive = hostedRoom.status === 'playing' || hostedRoom.status === 'round_pause';
        const guest = hostedRoom.players.find((p) => p.id !== myClientId);
        if (guest) {
          if (wasActive) {
            guest.stats.wins += 1;
            sendToPeer(guest.id, {
              type: 'opponent_left',
              awardedWin: true,
              meStats: guest.stats,
              message: '방장이 나가서 1승을 획득했습니다! (HOST LEFT +1 WIN)'
            });
          } else {
            sendToPeer(guest.id, {
              type: 'opponent_left',
              awardedWin: false,
              message: '방장이 방을 나가 대기실로 이동합니다.'
            });
          }
          sendToPeer(guest.id, { type: 'left_room', rooms: [] });
        }
        closeHostedRoomAfterMatch();
      } else if (joinedHostId) {
        mqttPublish(TOPIC_PEER_PREFIX + joinedHostId, {
          kind: 'peer_cmd',
          cmd: 'leave_room',
          fromId: myClientId
        });
        joinedHostId = null;
      }
      break;
  }
}

function handleAbandonOnExitEvent() {
  penalizeActiveMatchAbandon(true);
  if (hostedRoom || joinedHostId) {
    wsSend({ type: 'leave_room', abandoned: true });
  }
}

window.addEventListener('beforeunload', handleAbandonOnExitEvent);
window.addEventListener('pagehide', handleAbandonOnExitEvent);
window.addEventListener('popstate', () => {
  if (state.screen === 'game') {
    clearAiTimer();
    penalizeActiveMatchAbandon(true);
    if (state.mode === 'multi') {
      wsSend({ type: 'leave_room', abandoned: true });
      state.oppNickname = 'OPP';
      showScreen('lobby');
    } else {
      showScreen('menu');
    }
  }
});

function updateWsBadge(statusClass, text) {
  const badge = document.getElementById('ws-status-badge');
  if (!badge) return;
  badge.className = `ws-pill ${statusClass}`;
  badge.textContent = text;
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'welcome':
    case 'room_list':
      renderLobbyRoomList(msg.rooms || []);
      break;

    case 'error':
      alert(msg.message || 'ERROR');
      break;

    case 'left_room':
      stopPeerHeartbeat();
      joinedHostId = null;
      state.multiStatus = 'waiting';
      state.isMatchOver = false;
      state.oppNickname = 'OPP';
      state.oppBadgeLevel = 0;
      renderLobbyRoomList(msg.rooms || []);
      showScreen('lobby');
      break;

    case 'room_update':
      handleMultiplayerRoomUpdate(msg.room);
      break;

    case 'stone_placed':
      handleMultiplayerStonePlaced(msg);
      break;

    case 'match_over':
      handleMultiplayerMatchOver(msg);
      break;

    case 'opponent_left':
      stopPeerHeartbeat();
      if (msg.awardedWin) {
        if (msg.meStats) {
          state.stats.multi.me = sanitizeRecord(msg.meStats);
        } else {
          state.stats.multi.me.wins += 1;
        }
        saveStatsData();
      }
      state.multiStatus = 'finished';
      state.isMatchOver = true;
      alert(msg.message || 'OPPONENT LEFT');
      break;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLobbyRoomList(rooms) {
  const container = document.getElementById('room-list-container');
  const countText = document.getElementById('room-count-text');
  if (!container || !countText) return;

  countText.textContent = String(rooms.length);

  if (rooms.length === 0) {
    container.innerHTML = '<div class="empty-rooms">NO ROOMS — TAP [＋ CREATE]</div>';
    return;
  }

  container.innerHTML = '';
  rooms.forEach((r) => {
    const isFull =
      r.playerCount >= r.maxPlayers ||
      r.status === 'playing' ||
      r.status === 'ready' ||
      r.status === 'round_pause';
    const item = document.createElement('div');
    item.className = 'room-item';

    item.innerHTML = `
      <div class="room-info">
        <div class="room-title">${escapeHtml(r.title)}</div>
        <div class="room-host">👤 ${escapeHtml(r.hostName)}</div>
      </div>
      <div class="room-right">
        <span class="room-pill ${isFull ? 'full' : 'open'}">${r.playerCount}/${r.maxPlayers}</span>
        <button class="btn-join" type="button" ${isFull ? 'disabled' : ''}>
          ${isFull ? 'FULL' : 'JOIN ▶'}
        </button>
      </div>
    `;

    const joinBtn = item.querySelector('.btn-join');
    if (!isFull) {
      joinBtn.addEventListener('click', () => {
        wsSend({
          type: 'join_room',
          roomId: r.id,
          nickname: state.nickname,
          badgeLevel: state.bestBadgeLevel,
          stats: state.stats.multi.me
        });
      });
    }
    container.appendChild(item);
  });
}

function renderHostReadyOverlay() {
  const overlay = document.getElementById('host-ready-overlay');
  const title = document.getElementById('ready-title');
  const sub = document.getElementById('ready-sub');
  const btn = document.getElementById('btn-host-start');
  if (!overlay || !title || !sub || !btn) return;

  clearReadyCountdown();
  if (state.mode !== 'multi' || state.multiStatus !== 'ready') {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  let sec = state.readySecondsLeft > 0 ? state.readySecondsLeft : HOST_START_LIMIT_SEC;

  const updateTexts = () => {
    title.textContent = `${formatNameWithBadge(state.oppNickname, state.oppBadgeLevel)} 입장 완료!`;
    if (state.isHost) {
      sub.textContent = `${sec}초 안에 시작하지 않으면 자동 시작됩니다.`;
      btn.classList.remove('hidden');
      btn.textContent = `▶ START GAME (${sec}s)`;
    } else {
      sub.textContent = `방장이 게임을 시작할 때까지 대기 중... (${sec}s)`;
      btn.classList.add('hidden');
    }
  };

  updateTexts();
  readyCountdownIntervalId = setInterval(() => {
    if (state.mode !== 'multi' || state.multiStatus !== 'ready') {
      clearReadyCountdown();
      overlay.classList.add('hidden');
      return;
    }
    sec = Math.max(0, sec - 1);
    updateTexts();
    if (sec <= 0) {
      clearReadyCountdown();
    }
  }, 1000);
}

function handleMultiplayerRoomUpdate(room) {
  state.mode = 'multi';
  document.getElementById('gameover-modal').classList.add('hidden');
  clearRoundTransitionTimers();
  matchOverHandled = false;

  state.multiStatus = room.status || 'waiting';
  state.isHost = Boolean(room.isHost);
  state.readySecondsLeft = Number(room.readySecondsLeft) || 0;
  state.isRoundTransition = false;
  state.isMatchOver = state.multiStatus === 'finished';
  state.abandonPenalized = false;

  if (room.series) {
    state.series = {
      round: Number(room.series.round) || 1,
      myWins: Number(room.series.myWins) || 0,
      oppWins: Number(room.series.oppWins) || 0,
      draws: Number(room.series.draws) || 0
    };
  } else {
    state.series = { round: 1, myWins: 0, oppWins: 0, draws: 0 };
  }

  if (room.me) {
    state.myColor = room.me.color || 1;
    state.oppColor = state.myColor === 1 ? 2 : 1;
    if (room.me.stats) {
      state.stats.multi.me = sanitizeRecord(room.me.stats);
    }
  }

  if (room.opp) {
    state.oppNickname = room.opp.nickname || 'OPP';
    state.oppBadgeLevel = Number(room.opp.badgeLevel) || 0;
    state.stats.multi.opp = sanitizeRecord(room.opp.stats);
    state.isWaitingOpponent = false;
  } else {
    state.oppNickname = 'WAIT...';
    state.oppBadgeLevel = 0;
    state.stats.multi.opp = { wins: 0, losses: 0, draws: 0 };
    state.isWaitingOpponent = true;
  }

  state.board = room.board || createEmptyBoard();
  state.turnColor = room.turnColor || 1;
  state.lastMove = room.lastMove || null;
  state.winLine = room.winLine || null;
  state.isGameOver = state.multiStatus === 'finished';

  if (state.screen !== 'game') {
    showScreen('game');
  }

  renderHostReadyOverlay();
  updateTurnBannerUI();
  updateTopScoreHeader();
  startTurnCountdown();
  drawOmokBoard();
}

function showMultiMatchOverModal(result, seriesSnapshot) {
  if (matchOverHandled) return;
  matchOverHandled = true;
  clearTurnCountdown();
  clearRoundTransitionTimers();
  stopPeerHeartbeat();

  state.multiStatus = 'finished';
  state.isGameOver = true;
  state.isMatchOver = true;
  joinedHostId = null;

  renderTurnTimerBadge();
  updateTurnBannerUI();
  drawOmokBoard();

  const w = (seriesSnapshot && seriesSnapshot.myWins) || state.series.myWins || 0;
  const l = (seriesSnapshot && seriesSnapshot.oppWins) || state.series.oppWins || 0;
  const subText =
    result === 'win'
      ? `3판 2승제 최종 승리! (${w}승 ${l}패)`
      : `3판 2승제 최종 패배 (${w}승 ${l}패)`;

  showGameOverModal(result, subText, {
    primaryText: '🏢 대기실로 돌아가기',
    primaryAction: () => {
      state.oppNickname = 'OPP';
      state.oppBadgeLevel = 0;
      showScreen('lobby');
      wsSend({ type: 'get_rooms' });
    },
    secondaryText: '🏠 메인화면',
    secondaryAction: () => {
      state.mode = 'single';
      state.oppNickname = 'AI';
      showScreen('menu');
    }
  });
}

function handleMultiplayerStonePlaced(msg) {
  if (state.mode !== 'multi') return;
  state.board[msg.r][msg.c] = msg.color;
  state.lastMove = { r: msg.r, c: msg.c, color: msg.color };
  state.turnColor = msg.turnColor;
  if (msg.winLine) state.winLine = msg.winLine;

  playStonePlaceSound(msg.color === 1);

  if (msg.roundResult) {
    clearTurnCountdown();
    state.isGameOver = true;
    state.multiStatus = msg.matchFinished ? 'finished' : 'round_pause';
    if (msg.series) {
      state.series = {
        round: Number(msg.series.round) || state.series.round,
        myWins: Number(msg.series.myWins) || 0,
        oppWins: Number(msg.series.oppWins) || 0,
        draws: Number(msg.series.draws) || 0
      };
    }
    if (msg.meStats) state.stats.multi.me = sanitizeRecord(msg.meStats);
    if (msg.oppStats) state.stats.multi.opp = sanitizeRecord(msg.oppStats);
    saveStatsData();

    renderTurnTimerBadge();
    updateTurnBannerUI();
    drawOmokBoard();

    const snap = { ...state.series };
    playRoundTransitionOverlay(msg.roundResult, snap, () => {
      if (state.mode !== 'multi' || state.screen !== 'game') return;
      if (msg.matchFinished) {
        showMultiMatchOverModal(msg.matchResult || (snap.myWins >= 2 ? 'win' : 'lose'), snap);
      }
    });
    return;
  }

  updateTurnBannerUI();
  updateTopScoreHeader();
  if (!msg.winLine && !state.isGameOver) {
    startTurnCountdown();
  }
  drawOmokBoard();
}

function handleMultiplayerMatchOver(msg) {
  if (msg.meStats) state.stats.multi.me = sanitizeRecord(msg.meStats);
  if (msg.oppStats) state.stats.multi.opp = sanitizeRecord(msg.oppStats);
  if (msg.series) {
    state.series = {
      round: Number(msg.series.round) || state.series.round,
      myWins: Number(msg.series.myWins) || 0,
      oppWins: Number(msg.series.oppWins) || 0,
      draws: Number(msg.series.draws) || 0
    };
  }
  saveStatsData();

  // If round transition overlay is still finishing, let it finish before showing modal
  if (state.isRoundTransition) return;
  showMultiMatchOverModal(msg.result, state.series);
}

// ==========================================
// Game Over Modal
// ==========================================
let modalPrimaryHandler = null;
let modalSecondaryHandler = null;

function showGameOverModal(result, subtitleText, options = {}) {
  playMatchSound(result);
  const modal = document.getElementById('gameover-modal');
  const badge = document.getElementById('modal-badge');
  const title = document.getElementById('modal-title');
  const sub = document.getElementById('modal-sub');
  const btnRow = document.getElementById('modal-btn-row');
  const primaryBtn = document.getElementById('btn-play-again');
  const secondaryBtn = document.getElementById('btn-modal-leave');

  if (btnRow) {
    btnRow.classList.toggle('hidden', Boolean(options.isAutoLobby));
  }

  badge.className = `modal-badge ${result}`;
  if (result === 'win') {
    badge.textContent = 'VICTORY';
    title.textContent = options.customTitle || '🏆 YOU WIN!';
  } else if (result === 'lose') {
    badge.textContent = 'DEFEAT';
    title.textContent = options.customTitle || '💔 YOU LOSE';
  } else {
    badge.textContent = 'DRAW';
    title.textContent = options.customTitle || '🤝 DRAW';
  }
  sub.textContent = subtitleText;

  if (primaryBtn) {
    primaryBtn.textContent = options.primaryText || '🔄 AGAIN';
    modalPrimaryHandler = options.primaryAction || null;
  }
  if (secondaryBtn) {
    secondaryBtn.textContent = options.secondaryText || '🚪 EXIT';
    modalSecondaryHandler = options.secondaryAction || null;
  }

  modal.classList.remove('hidden');
}

// ==========================================
// Board Interaction & UI Event Listeners
// ==========================================
function handleBoardClick(e) {
  getAudioContext();
  if (!isPlayingTurnActive()) return;
  if (state.turnColor !== state.myColor) return;

  const cell = getCellFromPointerEvent(e);
  if (!cell) return;
  const { r, c } = cell;
  if (state.board[r][c] !== 0) return;

  if (state.mode === 'single') {
    applySinglePlayMove(r, c, state.myColor);
  } else {
    wsSend({ type: 'place_stone', r, c });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  showScreen('menu');

  // Unlock Web Audio on first touch/click
  const unlockAudio = () => getAudioContext();
  document.addEventListener('touchstart', unlockAudio, { passive: true });
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  const canvas = document.getElementById('omok-canvas');
  canvas.addEventListener('pointerdown', handleBoardClick);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const cell = getCellFromPointerEvent(e);
    const prev = state.hoverCell;
    if (!cell && !prev) return;
    if (!cell || !prev || cell.r !== prev.r || cell.c !== prev.c) {
      state.hoverCell = cell;
      drawOmokBoard();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (state.hoverCell) {
      state.hoverCell = null;
      drawOmokBoard();
    }
  });

  const nickInput = document.getElementById('input-nickname');
  nickInput.addEventListener('input', () => {
    if (nickInput.value.trim().length > 0) {
      const pill = document.getElementById('name-input-pill');
      const warn = document.getElementById('id-warning-msg');
      if (pill) pill.classList.remove('input-error');
      if (warn) warn.classList.add('hidden');
    }
  });
  nickInput.addEventListener('change', syncNickname);
  nickInput.addEventListener('blur', syncNickname);

  // Menu Mode Buttons
  document.getElementById('btn-mode-single').addEventListener('click', () => {
    if (!validateNicknameBeforePlay()) return;
    startSinglePlayStage(1);
  });

  document.getElementById('btn-mode-multi').addEventListener('click', () => {
    if (!validateNicknameBeforePlay()) return;
    state.mode = 'multi';
    state.oppNickname = 'OPP';
    state.oppBadgeLevel = 0;
    showScreen('lobby');
    ensureWebSocketConnected();
  });

  // Lobby Buttons
  document.getElementById('btn-lobby-back').addEventListener('click', () => {
    state.mode = 'single';
    state.oppNickname = 'AI';
    showScreen('menu');
  });

  document.getElementById('btn-create-room').addEventListener('click', () => {
    syncNickname();
    ensureWebSocketConnected();
    const roomInput = document.getElementById('input-room-title');
    const title = roomInput.value.trim() || `${state.nickname}'S ROOM`;
    wsSend({
      type: 'create_room',
      title,
      nickname: state.nickname,
      badgeLevel: state.bestBadgeLevel,
      stats: state.stats.multi.me
    });
    roomInput.value = '';
  });

  document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    ensureWebSocketConnected();
    wsSend({ type: 'get_rooms' });
  });

  const hostStartBtn = document.getElementById('btn-host-start');
  if (hostStartBtn) {
    hostStartBtn.addEventListener('click', () => {
      if (state.mode === 'multi' && state.isHost && state.multiStatus === 'ready') {
        wsSend({ type: 'start_game' });
      }
    });
  }

  // Game Screen Buttons
  document.getElementById('btn-leave-game').addEventListener('click', () => {
    clearAiTimer();
    const penalized = penalizeActiveMatchAbandon(true);
    if (state.mode === 'multi') {
      if (!penalized) {
        wsSend({ type: 'leave_room' });
      }
      state.oppNickname = 'OPP';
      state.oppBadgeLevel = 0;
      showScreen('lobby');
      wsSend({ type: 'get_rooms' });
    } else {
      showScreen('menu');
    }
  });

  document.getElementById('btn-new-game').addEventListener('click', () => {
    if (state.mode === 'single') {
      penalizeActiveMatchAbandon(false);
      startSinglePlayStage(1);
    } else if (state.isMatchOver) {
      document.getElementById('gameover-modal').classList.add('hidden');
      wsSend({ type: 'play_again', stats: state.stats.multi.me });
    }
  });

  // Modal Buttons
  document.getElementById('btn-play-again').addEventListener('click', () => {
    document.getElementById('gameover-modal').classList.add('hidden');
    if (modalPrimaryHandler) {
      const fn = modalPrimaryHandler;
      modalPrimaryHandler = null;
      fn();
      return;
    }
    if (state.mode === 'single') {
      startSinglePlayStage(1);
    } else {
      wsSend({ type: 'play_again', stats: state.stats.multi.me });
    }
  });

  document.getElementById('btn-modal-leave').addEventListener('click', () => {
    document.getElementById('gameover-modal').classList.add('hidden');
    clearAiTimer();
    if (modalSecondaryHandler) {
      const fn = modalSecondaryHandler;
      modalSecondaryHandler = null;
      fn();
      return;
    }
    if (state.mode === 'multi') {
      wsSend({ type: 'leave_room' });
      showScreen('lobby');
    } else {
      showScreen('menu');
    }
  });

  // Header Tools
  const soundBtn = document.getElementById('btn-sound-toggle');
  soundBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
    soundBtn.classList.toggle('sound-on', state.soundEnabled);
  });

  document.getElementById('btn-reset-stats').addEventListener('click', () => {
    if (state.mode === 'multi') {
      state.stats.multi.me = { wins: 0, losses: 0, draws: 0 };
      wsSend({ type: 'set_profile', nickname: state.nickname, stats: state.stats.multi.me });
    } else {
      state.stats.single.me = { wins: 0, losses: 0, draws: 0 };
      state.stats.single.ai = { wins: 0, losses: 0, draws: 0 };
    }
    saveStatsData();
  });

  initShortcutAndPwaPrompt();
});

// ==========================================
// Windows Desktop & Android Home Screen Shortcut Installer
// - Checks if shortcut already exists on Windows Desktop or Standalone PWA
// - If already installed, NEVER asks
// - If not installed, asks on first visit and installs directly to Desktop / Home Screen
// ==========================================
let deferredInstallPrompt = null;
let installGuideShown = false;

function isRunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

async function checkWindowsShortcutExistsOnServer() {
  if (window.location.protocol === 'file:') return false;
  try {
    const res = await fetch('/api/shortcut-status', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.exists);
  } catch (e) {
    return false;
  }
}

async function requestWindowsServerShortcutCreation() {
  if (window.location.protocol === 'file:') return false;
  try {
    const res = await fetch('/api/create-shortcut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.origin })
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.ok);
  } catch (e) {
    return false;
  }
}

async function initShortcutAndPwaPrompt() {
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const installModal = document.getElementById('install-modal');
  const confirmBtn = document.getElementById('btn-install-confirm');
  const laterBtn = document.getElementById('btn-install-later');
  const openChipBtn = document.getElementById('btn-open-install');
  const guideBox = document.getElementById('install-guide-box');

  // 1) Check Web API related installed apps
  let relatedInstalled = false;
  if ('getInstalledRelatedApps' in navigator) {
    try {
      const apps = await navigator.getInstalledRelatedApps();
      if (apps && apps.length > 0) {
        relatedInstalled = true;
      }
    } catch (e) {}
  }

  // 2) Check Windows Desktop actual file (`OMOK.lnk` / `OMOK.url`) via local server API
  const desktopShortcutExists = await checkWindowsShortcutExistsOnServer();

  if (
    isRunningStandalone() ||
    relatedInstalled ||
    desktopShortcutExists ||
    localStorage.getItem('omok_shortcut_installed_v1') === '1'
  ) {
    localStorage.setItem('omok_shortcut_installed_v1', '1');
    localStorage.setItem('omok_shortcut_asked_v1', '1');
    if (openChipBtn) openChipBtn.classList.add('hidden');
    if (installModal) installModal.classList.add('hidden');
    return;
  }

  if (openChipBtn) {
    openChipBtn.classList.remove('hidden');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (openChipBtn && localStorage.getItem('omok_shortcut_installed_v1') !== '1') {
      openChipBtn.classList.remove('hidden');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.setItem('omok_shortcut_installed_v1', '1');
    localStorage.setItem('omok_shortcut_asked_v1', '1');
    installModal.classList.add('hidden');
    if (openChipBtn) openChipBtn.classList.add('hidden');
  });

  // Show prompt on first visit only if not already installed
  const alreadyAsked = localStorage.getItem('omok_shortcut_asked_v1') === '1';
  if (!alreadyAsked) {
    localStorage.setItem('omok_shortcut_asked_v1', '1');
    setTimeout(() => {
      openInstallModal();
    }, 350);
  }

  if (openChipBtn) {
    openChipBtn.addEventListener('click', () => {
      openInstallModal();
    });
  }

  if (laterBtn) {
    laterBtn.addEventListener('click', () => {
      localStorage.setItem('omok_shortcut_asked_v1', '1');
      installModal.classList.add('hidden');
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (installGuideShown) {
        installModal.classList.add('hidden');
        return;
      }
      localStorage.setItem('omok_shortcut_asked_v1', '1');

      const ua = navigator.userAgent || '';
      const isAndroid = /Android/i.test(ua);
      const isIOS = /iPhone|iPad|iPod/i.test(ua);

      // Step 1: On Windows PC running local server, directly create the Desktop `.lnk` icon
      if (!isAndroid && !isIOS) {
        const createdOnDesktop = await requestWindowsServerShortcutCreation();
        if (createdOnDesktop) {
          localStorage.setItem('omok_shortcut_installed_v1', '1');
          if (openChipBtn) openChipBtn.classList.add('hidden');

          // Also trigger native PWA prompt if available
          if (deferredInstallPrompt) {
            try {
              deferredInstallPrompt.prompt();
              await deferredInstallPrompt.userChoice;
            } catch (e) {}
            deferredInstallPrompt = null;
          }

          guideBox.classList.remove('hidden');
          guideBox.innerHTML = '✅ <strong>OMOK icon installed on your Windows Desktop!</strong>';
          installGuideShown = true;
          confirmBtn.textContent = 'OK';
          return;
        }
      }

      // Step 2: Native PWA install prompt (Android Chrome / Desktop Chrome & Edge)
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (choiceResult && choiceResult.outcome === 'accepted') {
          localStorage.setItem('omok_shortcut_installed_v1', '1');
          installModal.classList.add('hidden');
          if (openChipBtn) openChipBtn.classList.add('hidden');
          return;
        }
      }

      // Step 3: Fallback for mobile or static hosting
      guideBox.classList.remove('hidden');
      if (isAndroid) {
        guideBox.innerHTML =
          '📱 <strong>Android Home Screen</strong><br/>' +
          'Tap browser menu <strong>[⋮]</strong> → select <strong>[Add to Home screen]</strong> or <strong>[Install app]</strong>.';
      } else if (isIOS) {
        guideBox.innerHTML =
          '📱 <strong>iPhone Home Screen</strong><br/>' +
          'Tap <strong>[Share]</strong> → select <strong>[Add to Home Screen]</strong>.';
      } else {
        downloadWindowsShortcutFile();
        localStorage.setItem('omok_shortcut_installed_v1', '1');
        guideBox.innerHTML =
          '💻 <strong>Shortcut Downloaded!</strong><br/>' +
          'Place <strong>[OMOK.url]</strong> on your Desktop or click the address bar <strong>[Install App]</strong> icon.';
      }
      installGuideShown = true;
      confirmBtn.textContent = 'OK';
    });
  }
}

function openInstallModal() {
  const installModal = document.getElementById('install-modal');
  const guideBox = document.getElementById('install-guide-box');
  const confirmBtn = document.getElementById('btn-install-confirm');
  if (!installModal) return;

  installGuideShown = false;
  guideBox.classList.add('hidden');
  confirmBtn.textContent = '✨ INSTALL';
  installModal.classList.remove('hidden');
}

function downloadWindowsShortcutFile() {
  const baseHref = window.location.href.split('#')[0].split('?')[0].replace(/\/index\.html$/i, '');
  const targetUrl = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
  const iconUrl = `${targetUrl}favicon.ico`;
  const content = `[InternetShortcut]\r\nURL=${targetUrl}\r\nIconFile=${iconUrl}\r\nIconIndex=0\r\n`;
  const blob = new Blob([content], { type: 'application/internet-shortcut' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'OMOK.url';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
