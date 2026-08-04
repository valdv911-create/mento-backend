import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmptyChatSuggestions } from './emptyChatSuggestions';

test('returns coding-focused suggestions for coding history', () => {
  const suggestions = getEmptyChatSuggestions([
    { role: 'user', text: 'I keep getting a React hook error in my app' },
    { role: 'assistant', text: 'I can help with that.' },
  ]);

  assert.ok(suggestions.some((suggestion) => suggestion.title === 'Learn coding'));
  assert.ok(suggestions.some((suggestion) => suggestion.title === 'Improve my writing') === false);
});

test('falls back to broad starter suggestions when history is empty', () => {
  const suggestions = getEmptyChatSuggestions([]);

  assert.ok(suggestions.length >= 4);
  assert.ok(suggestions.some((suggestion) => suggestion.title === 'Explain this concept'));
  assert.ok(suggestions.some((suggestion) => suggestion.title === 'Help me study'));
});
