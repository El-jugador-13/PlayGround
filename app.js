const boardElement = document.getElementById('board');
const turnText = document.getElementById('turn-text');
const turnSymbol = document.getElementById('turn-symbol');
const statusLabel = document.getElementById('status-label');
const statusMessage = document.getElementById('status-message');
const statusIcon = document.getElementById('status-icon');
const toast = document.getElementById('toast');

let board = [];
let turn = 'w'; // Marfil begins.
let selected = null;
let legalTargets = [];
let forcedCapture = false;
let chainSquare = null;
let gameOver = false;
let turnCount = 0;
let captured = { b: 0, w: 0 };
let undoStack = [];
let lastMove = null;
let messageTimer;

const sideName = side => side === 'w' ? 'Marfil' : 'Ébano';
const sideLabel = side => side === 'w' ? 'white' : 'black';
const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const isKing = piece => piece === 'W' || piece === 'B';
const owner = piece => piece ? piece.toLowerCase() : null;

function initialBoard() {
  const next = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) next[r][c] = 'b';
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) next[r][c] = 'w';
  }
  return next;
}

function moveOptions(r, c, capturesOnly = false) {
  const piece = board[r][c];
  if (!piece) return [];
  const side = owner(piece);
  const forward = side === 'w' ? -1 : 1;
  const directions = isKing(piece) ? [-1, 1] : [forward];
  const moves = [];
  for (const dr of directions) {
    for (const dc of [-1, 1]) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      if (board[nr][nc] === null && !capturesOnly) {
        moves.push({ from: [r, c], to: [nr, nc], capture: null });
      } else if (board[nr][nc] && owner(board[nr][nc]) !== side) {
        const jr = r + 2 * dr;
        const jc = c + 2 * dc;
        if (inBounds(jr, jc) && board[jr][jc] === null) {
          moves.push({ from: [r, c], to: [jr, jc], capture: [nr, nc] });
        }
      }
    }
  }
  return moves;
}

function allCaptures(side) {
  const captures = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (owner(board[r][c]) === side) captures.push(...moveOptions(r, c, true));
  }
  return captures;
}

function allMoves(side) {
  const captures = allCaptures(side);
  if (captures.length) return captures;
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (owner(board[r][c]) === side) moves.push(...moveOptions(r, c));
  }
  return moves;
}

function renderBoard() {
  boardElement.replaceChildren();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = document.createElement('button');
      square.type = 'button';
      square.className = `square ${(r + c) % 2 === 1 ? 'dark' : 'light'}`;
      square.setAttribute('role', 'gridcell');
      square.setAttribute('aria-label', `${String.fromCharCode(97 + c)}${8 - r}${board[r][c] ? `, ficha ${sideName(owner(board[r][c]))}${isKing(board[r][c]) ? ', dama' : ''}` : ''}`);
      square.dataset.row = r;
      square.dataset.col = c;
      if (selected && selected[0] === r && selected[1] === c) square.classList.add('selected');
      if (lastMove && (sameSquare(lastMove.from, [r, c]) || sameSquare(lastMove.to, [r, c]))) square.classList.add(sameSquare(lastMove.from, [r, c]) ? 'last-from' : 'last-to');
      const target = legalTargets.find(option => sameSquare(option.to, [r, c]));
      if (target) {
        square.classList.add('legal');
        if (target.capture) square.classList.add('capture-landing');
      }
      const piece = board[r][c];
      if (piece) {
        const token = document.createElement('span');
        token.className = `piece ${owner(piece) === 'w' ? 'white' : 'black'}${isKing(piece) ? ' king' : ''}`;
        token.setAttribute('aria-hidden', 'true');
        square.append(token);
      }
      square.addEventListener('click', onSquareClick);
      boardElement.append(square);
    }
  }
  updateInfo();
}

