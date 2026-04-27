/* ============================================================
   NORICHESSREVIEW — script.js
   Full Chess Analysis with Stockfish + Coach System
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// CONSTANTS & CONFIG
// ──────────────────────────────────────────────
const PIECE_UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

const CLASS_CONFIG = {
  brilliant:  { label: 'Brilliant', symbol: '!!', color: '#4fc3f7', emoji: '💎' },
  best:       { label: 'Best',      symbol: '!',  color: '#69f0ae', emoji: '✅' },
  good:       { label: 'Good',      symbol: '',   color: '#aed581', emoji: '👍' },
  inaccuracy: { label: 'Inaccuracy',symbol: '?!', color: '#fff176', emoji: '⚠️' },
  mistake:    { label: 'Mistake',   symbol: '?',  color: '#ffa726', emoji: '❗' },
  blunder:    { label: 'Blunder',   symbol: '??', color: '#ef5350', emoji: '💀' }
};

const SAMPLE_PGN = `[Event "World Chess Championship"]
[Site "New York, USA"]
[Date "1997.05.11"]
[Round "6"]
[White "Deep Blue"]
[Black "Kasparov, Garry"]
[Result "1-0"]
[WhiteElo "?"]
[BlackElo "2785"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Ng5 Ngf6 6. Bd3 e6
7. N1f3 h6 8. Nxe6 Qe7 9. O-O fxe6 10. Bg6+ Kd8 11. Bf4 b5
12. a4 Bb7 13. Re1 Nd5 14. Bg3 Kc8 15. axb5 cxb5 16. Qd3 Bc6
17. Bf5 exf5 18. Rxe7 Bxe7 19. c4 1-0`;

// ──────────────────────────────────────────────
// CHESS ENGINE (Lightweight FEN/Move Parser)
// ──────────────────────────────────────────────
const Chess = (() => {
  const FILES = 'abcdefgh';
  const RANKS = '12345678';

  function createBoard(fen) {
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { c += parseInt(ch); }
        else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          board[r][c] = color + ch.toUpperCase();
          c++;
        }
      }
    }
    return {
      board,
      turn:       parts[1] || 'w',
      castling:   parts[2] || '-',
      enPassant:  parts[3] || '-',
      halfMove:   parseInt(parts[4]) || 0,
      fullMove:   parseInt(parts[5]) || 1
    };
  }

  function boardToFen(state) {
    const { board, turn, castling, enPassant, halfMove, fullMove } = state;
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) { empty++; }
        else {
          if (empty) { fen += empty; empty = 0; }
          const color = piece[0];
          const type = piece[1];
          fen += color === 'w' ? type.toUpperCase() : type.toLowerCase();
        }
      }
      if (empty) fen += empty;
      if (r < 7) fen += '/';
    }
    return `${fen} ${turn} ${castling} ${enPassant} ${halfMove} ${fullMove}`;
  }

  function sqToCoord(sq) {
    // sq like 'e4' → { r: 4, c: 4 }
    const c = FILES.indexOf(sq[0]);
    const r = 8 - parseInt(sq[1]);
    return { r, c };
  }

  function coordToSq(r, c) {
    return FILES[c] + RANKS[7 - r];
  }

  return { createBoard, boardToFen, sqToCoord, coordToSq };
})();

// ──────────────────────────────────────────────
// PGN PARSER
// ──────────────────────────────────────────────
function parsePGN(pgn) {
  const headers = {};
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = headerRegex.exec(pgn)) !== null) {
    headers[m[1]] = m[2];
  }

  // Strip headers
  let moveText = pgn.replace(/\[.*?\]/g, '').replace(/\{[^}]*\}/g, '').trim();
  // Remove result
  moveText = moveText.replace(/1-0|0-1|1\/2-1\/2|\*/g, '').trim();
  // Remove move numbers and extra whitespace
  const tokens = moveText.split(/\s+/).filter(t =>
    t && !/^\d+\.+$/.test(t) && t !== '$' && !/^\$\d+$/.test(t)
  );

  return { headers, moves: tokens };
}

// ──────────────────────────────────────────────
// STOCKFISH INTEGRATION
// ──────────────────────────────────────────────
let stockfish = null;
let stockfishReady = false;
let stockfishCallback = null;
let currentDepth = 14;

