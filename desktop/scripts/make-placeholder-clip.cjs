/**
 * Generates desktop/resources/media/placeholder-lesson.webm (ADR 0019). Original work, no
 * third-party material and no new dependency: a canvas title card is encoded with WebCodecs VP8
 * inside a hidden Electron window and muxed by the small EBML writer below, with a known Duration
 * and Cues before the Clusters so the clip seeks reliably (MediaRecorder output does neither).
 *
 * Run once, commit the output:   npx electron desktop/scripts/make-placeholder-clip.cjs
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'resources', 'media', 'placeholder-lesson.webm');
const WIDTH = 480;
const HEIGHT = 270;
const FPS = 10;
const SECONDS = 8;
const KEY_EVERY = FPS; // a keyframe each second: one Cluster and one Cue per second

// ---- encode in the renderer -------------------------------------------------------------------
const encodeInPage = `(async () => {
  const W = ${WIDTH}, H = ${HEIGHT}, FPS = ${FPS}, N = ${FPS * SECONDS}, KEY = ${KEY_EVERY};
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      chunks.push({ key: chunk.type === 'key', ts: chunk.timestamp, b64: btoa(s) });
    },
    error: (e) => { throw e; },
  });
  const config = { codec: 'vp8', width: W, height: H, bitrate: 120000, framerate: FPS };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error('VP8 encoding is not supported');
  encoder.configure(config);
  for (let i = 0; i < N; i++) {
    ctx.fillStyle = '#0d1424';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#16213a';
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = '#e8edf7';
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('Lesson video placeholder', W / 2, H / 2 - 12);
    ctx.fillStyle = '#9fb0cf';
    ctx.font = '16px sans-serif';
    ctx.fillText('CSense bundled media pack', W / 2, H / 2 + 22);
    ctx.fillText(Math.floor(i / FPS) + 's of ' + (N / FPS) + 's', W / 2, H / 2 + 50);
    ctx.fillStyle = '#16213a';
    ctx.fillRect(60, H - 52, W - 120, 8);
    ctx.fillStyle = '#4da3ff';
    ctx.fillRect(60, H - 52, ((W - 120) * (i + 1)) / N, 8);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS) });
    encoder.encode(frame, { keyFrame: i % KEY === 0 });
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  return chunks;
})()`;

// ---- EBML writer ------------------------------------------------------------------------------
function vint(n) {
  // Sizes always use 4 bytes so lengths are predictable.
  if (n >= 0x0fffffff) throw new Error('size too large');
  return Buffer.from([0x10 | ((n >> 24) & 0x0f), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
const el = (id, payload) => Buffer.concat([Buffer.from(id, 'hex'), vint(payload.length), payload]);
const uint = (id, n, width) => {
  const b = Buffer.alloc(width);
  b.writeUIntBE(n, 0, width);
  return el(id, b);
};
const str = (id, s) => el(id, Buffer.from(s, 'ascii'));
const f64 = (id, n) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return el(id, b);
};

function mux(chunks) {
  const header = el(
    '1A45DFA3',
    Buffer.concat([
      uint('4286', 1, 1),
      uint('42F7', 1, 1),
      uint('42F2', 4, 1),
      uint('42F3', 8, 1),
      str('4282', 'webm'),
      uint('4287', 4, 1),
      uint('4285', 2, 1),
    ]),
  );
  const info = el(
    '1549A966',
    Buffer.concat([
      uint('2AD7B1', 1_000_000, 4),
      f64('4489', (chunks.length * 1000) / FPS),
      str('4D80', 'csense-media-pack'),
      str('5741', 'csense-media-pack'),
    ]),
  );
  const tracks = el(
    '1654AE6B',
    el(
      'AE',
      Buffer.concat([
        uint('D7', 1, 1),
        uint('73C5', 1, 1),
        uint('83', 1, 1),
        uint('9C', 0, 1),
        str('86', 'V_VP8'),
        el('E0', Buffer.concat([uint('B0', WIDTH, 2), uint('BA', HEIGHT, 2)])),
      ]),
    ),
  );

  // Group the chunks into clusters at each keyframe.
  const groups = [];
  for (const c of chunks) {
    if (c.key) groups.push([]);
    groups[groups.length - 1].push(c);
  }
  const clusters = groups.map((g) => {
    const t0 = Math.round(g[0].ts / 1000);
    const blocks = g.map((c) => {
      const rel = Math.round(c.ts / 1000) - t0;
      const head = Buffer.alloc(4);
      head[0] = 0x81; // track 1
      head.writeInt16BE(rel, 1);
      head[3] = c.key ? 0x80 : 0x00;
      return el('A3', Buffer.concat([head, Buffer.from(c.b64, 'base64')]));
    });
    return { t0, buf: el('1F43B675', Buffer.concat([uint('E7', t0, 4), ...blocks])) };
  });

  // Cues sit before the clusters; their size is fixed (4-byte positions), so offsets are known.
  const cueSize = el('1C53BB6B', Buffer.concat(clusters.map(() => cuePoint(0, 0)))).length;
  let offset = info.length + tracks.length + cueSize;
  const cuePoints = clusters.map((c) => {
    const p = cuePoint(c.t0, offset);
    offset += c.buf.length;
    return p;
  });
  const cues = el('1C53BB6B', Buffer.concat(cuePoints));
  if (cues.length !== cueSize) throw new Error('cue size drifted');
  const segment = el(
    '18538067',
    Buffer.concat([info, tracks, cues, ...clusters.map((c) => c.buf)]),
  );
  return Buffer.concat([header, segment]);
}

function cuePoint(timeMs, clusterPos) {
  return el(
    'BB',
    Buffer.concat([
      uint('B3', timeMs, 4),
      el('B7', Buffer.concat([uint('F7', 1, 1), uint('F1', clusterPos, 4)])),
    ]),
  );
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    // WebCodecs needs a secure context; a file:// page qualifies, a data: URL does not.
    const page = join(mkdtempSync(join(tmpdir(), 'csense-clip-')), 'blank.html');
    writeFileSync(page, '<!doctype html><title>clip</title>');
    await win.loadFile(page);
    const chunks = await win.webContents.executeJavaScript(encodeInPage);
    const file = mux(chunks);
    mkdirSync(join(__dirname, '..', 'resources', 'media'), { recursive: true });
    writeFileSync(OUT, file);
    process.stdout.write(`wrote ${OUT} (${file.length} bytes, ${chunks.length} frames)\n`);
    app.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`failed: ${String(err && err.stack ? err.stack : err)}\n`);
    app.exit(1);
  });