function sameSquare(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function saveSnapshot() {
  undoStack.push({
    board: board.map(row => [...row]), turn, selected: selected ? [...selected] : null,
    legalTargets: legalTargets.map(m => ({ ...m, from: [...m.from], to: [...m.to], capture: m.capture ? [...m.capture] : null })),
    forcedCapture, chainSquare: chainSquare ? [...chainSquare] : null, gameOver, turnCount,
    captured: { ...captured }, lastMove: lastMove ? { from: [...lastMove.from], to: [...lastMove.to] } : null
  });
  document.getElementById('undo-button').disabled = false;
}

function onSquareClick(event) {
  if (gameOver) return;
  const r = Number(event.currentTarget.dataset.row);
  const c = Number(event.currentTarget.dataset.col);
  const destination = [r, c];
  const option = legalTargets.find(move => sameSquare(move.to, destination));
  if (selected && option) {
    makeMove(option);
    return;
  }
  const piece = board[r][c];
  if (piece && owner(piece) === turn && (!chainSquare || sameSquare(chainSquare, destination))) {
    const captures = allCaptures(turn);
    forcedCapture = captures.length > 0;
    const pieceCaptures = captures.filter(m => sameSquare(m.from, destination));
    if (forcedCapture && !chainSquare && pieceCaptures.length === 0) {
      setStatus('CAPTURA OBLIGATORIA', 'Elige una ficha que pueda capturar', '!');
      return;
    }
    selected = destination;
    legalTargets = chainSquare ? moveOptions(r, c, true) : (forcedCapture ? pieceCaptures : moveOptions(r, c));
    updateInfo();
    renderBoard();
    return;
  }
  if (selected && !chainSquare) {
    selected = null;
    legalTargets = [];
    if (forcedCapture) setStatus('CAPTURA OBLIGATORIA', 'Debes elegir una ficha que pueda capturar', '!');
    else setStatus('TU TURNO', `${sideName(turn)}: elige una ficha`, '✦');
    renderBoard();
  }
}

function makeMove(move) {
  saveSnapshot();
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  let piece = board[fr][fc];
  board[fr][fc] = null;
  board[tr][tc] = piece;
  if (move.capture) {
    const [cr, cc] = move.capture;
    board[cr][cc] = null;
    captured[turn]++;
  }
  const promoted = (piece === 'w' && tr === 0) || (piece === 'b' && tr === 7);
  if (promoted) board[tr][tc] = piece.toUpperCase();
  lastMove = { from: [fr, fc], to: [tr, tc] };

  if (move.capture && !promoted) {
    const more = moveOptions(tr, tc, true);
    if (more.length) {
      selected = [tr, tc];
      chainSquare = [tr, tc];
      forcedCapture = true;
      legalTargets = more;
      setStatus('SIGUE CAPTURANDO', 'Encadena otro salto con esta ficha', '↗');
      renderBoard();
      return;
    }
  }
  selected = null;
  legalTargets = [];
  chainSquare = null;
  forcedCapture = false;
  turn = turn === 'w' ? 'b' : 'w';
  turnCount++;
  const destinationName = `${String.fromCharCode(97 + fc)}${8 - fr} → ${String.fromCharCode(97 + tc)}${8 - tr}`;
  document.getElementById('last-move').textContent = destinationName;
  if (promoted) showToast(`${sideName(owner(board[tr][tc]))} corona una dama ✦`);
  const nextMoves = allMoves(turn);
  if (nextMoves.length === 0) {
    gameOver = true;
    setStatus('FIN DE LA PARTIDA', `¡${sideName(turn === 'w' ? 'b' : 'w')} gana!`, '♛');
  } else if (promoted) {
    setStatus('NUEVA DAMA', `${sideName(turn === 'w' ? 'b' : 'w')} coronó. Turno de ${sideName(turn)}`, '✦');
  } else if (move.capture) {
    setStatus('FICHA CAPTURADA', `Turno de ${sideName(turn)}`, '×');
  } else {
    setStatus('TU TURNO', `Turno de ${sideName(turn)}`, '✦');
  }
  renderBoard();
}

function setStatus(label, message, icon) {
  statusLabel.textContent = label;
  statusMessage.textContent = message;
  statusIcon.textContent = icon;
}

function updateInfo() {
  const blackCount = board.flat().filter(p => owner(p) === 'b').length;
  const whiteCount = board.flat().filter(p => owner(p) === 'w').length;
  document.getElementById('black-count').textContent = blackCount;
  document.getElementById('white-count').textContent = whiteCount;
  document.getElementById('black-captures').textContent = captured.b;
  document.getElementById('white-captures').textContent = captured.w;
  const blackTrail = document.getElementById('black-captured');
  const whiteTrail = document.getElementById('white-captured');
  blackTrail.replaceChildren();
  whiteTrail.replaceChildren();
  for (let i = 0; i < captured.b; i++) { const item = document.createElement('span'); item.className = 'mini-piece white-mini'; blackTrail.append(item); }
  for (let i = 0; i < captured.w; i++) { const item = document.createElement('span'); item.className = 'mini-piece black-mini'; whiteTrail.append(item); }
  turnText.textContent = gameOver ? 'Partida terminada' : `Turno de ${sideName(turn)}`;
  turnSymbol.className = `turn-symbol ${turn === 'b' ? 'dark-turn' : ''}`;
  turnSymbol.style.background = turn === 'w' ? '#eadfc9' : '#557364';
  turnSymbol.style.boxShadow = turn === 'w' ? '0 0 8px rgba(234,223,201,.3)' : '0 0 8px rgba(116,164,132,.35)';
  document.getElementById('white-card').classList.toggle('active', turn === 'w' && !gameOver);
  document.getElementById('black-card').classList.toggle('active', turn === 'b' && !gameOver);
  document.getElementById('move-number').textContent = String(turnCount).padStart(2, '0');
  document.getElementById('undo-button').disabled = undoStack.length === 0;
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  board = previous.board;
  turn = previous.turn;
  selected = previous.selected;
  legalTargets = previous.legalTargets;
  forcedCapture = previous.forcedCapture;
  chainSquare = previous.chainSquare;
  gameOver = previous.gameOver;
  turnCount = previous.turnCount;
  captured = previous.captured;
  lastMove = previous.lastMove;
  document.getElementById('last-move').textContent = lastMove ? `${String.fromCharCode(97 + lastMove.from[1])}${8 - lastMove.from[0]} → ${String.fromCharCode(97 + lastMove.to[1])}${8 - lastMove.to[0]}` : '—';
  setStatus(forcedCapture ? 'CAPTURA OBLIGATORIA' : 'TU TURNO', forcedCapture ? 'Debes capturar si es posible' : `Turno de ${sideName(turn)}`, '↶');
  renderBoard();
}

function restart() {
  board = initialBoard();
  turn = 'w'; selected = null; legalTargets = []; forcedCapture = false;
  chainSquare = null; gameOver = false; turnCount = 0; captured = { b: 0, w: 0 };
  undoStack = []; lastMove = null;
  document.getElementById('last-move').textContent = '—';
  setStatus('TU TURNO', 'Elige una ficha para empezar', '✦');
  renderBoard();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

document.getElementById('undo-button').addEventListener('click', undo);
document.getElementById('restart-button').addEventListener('click', () => {
  if (turnCount > 0 || captured.b + captured.w > 0) {
    if (!window.confirm('¿Reiniciar la partida? Se perderá el progreso actual.')) return;
  }
  restart();
});
const rulesDialog = document.getElementById('rules-dialog');
document.getElementById('rules-button').addEventListener('click', () => rulesDialog.showModal());
document.getElementById('close-rules').addEventListener('click', () => rulesDialog.close());
document.getElementById('got-it').addEventListener('click', () => rulesDialog.close());
rulesDialog.addEventListener('click', event => { if (event.target === rulesDialog) rulesDialog.close(); });

restart();
