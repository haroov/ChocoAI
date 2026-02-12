import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const PORT = 54112; // From the log
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = 'dev-secret-key-change-in-production';

async function verify() {
  console.log('Verifying API...');

  // Generate Admin Token
  const token = jwt.sign(
    { admin: { username: 'test-admin', role: 'admin' } },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const cookie = `choco_admin=${token}`;

  // 1. GET /api/v1/segments-catalog/prod
  console.log('GET /api/v1/segments-catalog/prod');
  const res = await fetch(`${BASE_URL}/api/v1/segments-catalog/prod`, {
    headers: {
      Cookie: cookie,
    },
  });

  if (!res.ok) {
    console.error('Failed to get catalog:', res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  if (!data.ok) {
    console.error('API returned not ok:', data);
    process.exit(1);
  }

  const catalog = data.catalog;
  if (catalog.packages) {
    console.error('FAIL: "packages" key found in catalog response!');
    process.exit(1);
  } else {
    console.log('PASS: "packages" key NOT found in catalog response.');
  }

  if (catalog.segments && catalog.segments.length > 0) {
    const seg = catalog.segments[0];
    if (seg.coverages) {
      console.log('PASS: Found "coverages" in a segment.');
    } else {
      console.log('WARN: No "coverages" found in first segment (might be expected if not enriched yet).');
    }
  }

  // 2. POST /api/v1/segments-catalog/prod/enrich
  console.log('POST /api/v1/segments-catalog/prod/enrich');
  const resEnrich = await fetch(`${BASE_URL}/api/v1/segments-catalog/prod/enrich`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
  });

  if (!resEnrich.ok) {
    console.error('Failed to enrich:', resEnrich.status, await resEnrich.text());
    process.exit(1);
  }

  const dataEnrich = await resEnrich.json();
  if (!dataEnrich.ok) {
    console.error('Enrich API returned not ok:', dataEnrich);
    process.exit(1);
  }

  console.log('Enrich stats:', dataEnrich.stats);

  // 3. GET again to verify enrichment
  console.log('GET /api/v1/segments-catalog/prod (after enrich)');
  const res2 = await fetch(`${BASE_URL}/api/v1/segments-catalog/prod`, {
    headers: {
      Cookie: cookie,
    },
  });
  const data2 = await res2.json();
  const catalog2 = data2.catalog;

  if (catalog2.packages) {
    console.error('FAIL: "packages" key found after enrich!');
    process.exit(1);
  } else {
    console.log('PASS: "packages" key NOT found after enrich.');
  }

  // Check for coverages and choco_product_slugs
  let foundCoverages = false;
  let foundSlugs = false;
  for (const s of catalog2.segments) {
    if (s.coverages && Object.keys(s.coverages).length > 0) foundCoverages = true;
    if (s.choco_product_slugs && s.choco_product_slugs.length > 0) foundSlugs = true;
  }

  if (foundCoverages) console.log('PASS: Found segments with coverages.');
  else console.warn('WARN: No segments with coverages found.');

  if (foundSlugs) console.log('PASS: Found segments with choco_product_slugs.');
  else console.warn('WARN: No segments with choco_product_slugs found.');

  console.log('Verification complete.');
}

verify().catch(console.error);
