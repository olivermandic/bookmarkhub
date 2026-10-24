// Compare favicon success: 2.0.1 module vs 2.1 module. Usage: node favicon-rate.js [urls.json]
// Run inside the image: docker run --rm -v $PWD/tests:/rate:ro -w /app/server --entrypoint node bookmarkhub:2.1.0 /rate/favicon-rate.js
// (needs favicons-2.0.1.js next to it: git show v2.0.1:server/favicons.js > tests/favicons-2.0.1.js)
const fs = require('fs'), os = require('os'), path = require('path');
const oldF = require('./favicons-2.0.1.js'); const newF = require('/app/server/favicons.js');
const popular = ['https://github.com','https://www.wikipedia.org','https://www.tagesschau.de','https://www.heise.de','https://www.spiegel.de','https://www.zeit.de','https://www.faz.net','https://www.sueddeutsche.de','https://www.amazon.de','https://www.ebay.de','https://www.youtube.com','https://www.reddit.com','https://stackoverflow.com','https://developer.mozilla.org','https://www.apple.com','https://www.microsoft.com','https://www.synology.com','https://www.netflix.com','https://www.paypal.com','https://www.dhl.de','https://www.bahn.de','https://www.chefkoch.de','https://www.golem.de','https://t3n.de','https://www.dwd.de','https://www.ikea.com/de/de/','https://www.otto.de','https://www.idealo.de','https://www.linkedin.com','https://www.xing.com'];
const tricky = ['https://news.ycombinator.com','https://www.notion.so','https://www.figma.com','https://www.spotify.com','https://www.instagram.com','https://x.com','https://www.tiktok.com','https://www.nytimes.com','https://www.bbc.co.uk/news','https://docs.github.com/en','https://mail.proton.me','https://app.diagrams.net','https://www.openstreetmap.org','https://gitlab.com','https://www.deepl.com/translator'];
const own = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map((b) => b.url) : [];
async function rate(name, urls) {
  let o = 0, n = 0; const misses = [];
  for (const [i, url] of urls.entries()) {
    const b = { id: `t${name}${i}`, url };
    const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'o')), d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'n'));
    let ok1 = false, ok2 = false;
    try { const r = await Promise.race([oldF.get(b, d1), new Promise((r) => setTimeout(() => r(null), 20000))]); ok1 = !!(r && (r.buf || r.data || r.body || r.length)); } catch {}
    try { const m = await newF.refresh(b, d2, { force: true }); ok2 = m && (m.status === 'found' || m.status === 'custom'); } catch {}
    o += ok1; n += ok2; if (!ok2) misses.push(new URL(url).hostname);
  }
  console.log(`${name}: 2.0.1 ${o}/${urls.length}  ->  2.1.0 ${n}/${urls.length}${misses.length ? '  (2.1 misses: ' + misses.join(', ') + ')' : ''}`);
}
(async () => { await rate('popular', popular); await rate('tricky', tricky); if (own.length) await rate('own-bookmarks', own); })();
