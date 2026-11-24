/**
 * MOP-13 · Turno de noche en el espacio
 * Servidor sin dependencias para Node.js 18+ (pensado para Hostinger).
 *
 *  - Sirve la carpeta ./dist (el juego ya compilado) con brotli/gzip y caché.
 *  - Multijugador cooperativo: salas con código de 5 caracteres.
 *      · WebSocket en /mp (implementación propia del protocolo RFC 6455).
 *      · Alternativa HTTP de sondeo largo en /mp/open, /mp/send y /mp/recv
 *        para alojamientos que no dejan pasar WebSocket.
 *    El servidor solo hace de repetidor: el anfitrión simula la nave y los demás reciben su estado.
 *  - Sirve la presentación del proyecto (./slides, hecha con HyperFrames) en /slides/.
 *  - Puerto: variable de entorno PORT (Hostinger la asigna) o 3000 en local.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || Number(process.argv[3]) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, process.argv[2] || 'dist');
const SLIDES_ROOT = path.resolve(__dirname, 'slides');
const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_MSG = 4 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  // el chat de voz del multijugador usa el micrófono de esta misma web
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
};

// ───────────────────────────── ficheros estáticos ─────────────────────────────

/** caché en memoria: ruta → { raw, br, gz, mtime } */
const cache = new Map();

function load(file, stat) {
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const entry = { raw, mtime: stat.mtimeMs, br: null, gz: null, etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"` };
  if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
    entry.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    entry.gz = zlib.gzipSync(raw, { level: 9 });
  }
  cache.set(file, entry);
  return entry;
}

function resolveFile(urlPath, root = ROOT) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  if (p.includes('\0')) return null;
  const full = path.normalize(path.join(root, p));
  if (full !== root && !full.startsWith(root + path.sep)) return null; // evita salir de dist (o de slides)
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const idx = path.join(full, 'index.html');
      return fs.existsSync(idx) ? { file: idx, stat: fs.statSync(idx) } : null;
    }
    return { file: full, stat: st };
  } catch { return null; }
}

function serveStatic(req, res, root = ROOT, url = req.url || '/') {
  let found = resolveFile(url, root);
  // SPA: cualquier ruta sin extensión devuelve el juego
  if (!found && root === ROOT && !path.extname(url.split('?')[0])) found = resolveFile('/index.html');
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    return res.end('404 · Esta sala de la USC Desastre no existe. MOP-13 tampoco la va a fregar.');
  }
  const { file, stat } = found;
  const ext = path.extname(file).toLowerCase();
  const entry = load(file, stat);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
    ...SECURITY_HEADERS,
  };
  const rel = path.relative(root, file).split(path.sep).join('/');
  headers['Cache-Control'] = root === ROOT && rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accept = String(req.headers['accept-encoding'] || '');
  let body = entry.raw;
  if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gz && /\bgzip\b/.test(accept)) { body = entry.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ───────────────────────────── salas ─────────────────────────────

/** code → { code, host: Conn, members: Map<pid, Conn>, nextPid } */
const rooms = new Map();
let connSeq = 1;

function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('sin códigos libres');
}

const cleanName = (n) => String(n || 'Conserje').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Conserje';
const cleanLook = (l) => ({ uniform: String(l?.uniform || 'amarillo').slice(0, 16), hat: String(l?.hat || 'cap').slice(0, 16) });
const peerInfo = (c) => ({ pid: c.pid, name: c.name, look: c.look, host: c.room?.host === c });

