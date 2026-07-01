#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// build-catalog.js — Convert Shopify CSV exports → compact JSON per region
//
// Input:  Vahdam Product Catalog RegionWise/products_export_{usa,uk,global}.csv
// Output: data/catalog/products_{us,uk,global}.json
//
// Each CSV is a standard Shopify export with multi-row per product:
//   - Row with Image Position=1 → primary image
//   - Multiple rows per Handle → variants/images (we deduplicate)
//   - Only products with Status=active are included
//
// Output JSON per product:
//   { n, i, t, h, price, compare_at, category, subtitle, caffeine, tasting_notes, type }
//
// Run: node scripts/build-catalog.js
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_DIR = path.join(ROOT, 'Vahdam Product Catalog RegionWise');
const OUT_DIR = path.join(ROOT, 'data', 'catalog');

// Region mapping: filename → market code
const REGIONS = [
  { file: 'products_export_usa.csv',    market: 'us' },
  { file: 'products_export_uk.csv',     market: 'uk' },
  { file: 'products_export_global.csv', market: 'global' }
];

// ── Minimal CSV parser (handles quoted fields with commas/newlines) ─────────
function parseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function parseField() {
    if (i >= len || text[i] === '\n' || text[i] === '\r') return '';
    if (text[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let val = '';
      while (i < len) {
        if (text[i] === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += text[i];
          i++;
        }
      }
      return val;
    } else {
      // Unquoted field
      let val = '';
      while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
        val += text[i];
        i++;
      }
      return val;
    }
  }

  while (i < len) {
    const row = [];
    while (i < len && text[i] !== '\n' && text[i] !== '\r') {
      row.push(parseField());
      if (i < len && text[i] === ',') i++; // skip comma
    }
    // Skip line endings
    while (i < len && (text[i] === '\n' || text[i] === '\r')) i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

// ── Tag categorization (matches the SPA's existing tag logic) ───────────────
function deriveTags(tagsStr, type, title) {
  const tags = [];
  const tl = (tagsStr || '').toLowerCase();
  const titleL = (title || '').toLowerCase();

  // Category tags from Shopify tags field
  if (tl.includes('chai') || titleL.includes('chai'))           tags.push('chai');
  if (tl.includes('green') || titleL.includes('green tea'))     tags.push('green');
  if (tl.includes('black') || tl.includes('darjeeling') || tl.includes('assam') || titleL.includes('black tea')) tags.push('black');
  if (tl.includes('herbal') || titleL.includes('herbal'))       tags.push('detox');
  if (tl.includes('immunity') || tl.includes('turmeric') || tl.includes('ashwagandha')) tags.push('immunity');
  if (tl.includes('sleep') || tl.includes('chamomile') || tl.includes('lavender')) tags.push('sleep');
  if (tl.includes('gift') || titleL.includes('gift'))           tags.push('gift');
  if (tl.includes('sampler') || tl.includes('assorted') || titleL.includes('sampler')) tags.push('discovery');
  if (tl.includes('bestseller') || tl.includes('best-seller'))  tags.push('bestseller');
  if (tl.includes('iced') || tl.includes('summer') || tl.includes('hibiscus') || tl.includes('lychee')) tags.push('summer');
  if (tl.includes('premium') || tl.includes('single-estate') || tl.includes('oolong') || tl.includes('white tea')) tags.push('premium');
  if (tl.includes('matcha') || titleL.includes('matcha'))       tags.push('green');
  if (tl.includes('bundle') || titleL.includes('bundle'))       tags.push('gift');

  // Deduplicate
  return [...new Set(tags)];
}

// ── Find column index by partial header match ───────────────────────────────
function colIdx(headers, ...patterns) {
  for (const pat of patterns) {
    const pl = pat.toLowerCase();
    const idx = headers.findIndex(h => h.toLowerCase().includes(pl));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Process one CSV file ────────────────────────────────────────────────────
function processCSV(filePath, market) {
  console.log(`Processing ${path.basename(filePath)} → ${market}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  // Remove BOM if present
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.warn(`  ⚠ No data rows found`);
    return [];
  }

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1);

  // Locate columns
  const iHandle      = colIdx(headers, 'Handle');
  const iTitle       = colIdx(headers, 'Title');
  const iTags        = colIdx(headers, 'Tags');
  const iPublished   = colIdx(headers, 'Published');
  const iPrice       = colIdx(headers, 'Variant Price');
  const iCompareAt   = colIdx(headers, 'Variant Compare At Price');
  const iImageSrc    = colIdx(headers, 'Image Src');
  const iImagePos    = colIdx(headers, 'Image Position');
  const iStatus      = colIdx(headers, 'Status');
  const iType        = colIdx(headers, 'Type');
  const iCategory    = colIdx(headers, 'Product Category');
  const iSubtitle    = colIdx(headers, 'Subtitle (product.metafields.custom.subtitle)', 'Product Card Subtitle');
  const iCaffeine    = colIdx(headers, 'Caffeine (product.metafields.custom.caffeine)', 'Caffeine content');
  const iTasting     = colIdx(headers, 'Tasting Notes');
  const iForm        = colIdx(headers, 'Form (product.metafields.custom.form)');
  const iCups        = colIdx(headers, 'No. of Cups');
  const iPackaging   = colIdx(headers, 'Packaging');

  if (iHandle < 0 || iTitle < 0) {
    console.error(`  ✗ Missing Handle or Title column`);
    return [];
  }

  // Group rows by Handle
  const grouped = new Map();
  for (const row of data) {
    const handle = (row[iHandle] || '').trim();
    if (!handle) continue;
    if (!grouped.has(handle)) grouped.set(handle, []);
    grouped.get(handle).push(row);
  }

  // Process each product
  const products = [];
  for (const [handle, prodRows] of grouped) {
    // Use first row for product-level fields
    const first = prodRows[0];

    // Filter: only active products
    const status = iStatus >= 0 ? (first[iStatus] || '').trim().toLowerCase() : 'active';
    if (status !== 'active') continue;

    const title = (first[iTitle] || '').trim();
    if (!title) continue;

    const tags = iTags >= 0 ? (first[iTags] || '').trim() : '';
    const type = iType >= 0 ? (first[iType] || '').trim() : '';
    const price = iPrice >= 0 ? (first[iPrice] || '').trim() : '';
    const compareAt = iCompareAt >= 0 ? (first[iCompareAt] || '').trim() : '';

    // Find primary image (Image Position = 1)
    let image = '';
    for (const row of prodRows) {
      const pos = iImagePos >= 0 ? (row[iImagePos] || '').trim() : '';
      const src = iImageSrc >= 0 ? (row[iImageSrc] || '').trim() : '';
      if (pos === '1' && src) { image = src; break; }
    }
    // Fallback: first non-empty image
    if (!image) {
      for (const row of prodRows) {
        const src = iImageSrc >= 0 ? (row[iImageSrc] || '').trim() : '';
        if (src) { image = src; break; }
      }
    }

    // Extract metafields from first row
    const subtitle   = iSubtitle >= 0 ? (first[iSubtitle] || '').trim() : '';
    const caffeine   = iCaffeine >= 0 ? (first[iCaffeine] || '').trim() : '';
    const tasting    = iTasting >= 0 ? (first[iTasting] || '').trim() : '';
    const form       = iForm >= 0 ? (first[iForm] || '').trim() : '';
    const cups       = iCups >= 0 ? (first[iCups] || '').trim() : '';
    const packaging  = iPackaging >= 0 ? (first[iPackaging] || '').trim() : '';

    const derivedTags = deriveTags(tags, type, title);
    if (!derivedTags.length) derivedTags.push('general');

    const product = {
      n: title,
      i: image,
      t: derivedTags,
      h: handle
    };
    // Only include price fields if they have values
    if (price) product.price = price;
    if (compareAt && compareAt !== price) product.compare_at = compareAt;
    if (type) product.type = type;
    if (subtitle) product.subtitle = subtitle;
    if (caffeine) product.caffeine = caffeine;
    if (tasting) product.tasting_notes = tasting;
    if (form) product.form = form;
    if (cups) product.cups = cups;
    if (packaging) product.packaging = packaging;

    products.push(product);
  }

  console.log(`  ✓ ${products.length} active products (from ${grouped.size} total handles)`);
  return products;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalProducts = 0;

  for (const region of REGIONS) {
    const csvPath = path.join(CSV_DIR, region.file);
    if (!fs.existsSync(csvPath)) {
      console.warn(`⚠ CSV not found: ${region.file} — skipping`);
      continue;
    }

    const products = processCSV(csvPath, region.market);
    const outPath = path.join(OUT_DIR, `products_${region.market}.json`);
    fs.writeFileSync(outPath, JSON.stringify(products), 'utf8');
    const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`  → ${outPath} (${sizeKB} KB, ${products.length} products)`);
    totalProducts += products.length;
  }

  console.log(`\n✓ Build complete: ${totalProducts} total products across ${REGIONS.length} regions`);
}

// Export shared helpers so the live storefront scraper reuses identical
// categorization (scripts/scrape-catalog.js). Only run the CSV build when this
// file is executed directly, not when required.
module.exports = { deriveTags };

if (require.main === module) {
  main();
}
