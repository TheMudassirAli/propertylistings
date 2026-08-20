// Generates small static HTML files under /a/<agent-slug>/ and
// /l/<agent-slug>/<listing-id>/ — each with correct og:image/title/description
// tags baked in, so WhatsApp/Instagram show a real preview card when these
// links are shared. Each file immediately redirects into the real live app.
//
// Run via GitHub Actions (see .github/workflows/generate-previews.yml) —
// you should never need to run this by hand.

const https = require('https');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const AGENTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCXA3NU7egj4jXKZMNZOBtsQ9zSB3e6FaqyrFsp7Sjh3yyqexI8NxNHUsSCDdKCWKWKGPms4oWwnil/pub?output=csv';
const LISTINGS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVB8CeQwJ75S5e0K5fyHO-ubc3cf28xib_xc3xFSp274NNRfJPx6ZFamqmqOADAR2Fb8N2t7ie0XJP/pub?output=csv';
const SITE_ROOT = 'https://themudassirali.github.io/propertylistings';

function fetchCSV(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      // Google's published CSV links issue a redirect before serving the
      // actual file — follow it manually, since Node's https.get doesn't.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume(); // discard this response body
        return resolve(fetchCSV(res.headers.location, redirectsLeft - 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = Papa.parse(data, { header: true, skipEmptyLines: true });
        resolve(parsed.data);
      });
    }).on('error', reject);
  });
}

function slugify(s) { return (s || '').toString().trim().toLowerCase().replace(/\s+/g, '-'); }
function normEmail(e) { return (e || '').toString().trim().toLowerCase(); }
function sanitizeId(ts) { return (ts || '').toString().trim().replace(/[\/: ]+/g, '-'); }
function escapeHtml(s) {
  return (s || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSlugMap(agents) {
  const used = new Set();
  const emailToSlug = {};
  agents.forEach(a => {
    const email = normEmail(a['Email address']);
    if (!email) return;
    const base = slugify(a['Full Name']) || 'agent';
    let slug = base, n = 2;
    while (used.has(slug)) { slug = base + '-' + n; n++; }
    used.add(slug);
    emailToSlug[email] = slug;
  });
  return emailToSlug;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function redirectPage(title, desc, image, type, redirectUrl) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:type" content="${type}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${redirectUrl}">
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</head><body>
<p>Redirecting… <a href="${redirectUrl}">Click here if you're not redirected.</a></p>
</body></html>`;
}

async function main() {
  const [agents, listings] = await Promise.all([fetchCSV(AGENTS_CSV_URL), fetchCSV(LISTINGS_CSV_URL)]);
  const emailToSlug = buildSlugMap(agents);

  agents.forEach(a => {
    const email = normEmail(a['Email address']);
    const slug = emailToSlug[email];
    if (!slug) return;
    const count = listings.filter(l => normEmail(l['Email address']) === email).length;
    const title = `${a['Full Name'] || 'Agent'} — Property Listings`;
    const desc = `${a['City'] || ''} · ${count} listing${count === 1 ? '' : 's'}`;
    const image = a['Photo URL'] ? a['Photo URL'].split(',')[0].trim() : '';
    writeFile(`a/${slug}/index.html`, redirectPage(title, desc, image, 'profile', `${SITE_ROOT}/?agent=${slug}`));
  });

  listings.forEach(l => {
    const email = normEmail(l['Email address']);
    const slug = emailToSlug[email];
    if (!slug) return;
    const rawId = (l['Timestamp'] || '').toString().trim();
    if (!rawId) return;
    const safeId = sanitizeId(rawId);

    const isRent = (l['Listing Purpose'] || '').toLowerCase().includes('rent');
    const priceNum = parseFloat(l['Price']);
    const price = isNaN(priceNum) ? '' : '₹' + priceNum.toLocaleString('en-IN') + (isRent ? '/month' : '');
    const location = [l['Area'], l['Zone']].filter(Boolean).join(', ');

    const title = `${l['Title'] || l['Property Type'] || 'Property'}${location ? ' — ' + location : ''}`;
    const desc = [price, l['Description']].filter(Boolean).join(' — ');
    const photos = (l['Photo URL'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const image = photos[0] || '';

    const redirectUrl = `${SITE_ROOT}/?agent=${slug}&listing=${encodeURIComponent(rawId)}`;
    writeFile(`l/${slug}/${safeId}/index.html`, redirectPage(title, desc, image, 'website', redirectUrl));
  });

  console.log(`Generated ${agents.length} agent page(s) and ${listings.length} listing page(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
