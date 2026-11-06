// Exports: STL (3D print), video (MP4/WebM) and animated GIF of the rotating skyline.
// Heavy libraries are loaded only when the user asks for an export.

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

export const VIDEO_FORMATS = {
  story: { label: 'Story 9:16', w: 1080, h: 1920 },
  square: { label: 'Square 1:1', w: 1080, h: 1080 },
  wide: { label: 'Wide 16:9', w: 1920, h: 1080 },
};

/* ------------------------------------------------------------------ STL */

export async function exportSTL(skyline) {
  const root = await skyline.buildPrintable();
  if (!root) throw new Error('Nothing to export');
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
  const data = new STLExporter().parse(root, { binary: true });
  return new Blob([data], { type: 'model/stl' });
}

/* ------------------------------------------------------------------ overlay */

/** Name and numbers drawn on top of video / GIF frames. */
export function drawOverlay(ctx, w, h, info, pal) {
  const s = Math.min(w, h) / 1080;
  const portrait = h > w;
  const pad = 64 * s;
  const grad = ctx.createLinearGradient(0, 0, 0, h * (portrait ? 0.32 : 0.4));
  grad.addColorStop(0, pal.bg);
  grad.addColorStop(1, pal.bg + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * (portrait ? 0.32 : 0.4));

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.muted;
  ctx.font = `500 ${34 * s}px ${FONT}`;
  ctx.fillText(`@${info.login}`, pad, pad + 34 * s);
  ctx.fillStyle = pal.text;
  ctx.font = `700 ${(portrait ? 120 : 96) * s}px ${FONT}`;
  ctx.fillText(info.total, pad - 4 * s, pad + (portrait ? 160 : 136) * s);
  ctx.fillStyle = pal.muted;
  ctx.font = `500 ${32 * s}px ${FONT}`;
  ctx.fillText(info.subtitle, pad, pad + (portrait ? 212 : 184) * s);

  ctx.textAlign = 'right';
  ctx.font = `600 ${26 * s}px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(info.site, w - pad, h - pad * 0.8);
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------ video */

export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

export function canRecordVideo() {
  return Boolean(pickVideoMime() && HTMLCanvasElement.prototype.captureStream);
}

/**
 * Records one full turn of the skyline. Real-time: takes `seconds` to record.
 * onProgress(0..1) is called while recording.
 */
export async function recordVideo(skyline, { format = 'story', seconds = 6, info, palette, onProgress, signal } = {}) {
  const mime = pickVideoMime();
  if (!mime) throw new Error('Video recording is not supported in this browser');
  const { w, h } = VIDEO_FORMATS[format] || VIDEO_FORMATS.story;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  const stream = out.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  skyline.beginCapture(w, h);
  try {
    const draw = (t) => {
      const frame = skyline.captureFrame(t);
      ctx.drawImage(frame, 0, 0, w, h);
      drawOverlay(ctx, w, h, info, palette);
    };
    draw(0);
    recorder.start(250);
    const start = performance.now();
    const duration = seconds * 1000;
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal && signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const t = Math.min(1, (performance.now() - start) / duration);
        draw(t);
        onProgress?.(t);
        if (t >= 1) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    recorder.stop();
    await stopped;
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    skyline.endCapture();
  }
  const type = mime.split(';')[0];
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' };
}

/* ------------------------------------------------------------------ GIF */

export async function recordGIF(skyline, { width = 640, height = 360, frames = 60, delay = 60, info, palette, onProgress, signal } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  // Render the 3D view at 2x and downscale for smoother edges
  skyline.beginCapture(width * 2, height * 2);
  try {
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const frame = skyline.captureFrame(i / frames);
      ctx.drawImage(frame, 0, 0, width, height);
      drawOverlay(ctx, width, height, info, palette);
      const { data } = ctx.getImageData(0, 0, width, height);
      const pal = quantize(data, 256);
      const index = applyPalette(data, pal);
      gif.writeFrame(index, width, height, { palette: pal, delay });
      onProgress?.((i + 1) / frames);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
  } finally {
    skyline.endCapture();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
