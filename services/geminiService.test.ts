import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeminiError, getModelCandidatesForKind } from './geminiService';

test('getModelCandidatesForKind uses a supported fallback chain', () => {
  const candidates = getModelCandidatesForKind('chat', 'gemini-3.5-flash');

  assert.deepEqual(candidates, ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']);
});

test('classifyGeminiError distinguishes invalid key and model missing cases', () => {
  const invalidKey = classifyGeminiError({ status: 401, message: 'API key not valid' });
  const modelMissing = classifyGeminiError({ status: 404, message: 'Model not found' });

  assert.equal(invalidKey.category, 'invalid_api_key');
  assert.equal(modelMissing.category, 'model_not_found');
});
