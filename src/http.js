// Polite HTTP: ~1 request/second per host, backoff on 429/5xx, on-disk cache.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CACHE_DIR = process.env.SGX_CACHE_DIR ?? '.cache/http';
const MIN_GAP_MS = 1100;
const lastHit = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function userAgent() {
  const contact = process.env.SGX_SCRAPER_CONTACT; // never hardcoded
  return `sgx-data-snapshot/0.1 (+https://github.com/burdolchendol/sgx-data${contact ? `; ${contact}` : ''})`;
}

async function throttle(host) {
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export function cachePath(url) {
  return join(CACHE_DIR, createHash('sha256').update(url).digest('hex'));
}

/** Fetch a URL once; later calls read the cache. Returns a Buffer. */
export async function getCached(url, { retries = 4, headers = {} } = {}) {
  const file = cachePath(url);
  try { await access(file); return await readFile(file); } catch { /* not cached */ }
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await throttle(host);
    const res = await fetch(url, { headers: { 'User-Agent': userAgent(), ...headers } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, buf);
      return buf;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
}