function initStockfish() {
  try {
    // Try CDN worker approach
    const sfCode = `
      importScripts('https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish.js');
    `;
    const blob = new Blob([sfCode], { type: 'application/javascript' });
    stockfish = new Worker(URL.createObjectURL(blob));

    stockfish.onmessage = handleStockfishMessage;
    stockfish.onerror = () => loadStockfishFallback();

    stockfish.postMessage('uci');
    setTimeout(() => {
      if (!stockfishReady) loadStockfishFallback();
    }, 4000);

  } catch (e) {
    loadStockfishFallback();
  }
}

function loadStockfishFallback() {
  // Try external script tag approach
  try {
    stockfish = new Worker('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');
    stockfish.onmessage = handleStockfishMessage;
    stockfish.onerror = () => setEngineStatus('error');
    stockfish.postMessage('uci');
  } catch (e) {
    setEngineStatus('error');
    stockfishReady = false;
    // Use simulated engine for demo
    simulateEngine();
  }
}

function simulateEngine() {
  // Fallback: simulated engine responses
  stockfishReady = true;
  setEngineStatus('ready', 'Demo Mode (Simulated)');
  stockfish = {
    postMessage: (msg) => {
      if (msg.startsWith('position') && stockfishCallback) {
        setTimeout(() => {
          const score = (Math.random() * 4 - 2).toFixed(2);
          const moves = ['e2e4','d2d4','g1f3','c2c4','e7e5','d7d5','g8f6','c7c5'];
          const bestMove = moves[Math.floor(Math.random() * moves.length)];
          stockfishCallback({ score: parseFloat(score), bestMove, simulated: true });
        }, 50 + Math.random() * 100);
      }
    }
  };
}

function handleStockfishMessage(e) {
  const line = e.data;

  if (line.includes('uciok') || line.includes('readyok')) {
    stockfishReady = true;
    setEngineStatus('ready', 'Stockfish Ready');
    stockfish.postMessage('isready');
  }

  if (line.startsWith('info') && line.includes('score')) {
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/pv\s+(\S+)/);

    if (stockfishCallback) {
      let score = 0;
      if (cpMatch) score = parseInt(cpMatch[1]) / 100;
      if (mateMatch) {
        const mate = parseInt(mateMatch[1]);
        score = mate > 0 ? 100 : -100;
      }
      stockfishCallback({ score, bestMove: pvMatch ? pvMatch[1] : null, partial: true });
    }
  }

  if (line.startsWith('bestmove')) {
    const parts = line.split(' ');
    const bestMove = parts[1];
    if (stockfishCallback && bestMove && bestMove !== '(none)') {
      stockfishCallback({ bestMove, final: true });
      stockfishCallback = null;
    }
  }
}

function analyzePosition(fen, depth, callback) {
  if (!stockfish) { callback({ score: 0, bestMove: null }); return; }
  stockfishCallback = callback;
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage(`position fen ${fen}`);
  stockfish.postMessage(`go depth ${depth}`);
}

// ──────────────────────────────────────────────
// MOVE CLASSIFICATION
// ──────────────────────────────────────────────
function classifyMove(prevScore, currScore, isBestMove, color) {
  // Normalize: positive = good for the player who just moved
  const sign = color === 'w' ? 1 : -1;
  const before = prevScore * sign;
  const after  = currScore * sign;
  const delta  = after - before; // positive = improvement for this player

  // If played best move according to engine
  if (isBestMove) {
    if (delta > 1.5) return 'brilliant';
    return 'best';
  }

  // Classify by how much eval dropped
  const loss = before - after; // loss for the player (positive = bad)
  if (loss < 0.1)   return 'good';
  if (loss < 0.5)   return 'inaccuracy';
  if (loss < 1.5)   return 'mistake';
  return 'blunder';
}

// ──────────────────────────────────────────────
// BOARD RENDERER
// ──────────────────────────────────────────────
let currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let flipped = false;
let lastMoveSquares = [];
let bestMoveSquares = [];
let badgeSquares = {};

