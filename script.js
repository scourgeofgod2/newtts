/* =============================================
   metinseslendirme.com — CortexAI TTS Client
   Asenkron polling (PROCESSING → FINISHED/FAILED)
   ============================================= */

'use strict';

// ── CONFIG ────────────────────────────────────────
const CONFIG = {
  CHAR_LIMIT:       40000,
  SUBMIT_ENDPOINT:  '/api/tts',
  POLL_ENDPOINT:    '/api/tts/poll',
  PROXY_ENDPOINT:   '/api/audio-proxy',
  POLL_INTERVAL_MS: 2000,   // her 2 sn'de bir sorgula
  POLL_MAX_TRIES:   60,     // max 120 sn bekle
};

// ── DOM REFS ──────────────────────────────────────
const textarea        = document.getElementById('tts-input');
const charNum         = document.getElementById('char-num');
const charMax         = document.getElementById('char-max');
const voiceIdInput    = document.getElementById('voice-id-input');
const stabilitySlider = document.getElementById('stability-slider');
const stabilityVal    = document.getElementById('stability-val');
const speedSlider     = document.getElementById('speed-slider');
const speedVal        = document.getElementById('speed-val');
const playBtn         = document.getElementById('btn-play');
const stopBtn         = document.getElementById('btn-stop');
const downloadBtn     = document.getElementById('btn-download');
const clearBtn        = document.getElementById('btn-clear');
const audioPlayerWrap = document.getElementById('audio-player-wrap');
const audioEl         = document.getElementById('tts-audio');
const playingBar      = document.getElementById('playing-bar');
const playingBarText  = document.getElementById('playing-bar-text');

// ── STATE ─────────────────────────────────────────
let pollTimer      = null;   // setInterval handle
let pollTries      = 0;
let currentTaskId  = null;
let currentBlobUrl = null;   // object URL used for download
let isProcessing   = false;

// ── CHAR COUNTER ──────────────────────────────────
function updateCharCount() {
  const len = textarea.value.length;
  charNum.textContent = len.toLocaleString('tr-TR');
  charMax.textContent = CONFIG.CHAR_LIMIT.toLocaleString('tr-TR');

  charNum.className = 'char-counter__num';
  if (len > CONFIG.CHAR_LIMIT * 0.85) charNum.classList.add('warning');
  if (len >= CONFIG.CHAR_LIMIT)       charNum.classList.add('danger');
}

textarea.addEventListener('input', updateCharCount);
textarea.addEventListener('paste', () => setTimeout(updateCharCount, 50));

// ── SLIDER LABELS ─────────────────────────────────
stabilitySlider.addEventListener('input', () => {
  const v = parseFloat(stabilitySlider.value).toFixed(2);
  stabilityVal.textContent = v;
  document.getElementById('stability-val-display').textContent = v;
});

speedSlider.addEventListener('input', () => {
  const v = parseFloat(speedSlider.value).toFixed(1);
  speedVal.textContent = v + 'x';
  document.getElementById('speed-val-display').textContent = v + 'x';
});

// ── MAIN SPEAK FLOW ───────────────────────────────
async function speak() {
  const rawText = textarea.value.trim();
  if (!rawText) { flashTextarea(); return; }
  if (rawText.length > CONFIG.CHAR_LIMIT) {
    showError(`Metin ${CONFIG.CHAR_LIMIT.toLocaleString('tr-TR')} karakter sınırını aşıyor.`);
    return;
  }

  abortPoll();
  resetAudio();
  setLoadingState(true, 'Hazırlanıyor…');

  try {
    // 1. Submit job
    const submitRes = await fetch(CONFIG.SUBMIT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:      rawText,
        voice_id:  voiceIdInput.value.trim(),
        stability: parseFloat(stabilitySlider.value),
        speed:     parseFloat(speedSlider.value),
      }),
    });

    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({ error: 'Bilinmeyen hata.' }));
      throw new Error(err.error || `HTTP ${submitRes.status}`);
    }

    const { taskId } = await submitRes.json();
    if (!taskId) throw new Error('Görev ID alınamadı.');

    currentTaskId = taskId;
    setLoadingState(true, 'İşleniyor…');
    startPolling(taskId);

  } catch (err) {
    setLoadingState(false);
    showError(err.message || 'Seslendirme başarısız. Lütfen tekrar deneyin.');
    console.error('[TTS Submit Error]', err);
  }
}