/** Conexión abstracta (WebSocket o sondeo largo). */
class Conn {
  constructor(kind) {
    this.id = connSeq++;
    this.kind = kind;
    this.room = null;
    this.pid = 0;
    this.name = '';
    this.look = null;
    this.closed = false;
  }
  send(obj) { this.sendRaw(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  sendRaw() { /* implementado en cada transporte */ }
  close() { /* implementado en cada transporte */ }
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.members.delete(c.pid);
  if (room.host === c) {
    for (const m of room.members.values()) { m.send({ t: 'closed' }); m.room = null; }
    rooms.delete(room.code);
    log(`sala ${room.code} cerrada (el anfitrión se fue)`);
  } else {
    for (const m of room.members.values()) m.send({ t: 'peer', pid: c.pid, name: c.name, on: false });
    log(`${c.name} salió de ${room.code}`);
  }
}

function handleMessage(c, text) {
  if (text.length > MAX_MSG) return;
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'create': {
      leaveRoom(c);
      const code = newCode();
      const room = { code, host: c, members: new Map(), nextPid: 2 };
      rooms.set(code, room);
      c.room = room; c.pid = 1; c.name = cleanName(m.name); c.look = cleanLook(m.look);
      room.members.set(1, c);
      c.send({ t: 'room', code, pid: 1, host: true, peers: [peerInfo(c)] });
      log(`sala ${code} creada por ${c.name}`);
      break;
    }
    case 'join': {
      leaveRoom(c);
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room) return c.send({ t: 'err', msg: 'No existe ninguna sala con ese código.' });
      if (room.members.size >= MAX_PLAYERS) return c.send({ t: 'err', msg: 'La sala está llena (máximo 4 conserjes).' });
      c.room = room; c.pid = room.nextPid++; c.name = cleanName(m.name); c.look = cleanLook(m.look);
      room.members.set(c.pid, c);
      c.send({ t: 'room', code, pid: c.pid, host: false, peers: [...room.members.values()].map(peerInfo) });
      for (const o of room.members.values()) if (o !== c) o.send({ t: 'peer', ...peerInfo(c), on: true });
      log(`${c.name} entró en ${code} (${room.members.size}/${MAX_PLAYERS})`);
      break;
    }
    case 'tx': { // anfitrión → invitados
      const room = c.room;
      if (!room || room.host !== c) return;
      const payload = JSON.stringify({ t: 'rx', d: m.d });
      if (m.to === undefined || m.to === 'all') { for (const o of room.members.values()) if (o !== c) o.sendRaw(payload); }
      else { const o = room.members.get(Number(m.to)); if (o) o.sendRaw(payload); }
      break;
    }
    case 'up': { // invitado → anfitrión
      const room = c.room;
      if (!room || room.host === c) return;
      room.host.sendRaw(JSON.stringify({ t: 'up', from: c.pid, d: m.d }));
      break;
    }
    case 'sig': { // señalización del chat de voz (WebRTC): entre cualquier pareja de la sala
      const room = c.room;
      if (!room) return;
      const payload = JSON.stringify({ t: 'sig', from: c.pid, d: m.d });
      if (m.to === 'all') { for (const o of room.members.values()) if (o !== c) o.sendRaw(payload); }
      else { const o = room.members.get(Number(m.to)); if (o && o !== c) o.sendRaw(payload); }
      break;
    }
    case 'bye': leaveRoom(c); break;
    case 'ping': c.send({ t: 'pong' }); break;
  }
}

function log(s) { if (process.env.MP_QUIET !== '1') console.log(`[mp] ${s}`); }

/**
 * Servidores ICE para el chat de voz.
 *  STUN_URLS  (opcional) lista separada por comas; por defecto, los STUN públicos de Google.
 *  TURN_URLS / TURN_USER / TURN_PASS  (opcional) servidor TURN propio o contratado, para redes que bloquean la conexión directa.
 */
function iceServers() {
  const list = [];
  const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) list.push({ urls: stun });
  const turn = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turn.length) list.push({ urls: turn, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  return list;
}

// ───────────────────────────── WebSocket (RFC 6455) ─────────────────────────────

function wsFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

class WsConn extends Conn {
  constructor(socket) {
    super('ws');
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.fragOp = 0;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
    this.pingIv = setInterval(() => {
      if (!this.alive) { this.socket.destroy(); return; }
      this.alive = false;
      this.writeFrame(0x9, Buffer.alloc(0));
    }, 25000);
  }
  writeFrame(op, payload) { if (!this.closed && this.socket.writable) this.socket.write(wsFrame(op, payload)); }
  sendRaw(text) { this.writeFrame(0x1, Buffer.from(text, 'utf8')); }
  close() { if (this.closed) return; this.writeFrame(0x8, Buffer.alloc(0)); this.socket.end(); this.onClose(); }
  onClose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingIv);
    leaveRoom(this);
  }
  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) { this.socket.destroy(); return; } len = Number(big); off = 10; }
      if (len > MAX_MSG) { this.socket.destroy(); return; }
      const total = off + (masked ? 4 : 0) + len;
      if (this.buf.length < total) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buf = this.buf.subarray(total);
      this.alive = true;
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.writeFrame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) {
        if (fin) handleMessage(this, payload.toString('utf8'));
        else { this.fragOp = op; this.frag = [payload]; }
      } else if (op === 0x0) {
        this.frag.push(payload);
        if (fin) { const all = Buffer.concat(this.frag); this.frag = []; handleMessage(this, all.toString('utf8')); }
      }
    }
  }
}

