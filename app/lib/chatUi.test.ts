import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttachmentGridClass, getAttachmentPreviewClass, getMessageSurfaceClass, getComposerSurfaceClass } from './chatUi';

test('returns a single-column grid for one attachment', () => {
  assert.equal(getAttachmentGridClass(1), 'grid-cols-1');
});

test('uses a compact grid for multiple images', () => {
  assert.equal(getAttachmentGridClass(3), 'grid-cols-2 sm:grid-cols-3');
  assert.equal(getAttachmentGridClass(4), 'grid-cols-2 sm:grid-cols-3');
});

test('keeps preview wrappers compact for small attachment groups', () => {
  assert.equal(getAttachmentPreviewClass(1), 'max-w-[280px]');
  assert.equal(getAttachmentPreviewClass(2), 'max-w-[320px]');
});

test('adds streaming polish classes to assistant bubbles', () => {
  const classes = getMessageSurfaceClass(false, true, false);
  assert.match(classes, /ring-1/);
  assert.match(classes, /shadow-\[/);
  assert.match(classes, /bg-zinc-900\/95/);
});

test('adds focused composer styling for active input', () => {
  const classes = getComposerSurfaceClass(true, false);
  assert.match(classes, /border-cyan-400\/40/);
  assert.match(classes, /bg-zinc-900\/95/);
});
