'use strict';

/* ── Brand Studio tab: import branding, live preview, brand.json + icons ───
   Color math comes from palette.js (the hand-port of app/src/brandPalette.ts)
   so the preview and contrast warnings match exactly what the mobile app will
   render. Old inline helpers → ported names:
     parseHex → parseColor · normHex → normalizeHex · luminance →
     relativeLuminance · contrast → contrastRatio · mixHex → mix ·
     onColorFor → onColor */

import { el, escapeHtml, toast } from './ui.js';
import { API, getJson } from './api.js';
import { normalizeHex, relativeLuminance, contrastRatio, mix, onColor } from './palette.js';

const studio = { colors: {}, candidates: [], logos: [], selectedLogo: null };

export function wireStudio() {
  el('studio-import-btn').addEventListener('click', importFromWebsite);
  el('studio-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') importFromWebsite(); });

  // Keep each color's picker <-> hex text in sync and refresh the preview.
  ['primary', 'secondary', 'accent'].forEach((key) => {
    const text = el(`studio-${key}`);
    const picker = el(`studio-${key}-picker`);
    text.addEventListener('input', () => { const n = normalizeHex(text.value); if (n) picker.value = n; updateStudio(); });
    picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); updateStudio(); });
  });
  ['studio-name', 'studio-id', 'studio-short', 'studio-privacy', 'studio-terms'].forEach((id) => {
    el(id).addEventListener('input', updateStudio);
  });
  el('studio-font').addEventListener('change', updateStudio);

  el('cand-primary').addEventListener('click', (e) => pickCandidate(e, 'primary'));
  el('cand-secondary').addEventListener('click', (e) => pickCandidate(e, 'secondary'));
  el('cand-accent').addEventListener('click', (e) => pickCandidate(e, 'accent'));
  el('logo-candidates').addEventListener('click', (e) => {
    const img = e.target.closest('.logo-thumb');
    if (!img) return;
    selectLogo(img.dataset.url);
    updateStudio();
  });

  // Icon generator controls.
  const bgText = el('icon-bg'); const bgPicker = el('icon-bg-picker');
  bgText.addEventListener('input', () => { const n = normalizeHex(bgText.value); if (n) bgPicker.value = n; regenIcons(); });
  bgPicker.addEventListener('input', () => { bgText.value = bgPicker.value.toUpperCase(); regenIcons(); });
  el('icon-scale').addEventListener('input', regenIcons);
  el('download-icon-btn').addEventListener('click', () => downloadCanvas('icon-canvas', 'icon.png'));
  el('download-splash-btn').addEventListener('click', () => downloadCanvas('splash-canvas', 'splash.png'));
  el('contrast-note').addEventListener('click', (e) => { if (e.target.closest('#fix-contrast-btn')) fixPrimaryContrast(); });

  el('studio-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(el('studio-json').value).then(
      () => toast('brand.json copied.', 'success'),
      () => toast('Copy failed — select the text manually.', 'error'));
  });
  el('studio-download-btn').addEventListener('click', downloadBrandJson);
}

function pickCandidate(e, key) {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  el(`studio-${key}`).value = sw.dataset.color;
  el(`studio-${key}-picker`).value = sw.dataset.color;
  updateStudio();
}

