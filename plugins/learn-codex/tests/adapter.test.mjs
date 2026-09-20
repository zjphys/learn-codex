import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../scripts/visualize-adapter.js', import.meta.url), 'utf8');
function adapter(openai, restore = () => {}) {
  const listeners = new Map();
  const host = { openai, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const context = vm.createContext({ TextEncoder, host, restore });
  const result = vm.runInContext(source + '\ncreateVisualizeAdapter(host,restore)', context);
  return { result, listeners };
}
test('adapter saves only bounded snapshots and never sends on restoration', () => {
  const writes = [], restores = [];
  const { result, listeners } = adapter({ widgetState: { initial: true }, setWidgetState: x => writes.push(x) }, x => restores.push(x));
  assert.equal(result.initial().initial, true);
  result.remember({ privateContent: { quiz: 'one' } });
  result.remember({ privateContent: 'x'.repeat(17000) });
  assert.equal(writes.length, 1);
  listeners.get('openai:set_globals')({ detail: { globals: { widgetState: { quiz: 'two' } } } });
  assert.equal(restores.length, 1); assert.equal(writes.length, 1);
  result.dispose(); assert.equal(listeners.size, 0);
});
test('adapter handles absent, cancelled, rejected and successful follow-up actions', async () => {
  await assert.rejects(adapter({}).result.send('answers'), /unavailable/);
  await assert.rejects(adapter({ sendFollowUpMessage: async () => false }).result.send('answers'), /cancelled/);
  await assert.rejects(adapter({ sendFollowUpMessage: async () => ({ cancelled: true }) }).result.send('answers'), /cancelled/);
  await assert.rejects(adapter({ sendFollowUpMessage: async () => { throw Error('offline'); } }).result.send('answers'), /offline/);
  let sent;
  const response = await adapter({ sendFollowUpMessage: async value => { sent = value; return { sent: true }; } }).result.send('answers');
  assert.equal(sent.prompt, 'answers'); assert.equal(response.sent, true); assert.equal(response.saved, undefined);
});
test('failed widget persistence never blocks interaction', async () => {
  adapter({ setWidgetState: () => { throw Error('no state'); } }).result.remember({});
  adapter({ setWidgetState: async () => { throw Error('no state'); } }).result.remember({});
  await new Promise(resolve => setImmediate(resolve));
});
