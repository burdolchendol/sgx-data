// PDF to text with poppler's pdftotext (-layout keeps table columns aligned).
// The PDF is written to a temp file only for the conversion and deleted straight after.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

async function withTempPdf(buffer, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sgx-pdf-'));
  const file = join(dir, 'doc.pdf');
  try { await writeFile(file, buffer); return await fn(file); } finally { await rm(dir, { recursive: true, force: true }); }
}

// some PDFs print "ﬁ"/"ﬂ" ligatures ("Cash ﬂows"): spell them out so headings and labels match
const LIG = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
// some PDFTron-made reports map the fi/fl ligatures to "ȴ"/"ȵ" (DBS 2022: "Cash ȵows", "ȴnancing")
const ODD = { 'ȴ': 'fi', 'ȵ': 'fl' };
export const ligatures = (text) => text.replace(/[ﬀ-ﬆ]/g, (c) => LIG[c] ?? c).replace(/(?<=[A-Za-z ]|^)[ȴȵ](?=[a-z])/gm, (c) => ODD[c]);

/** Returns an array of page texts (index 0 = page 1). */
export function pdfPages(buffer) {
  return withTempPdf(buffer, async (file) => {
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 256 * 1024 * 1024 });
    const pages = ligatures(stdout).split('\f');
    if (pages.length && pages[pages.length - 1].trim() === '') pages.pop();
    return pages;
  });
}

/** The PDF's creation date as YYYY-MM-DD, or null. */
export function pdfCreationDate(buffer) {
  return withTempPdf(buffer, async (file) => {
    const { stdout } = await run('pdfinfo', ['-isodates', file]);
    const m = stdout.match(/^CreationDate:\s+(\d{4}-\d{2}-\d{2})/m);
    return m ? m[1] : null;
  });
}

/**
 * Like pdfPages, but splits two-page spreads (landscape PDF pages holding two printed pages side
 * by side, as in Wilmar's and CapitaLand's reports) into their left and right halves, so each
 * printed page is read on its own. split: true forces halves (some reports put two printed pages
 * side by side on a portrait sheet), false never splits. Returns { pages, pageNo } (pageNo[i] = PDF page).
 */
export function pdfPrintedPages(buffer, { split = null } = {}) {
  return withTempPdf(buffer, async (file) => {
    const { stdout: info } = await run('pdfinfo', ['-f', '1', '-l', '100000', file], { maxBuffer: 64 * 1024 * 1024 });
    const sizes = [...info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+)/gm)].map((m) => [Number(m[1]), Number(m[2])]);
    const text = async (extra) => {
      const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', ...extra, file, '-'], { maxBuffer: 256 * 1024 * 1024 });
      const p = ligatures(stdout).split('\f');
      if (p.length && p[p.length - 1].trim() === '') p.pop();
      return p;
    };
    const landscape = sizes.filter(([w, h]) => w > h * 1.2).length;
    if (split === false || (split == null && (!sizes.length || landscape < sizes.length / 2))) {
      const pages = await text([]);
      return { pages, pageNo: pages.map((_, i) => i + 1) };
    }
    // pdftotext crops in pixels at 72 dpi, i.e. PDF points; use the most common spread size
    const wide = sizes.filter(([a, b]) => a > b * 1.2);
    const [w, h] = (wide.length ? wide : sizes).slice().sort((a, b) => b[0] - a[0])[0];
    const half = Math.floor(w / 2);
    const H = Math.ceil(h);
    const left = await text(['-x', '0', '-y', '0', '-W', String(half), '-H', String(H)]);
    const right = await text(['-x', String(half), '-y', '0', '-W', String(Math.ceil(w) - half), '-H', String(H)]);
    const pages = [];
    const pageNo = [];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      pages.push(left[i] ?? '', right[i] ?? '');
      pageNo.push(i + 1, i + 1);
    }
    return { pages, pageNo };
  });
}
