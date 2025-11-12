const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAnon = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const supabaseServer = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      if (!supabaseAnon) return res.status(500).json({ error: 'Supabase anon not configured' });
      const { movie_id, user_id } = req.query;
      let q = supabaseAnon.from('ratings').select('*');
      if (movie_id) q = q.eq('movie_id', movie_id);
      if (user_id) q = q.eq('user_id', user_id);
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(user_id && movie_id ? (data[0] || null) : data);
    }

    if (req.method === 'POST') {
      if (!supabaseServer) return res.status(500).json({ error: 'Supabase server not configured' });
      const { movie_id, user_id, score } = req.body;
      if (!movie_id || !user_id || !score) return res.status(400).json({ error: 'movie_id, user_id, score required' });
      const { data, error } = await supabaseServer.from('ratings').upsert({ movie_id, user_id, score }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
};
