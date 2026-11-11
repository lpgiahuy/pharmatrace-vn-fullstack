import assert from 'node:assert/strict';
import test from 'node:test';
import { codPermissions, codSubmissionMessage } from './cod-workflow.ts';

test('limits statement submission and approval to the corresponding finance roles', () => {
  assert.deepEqual(codPermissions('ACCOUNTANT'), { canView: true, canSubmit: true, canApprove: false });
  assert.deepEqual(codPermissions('FINANCE_MANAGER'), { canView: true, canSubmit: true, canApprove: true });
  assert.deepEqual(codPermissions('SUPER_ADMIN'), { canView: true, canSubmit: true, canApprove: true });
  assert.deepEqual(codPermissions('STORE_MANAGER'), { canView: true, canSubmit: false, canApprove: false });
  assert.deepEqual(codPermissions('WAREHOUSE_STAFF'), { canView: false, canSubmit: false, canApprove: false });
});

test('describes a submitted statement as pending instead of settled', () => {
  assert.match(codSubmissionMessage('PENDING'), /pending approval/i);
  assert.doesNotMatch(codSubmissionMessage('PENDING'), /settled/i);
});
