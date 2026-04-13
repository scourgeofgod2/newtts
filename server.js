// server.js — metinseslendirme.com
// CortexAI (router.claude.gg) TTS proxy + static file server
// Deploy: Coolify (Node.js 18+)

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ────────────────────────────────────────
const CORTEXAI_API_KEY   = process.env.CORTEXAI_API_KEY;
const CORTEXAI_SUBMIT    = 'https://router.claude.gg/api/generate';
const CORTEXAI_POLL_BASE = 'https://router.claude.gg/get';
const MAX_CHARS          = 40000;

if (!CORTEXAI_API_KEY) {
  console.error('[ERROR] CORTEXAI_API_KEY is not set. Check your .env file.');
  process.exit(1);
}

// ── MIDDLEWARE ────────────────────────────────────
app.use(express.json({ limit: '256kb' }));

// ── TTS SUBMIT ────────────────────────────────────
// POST /api/tts
// Body : { text, voice_id?, stability?, speed? }
// Returns: { taskId }
app.post('/api/tts', async (req, res) => {
  const {
    text,
    voice_id  = '',
    stability = 0.5,
    speed     = 1.0,
  } = req.body ?? {};

  // Validation
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text alanı zorunlu.' });
  }
  if (text.trim().length === 0) {
    return res.status(400).json({ error: 'Metin boş olamaz.' });
  }
  if (text.length > MAX_CHARS) {
    return res.status(400).json({ error: `Metin ${MAX_CHARS} karakteri aşamaz.` });
  }

  // Build params — voice_id is optional
  const params = {
    text:      text.trim(),
    stability: Math.min(1, Math.max(0, parseFloat(stability) || 0.5)),
    speed:     Math.min(1.2, Math.max(0.7, parseFloat(speed) || 1.0)),
  };
  const trimmedVoiceId = String(voice_id).trim();
  if (trimmedVoiceId) {
    params.voice_id = trimmedVoiceId;
  }

  try {
    const apiRes = await fetch(CORTEXAI_SUBMIT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CORTEXAI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:  'voiceover',
        type:   'voiceover',
        params,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => '');
      console.error(`[CortexAI Submit Error] HTTP ${apiRes.status}: ${errBody}`);
      return res.status(502).json({
        error: 'Seslendirme servisi başlatılamadı. Lütfen tekrar deneyin.',
      });
    }

    const data = await apiRes.json();

    // API may return task_id, id, or taskId
    const taskId = data?.task_id ?? data?.id ?? data?.taskId ?? null;

    if (!taskId) {
      console.error('[CortexAI Submit] task_id bulunamadı. Yanıt:', JSON.stringify(data));
      return res.status(502).json({ error: 'Görev ID alınamadı. Lütfen tekrar deneyin.' });
    }

    return res.json({ taskId });

  } catch (err) {
    console.error('[Submit Error]', err);
    return res.status(500).json({ error: 'Sunucu hatası. Lütfen tekrar deneyin.' });
  }
});

// ── POLLING ENDPOINT ──────────────────────────────
// GET /api/tts/poll/:taskId
// Returns: { status: 'PROCESSING' | 'FINISHED' | 'FAILED', audioUrl?, error? }
app.get('/api/tts/poll/:taskId', async (req, res) => {
  const { taskId } = req.params;

  if (!taskId || !/^[\w\-]+$/.test(taskId)) {
    return res.status(400).json({ error: 'Geçersiz görev ID.' });
  }

  try {
    const pollRes = await fetch(`${CORTEXAI_POLL_BASE}/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${CORTEXAI_API_KEY}`,
      },
    });

    if (!pollRes.ok) {
      const errBody = await pollRes.text().catch(() => '');
      console.error(`[CortexAI Poll Error] HTTP ${pollRes.status}: ${errBody}`);
      return res.status(502).json({ error: 'Durum sorgulanamadı.' });
    }

    const data = await pollRes.json();
    const rawStatus = (data?.status || 'UNKNOWN').toUpperCase();

    // Map finished states
    if (['FINISHED', 'COMPLETED', 'SUCCESS', 'DONE'].includes(rawStatus)) {
      // Extract audio URL from various possible structures
      const result = data?.result;
      let audioUrl = null;

      if (Array.isArray(result) && result.length > 0) {
        const first = result[0];
        audioUrl = (typeof first === 'string') ? first : (first?.url ?? first?.audio_url ?? null);
      } else if (typeof result === 'string' && result.startsWith('http')) {
        audioUrl = result;
      } else if (data?.audio_url) {
        audioUrl = data.audio_url;
      } else if (data?.url) {
        audioUrl = data.url;
      }

      if (!audioUrl) {
        console.error('[CortexAI Poll] FINISHED ancak ses URL yok. Yanıt:', JSON.stringify(data));
        return res.json({ status: 'FAILED', error: 'Ses dosyası URL\'si bulunamadı.' });
      }

      return res.json({ status: 'FINISHED', audioUrl });
    }

    // Map failed states
    if (['FAILED', 'ERROR', 'CANCELLED'].includes(rawStatus)) {
      const errMsg = data?.error ?? data?.message ?? 'Seslendirme başarısız oldu.';
      return res.json({ status: 'FAILED', error: errMsg });
    }

    // Still processing
    return res.json({ status: 'PROCESSING' });

  } catch (err) {
    console.error('[Poll Error]', err);
    return res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// ── AUDIO PROXY ───────────────────────────────────
// GET /api/audio-proxy?url=...
// Streams the remote MP3 back to the browser (avoids CORS / auth issues)
app.get('/api/audio-proxy', async (req, res) => {
  const rawUrl = req.query.url;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'url parametresi zorunlu.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Geçersiz URL.' });
  }

  if (parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Sadece HTTPS URL kabul edilir.' });
  }

  try {
    const audioRes = await fetch(rawUrl);

    if (!audioRes.ok) {
      console.error(`[Audio Proxy] Upstream HTTP ${audioRes.status} for ${rawUrl}`);
      return res.status(502).json({ error: 'Ses dosyası indirilemedi.' });
    }

    const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const reader = audioRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    console.error('[Audio Proxy Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Ses proxy hatası.' });
    }
  }
});

// ── HEALTH CHECK ──────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── STATIC FILES ──────────────────────────────────
app.use(express.static(__dirname, {
  maxAge: '1d',
  etag: true,
  index: 'index.html',
}));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── START ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[metinseslendirme] Server running on http://localhost:${PORT}`);
});