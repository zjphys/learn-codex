// Optional integration test. Use an existing Playwright install and Visualize CSS.
// LEARN_PLAYWRIGHT_MODULE: absolute path to playwright/index.mjs (or installed package).
// LEARN_VIZ_CSS: absolute path to the installed Visualize assets/visualize.css.
// LEARN_BROWSER_CHANNEL: optional installed browser channel, e.g. msedge.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { execute } from '../scripts/learn.mjs';
import { initialized, makeQuiz } from './fixtures.mjs';

const modulePath = process.env.LEARN_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const css = fs.readFileSync(process.env.LEARN_VIZ_CSS, 'utf8');
const output = path.resolve(process.argv[2] ?? 'test-results');
fs.mkdirSync(output, { recursive: true });
const fixture = path.join(output, 'learning workspace 学习'); fs.mkdirSync(fixture, { recursive: true });
const base = initialized(fixture), created = makeQuiz(base);
const fragmentPath = path.join(output, 'quiz.html');
execute('render-quiz', { ...base, quizId: created.quiz.id, output: fragmentPath });
let fragment = fs.readFileSync(fragmentPath, 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.LEARN_BROWSER_CHANNEL ? { channel: process.env.LEARN_BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 736, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const harness = (html, state = null, mode = 'success') => '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><script>' +
  'window.sent=[];window.snapshots=[];window.mode=' + JSON.stringify(mode) + ';window.openai={widgetState:' + JSON.stringify(state).replace(/</g, '\\u003c') +
  ',setWidgetState:async(s)=>{window.openai.widgetState=s;window.snapshots.push(s)},sendFollowUpMessage:async(p)=>{if(window.mode==="fail")throw Error("test failure");if(window.mode==="cancel")return false;window.sent.push(p);return {sent:true}}};</script>' + html + '</body></html>';
async function load(state = null, mode = 'success') { await page.setContent(harness(fragment, state, mode)); }
try {
  await load();
  assert.equal(await page.locator('[data-feedback]:visible').count(), 0);
  assert.equal(await page.locator('[data-continue]').isVisible(), false);
  await page.locator('[data-question="q-order"] button').click();
  assert.equal(await page.locator('[data-error]:visible').count(), 1);
  await page.locator('input[value="seq"]').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('input[value="seq"]').isChecked(), true);
  await page.locator('[data-question="q-order"] textarea').fill('Index versus address.');
  const before = await page.evaluate(() => window.openai.widgetState);
  assert.equal(JSON.stringify(before).includes('correctIds'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(before)) < 16384);
  await load(before);
  assert.equal(await page.locator('input[value="seq"]').isChecked(), true);
  assert.equal(await page.locator('[data-question="q-order"] textarea').inputValue(), 'Index versus address.');
  assert.equal(await page.evaluate(() => window.snapshots.length), 0);
  await page.locator('[data-question="q-order"] button').focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('[data-question="q-order"] [data-feedback]').innerText(), /^Correct/);
  assert.equal(await page.locator('[data-question="q-order"] textarea').getAttribute('readonly'), '');
  await page.locator('input[value="ack"]').check();
  await page.locator('[data-question="q-delivery"] button').click();
  assert.match(await page.locator('[data-question="q-delivery"] [data-feedback]').innerText(), /^Incorrect/);
  const complete = await page.evaluate(() => window.openai.widgetState);
  await load(complete, 'fail');
  await page.locator('[data-continue]').click();
  assert.match(await page.locator('[data-status]').innerText(), /Not saved yet/);
  assert.equal(await page.locator('[data-fallback]').isVisible(), true);
  assert.equal(await page.locator('input[value="seq"]').isChecked(), true);
  await page.evaluate(() => window.mode = 'cancel'); await page.locator('[data-continue]').click();
  assert.match(await page.locator('[data-status]').innerText(), /Not saved yet/);
  await page.evaluate(() => window.mode = 'success'); await page.locator('[data-continue]').click();
  assert.match(await page.locator('[data-status]').innerText(), /Wait for Codex to confirm/);
  const sent = await page.evaluate(() => window.sent[0].prompt);
  const request = JSON.parse(sent.slice(sent.indexOf('\n\n') + 2));
  assert.equal(request.attemptId, created.quiz.attemptId);
  const saved = execute('submit-attempt', request);
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.attempt.results.map(r => r.outcome), ['correct', 'incorrect']);
  assert.equal(execute('submit-attempt', request).duplicate, true);
  execute('render-quiz', { ...base, quizId: created.quiz.id, output: fragmentPath });
  fragment = fs.readFileSync(fragmentPath, 'utf8');
  await load();
  assert.match(await page.locator('[data-status]').innerText(), /^Saved/);
  assert.equal(await page.locator('[data-continue]').isVisible(), false);
  for (const width of [320, 736]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    const clipped = await page.locator('fieldset,textarea,button,legend').evaluateAll(nodes => nodes.filter(n => n.offsetParent && (n.getBoundingClientRect().left < 0 || n.getBoundingClientRect().right > innerWidth + 1)).length);
    assert.equal(clipped, 0);
    await page.screenshot({ path: path.join(output, `${width}-${colorScheme}.png`), fullPage: true });
  }
  // Unknown choice exclusivity, state events, and inert hostile labels.
  const unknownQuiz = makeQuiz(base, { title: '</script><img src=x onerror="window.injected=true">' });
  execute('render-quiz', { ...base, quizId: unknownQuiz.quiz.id, output: fragmentPath });
  fragment = fs.readFileSync(fragmentPath, 'utf8'); await load();
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.locator('input[value="seq"]').check();
  await page.locator('[data-question="q-order"] input[aria-label="I don’t know"]').check();
  assert.equal(await page.locator('input[value="seq"]').isChecked(), false);
  await page.locator('[data-question="q-order"] button').click();
  assert.match(await page.locator('[data-question="q-order"] [data-feedback]').innerText(), /^Not yet known/);
  const unknownState = await page.evaluate(() => window.openai.widgetState);
  await load();
  await page.evaluate(s => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: s } } })), unknownState);
  assert.equal(await page.locator('[data-question="q-order"] input[aria-label="I don’t know"]').isChecked(), true);
  assert.equal(await page.evaluate(() => window.snapshots.length), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, scenarios: ['keyboard', 'feedback timing', 'restoration', 'failure and cancellation', 'durable save and replay', '320/736px light/dark', 'unknown choice', 'inert labels'], fixture }, null, 2));
  console.log('Browser acceptance passed: ' + output);
} finally { await context.close(); await browser.close(); }
