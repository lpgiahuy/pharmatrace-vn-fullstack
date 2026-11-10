import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual View Details handler without mounting the account page.
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../app/(ecom)/account/orders/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'button'
    && node.children.some(child => child.getText(source).includes('View Details'))) {
    handler = node.openingElement.attributes.properties.find(attribute => attribute.name?.getText(source) === 'onClick')?.initializer.expression;
  }
  ts.forEachChild(node, visit);
}
visit(source);

// Use the real shared helper so the handler under test behaves as it does in the page.
const helperModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./workflow-error.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, helperModule);
const { workflowErrorMessage } = helperModule.exports;

function setup(getMyOrderById) {
  const selected = [], opened = [], errors = [], loading = [];
  const code = ts.transpileModule(`const click = ${handler.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const click = vm.runInNewContext(`${code}\nclick`, {
    order: { id: 177, orderStatus: 'CANCELLED', cancellationReason: null },
    orderService: { getMyOrderById },
    setSelectedOrder: value => selected.push(value),
    setDetailModalOpen: value => opened.push(value),
    setLoadingDetailId: value => loading.push(value),
    message: { error: value => errors.push(value) },
    Error,
    workflowErrorMessage,
  });
  return { click, selected, opened, errors, loading };
}

test('opens customer details with the saved cancellation reason from the detail API', async () => {
  const detail = { id: 177, orderStatus: 'CANCELLED', cancellationReason: 'test cancellation' };
  const state = setup(async id => {
    assert.equal(id, 177);
    return { success: true, data: detail };
  });
  await state.click();
  assert.equal(state.selected[0]?.cancellationReason, 'test cancellation');
  assert.deepEqual(state.opened, [true]);
  assert.deepEqual(state.loading, [177, null]);
});

test('reports detail loading failures and does not open incomplete order details', async () => {
  const state = setup(async () => { throw new Error('Unable to load order details.'); });
  await state.click();
  assert.deepEqual(state.selected, []);
  assert.deepEqual(state.opened, []);
  assert.deepEqual(state.errors, ['Unable to load order details.']);
  assert.deepEqual(state.loading, [177, null]);
});
