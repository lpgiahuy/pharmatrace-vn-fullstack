import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
function setup() {
  const states = [], errors = [], message = { error: value => errors.push(value) };
  let cursor, dependencies, cleanup;
  const { useLogisticsList: renderList } = compile('./useLogisticsList.ts', {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useCallback: callback => callback,
      useEffect(effect, next) {
        if (dependencies && next.every((value, index) => Object.is(value, dependencies[index]))) return;
        cleanup?.(); dependencies = next; cleanup = effect();
      },
    },
    antd: { App: { useApp: () => ({ message }) } },
    '@/utils/workflow-error': compile('../utils/workflow-error.ts'),
  });
  return { errors, unmount: () => cleanup?.(), render(load, enabled = true) { cursor = 0; return renderList(load, 'Unable to load shipments', enabled); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('retains the latest query result and ignores failures from an obsolete request', async () => {
  const hook = setup(); let rejectOld;
  hook.render(() => new Promise((_, reject) => { rejectOld = reject; })); await flush();
  const load = async () => ['current shipment'];
  hook.render(load); await flush();
  rejectOld(new Error('Obsolete query failed')); await flush();
  assert.deepEqual(hook.render(load).result, ['current shipment']);
  assert.deepEqual(hook.errors, []); hook.unmount();
});
test('does not request or expose COD data after access is removed', async () => {
  const hook = setup(); let calls = 0;
  const load = async () => { calls++; return ['statement']; };
  hook.render(load, false); await flush(); assert.equal(calls, 0);
  hook.render(load); await flush(); assert.equal(calls, 1);
  assert.deepEqual(hook.render(load).result, ['statement']);
  assert.equal(hook.render(load, false).result, undefined); await flush();
  assert.equal(calls, 1); assert.equal(hook.render(load, false).loading, false); hook.unmount();
});
test('refreshes the active query and clears loading after a failure', async () => {
  const hook = setup(); let calls = 0;
  const load = async () => { if (++calls === 2) throw { message: ['Carrier unavailable', 'Retry later'] }; return ['shipment']; };
  hook.render(load); await flush(); hook.render(load).reload(); hook.render(load); await flush();
  assert.equal(calls, 2); assert.deepEqual(hook.errors, ['Carrier unavailable. Retry later']);
  assert.equal(hook.render(load).loading, false); assert.deepEqual(hook.render(load).result, ['shipment']); hook.unmount();
});
