// File uploads via Supabase Storage. Vercel (and most serverless hosts) have a read-only, ephemeral
// filesystem, so product images can't be saved to local disk the way a traditional server could — they
// have to land in real object storage instead.
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'product-images';
let client = null;

function getClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Image uploads are not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  client = createClient(url, key);
  return client;
}

// Uploads a single in-memory file (from multer's memoryStorage) and returns its public URL.
async function uploadImage(file) {
  const supabase = getClient();
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`;
  const { error } = await supabase.storage.from(BUCKET).upload(name, file.buffer, {
    contentType: file.mimetype,
    cacheControl: '31536000', // product photos are immutable once uploaded — cache for a year
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
}

module.exports = { uploadImage };