function upgrade(req, socket) {
  const url = (req.url || '').split('?')[0];
  const key = req.headers['sec-websocket-key'];
  if (!/\/mp$/.test(url) || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  new WsConn(socket);
}

// ───────────────────────────── sondeo largo (alternativa) ─────────────────────────────

/** sid → PollConn */
const polls = new Map();

class PollConn extends Conn {
  constructor() {
    super('poll');
    this.sid = crypto.randomBytes(12).toString('hex');
    this.queue = [];
    this.waiting = null;
    this.seen = Date.now();
    polls.set(this.sid, this);
  }
  sendRaw(text) {
    if (this.closed) return;
    this.queue.push(text);
    if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
    this.flush();
  }
  flush() {
    if (!this.waiting || !this.queue.length) return;
    const res = this.waiting;
    this.waiting = null;
    clearTimeout(res._t);
    const body = '[' + this.queue.join(',') + ']';
    this.queue = [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    polls.delete(this.sid);
    if (this.waiting) { this.waiting.writeHead(410); this.waiting.end(); this.waiting = null; }
    leaveRoom(this);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const p of polls.values()) if (!p.waiting && now - p.seen > 40000) p.close();
}, 10000);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handlePoll(req, res) {
  const u = new URL(req.url || '/', 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  const op = (u.pathname.match(/\/mp\/(open|send|recv|close)$/) || [])[1];
  if (op === 'open' && req.method === 'POST') {
    const c = new PollConn();
    return json(200, { sid: c.sid });
  }
  const c = polls.get(u.searchParams.get('sid') || '');
  if (!c) return json(410, { t: 'gone' });
  c.seen = Date.now();
  if (op === 'send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, MAX_MSG); } catch { return json(413); }
    let arr;
    try { arr = JSON.parse(body); } catch { return json(400); }
    if (Array.isArray(arr)) for (const m of arr) handleMessage(c, typeof m === 'string' ? m : JSON.stringify(m));
    return json(200, { ok: true });
  }
  if (op === 'recv' && req.method === 'GET') {
    if (c.waiting) { c.waiting.writeHead(200, { 'Content-Type': 'application/json' }); c.waiting.end('[]'); }
    c.waiting = res;
    res._t = setTimeout(() => { if (c.waiting === res) { c.waiting = null; res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('[]'); } }, 25000);
    req.on('close', () => { if (c.waiting === res) { c.waiting = null; clearTimeout(res._t); } });
    c.flush();
    return;
  }
  if (op === 'close' && req.method === 'POST') { c.close(); return json(200, { ok: true }); }
  json(404);
}

// ───────────────────────────── servidor ─────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (/\/mp\/(open|send|recv|close)(\?|$)/.test(url)) {
    handlePoll(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* */ } });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
    return res.end();
  }
  if (/\/mp\/ice(\?|$)/.test(url)) {
    // servidores STUN/TURN para el chat de voz (configurables con variables de entorno)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: iceServers() }));
  }
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`ok · salas ${rooms.size}`);
  }
  if (url === '/slides') {
    res.writeHead(301, { Location: '/slides/', ...SECURITY_HEADERS });
    return res.end();
  }
  if (url.startsWith('/slides/')) {
    // presentación del TFM; no se exponen ficheros de trabajo de la carpeta
    const sub = url.slice('/slides'.length);
    if (/^\/(node_modules|package(-lock)?\.json|\.)|\/\.hyperframes\//.test(sub.split('?')[0])) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end('404');
    }
    return serveStatic(req, res, SLIDES_ROOT, sub);
  }
  serveStatic(req, res);
});

server.on('upgrade', upgrade);
server.keepAliveTimeout = 65000;

server.listen(PORT, HOST, () => {
  console.log(`MOP-13 listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (sirviendo ${ROOT}; multijugador en /mp)`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
