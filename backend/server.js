// Załaduj zmienne środowiskowe z .env (lokalnie)
require('dotenv').config();

// Supabase server client (używaj tylko na backendzie)
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseServer = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseServer = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('Supabase server client initialized');
} else {
  console.log('Supabase server keys missing; server client not initialized');
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Now also consider repository root (one level up from backend)
const REPO_ROOT = path.join(__dirname, '..'); // np. /workspaces/streaminghub-w
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');

// Ensure public dir exists (repo root exists by default)
if (!fs.existsSync(PUBLIC_DIR)) {
  // don't create repo root — tylko public jak trzeba
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// helper promises
function run(sql, params=[]) { return new Promise((res, rej) => db.run(sql, params, function(err){ if(err) rej(err); else res({id:this.lastID, changes:this.changes}); })); }
function all(sql, params=[]) { return new Promise((res, rej) => db.all(sql, params, (e,rows)=> e?rej(e):res(rows))); }
function get(sql, params=[]) { return new Promise((res, rej) => db.get(sql, params, (e,row)=> e?rej(e):res(row))); }

// Init tables (films, series, users, library, friends) - dopasuj kolumny do Twoich potrzeb
(async function initDB(){
  await run(`CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await run(`CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT, -- hashuj w produkcji
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await run(`CREATE TABLE IF NOT EXISTS library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    item_type TEXT, -- 'film'|'series'
    item_id INTEGER,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    friend_user_id INTEGER,
    status TEXT DEFAULT 'accepted'
  );`);
})().catch(err => { console.error('DB init error', err); });

// Helper: sprawdź czy plik istnieje w jednym z dostarczonych katalogów
function findFileInDirs(relativePath, dirs) {
  for (const d of dirs) {
    try {
      const p = path.join(d, relativePath);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// Blokuj bezpośredni dostęp do ukrytego katalogu — przekieruj na root
app.use((req, res, next) => {
  if (req.path.startsWith('/_hidden/') || req.path === '/_hidden' ) {
    return res.redirect(301, '/');
  }
  next();
});

// Redirect starych linków /public/* -> /*
app.use((req, res, next) => {
  if (req.path.startsWith('/public/')) {
    const newPath = req.path.replace(/^\/public/, '') || '/';
    return res.redirect(301, newPath + (req.url.includes('?') ? ('?' + req.url.split('?').slice(1).join('?')) : ''));
  }
  next();
});

// --- NOWE: obsługa "czystych" URL bez .html ---
// 1) jeśli żądanie kończy się na .html -> przekieruj na wersję bez .html
// 2) jeśli żądanie nie ma rozszerzenia -> sprawdź czy istnieje odpowiadający plik .html i podaj go
app.use((req, res, next) => {
  // Nie manipulujemy API ani zasobami z rozszerzeniami
  if (req.path.startsWith('/api/') || path.extname(req.path)) return next();

  // 1) redirect from /file.html -> /file
  if (req.path.endsWith('.html')) {
    const clean = req.path.replace(/\.html$/, '') || '/';
    return res.redirect(301, clean + (req.url.includes('?') ? ('?' + req.url.split('?').slice(1).join('?')) : ''));
  }

  // 2) serve /file -> try repo-root/file.html then public/file.html
  const relative = req.path === '/' ? '' : req.path.replace(/^\//, '');
  if (req.path === '/') return next(); // root handled later

  const candidateRel = relative + '.html';
  const found = findFileInDirs(candidateRel, [REPO_ROOT, PUBLIC_DIR]);
  if (found) return res.sendFile(found);

  next();
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public as before
app.use(express.static(PUBLIC_DIR, {
  index: false,
}));

// Root handler: najpierw ukryty index w public/_hidden, potem repo-root filmy/index.html, potem public filmy/index.html, potem rekurencyjnie
app.get('/', (req, res) => {
  // 1) hidden index w public/_hidden/index.html
  const hiddenIndex = path.join(PUBLIC_DIR, '_hidden', 'index.html');
  if (fs.existsSync(hiddenIndex)) return res.sendFile(hiddenIndex);

  // 2) szukaj konkretnych nazw w repo root, potem public (rekurencyjnie)
  const candidates = ['filmy.html', 'index.html'];
  for (const name of candidates) {
    // bez rekurencji: najpierw root/name, potem public/name
    const f = findFileInDirs(name, [REPO_ROOT, PUBLIC_DIR]);
    if (f) return res.sendFile(f);
  }

  // 3) znajdź dowolny .html rekurencyjnie w repo root, potem public
  function findAnyHtmlRec(dirs) {
    for (const d of dirs) {
      const result = (function search(dir){
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isFile() && path.extname(e.name).toLowerCase() === '.html') return full;
          if (e.isDirectory()) {
            const found = search(full);
            if (found) return found;
          }
        }
        return null;
      })(d);
      if (result) return result;
    }
    return null;
  }

  const anyHtml = findAnyHtmlRec([REPO_ROOT, PUBLIC_DIR]);
  if (anyHtml) return res.sendFile(anyHtml);

  res.status(200).send('Brak domyślnego pliku HTML w repo root ani w public/ (dodaj filmy.html lub index.html).');
});

// API endpoints
app.get('/api/items', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM items ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const row = await get('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = await run('INSERT INTO items (title, content) VALUES (?, ?)', [title, content || null]);
    const item = await get('SELECT * FROM items WHERE id = ?', [result.id]);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const { title, content } = req.body;
    await run('UPDATE items SET title = ?, content = ? WHERE id = ?', [title, content, req.params.id]);
    const item = await get('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    await run('DELETE FROM items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// API: listy / CRUD minimalne
app.get('/api/films', async (req,res)=>{
  try{ const rows = await all('SELECT * FROM films ORDER BY created_at DESC'); res.json(rows); } catch(e){ res.status(500).json({error:'DB'}); }
});
app.post('/api/films', async (req,res)=>{ // zabezpiecz auth później
  try{ const {title,description,url} = req.body; if(!title) return res.status(400).json({error:'title required'}); const r = await run('INSERT INTO films (title,description,url) VALUES (?,?,?)',[title,description||'',url||'']); const row = await get('SELECT * FROM films WHERE id = ?',[r.id]); res.status(201).json(row); } catch(e){ res.status(500).json({error:'DB'}); }
});

app.get('/api/series', async (req,res)=>{
  try{ const rows = await all('SELECT * FROM series ORDER BY created_at DESC'); res.json(rows); } catch(e){ res.status(500).json({error:'DB'}); }
});
app.post('/api/series', async (req,res)=>{
  try{ const {title,description} = req.body; if(!title) return res.status(400).json({error:'title required'}); const r = await run('INSERT INTO series (title,description) VALUES (?,?)',[title,description||'']); const row = await get('SELECT * FROM series WHERE id = ?',[r.id]); res.status(201).json(row); } catch(e){ res.status(500).json({error:'DB'}); }
});

// Simple auth (demo) - returns user object; in production użyj hash + JWT
app.post('/api/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({ error: 'username/password required' });
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if(!user){
      // auto-register for convenience (demo only)
      const r = await run('INSERT INTO users (username, password) VALUES (?,?)',[username, password]);
      const newUser = await get('SELECT * FROM users WHERE id = ?',[r.id]);
      return res.json({ user: newUser, token: 'demo-token' });
    }
    if(user.password !== password) return res.status(401).json({ error: 'invalid credentials' });
    res.json({ user, token: 'demo-token' });
  } catch(e){ res.status(500).json({ error: 'DB' }); }
});

// Library for logged user (demo: user_id passed as query or from token)
app.get('/api/library', async (req,res)=>{
  try{
    const userId = req.query.user_id || 1;
    const rows = await all('SELECT * FROM library WHERE user_id = ? ORDER BY added_at DESC',[userId]);
    res.json(rows);
  } catch(e){ res.status(500).json({error:'DB'}); }
});

// Friends list
app.get('/api/friends', async (req,res)=>{
  try{
    const userId = req.query.user_id || 1;
    const rows = await all('SELECT f.*, u.username as friend_username FROM friends f LEFT JOIN users u ON u.id = f.friend_user_id WHERE f.user_id = ?',[userId]);
    res.json(rows);
  } catch(e){ res.status(500).json({error:'DB'}); }
});

// Przykład użycia Supabase w endpointzie:
app.post('/api/admin/add-film', async (req, res) => {
  if (!supabaseServer) return res.status(500).json({ error: 'Supabase not configured' });
  const { title, description, url } = req.body;
  try {
    const { data, error } = await supabaseServer
      .from('films')
      .insert([{ title, description, url }]);
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

// SPA fallback: jeśli plik nie znaleziony, zwróć 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Serving static from ${PUBLIC_DIR}`);
});