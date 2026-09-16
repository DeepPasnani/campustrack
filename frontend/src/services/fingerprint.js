import api from './api';

function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('CampusTrack™', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('FP', 4, 35);
    return canvas.toDataURL();
  } catch {
    return 'canvas-unavailable';
  }
}

function getFontFingerprint() {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testFonts = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria',
    'Comic Sans MS', 'Courier New', 'Georgia', 'Helvetica', 'Impact',
    'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype',
    'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  ];
  const detected = [];
  const testString = 'mmMWWabcdefghijklmnopqrstuvwxyz0123456789';
  const testSize = '72px';

  const body = document.body;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;overflow:hidden;width:0;height:0;';
  body.appendChild(container);

  for (const base of baseFonts) {
    const span = document.createElement('span');
    span.style.cssText = `font-family:${base};font-size:${testSize}`;
    span.textContent = testString;
    container.appendChild(span);

    const baseWidth = span.offsetWidth;
    const baseHeight = span.offsetHeight;

    for (const font of testFonts) {
      span.style.cssText = `font-family:${font},${base};font-size:${testSize}`;
      if (span.offsetWidth !== baseWidth || span.offsetHeight !== baseHeight) {
        detected.push(font);
      }
    }
    container.removeChild(span);
  }
  body.removeChild(container);
  return detected;
}

export function generateFingerprint() {
  const canvasFP = getCanvasFingerprint();
  const fonts = getFontFingerprint();
  const resolution = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;

  const fp = {
    screen: resolution,
    availScreen: `${window.screen.availWidth}x${window.screen.availHeight}`,
    colorDepth: window.screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: navigator.languages || [],
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    webglRenderer: '',
    canvasFingerprint: canvasFP,
    fonts: fonts,
  };

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        fp.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }
    }
  } catch {
    fp.webglRenderer = 'unavailable';
  }

  return fp;
}

function normalizeFingerprint(fp) {
  const stable = { ...fp };
  delete stable.userAgent;
  return stable;
}

let previousFingerprint = null;

export const fingerprintService = {
  async send(submissionId) {
    const fp = generateFingerprint();
    previousFingerprint = normalizeFingerprint(fp);
    try {
      const result = await api.post('/submissions/fingerprint', {
        submissionId,
        fingerprint: fp,
      });
      return result.data;
    } catch {
      return null;
    }
  },

  async verify(submissionId) {
    const fp = generateFingerprint();
    const normalized = normalizeFingerprint(fp);
    let changed = false;

    if (previousFingerprint) {
      const prev = JSON.stringify(previousFingerprint);
      const curr = JSON.stringify(normalized);
      if (prev !== curr) {
        changed = true;
      }
    }
    previousFingerprint = normalized;

    try {
      const result = await api.post('/submissions/fingerprint/verify', {
        submissionId,
        fingerprint: fp,
        previousFingerprint: previousFingerprint,
      });
      return { ...result.data, changed };
    } catch {
      return { valid: false, changed };
    }
  },
};