function renderBoard(fen, lastMove, bestMoveUCI, classification) {
  currentFEN = fen;
  const state = Chess.createBoard(fen);
  const board = state.board;
  const chessboard = document.getElementById('chessboard');
  const filesTop = document.getElementById('filesTop');
  const ranksLeft = document.getElementById('ranksLeft');
  const ranksRight = document.getElementById('ranksRight');

  // Coord labels
  const fileChars = flipped ? 'hgfedcba' : 'abcdefgh';
  const rankNums  = flipped ? '12345678' : '87654321';

  filesTop.innerHTML = '';
  fileChars.split('').forEach(f => {
    const el = document.createElement('div');
    el.className = 'coord-label';
    el.style.cssText = 'width:60px;text-align:center;font-size:0.65rem;color:var(--text-dim);font-family:var(--font-mono)';
    el.textContent = f;
    filesTop.appendChild(el);
  });

  ranksLeft.innerHTML = '';
  ranksRight.innerHTML = '';
  rankNums.split('').forEach(r => {
    ['ranksLeft','ranksRight'].forEach(id => {
      const el = document.createElement('div');
      el.className = 'coord-label';
      el.style.cssText = 'height:60px;display:flex;align-items:center;font-size:0.65rem;color:var(--text-dim);font-family:var(--font-mono)';
      el.textContent = r;
      document.getElementById(id).appendChild(el);
    });
  });

  // Parse last move UCI → squares
  lastMoveSquares = [];
  if (lastMove) {
    const from = lastMove.slice(0, 2);
    const to   = lastMove.slice(2, 4);
    if (from && to) lastMoveSquares = [from, to];
  }

  bestMoveSquares = [];
  if (bestMoveUCI && bestMoveUCI !== '(none)') {
    const bFrom = bestMoveUCI.slice(0, 2);
    const bTo   = bestMoveUCI.slice(2, 4);
    if (bFrom && bTo) bestMoveSquares = [bFrom, bTo];
  }

  chessboard.innerHTML = '';

  for (let ri = 0; ri < 8; ri++) {
    for (let ci = 0; ci < 8; ci++) {
      const boardR = flipped ? 7 - ri : ri;
      const boardC = flipped ? 7 - ci : ci;
      const sq = Chess.coordToSq(boardR, boardC);
      const piece = board[boardR][boardC];

      const cell = document.createElement('div');
      cell.className = 'sq hover-sq';
      cell.dataset.sq = sq;

      const isLight = (boardR + boardC) % 2 === 0;
      cell.classList.add(isLight ? 'light' : 'dark');

      if (lastMoveSquares.includes(sq)) cell.classList.add('highlight-last');
      if (bestMoveSquares.includes(sq) && sq === bestMoveSquares[1]) cell.classList.add('highlight-best');

      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece';
        pieceEl.textContent = PIECE_UNICODE[piece] || '';
        cell.appendChild(pieceEl);
      }

      // Badge on the "to" square
      if (classification && sq === (lastMoveSquares[1] || '') && lastMoveSquares.length === 2) {
        const badge = document.createElement('div');
        badge.className = `move-badge ${classification}`;
        badge.textContent = CLASS_CONFIG[classification]?.symbol || '';
        cell.appendChild(badge);
      }

      chessboard.appendChild(cell);
    }
  }

  // Update eval bar
  updateEvalBar(window.currentScore || 0);
}

function updateEvalBar(score) {
  window.currentScore = score;
  const fill = document.getElementById('evalFill');
  const label = document.getElementById('evalLabel');

  // Clamp and convert to percentage (50% = equal)
  const clamped = Math.max(-5, Math.min(5, score));
  const pct = 50 + (clamped / 10) * 100;

  fill.style.width = `${Math.max(5, Math.min(95, pct))}%`;
  label.textContent = score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  label.style.color = score > 0.5 ? '#e8e4dc' : score < -0.5 ? '#ef5350' : '#8b9ab5';
}

// ──────────────────────────────────────────────
// COACH SYSTEM
// ──────────────────────────────────────────────
let coaches = [];
let activeCoach = null;

async function loadCoaches() {
  try {
    const res = await fetch('assets/coach/coach.json');
    const data = await res.json();
    coaches = data.coaches;
  } catch {
    // fallback coaches
    coaches = [
      { name: 'DevZel', logo: '', style: 'calm analytical', signature: 'DevZel says', color: '#4fc3f7', emoji: '🧠',
        phrases: { brilliant: ['A deeply calculated move.'], best: ['The best continuation.'], good: ['A solid choice.'],
          inaccuracy: ['A slight imprecision.'], mistake: ['A concrete error.'], blunder: ['A critical blunder.'] } },
      { name: 'Kimmy',  logo: '', style: 'friendly beginner', signature: 'Kimmy says', color: '#f48fb1', emoji: '🌸',
        phrases: { brilliant: ['Amazing move! 🌟'], best: ['Perfect choice!'], good: ['Nice move!'],
          inaccuracy: ['Oops, small slip!'], mistake: ['Oh no, that hurt!'], blunder: ['Big oopsie! 😬'] } }
    ];
  }
  renderCoaches();
  setActiveCoach(0);
}

