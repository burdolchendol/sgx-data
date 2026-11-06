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

/** Returns an array of page texts (index 0 = page 1). */
export function pdfPages(buffer) {
  return withTempPdf(buffer, async (file) => {
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 256 * 1024 * 1024 });
    const pages = stdout.split('\f');
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
