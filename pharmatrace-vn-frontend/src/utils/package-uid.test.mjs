import assert from 'node:assert/strict';
import test from 'node:test';
import { readPackageUid } from './package-uid.ts';

const uid = 'b1029cf3-0246-4e38-8159-7c2422b0a001';

test('reads a UID entered manually or by a hardware scanner', () => {
  assert.equal(readPackageUid(`  ${uid.toUpperCase()}\r\n`), uid);
});

test('reads the UID from a QR traceability URL', () => {
  assert.equal(readPackageUid(`https://example.test/trace?uid=${uid}&source=qr`), uid);
});

test('rejects unrelated QR content instead of adding a package', () => {
  for (const code of ['', 'not-a-package', 'https://example.test', 'https://example.test/?uid=wrong']) {
    assert.equal(readPackageUid(code), null);
  }
});