function renderCoaches() {
  const container = document.getElementById('coachCards');
  container.innerHTML = '';
  coaches.forEach((coach, i) => {
    const card = document.createElement('div');
    card.className = 'coach-card';
    card.dataset.index = i;

    // Avatar
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'coach-avatar-fallback';
    avatarWrap.textContent = coach.emoji || '🎓';
    avatarWrap.style.borderColor = coach.color || 'var(--gold-dim)';

    if (coach.logo) {
      const img = new Image();
      img.onload = () => {
        const imgEl = document.createElement('img');
        imgEl.className = 'coach-avatar';
        imgEl.src = coach.logo;
        imgEl.alt = coach.name;
        avatarWrap.replaceWith(imgEl);
        card.insertBefore(imgEl, card.firstChild);
      };
      img.src = coach.logo;
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'coach-card-name';
    nameEl.textContent = coach.name;
    nameEl.style.color = coach.color || 'var(--text-primary)';

    card.appendChild(avatarWrap);
    card.appendChild(nameEl);
    card.addEventListener('click', () => setActiveCoach(i));
    container.appendChild(card);
  });
}

function setActiveCoach(index) {
  activeCoach = coaches[index];
  document.querySelectorAll('.coach-card').forEach((c, i) => {
    c.classList.toggle('active', i === index);
  });
  const info = document.getElementById('activeCoachInfo');
  if (activeCoach) {
    info.textContent = `${activeCoach.emoji} ${activeCoach.name} — ${activeCoach.style}`;
    info.style.color = activeCoach.color || 'var(--text-secondary)';
  }
  // Update coach exp area
  setCoachDisplay(activeCoach, null, null);
}

function getCoachPhrase(coach, classification) {
  if (!coach || !coach.phrases) return 'A notable move in this position.';
  const list = coach.phrases[classification] || ['Interesting move.'];
  return list[Math.floor(Math.random() * list.length)];
}

function setCoachDisplay(coach, classification, moveSan) {
  const avatar = document.getElementById('coachExpAvatar');
  const name   = document.getElementById('coachExpName');
  const text   = document.getElementById('coachExpText');

  if (!coach) return;

  // Avatar
  if (coach.logo) {
    avatar.src = coach.logo;
    avatar.style.display = 'block';
    avatar.onerror = () => { avatar.style.display = 'none'; };
  } else {
    avatar.style.display = 'none';
  }

  const sig = coach.signature || coach.name;
  name.textContent = sig;
  name.style.color = coach.color || 'var(--gold)';

  if (classification && moveSan) {
    const phrase = getCoachPhrase(coach, classification);
    const classInfo = CLASS_CONFIG[classification];
    text.innerHTML = `<strong style="color:${classInfo.color}">${classInfo.emoji} ${classInfo.label}</strong> on <strong>${moveSan}</strong> — ${phrase}`;
  } else {
    text.textContent = 'Click any move in the list to get a coach explanation.';
  }
}

// ──────────────────────────────────────────────
// GAME STATE
// ──────────────────────────────────────────────
let gamePositions = []; // Array of { fen, move, score, bestMove, classification, san }
let currentMoveIndex = -1;
let isAnalyzing = false;
let playInterval = null;

// FEN move applier using chess.js-lite approach
// We rely on the external chess.js if available, or our own minimal implementation
let chessInstance = null;

function getChessJS() {
  // Check if Chess.js is loaded globally (via CDN script)
  if (typeof window.Chess !== 'undefined') {
    return new window.Chess();
  }
  return null;
}

// ──────────────────────────────────────────────
// GAME ANALYSIS PIPELINE
// ──────────────────────────────────────────────
async function analyzeGame(pgn) {
  if (isAnalyzing) return;
  isAnalyzing = true;
  gamePositions = [];
  currentMoveIndex = -1;

  const parsed = parsePGN(pgn);
  const { headers, moves } = parsed;

  // Set player names
  document.getElementById('whitePlayerName').textContent = headers.White || 'White';
  document.getElementById('blackPlayerName').textContent = headers.Black || 'Black';
  document.getElementById('whiteElo').textContent = headers.WhiteElo && headers.WhiteElo !== '?' ? `(${headers.WhiteElo})` : '';
  document.getElementById('blackElo').textContent = headers.BlackElo && headers.BlackElo !== '?' ? `(${headers.BlackElo})` : '';

  const moveListEl = document.getElementById('moveList');
  moveListEl.innerHTML = '';

  const progress = document.getElementById('analysisProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  progress.style.display = 'flex';

  // Load chess.js dynamically
  await loadChessJS();
  const chess = getChessJS();
  if (!chess) {
    alert('Chess library failed to load. Please refresh and try again.');
    isAnalyzing = false;
    return;
  }

  // Starting position
  const startFen = chess.fen();
  gamePositions.push({ fen: startFen, move: null, score: 0, bestMove: null, classification: null, san: null, uci: null });

  let prevScore = 0;

  for (let i = 0; i < moves.length; i++) {
    const san = moves[i];
    let moveResult;
    try {
      moveResult = chess.move(san, { sloppy: true });
    } catch {
      try { moveResult = chess.move(san); } catch { continue; }
    }
    if (!moveResult) continue;

    const fen = chess.fen();
    const color = moveResult.color; // 'w' or 'b'

    // Progress update
    const pct = ((i + 1) / moves.length) * 100;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `Analyzing move ${i + 1} / ${moves.length}: ${san}`;

    // Get UCI from move result
    const uci = moveResult.from + moveResult.to + (moveResult.promotion || '');

    // Analyze with Stockfish
    const evalResult = await new Promise(resolve => {
      let lastScore = prevScore;
      let lastBest = uci;
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; resolve({ score: lastScore, bestMove: lastBest }); }
      }, 2000);

      analyzePosition(fen, currentDepth, ({ score, bestMove, final, partial }) => {
        if (score !== undefined) lastScore = score;
        if (bestMove) lastBest = bestMove;
        if (final && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ score: lastScore, bestMove: lastBest });
        }
      });
    });

    const isBestMove = evalResult.bestMove && (
      evalResult.bestMove.slice(0, 4) === uci.slice(0, 4)
    );

    const classification = classifyMove(prevScore, evalResult.score, isBestMove, color);
    prevScore = evalResult.score;

    gamePositions.push({
      fen,
      move: uci,
      score: evalResult.score,
      bestMove: evalResult.bestMove,
      classification,
      san,
      color,
      moveNum: Math.floor(i / 2) + 1
    });

    // Add move row to UI
    addMoveRow(gamePositions.length - 1, gamePositions[gamePositions.length - 1]);
  }

  isAnalyzing = false;
  progress.style.display = 'none';
  document.getElementById('btnAnalyze').disabled = false;

  // Navigate to first move
  if (gamePositions.length > 1) {
    navigateTo(1);
    renderSummary();
  }
}

