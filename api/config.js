module.exports = async (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL || ""
  });
};
