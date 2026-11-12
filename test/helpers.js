import { readFileSync } from 'node:fs';

/** Rebuild a report's page array from a fixture that keeps only the pages the parser reads. */
export function loadReport(name) {
  const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  const pages = Array.from({ length: fx.pageCount }, (_, i) => fx.pages[i + 1] ?? '');
  return { url: fx.url, pages };
}