function addMoveRow(index, pos) {
  const moveListEl = document.getElementById('moveList');

  const row = document.createElement('div');
  row.className = 'move-row';
  row.dataset.index = index;

  const isWhite = pos.color === 'w';
  const moveNum = pos.moveNum;
  const classInfo = CLASS_CONFIG[pos.classification] || CLASS_CONFIG.good;

  // Score delta vs previous
  const prevPos = gamePositions[index - 1];
  const prevScore = prevPos ? prevPos.score : 0;
  const delta = pos.score - prevScore;
  const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
  const deltaClass = Math.abs(delta) < 0.1 ? 'delta-neu' : (
    (isWhite && delta > 0) || (!isWhite && delta < 0) ? 'delta-pos' : 'delta-neg'
  );

  row.innerHTML = `
    <div class="move-row-num">
      <span class="move-row-color ${isWhite ? 'w' : 'b'}"></span>
      ${isWhite ? moveNum + '.' : moveNum + '..'}
      <span class="move-row-san">${pos.san}</span>
    </div>
    <div class="move-row-score">${pos.score > 0 ? '+' : ''}${pos.score.toFixed(2)}</div>
    <div class="move-row-delta ${deltaClass}">${deltaStr}</div>
    <div class="move-row-class class-${pos.classification}">
      <div class="class-dot"></div>
      ${classInfo.label}
    </div>
  `;

  row.addEventListener('click', () => navigateTo(index));
  row.addEventListener('mouseenter', (e) => showTooltip(e, `${classInfo.emoji} ${classInfo.label}: ${pos.san}`));
  row.addEventListener('mouseleave', hideTooltip);

  moveListEl.appendChild(row);
}

