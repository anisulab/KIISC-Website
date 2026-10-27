// Writes dist/sitemap.xml from the public route list. Private routes are never included.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readEnvSiteUrl() {
  if (process.env.VITE_SITE_URL) return process.env.VITE_SITE_URL;
  for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const p = path.join(root, file);
    if (!existsSync(p)) continue;
    const match = readFileSync(p, 'utf8').match(/^VITE_SITE_URL=(.+)$/m);
    if (match) return match[1].trim();
  }
  return null;
}

const siteUrl = readEnvSiteUrl();
if (!siteUrl) {
  console.warn('[sitemap] VITE_SITE_URL is not set; skipping sitemap.xml generation.');
  process.exit(0);
}

const base = siteUrl.replace(/\/+$/, '');
const routes = JSON.parse(readFileSync(path.join(root, 'src/routes/publicRoutes.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const urls = routes
  .map((r) => `  <url><loc>${base}${r}</loc><lastmod>${today}</lastmod></url>`)
  .join('\n');

writeFileSync(
  path.join(root, 'dist/sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
console.log(`[sitemap] wrote ${routes.length} URLs for ${base}`);