function slugify(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function importFromWebsite() {
  const url = el('studio-url').value.trim();
  if (!url) { toast('Enter a website URL.', 'error'); return; }
  const btn = el('studio-import-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  el('studio-warnings').innerHTML = '';
  try {
    const data = await getJson(`/api/brands/extract?url=${encodeURIComponent(url)}`);
    if (data.companyName) {
      el('studio-name').value = data.companyName;
      el('studio-short').value = data.companyName.split(/\s+/)[0];
      el('studio-id').value = slugify(data.companyName);
    }
    if (data.primary) { el('studio-primary').value = data.primary; el('studio-primary-picker').value = data.primary; }
    if (data.secondary) { el('studio-secondary').value = data.secondary; el('studio-secondary-picker').value = data.secondary; }
    if (data.accent) { el('studio-accent').value = data.accent; el('studio-accent-picker').value = data.accent; }
    if (data.privacyPolicyUrl) el('studio-privacy').value = data.privacyPolicyUrl;
    if (data.termsUrl) el('studio-terms').value = data.termsUrl;

    renderCandidates('cand-primary', data.colorCandidates);
    renderCandidates('cand-secondary', data.colorCandidates);
    renderCandidates('cand-accent', data.colorCandidates);
    renderLogos(data.logoCandidates || []);
    renderFonts(data.fonts || []);
    if ((data.logoCandidates || []).length) selectLogo(data.logoCandidates[0]);

    (data.warnings || []).forEach((w) => {
      const div = document.createElement('div');
      div.className = 'warn-banner';
      div.textContent = w;
      el('studio-warnings').appendChild(div);
    });
    updateStudio();
    toast('Imported. Review and adjust below.', 'success');
  } catch (err) {
    toast(err.message || 'Import failed.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Import';
  }
}

function renderCandidates(hostId, colors) {
  el(hostId).innerHTML = (colors || []).map((c) =>
    `<span class="swatch" data-color="${escapeHtml(c)}" title="${escapeHtml(c)}"></span>`).join('');
  // Swatch fill is a dynamic value → set via CSSOM (allowed under CSP).
  Array.from(el(hostId).children).forEach((sw) => { sw.style.background = sw.dataset.color; });
}

function renderLogos(logos) {
  studio.logos = logos;
  const host = el('logo-candidates');
  if (!logos.length) { host.innerHTML = '<span class="muted">No logos found — upload one manually.</span>'; return; }
  host.innerHTML = logos.map((u) =>
    `<img class="logo-thumb" data-url="${escapeHtml(u)}" src="${escapeHtml(u)}" alt="logo option">`).join('');
}

const BUNDLED_FONTS = ['Inter', 'Poppins', 'Montserrat'];

function mapDetectedFont(fonts) {
  for (const f of fonts) {
    const hit = BUNDLED_FONTS.find((b) => f.toLowerCase().includes(b.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function renderFonts(fonts) {
  const mapped = mapDetectedFont(fonts || []);
  if (mapped) el('studio-font').value = mapped;
  el('studio-fonts').innerHTML = (fonts && fonts.length)
    ? `Detected on site: ${fonts.map(escapeHtml).join(', ')}` +
      (mapped ? ` → using <b>${escapeHtml(mapped)}</b>` : ' (no bundled match — using System)')
    : '';
}

function currentStudioColors() {
  const primary = normalizeHex(el('studio-primary').value) || '#FCA004';
  const secondary = normalizeHex(el('studio-secondary').value) || '#0A4FA6';
  const accent = normalizeHex(el('studio-accent').value) || '#FDD314';
  return { primary, secondary, accent };
}

export function updateStudio() {
  const { primary, secondary, accent } = currentStudioColors();
  const onPrimary = onColor(primary);
  const onAccent = onColor(accent);
  const name = el('studio-name').value.trim() || 'Your app';

  // Live preview.
  const font = el('studio-font').value;
  el('app-preview').style.fontFamily = font === 'System' ? '' : `'${font}', sans-serif`;
  el('ap-appname').textContent = name;
  el('ap-header').style.background = primary;
  el('ap-appname').style.color = onPrimary;
  const btn = el('ap-btn');
  btn.style.background = primary; btn.style.color = onPrimary;
  const chip = el('ap-chip');
  chip.style.background = mix('#FFFFFF', accent, 0.85); chip.style.color = onColor(mix('#FFFFFF', accent, 0.85));
  el('ap-link').style.color = secondary;

  // Palette strip.
  const cells = [
    ['primary', primary, onPrimary], ['on', onPrimary, primary],
    ['secondary', secondary, onColor(secondary)], ['accent', accent, onAccent],
  ];
  el('palette-strip').innerHTML = cells.map(([label, bg, fg]) =>
    `<div class="palette-cell" data-bg="${escapeHtml(bg)}" data-fg="${escapeHtml(fg)}">${escapeHtml(label)}</div>`).join('');
  Array.from(el('palette-strip').children).forEach((c) => { c.style.background = c.dataset.bg; c.style.color = c.dataset.fg; });

  // Contrast guidance.
  const ratio = contrastRatio(onPrimary, primary);
  const note = el('contrast-note');
  if (ratio >= 4.5) {
    note.innerHTML = `<span class="ok">✓ Primary carries accessible text (${ratio.toFixed(1)}:1).</span>`;
  } else {
    note.innerHTML =
      `<span class="warn">⚠ Text on the primary is only ${ratio.toFixed(1)}:1 (AA needs 4.5).</span> ` +
      `<button class="link-btn" id="fix-contrast-btn" type="button">Darken to AA</button>`;
  }

  // Default the icon background to a deep brand tone until the operator sets one.
  if (!el('icon-bg').value) {
    const bg = mix(secondary, '#000000', 0.35);
    el('icon-bg').value = bg;
    el('icon-bg-picker').value = bg;
  }
  regenIcons();

  el('studio-json').value = buildBrandJson();
}

// Nudges the primary darker (or lighter) until white/dark text clears AA, then
// writes it back — a one-click fix for the contrast warning.
function fixPrimaryContrast() {
  let primary = currentStudioColors().primary;
  const goDark = relativeLuminance(primary) > 0.35; // bright color → darken for white text
  for (let i = 0; i < 24 && contrastRatio(onColor(primary), primary) < 4.5; i++) {
    primary = goDark ? mix(primary, '#000000', 0.06) : mix(primary, '#FFFFFF', 0.06);
  }
  el('studio-primary').value = primary;
  el('studio-primary-picker').value = primary;
  updateStudio();
}

function buildBrandJson() {
  const { primary, secondary, accent } = currentStudioColors();
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'new-brand';
  const config = {
    id,
    name: el('studio-name').value.trim() || 'New Brand',
    slug: id,
    scheme: id.replace(/-/g, ''),
    bundleId: `com.${id.replace(/-/g, '')}.app`,
    companyShortName: el('studio-short').value.trim() || el('studio-name').value.trim() || 'New Brand',
    fontFamily: el('studio-font').value,
    releasePrefix: id,
    privacyPolicyUrl: el('studio-privacy').value.trim() || '',
    termsUrl: el('studio-terms').value.trim() || '',
    colors: { primary, secondary, accent },
    splashBackground: mix(secondary, '#000000', 0.35),
    iconBackground: mix(secondary, '#000000', 0.35),
    _logoSource: studio.selectedLogo || '',
  };
  return JSON.stringify(config, null, 2);
}

function downloadBrandJson() {
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'brand';
  const blob = new Blob([el('studio-json').value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${id}.brand.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── App-icon generator ──────────────────────────────────────────────────
// Loads the chosen logo through our same-origin image proxy (so the canvas
// isn't cross-origin tainted and can export), composites it onto a square
// brand-colored canvas, and exports store-ready icon.png / splash.png.
const iconState = { logoImg: null };

function selectLogo(url) {
  studio.selectedLogo = url;
  document.querySelectorAll('#logo-candidates .logo-thumb')
    .forEach((t) => t.classList.toggle('selected', t.dataset.url === url));
  loadLogoForIcon(url);
}

function loadLogoForIcon(url) {
  const img = new Image();
  img.onload = () => {
    iconState.logoImg = img;
    el('download-icon-btn').disabled = false;
    el('download-splash-btn').disabled = false;
    el('icon-hint').textContent = 'Adjust the background and logo size, then download.';
    regenIcons();
  };
  img.onerror = () => {
    iconState.logoImg = null;
    el('download-icon-btn').disabled = true;
    el('download-splash-btn').disabled = true;
    el('icon-hint').textContent = 'Could not load that logo — try another candidate or add one by hand.';
  };
  img.src = `${API}/api/brands/proxy-image?url=${encodeURIComponent(url)}`;
}

function currentIconBg() {
  const { secondary } = currentStudioColors();
  return normalizeHex(el('icon-bg').value) || mix(secondary, '#000000', 0.35);
}

function regenIcons() {
  if (!iconState.logoImg) return;
  const bg = currentIconBg();
  const frac = Number(el('icon-scale').value) / 100;
  drawBrandIcon(el('icon-canvas'), iconState.logoImg, bg, frac);
  drawBrandIcon(el('splash-canvas'), iconState.logoImg, bg, frac * 0.68); // splash logo sits smaller
}

function drawBrandIcon(canvas, img, bg, fraction) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  const box = S * fraction;
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.min(box / iw, box / ih);
  const w = iw * scale; const h = ih * scale;
  try { ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h); } catch (e) { /* invalid/tainted image */ }
}

function downloadCanvas(canvasId, filename) {
  const id = slugify(el('studio-id').value || el('studio-name').value) || 'brand';
  el(canvasId).toBlob((blob) => {
    if (!blob) { toast('Could not export image.', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}-${filename}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
