const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Now also consider repository root (one level up from backend)
const REPO_ROOT = path.join(__dirname, '..'); // np. /workspaces/streaminghub-w

// Ensure public dir exists (repo root exists by default)
if (!fs.existsSync(PUBLIC_DIR)) {
  // don't create repo root — tylko public jak trzeba
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

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

// SPA fallback: jeśli plik nie znaleziony, zwróć 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Serving static from ${PUBLIC_DIR}`);
});