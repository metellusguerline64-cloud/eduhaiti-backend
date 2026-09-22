#!/usr/bin/env node
// Blueprint Section 6, mitigation for "response-shape drift": diff a
// Worker action's response against a captured real apiHub() response
// for the same request, field by field.
//
// Usage:
//   1. Against the LIVE Apps Script app, capture a real response:
//        curl "<script.google.com exec url>?action=getViewerInfo&token=..." > samples/getViewerInfo.gas.json
//   2. node scripts/contract-test.js getViewerInfo \
//        "https://eduhaiti-api.<sub>.workers.dev/?action=getViewerInfo&token=..." \
//        samples/getViewerInfo.gas.json
//
// Exits non-zero (and prints every mismatched path) if the shapes
// differ, so this can gate deploys once Phase 1 starts porting real
// actions in bulk.

const [, , actionName, workerUrl, samplePath] = process.argv;

if (!actionName || !workerUrl || !samplePath) {
  console.error(
    "Usage: node scripts/contract-test.js <actionName> <workerUrl> <gasResponseSamplePath.json>"
  );
  process.exit(1);
}

const fs = await import("node:fs");

function diff(a, b, path = "$") {
  const mismatches = [];
  const ta = typeof a;
  const tb = typeof b;

  if (a === null || b === null) {
    if (a !== b) mismatches.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return mismatches;
  }
  if (ta !== tb) {
    mismatches.push(`${path}: type ${ta} vs ${tb}`);
    return mismatches;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      mismatches.push(`${path}: array vs non-array`);
      return mismatches;
    }
    if (a.length !== b.length) {
      mismatches.push(`${path}: length ${a.length} vs ${b.length}`);
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) mismatches.push(...diff(a[i], b[i], `${path}[${i}]`));
    return mismatches;
  }
  if (ta === "object") {
    const keysA = new Set(Object.keys(a));
    const keysB = new Set(Object.keys(b));
    for (const k of keysA) {
      if (!keysB.has(k)) mismatches.push(`${path}.${k}: present in Worker, missing in GAS sample`);
    }
    for (const k of keysB) {
      if (!keysA.has(k)) mismatches.push(`${path}.${k}: present in GAS sample, missing in Worker`);
    }
    for (const k of keysA) {
      // meta.timestamp always differs — expected, not a real mismatch.
      if (k === "timestamp" || k === "meta") continue;
      if (keysB.has(k)) mismatches.push(...diff(a[k], b[k], `${path}.${k}`));
    }
    return mismatches;
  }
  // Primitive leaf. Values themselves (real IDs, timestamps) are
  // expected to differ across systems — only flag if one is
  // truthy/empty in a way that suggests a broken mapping.
  if (Boolean(a) !== Boolean(b)) {
    mismatches.push(`${path}: truthiness differs — ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return mismatches;
}

const gasSample = JSON.parse(fs.readFileSync(samplePath, "utf8"));

const res = await fetch(workerUrl);
const workerBody = await res.json();

const mismatches = diff(workerBody, gasSample);

if (mismatches.length) {
  console.error(`✗ ${actionName}: ${mismatches.length} shape mismatch(es)`);
  for (const m of mismatches) console.error("  " + m);
  process.exit(1);
} else {
  console.log(`✓ ${actionName}: shape matches captured GAS sample`);
}