// ──────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────
function navigateTo(index) {
  if (index < 0 || index >= gamePositions.length) return;
  currentMoveIndex = index;

  const pos = gamePositions[index];
  const prevPos = gamePositions[index - 1];

  renderBoard(pos.fen, pos.move, pos.bestMove, pos.classification);
  updateEvalBar(pos.score || 0);

  // Best move display
  const bmText = document.getElementById('bestMoveText');
  bmText.textContent = pos.bestMove
    ? uciToSan(pos.bestMove, prevPos?.fen || gamePositions[0].fen)
    : '—';

  // Highlight active move row
  document.querySelectorAll('.move-row').forEach(r => {
    r.classList.toggle('active', parseInt(r.dataset.index) === index);
  });

  // Scroll move into view
  const activeRow = document.querySelector(`.move-row[data-index="${index}"]`);
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Coach explanation
  if (pos.classification && pos.san && activeCoach) {
    setCoachDisplay(activeCoach, pos.classification, pos.san);
  }
}

function uciToSan(uci, fen) {
  if (!uci) return '—';
  const from = uci.slice(0, 2);
  const to   = uci.slice(2, 4);
  return `${from}-${to}`;
}

// ──────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────
function renderSummary() {
  const content = document.getElementById('summaryContent');
  const moves = gamePositions.slice(1);

  const counts = { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  moves.forEach(m => { if (m.classification) counts[m.classification]++; });

  const totalMoves = moves.length;
  const accuracy = Math.max(0, 100 - (counts.inaccuracy * 3 + counts.mistake * 7 + counts.blunder * 15));

  content.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card-val" style="color:var(--gold)">${totalMoves}</div>
        <div class="summary-card-label">Total Moves</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-val" style="color:var(--best)">${accuracy.toFixed(0)}%</div>
        <div class="summary-card-label">Accuracy</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-val" style="color:var(--blunder)">${counts.blunder}</div>
        <div class="summary-card-label">Blunders</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-val" style="color:var(--mistake)">${counts.mistake}</div>
        <div class="summary-card-label">Mistakes</div>
      </div>
    </div>
    <div class="class-counts">
      ${Object.entries(counts).map(([cls, count]) => {
        const cfg = CLASS_CONFIG[cls];
        const pct = totalMoves > 0 ? (count / totalMoves * 100) : 0;
        return `
          <div class="class-count-row">
            <span style="color:${cfg.color};font-size:0.75rem;width:70px">${cfg.emoji} ${cfg.label}</span>
            <div class="class-count-bar-wrap">
              <div class="class-count-bar" style="width:${pct}%;background:${cfg.color}"></div>
            </div>
            <span class="class-count-num">${count}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ──────────────────────────────────────────────
// CHESS.JS DYNAMIC LOADER
// ──────────────────────────────────────────────
function loadChessJS() {
  return new Promise((resolve) => {
    if (typeof window.Chess !== 'undefined') { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chess.js@0.12.1/chess.min.js';
    script.onload = resolve;
    script.onerror = () => {
      // Try alternate CDN
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.2/chess.js';
      s2.onload = resolve;
      s2.onerror = resolve;
      document.head.appendChild(s2);
    };
    document.head.appendChild(script);
  });
}

// ──────────────────────────────────────────────
// ENGINE STATUS
// ──────────────────────────────────────────────
function setEngineStatus(state, text) {
  const dot = document.getElementById('engineDot');
  const label = document.getElementById('engineStatusText');
  dot.className = 'engine-dot ' + state;
  label.textContent = text || (state === 'ready' ? 'Engine Ready' : state === 'loading' ? 'Loading...' : 'Engine Error');
}

// ──────────────────────────────────────────────
// TOOLTIP
// ──────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
function showTooltip(e, text) {
  tooltip.textContent = text;
  tooltip.classList.add('visible');
  moveTooltip(e);
}
function moveTooltip(e) {
  tooltip.style.left = (e.clientX + 12) + 'px';
  tooltip.style.top  = (e.clientY - 30) + 'px';
}
function hideTooltip() {
  tooltip.classList.remove('visible');
}
document.addEventListener('mousemove', (e) => {
  if (tooltip.classList.contains('visible')) moveTooltip(e);
});

// ──────────────────────────────────────────────
// BOARD CONTROLS
// ──────────────────────────────────────────────
document.getElementById('btnFirst').addEventListener('click', () => {
  stopPlay(); navigateTo(0);
});
document.getElementById('btnPrev').addEventListener('click', () => {
  stopPlay(); navigateTo(currentMoveIndex - 1);
});
document.getElementById('btnNext').addEventListener('click', () => {
  stopPlay(); navigateTo(currentMoveIndex + 1);
});
document.getElementById('btnLast').addEventListener('click', () => {
  stopPlay(); navigateTo(gamePositions.length - 1);
});

document.getElementById('btnFlip').addEventListener('click', () => {
  flipped = !flipped;
  const pos = gamePositions[currentMoveIndex] || gamePositions[0];
  if (pos) {
    const prev = currentMoveIndex > 0 ? gamePositions[currentMoveIndex - 1] : null;
    renderBoard(pos.fen, pos.move, pos.bestMove, pos.classification);
  }
});

const btnPlay = document.getElementById('btnPlay');
let isPlaying = false;

btnPlay.addEventListener('click', () => {
  if (isPlaying) { stopPlay(); }
  else { startPlay(); }
});

function startPlay() {
  if (gamePositions.length < 2) return;
  isPlaying = true;
  btnPlay.classList.add('playing');
  btnPlay.textContent = '⏸';

  playInterval = setInterval(() => {
    if (currentMoveIndex >= gamePositions.length - 1) {
      stopPlay(); return;
    }
    navigateTo(currentMoveIndex + 1);
  }, 1000);
}

function stopPlay() {
  isPlaying = false;
  btnPlay.classList.remove('playing');
  btnPlay.textContent = '▶';
  clearInterval(playInterval);
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    stopPlay(); navigateTo(currentMoveIndex + 1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    stopPlay(); navigateTo(currentMoveIndex - 1);
  } else if (e.key === 'Home') {
    stopPlay(); navigateTo(0);
  } else if (e.key === 'End') {
    stopPlay(); navigateTo(gamePositions.length - 1);
  }
});

// ──────────────────────────────────────────────
// TABS
// ──────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  });
});

// ──────────────────────────────────────────────
// DEPTH SLIDER
// ──────────────────────────────────────────────
document.getElementById('depthSlider').addEventListener('input', (e) => {
  currentDepth = parseInt(e.target.value);
  document.getElementById('depthVal').textContent = currentDepth;
});

// ──────────────────────────────────────────────
// PGN BUTTONS
// ──────────────────────────────────────────────
document.getElementById('btnAnalyze').addEventListener('click', async () => {
  const pgn = document.getElementById('pgnInput').value.trim();
  if (!pgn) { alert('Please paste a PGN game first.'); return; }
  if (isAnalyzing) return;
  stopPlay();
  document.getElementById('btnAnalyze').disabled = true;
  document.getElementById('moveList').innerHTML = '';
  document.getElementById('summaryContent').innerHTML = '<div class="summary-empty">Analyzing...</div>';
  await analyzeGame(pgn);
});

document.getElementById('btnSample').addEventListener('click', () => {
  document.getElementById('pgnInput').value = SAMPLE_PGN;
});

document.getElementById('btnClear').addEventListener('click', () => {
  document.getElementById('pgnInput').value = '';
  document.getElementById('moveList').innerHTML = `
    <div class="move-list-empty">
      <span class="empty-icon">♟</span>
      <p>Paste a PGN below and click <strong>Analyze Game</strong> to start.</p>
    </div>`;
  gamePositions = [];
  currentMoveIndex = -1;
  renderBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', null, null, null);
  updateEvalBar(0);
  document.getElementById('bestMoveText').textContent = '—';
  document.getElementById('summaryContent').innerHTML = '<div class="summary-empty">Analyze a game to see the summary.</div>';
  stopPlay();
});

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
function init() {
  setEngineStatus('loading', 'Loading Engine...');
  renderBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', null, null, null);
  loadCoaches();
  initStockfish();
}

init();
