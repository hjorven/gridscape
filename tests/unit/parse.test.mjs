import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsername } from '../../js/api.js';

test('parseUsername accepts names, handles and links', () => {
  assert.equal(parseUsername('torvalds'), 'torvalds');
  assert.equal(parseUsername(' @gaearon '), 'gaearon');
  assert.equal(parseUsername('github.com/hjorven'), 'hjorven');
  assert.equal(parseUsername('https://github.com/octo-dev/repo?tab=x'), 'octo-dev');
  assert.equal(parseUsername('https://www.github.com/a-b'), 'a-b');
});

test('parseUsername rejects invalid input', () => {
  for (const bad of ['', 'not valid!!', '-abc', 'abc-', 'a--b', 'https://gitlab.com/x', 'x'.repeat(40)]) {
    assert.equal(parseUsername(bad), null, bad);
  }
});
