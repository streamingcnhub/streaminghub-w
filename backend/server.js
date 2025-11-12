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

// Root -> domyślny plik (najpierw filmy.html, potem index.html)
app.get('/', (req, res) => {
  const defaultFiles = ['filmy.html', 'index.html'];
  for (const f of defaultFiles) {
    const p = path.join(PUBLIC_DIR, f);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(200).send('Brak domyślnego pliku w public/ (dodaj filmy.html lub index.html)');
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