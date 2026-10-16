// Sanity tests for the acoustic pipeline and decision rules.
// Run: node tests/indices.test.mjs

import assert from 'node:assert/strict';
import { synthScene } from '../js/synth.js';
import { spectrogram, computeIndices, cosine } from '../js/indices.js';
import {
  acousticQuality, healthScore, quotaFor, priceFor, statusFor, feeSplit, smooth,
} from '../js/score.js';

const SR = 48000;
const CONTROL = 0.92;
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ', name);
}

const analyse = (scene, seed) => computeIndices(spectrogram(synthScene(scene, 6, SR, seed), SR, 2048));

const forest = [1, 2, 3].map((s) => analyse('forest', s));
const crowd = [1, 2, 3].map((s) => analyse('crowd', s));
const rain = [1, 2].map((s) => analyse('rain', s));

test('forest NDSI is clearly positive (biophony dominates)', () => {
  for (const ix of forest) assert.ok(ix.ndsi > 0.4, `ndsi ${ix.ndsi}`);
});

test('crowd NDSI is negative (anthrophony dominates)', () => {
  for (const ix of crowd) assert.ok(ix.ndsi < 0, `ndsi ${ix.ndsi}`);
});

test('forest is more acoustically complex and diverse than crowd', () => {
  for (let i = 0; i < 3; i++) {
    assert.ok(forest[i].aci > crowd[i].aci, 'aci');
    assert.ok(forest[i].adi > crowd[i].adi, 'adi');
  }
});

test('rain is flagged, forest and crowd are not', () => {
  for (const ix of rain) assert.equal(ix.rain, true);
  for (const ix of [...forest, ...crowd]) assert.equal(ix.rain, false);
});

test('health: forest scores Thriving, crowd scores Critical', () => {
  for (const ix of forest) {
    const h = healthScore(acousticQuality(ix), CONTROL);
    assert.ok(h >= 75, `forest health ${h}`);
    assert.equal(statusFor(h).key, 'thriving');
  }
  for (const ix of crowd) {
    const h = healthScore(acousticQuality(ix), CONTROL);
    assert.ok(h < 50, `crowd health ${h}`);
    assert.equal(statusFor(h).key, 'critical');
  }
});

test('quota falls and fee rises as health drops', () => {
  const site = { maxDaily: 400, baseFee: 50 };
  assert.equal(quotaFor(site, 90), 400);
  assert.equal(priceFor(site, 90), 50);
  assert.ok(quotaFor(site, 60) < quotaFor(site, 80));
  assert.ok(priceFor(site, 60) > priceFor(site, 80));
  assert.equal(quotaFor(site, 10), 100, 'quota floor is 25%');
  assert.equal(priceFor(site, 10), 175, 'fee cap is 3.5x base');
});

test('fee split sends base to village, surge to guardians and restoration', () => {
  const site = { baseFee: 50 };
  assert.deepEqual(feeSplit(site, 50), { village: 50, guardians: 0, restoration: 0 });
  const s = feeSplit(site, 150);
  assert.equal(s.village + s.guardians + s.restoration, 150);
  assert.equal(s.guardians, 70);
});

test('3-day smoothing damps a one-day drop', () => {
  assert.equal(smooth(90, 30), 60);
  assert.equal(smooth(null, 42), 42);
});

test('fingerprint flags a re-uploaded clip but not a different one', () => {
  const again = analyse('forest', 1);
  assert.ok(cosine(forest[0].fingerprint, again.fingerprint) > 0.995);
  assert.ok(cosine(forest[0].fingerprint, crowd[0].fingerprint) < 0.995);
});

console.log(`\n${passed} tests passed`);
console.log('forest health', forest.map((ix) => healthScore(acousticQuality(ix), CONTROL)).join(', '));
console.log('crowd health ', crowd.map((ix) => healthScore(acousticQuality(ix), CONTROL)).join(', '));
