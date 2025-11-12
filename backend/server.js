const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Ensure public dir exists
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// new: ścieżka do ukrytego katalogu i pliku index w nim
const HIDDEN_DIR = path.join(PUBLIC_DIR, '_hidden'); // możesz użyć '_hidden' lub 'pages'
const HIDDEN_INDEX = path.join(HIDDEN_DIR, 'index.html');

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

  // 2) serve /file -> public/file.html if exists
  const requested = req.path === '/' ? '' : req.path;
  const candidate = path.join(PUBLIC_DIR, requested + '.html');
  if (fs.existsSync(candidate)) {
    return res.sendFile(candidate);
  }

  next();
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public as root
app.use(express.static(PUBLIC_DIR, {
  index: false, // kontrolujemy index ręcznie
}));

// helper: znajdź plik rekurencyjnie w PUBLIC_DIR pasujący na jedną z nazw
function findFileRecursive(dir, candidates) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      if (candidates.includes(e.name)) return full;
    } else if (e.isDirectory()) {
      const found = findFileRecursive(full, candidates);
      if (found) return found;
    }
  }
  return null;
}

// helper: znajdź pierwszy plik .html rekurencyjnie
function findAnyHtml(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && path.extname(e.name).toLowerCase() === '.html') return full;
    if (e.isDirectory()) {
      const found = findAnyHtml(full);
      if (found) return found;
    }
  }
  return null;
}

// --- Root -> domyślny plik (szuka rekurencyjnie: filmy.html, index.html, potem dowolny .html)
app.get('/', (req, res) => {
  // jeśli istnieje ukryty index -> zwróć go
  if (fs.existsSync(HIDDEN_INDEX)) {
    return res.sendFile(HIDDEN_INDEX);
  }

  // dotychczasowa logika: szukaj filmy.html, index.html rekurencyjnie, potem pierwszy .html
  const defaultFiles = ['filmy.html', 'index.html'];
  // najpierw szukamy konkretnych nazw rekurencyjnie
  const found = findFileRecursive(PUBLIC_DIR, defaultFiles);
  if (found) return res.sendFile(found);

  // jeśli nic nie znaleziono, zwróć pierwszy napotkany plik .html
  const anyHtml = findAnyHtml(PUBLIC_DIR);
  if (anyHtml) return res.sendFile(anyHtml);

  // fallback: informacja o braku plików
  res.status(200).send('Brak domyślnego pliku w public/ (dodaj filmy.html lub index.html w public/ lub podkatalogach)');
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