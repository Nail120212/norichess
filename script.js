
// PIECE IMAGE CONFIGURATION
// To use your own piece images, place PNG files in these folders:
//   /assets/pieces/white/  ->  wK.png, wQ.png, wR.png, wB.png, wN.png, wP.png
//   /assets/pieces/black/  ->  bK.png, bQ.png, bR.png, bB.png, bN.png, bP.png
//
// Then set useCustomPieces = true below.
// If a file is missing, the app falls back to Unicode symbols automatically.

const PIECE_CONFIG = {
  useCustomPieces: false,  // <-- SET THIS TO true to enable your own images
  whitePath: 'assets/pieces/white/',
  blackPath: 'assets/pieces/black/',
  fileNames: {
    'K': 'wK.png', 'Q': 'wQ.png', 'R': 'wR.png', 'B': 'wB.png', 'N': 'wN.png', 'P': 'wP.png',
    'k': 'bK.png', 'q': 'bQ.png', 'r': 'bR.png', 'b': 'bB.png', 'n': 'bN.png', 'p': 'bP.png'
  }
};

// NoriChessReview - Main Application
class NoriChessReview {
  constructor() {
    this.game = new Chess();
    this.stockfish = null;
    this.stockfishReady = false;
    this.useSimulation = false;

    this.coaches = [];
    this.selectedCoach = null;

    this.moves = []; // { san, from, to, fen_before, fen_after, color }
    this.analysisResults = []; // { moveIndex, evalBefore, evalAfterPlayed, evalAfterBest, bestMove, classification, explanation }

    this.currentMoveIndex = -1; // -1 = start
    this.isAnalyzing = false;
    this.analysisQueue = [];

    this.pieceMap = {
      'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
      'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };

    this.classificationIcons = {
      'brilliant': 'assets/icons/brilliant.png',
      'best': 'assets/icons/best.png',
      'good': 'assets/icons/good.png',
      'inaccuracy': 'assets/icons/inaccuracy.png',
      'mistake': 'assets/icons/mistake.png',
      'blunder': 'assets/icons/blunder.png'
    };
  }

  async init() {
    await this.loadCoaches();
    this.initStockfish();
    this.initEventListeners();
    this.renderBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    this.updateCoachDisplay();
  }

  async loadCoaches() {
    try {
      const res = await fetch('assets/coach/coach.json');
      const data = await res.json();
      this.coaches = data.coaches;
      this.selectedCoach = this.coaches[0];
      this.populateCoachSelect();
    } catch (e) {
      console.warn('Failed to load coaches, using defaults');
      this.coaches = [
        { name: 'DevZel', logo: 'assets/coach/images/devzel.png', style: 'calm analytical', signature: 'DevZel says', personality: 'analytical' },
        { name: 'Kimmy', logo: 'assets/coach/images/kimmy.png', style: 'friendly beginner', signature: 'Kimmy says', personality: 'friendly' },
        { name: 'Digger', logo: 'assets/coach/images/digger.png', style: 'deep tactical', signature: 'Digger says', personality: 'tactical' },
        { name: 'Rj', logo: 'assets/coach/images/rj.png', style: 'aggressive attacking', signature: 'Rj says', personality: 'aggressive' },
        { name: 'Kim', logo: 'assets/coach/images/kim.png', style: 'balanced teaching', signature: 'Kim says', personality: 'balanced' }
      ];
      this.selectedCoach = this.coaches[0];
      this.populateCoachSelect();
    }
  }

  populateCoachSelect() {
    const select = document.getElementById('coachSelect');
    select.innerHTML = '';
    this.coaches.forEach((coach, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = coach.name;
      select.appendChild(opt);
    });
    select.addEventListener('change', (e) => {
      this.selectedCoach = this.coaches[parseInt(e.target.value)];
      this.updateCoachDisplay();
      if (this.analysisResults.length > 0) {
        this.regenerateExplanations();
        this.renderMoveList();
        if (this.currentMoveIndex >= 0) {
          this.showCoachFeedback(this.currentMoveIndex);
        }
      }
    });
  }

  updateCoachDisplay() {
    const coach = this.selectedCoach;
    document.getElementById('coachAvatar').src = coach.logo;
    document.getElementById('coachName').textContent = coach.name;
    document.getElementById('coachStyle').textContent = coach.style;
    document.getElementById('coachSignature').textContent = coach.signature + ':';

    const mini = document.getElementById('coachInfo');
    mini.innerHTML = `<img src="${coach.logo}" alt=""><span>${coach.name}</span>`;
  }

  initStockfish() {
    try {
      this.stockfish = new Worker('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
      this.stockfish.addEventListener('message', (e) => this.handleStockfishMessage(e.data));
      this.stockfish.postMessage('uci');
    } catch (e) {
      console.warn('Stockfish failed to load, using simulation mode');
      this.useSimulation = true;
      this.stockfishReady = true;
    }
  }

  handleStockfishMessage(msg) {
    if (msg === 'uciok') {
      this.stockfish.postMessage('isready');
    } else if (msg === 'readyok') {
      this.stockfishReady = true;
      this.processAnalysisQueue();
    } else if (this.currentAnalysisResolve) {
      if (msg.includes('bestmove')) {
        const parts = msg.split(' ');
        const bestMove = parts[1];
        this.currentAnalysisResolve({
          bestMove: bestMove,
          eval: this.currentEval,
          mate: this.currentMate
        });
        this.currentAnalysisResolve = null;
      } else if (msg.includes('score cp')) {
        const m = msg.match(/score cp (-?\d+)/);
        if (m) this.currentEval = parseInt(m[1]) / 100;
        this.currentMate = null;
      } else if (msg.includes('score mate')) {
        const m = msg.match(/score mate (-?\d+)/);
        if (m) {
          this.currentMate = parseInt(m[1]);
          this.currentEval = this.currentMate > 0 ? 1000 : -1000;
        }
      }
    }
  }

  async analyzePosition(fen, depth = 10) {
    if (this.useSimulation) {
      return this.simulateAnalysis(fen);
    }
    return new Promise((resolve) => {
      this.analysisQueue.push({ fen, depth, resolve });
      this.processAnalysisQueue();
    });
  }

  async processAnalysisQueue() {
    if (!this.stockfishReady || this.isAnalyzing || this.analysisQueue.length === 0) return;
    this.isAnalyzing = true;
    const { fen, depth, resolve } = this.analysisQueue.shift();

    this.currentEval = 0;
    this.currentMate = null;
    this.currentAnalysisResolve = (result) => {
      this.isAnalyzing = false;
      resolve(result);
      setTimeout(() => this.processAnalysisQueue(), 10);
    };

    this.stockfish.postMessage(`position fen ${fen}`);
    this.stockfish.postMessage(`go depth ${depth}`);
  }

  simulateAnalysis(fen) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const game = new Chess(fen);
        const legal = game.moves();
        const bestMove = legal.length > 0 ? legal[Math.floor(Math.random() * legal.length)] : '0000';
        const evalScore = (Math.random() - 0.5) * 3;
        resolve({ bestMove, eval: evalScore, mate: null });
      }, 50 + Math.random() * 100);
    });
  }

  initEventListeners() {
    document.getElementById('btnAnalyze').addEventListener('click', () => this.analyzeGame());
    document.getElementById('btnFirst').addEventListener('click', () => this.goToMove(-1));
    document.getElementById('btnPrev').addEventListener('click', () => this.goToMove(this.currentMoveIndex - 1));
    document.getElementById('btnNext').addEventListener('click', () => this.goToMove(this.currentMoveIndex + 1));
    document.getElementById('btnLast').addEventListener('click', () => this.goToMove(this.moves.length - 1));
    document.getElementById('btnLoadSample').addEventListener('click', () => this.loadSampleGame());
    document.getElementById('btnClear').addEventListener('click', () => {
      document.getElementById('pgnInput').value = '';
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.goToMove(this.currentMoveIndex - 1);
      if (e.key === 'ArrowRight') this.goToMove(this.currentMoveIndex + 1);
    });
  }

  loadSampleGame() {
    const sample = `[Event "Sample Game"]
[Site "NoriChessReview"]
[Date "2026.04.26"]
[White "Player1"]
[Black "Player2"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7
11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 h6 15. Bh4 Re8 16. a3 Bf8 17. Qc2 Qc7 18. Bg3 Nb6 19. Nh4 Nfd7
20. Nf5 Nc5 21. Bc2 Ne6 22. Nxh6+ gxh6 23. Qg6+ Bg7 24. Qxh6 f5 25. Bxe5 dxe5 26. dxe5 Nbd7 27. e6 Nf8
28. Qg5 Rxa3 29. Rxa3 Qxa3 30. bxa3 b4 31. Na4 bxa3 32. Bb3 Kh8 33. Qh4+ Nh7 34. Qxe8+ Nf8 35. Qxf8+ Bxf8
36. e7 Bxe7 37. Rxe7 Ng6 38. Rb7 Ba8 39. Rb8+ Kh7 40. Rxa8 Kg7 41. Rxa3 Kf6 42. Ra7 Ne5 43. Rf7+ Kg6
44. Rxc7 Kf6 45. f4 Nf3+ 46. gxf3 Kg6 47. Rxc6+ Kh5 48. Rc5 Kg6 49. Rxf5 Kh6 50. Rf6+ Kh5 51. Rh6# 1-0`;
    document.getElementById('pgnInput').value = sample;
  }

  async analyzeGame() {
    const pgn = document.getElementById('pgnInput').value.trim();
    if (!pgn) {
      alert('Please paste a PGN game first.');
      return;
    }

    this.setStatus('analyzing');
    this.game.reset();
    const ok = this.game.load_pgn(pgn);
    if (!ok) {
      alert('Invalid PGN. Please check your input.');
      this.setStatus('ready');
      return;
    }

    // Reconstruct move history with FENs
    const history = this.game.history({ verbose: true });
    this.game.reset();
    this.moves = [];
    this.analysisResults = [];

    const fens = [this.game.fen()];
    for (const h of history) {
      this.game.move(h);
      fens.push(this.game.fen());
    }

    for (let i = 0; i < history.length; i++) {
      this.moves.push({
        index: i,
        san: history[i].san,
        from: history[i].from,
        to: history[i].to,
        color: history[i].color,
        fenBefore: fens[i],
        fenAfter: fens[i + 1]
      });
    }

    // Analyze each move
    for (let i = 0; i < this.moves.length; i++) {
      const move = this.moves[i];
      this.setStatus('analyzing', `Analyzing move ${i + 1}/${this.moves.length}...`);

      // Eval before
      const beforeRes = await this.analyzePosition(move.fenBefore, 10);
      const evalBeforeRaw = beforeRes.eval;
      const bestMove = beforeRes.bestMove;

      // Eval after played move
      const afterRes = await this.analyzePosition(move.fenAfter, 10);
      const evalAfterPlayedRaw = afterRes.eval;

      // Eval after best move
      let evalAfterBestRaw = evalAfterPlayedRaw;
      if (bestMove && bestMove !== '0000') {
        try {
          const tempGame = new Chess(move.fenBefore);
          tempGame.move(bestMove, { sloppy: true });
          const bestRes = await this.analyzePosition(tempGame.fen(), 10);
          evalAfterBestRaw = bestRes.eval;
        } catch (e) {
          evalAfterBestRaw = evalBeforeRaw;
        }
      }

      // Adjust to mover's perspective
      const isWhite = move.color === 'w';
      const evalBefore = isWhite ? evalBeforeRaw : -evalBeforeRaw;
      const evalAfterPlayed = isWhite ? evalAfterPlayedRaw : -evalAfterPlayedRaw;
      const evalAfterBest = isWhite ? evalAfterBestRaw : -evalAfterBestRaw;

      // Calculate loss
      let loss = 0;
      if (isWhite) {
        loss = evalAfterBest - evalAfterPlayed;
      } else {
        loss = evalAfterPlayed - evalAfterBest;
      }

      const classification = this.classifyMove(loss, evalBefore, evalAfterPlayed, bestMove, move.san);
      const explanation = this.generateExplanation(classification, move, evalBefore, evalAfterPlayed, evalAfterBest, loss);

      this.analysisResults.push({
        moveIndex: i,
        evalBefore,
        evalAfterPlayed,
        evalAfterBest,
        bestMove,
        loss,
        classification,
        explanation
      });

      this.renderMoveList();
    }

    this.setStatus('done', 'Analysis complete');
    this.goToMove(-1);
    this.renderMoveList();
  }

  classifyMove(loss, evalBefore, evalAfterPlayed, bestMove, playedMove) {
    // Normalize loss (positive = bad for mover)
    const l = loss;

    if (l <= 0.05 && Math.abs(evalAfterPlayed) < 10) {
      // Check if it was a difficult position (not completely winning)
      if (Math.abs(evalBefore) < 3 || evalAfterPlayed > evalBefore + 0.5) {
        return 'brilliant';
      }
    }
    if (l <= 0.2) return 'best';
    if (l <= 0.7) return 'good';
    if (l <= 1.5) return 'inaccuracy';
    if (l <= 3.0) return 'mistake';
    return 'blunder';
  }

  generateExplanation(cls, move, evalBefore, evalAfter, evalBest, loss) {
    const coach = this.selectedCoach;
    const side = move.color === 'w' ? 'White' : 'Black';
    const sign = move.color === 'w' ? '+' : '-';
    const evalStr = evalAfter >= 0 ? `+${evalAfter.toFixed(1)}` : evalAfter.toFixed(1);
    const diffStr = Math.abs(loss).toFixed(1);

    const templates = {
      analytical: {
        brilliant: `This is a remarkable find. The evaluation shifts to ${evalStr} in your favor. You identified the optimal continuation in a complex position.`,
        best: `Technically precise. This maintains the evaluation at ${evalStr}, which is the engine's top recommendation.`,
        good: `A reasonable choice. The position remains at ${evalStr}, within acceptable parameters.`,
        inaccuracy: `Slight imprecision here. You dropped ${diffStr} pawns of evaluation compared to the optimal ${side === 'White' ? 'plus' : 'minus'}${Math.abs(evalBest).toFixed(1)}.`,
        mistake: `This move costs ${diffStr} pawns in evaluation. The position shifts from ${evalBefore >= 0 ? '+' : ''}${evalBefore.toFixed(1)} to ${evalStr}. Consider ${move.bestMove || 'alternative continuations'}.`,
        blunder: `Critical error. You lost ${diffStr} pawns of evaluation. The position collapses from ${evalBefore >= 0 ? '+' : ''}${evalBefore.toFixed(1)} to ${evalStr}.`
      },
      friendly: {
        brilliant: `Wow! What a beautiful move! You found the absolute best idea here. Great job!`,
        best: `Perfect! This is exactly what the engine likes. Keep playing like this!`,
        good: `Nice move! You're keeping the game going in a good direction.`,
        inaccuracy: `Hmm, this move is okay, but there's a slightly better way. Don't worry, you'll see it with practice!`,
        mistake: `Oops! This move makes things a bit harder. Try to look for safer options next time.`,
        blunder: `Oh no! This move really hurts your position. But don't give up—we all make these mistakes!`
      },
      tactical: {
        brilliant: `Brilliant tactical shot! You saw through the complications and found the critical line.`,
        best: `Strong tactical move. This keeps all the threats alive and maintains pressure.`,
        good: `Decent tactical awareness. The position remains sharp and playable.`,
        inaccuracy: `You missed a tactical nuance here. There was a stronger continuation that keeps more initiative.`,
        mistake: `Tactical oversight. This move allows counterplay or misses a stronger idea. Look for forcing moves!`,
        blunder: `Major tactical blunder! This completely changes the course of the game. Always check for threats!`
      },
      aggressive: {
        brilliant: `BOOM! That's how you punish your opponent! Beautiful and devastating!`,
        best: `Excellent! This keeps the attack rolling and your opponent under maximum pressure.`,
        good: `Not bad, but don't let up! Keep looking for ways to crash through.`,
        inaccuracy: `Too soft! You had a chance to really squeeze them here. Play with more energy!`,
        mistake: `That gives them breathing room. You need to keep them suffocating, not let them escape!`,
        blunder: `Unacceptable! You just threw away your advantage. Attackers cannot afford these lapses!`
      },
      balanced: {
        brilliant: `An outstanding move that demonstrates deep understanding. This is the kind of move that wins games.`,
        best: `Well played. This is the most principled continuation in the position.`,
        good: `A solid move that keeps you in the game. Always look for improvements, though.`,
        inaccuracy: `This move is playable, but not the most accurate. Ask yourself: what is my opponent's idea?`,
        mistake: `This move creates unnecessary difficulties. Take a moment to consider all candidate moves.`,
        blunder: `This is a significant error. When you have time, try to understand why this move fails and what to play instead.`
      }
    };

    const personality = coach.personality || 'balanced';
    return templates[personality][cls] || templates.balanced[cls];
  }

  regenerateExplanations() {
    for (let i = 0; i < this.analysisResults.length; i++) {
      const res = this.analysisResults[i];
      const move = this.moves[i];
      res.explanation = this.generateExplanation(res.classification, move, res.evalBefore, res.evalAfterPlayed, res.evalAfterBest, res.loss);
    }
  }

  setStatus(status, text) {
    const badge = document.getElementById('analysisStatus');
    badge.className = 'status-badge ' + status;
    if (status === 'analyzing') badge.textContent = text || 'Analyzing...';
    else if (status === 'done') badge.textContent = text || 'Done';
    else badge.textContent = 'Ready';
  }

  renderBoard(fen, lastMove = null, bestMove = null, classification = null) {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    const rows = fen.split(' ')[0].split('/');
    for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
      const row = rows[rankIdx];
      let fileIdx = 0;
      for (const char of row) {
        if (char >= '1' && char <= '8') {
          for (let i = 0; i < parseInt(char); i++) {
            this.createSquare(rankIdx, fileIdx, null, lastMove, bestMove, classification);
            fileIdx++;
          }
        } else {
          this.createSquare(rankIdx, fileIdx, char, lastMove, bestMove, classification);
          fileIdx++;
        }
      }
    }
  }

  createSquare(rankIdx, fileIdx, pieceChar, lastMove, bestMove, classification) {
    const board = document.getElementById('chessboard');
    const square = document.createElement('div');
    const file = ['a','b','c','d','e','f','g','h'][fileIdx];
    const rank = 8 - rankIdx;
    const sqName = file + rank;
    const isLight = (rankIdx + fileIdx) % 2 === 0;

    square.className = `square ${isLight ? 'light' : 'dark'}`;
    square.dataset.square = sqName;

    if (pieceChar) {
      this.renderPiece(square, pieceChar);
    }

    if (lastMove) {
      if (sqName === lastMove.from || sqName === lastMove.to) {
        square.classList.add('highlight-last');
      }
    }

    if (bestMove) {
      if (sqName === bestMove.from || sqName === bestMove.to) {
        square.classList.add('highlight-best');
      }
    }

    if (classification && lastMove && sqName === lastMove.to) {
      const badge = document.createElement('img');
      badge.className = 'classification-badge';
      badge.src = this.classificationIcons[classification];
      badge.alt = classification;
      square.appendChild(badge);
    }

    board.appendChild(square);
  }

  renderPiece(square, pieceChar) {
    const isWhite = pieceChar === pieceChar.toUpperCase();

    if (PIECE_CONFIG.useCustomPieces) {
      const folder = isWhite ? PIECE_CONFIG.whitePath : PIECE_CONFIG.blackPath;
      const filename = PIECE_CONFIG.fileNames[pieceChar];
      if (filename) {
        const img = document.createElement('img');
        img.src = folder + filename;
        img.alt = pieceChar;
        img.className = 'piece-img';
        img.style.width = '85%';
        img.style.height = '85%';
        img.style.objectFit = 'contain';
        img.style.zIndex = '2';
        img.onerror = () => {
          // Fallback to Unicode if image fails to load
          img.remove();
          this.renderUnicodePiece(square, pieceChar);
        };
        square.appendChild(img);
        return;
      }
    }
    this.renderUnicodePiece(square, pieceChar);
  }

  renderUnicodePiece(square, pieceChar) {
    const piece = document.createElement('span');
    piece.className = `piece ${pieceChar === pieceChar.toUpperCase() ? 'white' : 'black'}`;
    piece.textContent = this.pieceMap[pieceChar] || '';
    square.appendChild(piece);
  }

  renderMoveList() {
    const list = document.getElementById('moveList');
    list.innerHTML = '';

    if (this.moves.length === 0) {
      list.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-muted); text-align: center; padding: 20px;">No moves loaded</div>';
      return;
    }

    for (let i = 0; i < this.moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const numDiv = document.createElement('div');
      numDiv.className = 'move-number';
      numDiv.textContent = moveNum + '.';
      list.appendChild(numDiv);

      // White move
      const wMove = this.moves[i];
      const wRes = this.analysisResults[i];
      const wItem = this.createMoveItem(i, wMove, wRes);
      list.appendChild(wItem);

      // Black move
      if (i + 1 < this.moves.length) {
        const bMove = this.moves[i + 1];
        const bRes = this.analysisResults[i + 1];
        const bItem = this.createMoveItem(i + 1, bMove, bRes);
        list.appendChild(bItem);
      } else {
        const empty = document.createElement('div');
        list.appendChild(empty);
      }
    }
  }

  createMoveItem(index, move, result) {
    const item = document.createElement('div');
    item.className = 'move-item';
    if (index === this.currentMoveIndex) item.classList.add('active');

    let iconHtml = '';
    let evalText = '';
    if (result) {
      iconHtml = `<img src="${this.classificationIcons[result.classification]}" class="move-icon" alt="${result.classification}" title="${result.classification}">`;
      const ev = move.color === 'w' ? result.evalAfterPlayed : -result.evalAfterPlayed;
      evalText = ev >= 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1);
    }

    item.innerHTML = `
      <span class="move-text class-${result ? result.classification : 'good'}">${move.san}</span>
      ${iconHtml}
      <span class="move-eval">${evalText}</span>
    `;

    item.addEventListener('click', () => this.goToMove(index));

    if (result) {
      item.title = `${result.classification.toUpperCase()}: ${result.explanation.substring(0, 80)}...`;
    }

    return item;
  }

  goToMove(index) {
    if (index < -1) index = -1;
    if (index >= this.moves.length) index = this.moves.length - 1;
    this.currentMoveIndex = index;

    let fen, lastMove, bestMove, classification;

    if (index === -1) {
      fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      lastMove = null;
      bestMove = null;
      classification = null;
      this.updateEvalDisplay(0);
      document.getElementById('bestMoveDisplay').textContent = '--';
      document.getElementById('depthDisplay').textContent = 'Depth: --';
    } else {
      const move = this.moves[index];
      fen = move.fenAfter;
      lastMove = { from: move.from, to: move.to };

      const res = this.analysisResults[index];
      if (res) {
        classification = res.classification;
        bestMove = res.bestMove && res.bestMove !== '0000' ? { from: res.bestMove.substring(0,2), to: res.bestMove.substring(2,4) } : null;
        const rawEval = move.color === 'w' ? res.evalAfterPlayed : -res.evalAfterPlayed;
        this.updateEvalDisplay(rawEval);
        document.getElementById('bestMoveDisplay').textContent = res.bestMove && res.bestMove !== '0000' ? res.bestMove : '--';
        document.getElementById('depthDisplay').textContent = 'Depth: 10';
        this.showCoachFeedback(index);
      } else {
        this.updateEvalDisplay(0);
        document.getElementById('bestMoveDisplay').textContent = '--';
      }
    }

    this.renderBoard(fen, lastMove, bestMove, classification);
    this.renderMoveList();

    // Scroll active move into view
    setTimeout(() => {
      const active = document.querySelector('.move-item.active');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 10);
  }

  updateEvalDisplay(evalScore) {
    const bar = document.getElementById('evalBarWhite');
    const text = document.getElementById('evalText');

    let displayScore = evalScore;
    let percent = 50;

    if (Math.abs(displayScore) > 10) {
      percent = displayScore > 0 ? 95 : 5;
    } else {
      percent = 50 + (displayScore / 10) * 40;
      percent = Math.max(5, Math.min(95, percent));
    }

    bar.style.width = percent + '%';

    if (displayScore >= 0) {
      text.textContent = '+' + displayScore.toFixed(1);
      text.style.color = '#fff';
    } else {
      text.textContent = displayScore.toFixed(1);
      text.style.color = '#ff8888';
    }
  }

  showCoachFeedback(index) {
    const res = this.analysisResults[index];
    if (!res || !this.selectedCoach) return;

    document.getElementById('coachSignature').textContent = this.selectedCoach.signature + ':';
    document.getElementById('coachExplanation').textContent = res.explanation;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  const app = new NoriChessReview();
  app.init();
});
