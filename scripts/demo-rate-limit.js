#!/usr/bin/env node
// Demo script to exercise the chat rate limiter locally.
// Usage: node ./scripts/demo-rate-limit.js

import { default as fetch } from 'node-fetch';

const API = process.env.API_BASE_URL || 'http://localhost:3000';
const ENDPOINT = `${API}/api/chat`;

async function callOnce(token) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ history: [{ role: 'user', text: 'Hello' }] })
  });
  const text = await res.text();
  console.log(res.status, text);
}

(async () => {
  const token = process.env.DEMO_TOKEN || '';
  const calls = parseInt(process.env.DEMO_CALLS || '10', 10);
  for (let i = 0; i < calls; i++) {
    try {
      await callOnce(token);
    } catch (err) {
      console.error('Request failed', err);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  try {
    const metricsRes = await fetch(`${API}/api/metrics`);
    const metricsText = await metricsRes.text();
    console.log('\n==== METRICS ====\n', metricsText);
  } catch (err) {
    console.warn('Could not fetch metrics:', err.message || err);
  }
})();