// ── POLLING ───────────────────────────────────────
function startPolling(taskId) {
  pollTries = 0;
  isProcessing = true;

  pollTimer = setInterval(async () => {
    if (!isProcessing) { clearInterval(pollTimer); return; }
    pollTries++;

    if (pollTries > CONFIG.POLL_MAX_TRIES) {
      abortPoll();
      setLoadingState(false);
      showError('Seslendirme zaman aşımına uğradı. Lütfen tekrar deneyin.');
      return;
    }

    try {
      const res = await fetch(`${CONFIG.POLL_ENDPOINT}/${encodeURIComponent(taskId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }

      const data = await res.json();

      if (data.status === 'FINISHED') {
        abortPoll();
        await handleAudioReady(data.audioUrl);

      } else if (data.status === 'FAILED') {
        abortPoll();
        setLoadingState(false);
        showError(data.error || 'Seslendirme başarısız oldu.');

      }
      // PROCESSING → continue polling

    } catch (err) {
      // Network hatalarında polling'i durdurmuyoruz, denemeye devam et
      console.warn('[Poll attempt error]', err);
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

function abortPoll() {
  isProcessing = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  currentTaskId = null;
}

// ── AUDIO READY ───────────────────────────────────
async function handleAudioReady(audioUrl) {
  try {
    // Proxy üzerinden çek (CORS + auth güvenliği)
    const proxyUrl = `${CONFIG.PROXY_ENDPOINT}?url=${encodeURIComponent(audioUrl)}`;
    const audioRes = await fetch(proxyUrl);

    if (!audioRes.ok) throw new Error(`Ses indirilemedi (HTTP ${audioRes.status})`);

    const blob = await audioRes.blob();

    // Önceki blob URL'ini temizle
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }
    currentBlobUrl = URL.createObjectURL(blob);

    // Oynatıcıyı güncelle
    audioEl.src = currentBlobUrl;
    audioPlayerWrap.classList.add('active');

    setLoadingState(false);
    downloadBtn.disabled = false;

    // Oynatmaya başla — autoplay bloklanırsa native <audio controls> görünür, kullanıcı tıklayabilir.
    audioEl.play().catch(() => {
      // Tarayıcı autoplay politikası engelledi — sessizce geç, native player gösterildi.
    });

  } catch (err) {
    setLoadingState(false);
    showError(err.message || 'Ses yüklenemedi.');
    console.error('[Audio Ready Error]', err);
  }
}

// ── STOP ──────────────────────────────────────────
function stopAll() {
  abortPoll();
  audioEl.pause();
  audioEl.currentTime = 0;
  setPlayingState(false);
  setLoadingState(false);
}

// ── RESET AUDIO ───────────────────────────────────
function resetAudio() {
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  audioPlayerWrap.classList.remove('active');
  downloadBtn.disabled = true;
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

// ── DOWNLOAD ──────────────────────────────────────
function downloadAudio() {
  if (!currentBlobUrl) return;
  const a = document.createElement('a');
  a.href     = currentBlobUrl;
  a.download = 'seslendirme.mp3';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── UI STATE HELPERS ──────────────────────────────
function setLoadingState(loading, msg = 'Hazırlanıyor…') {
  playBtn.disabled = loading;
  stopBtn.disabled = !loading;

  if (loading) {
    playBtn.innerHTML = `<span class="btn__icon">⏳</span> ${msg}`;
    playingBarText.textContent = msg;
    playingBar.classList.add('active');
    playingBar.style.borderColor = '';
    playingBar.style.background  = '';
    const waveEl = playingBar.querySelector('.playing-bar__waves');
    if (waveEl) waveEl.style.display = '';
  } else {
    playBtn.innerHTML = '<span class="btn__icon">▶</span> Seslendir';
    stopBtn.disabled  = true;
    if (!currentBlobUrl || audioEl.paused) {
      playingBar.classList.remove('active');
    }
  }
}

function setPlayingState(playing) {
  if (playing) {
    stopBtn.disabled  = false;
    playBtn.disabled  = true;
    playingBar.classList.add('active');
    playingBarText.textContent = 'Oynatılıyor…';
    playBtn.innerHTML = '<span class="btn__icon">⏸</span> Oynatılıyor…';
  } else {
    stopBtn.disabled  = true;
    playBtn.disabled  = false;
    playingBar.classList.remove('active');
    playBtn.innerHTML = '<span class="btn__icon">▶</span> Seslendir';
  }
}

function flashTextarea() {
  textarea.style.borderColor = 'var(--danger)';
  textarea.focus();
  setTimeout(() => { textarea.style.borderColor = ''; }, 800);
}

function showError(msg) {
  const waveEl = playingBar.querySelector('.playing-bar__waves');
  if (waveEl) waveEl.style.display = 'none';
  playingBarText.textContent    = '⚠ ' + msg;
  playingBar.style.borderColor  = 'var(--danger)';
  playingBar.style.background   = 'rgba(255,71,87,0.08)';
  playingBar.classList.add('active');
  stopBtn.disabled  = true;
  playBtn.disabled  = false;

  setTimeout(() => {
    playingBar.classList.remove('active');
    playingBar.style.borderColor = '';
    playingBar.style.background  = '';
    playingBarText.textContent   = 'Seslendiriliyor…';
    if (waveEl) waveEl.style.display = '';
  }, 5000);
}

// ── AUDIO ELEMENT EVENTS ──────────────────────────
audioEl.addEventListener('play',  () => setPlayingState(true));
audioEl.addEventListener('ended', () => setPlayingState(false));
audioEl.addEventListener('pause', () => setPlayingState(false));
audioEl.addEventListener('error', () => {
  if (!currentBlobUrl) return;
  setPlayingState(false);
  showError('Ses oynatılamadı. Lütfen tekrar deneyin.');
});

// ── BUTTON EVENTS ─────────────────────────────────
playBtn.addEventListener('click',     speak);
stopBtn.addEventListener('click',     stopAll);
downloadBtn.addEventListener('click', downloadAudio);
clearBtn.addEventListener('click',    () => {
  stopAll();
  resetAudio();
  textarea.value = '';
  updateCharCount();
  textarea.focus();
});

// ── KEYBOARD SHORTCUT ─────────────────────────────
textarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!isProcessing) speak();
  }
});

// ── FAQ ACCORDION ─────────────────────────────────
document.querySelectorAll('.faq-item__q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item   = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
    btn.setAttribute('aria-expanded', String(!isOpen));
  });
});

// ── INIT ──────────────────────────────────────────
updateCharCount();
stopBtn.disabled     = true;
downloadBtn.disabled = true;
charMax.textContent  = CONFIG.CHAR_LIMIT.toLocaleString('tr-TR');

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  abortPoll();
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
});
