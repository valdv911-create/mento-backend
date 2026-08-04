#!/usr/bin/env node
// Test script to assert rate limiter behavior by calling the live /api/chat endpoint.

import { default as fetch } from 'node-fetch';

const API = process.env.API_BASE_URL || 'http://localhost:3000';
const ENDPOINT = `${API}/api/chat`;
const TOKEN = process.env.DEMO_TOKEN || '';

async function callOnce() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`
    },
    body: JSON.stringify({ history: [{ role: 'user', text: 'ping' }] })
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function main() {
  console.log('Running rate limiter test against', ENDPOINT);

  // Part 1: rapid calls to trigger sliding-window limit
  const calls = parseInt(process.env.TEST_CALLS || '10', 10);
  let denied = 0, allowed = 0;
  for (let i = 0; i < calls; i++) {
    try {
      const r = await callOnce();
      console.log(i + 1, r.status, r.body.slice(0, 200));
      if (r.status === 429) denied++; else allowed++;
    } catch (e) {
      console.error('request failed', e.message || e);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Results: allowed=${allowed}, denied=${denied}`);

  // Part 2: cooldown test - two immediate calls should trigger cooldown second
  const first = await callOnce();
  const second = await callOnce();
  console.log('Cooldown test responses:', first.status, second.status);

  if (denied === 0) {
    console.warn('Warning: no requests were denied. Check your limiter config or call volume.');
    process.exit(1);
  }

  if (second.status !== 429) {
    console.warn('Warning: cooldown did not trigger as expected.');
    process.exit(1);
  }

  console.log('Rate limiter test completed (expected denials observed).');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(2);
});
