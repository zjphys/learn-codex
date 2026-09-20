import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute } from '../scripts/learn.mjs';
import { gradeAnswer } from '../scripts/grading.mjs';
import { pluginRoot } from '../scripts/store.mjs';
import { workspace, initialized, makeQuiz, attempt } from './fixtures.mjs';

const cli = fileURLToPath(new URL('../scripts/learn.mjs', import.meta.url));
function call(operation, input) {
  const result = spawnSync(process.execPath, [cli, operation], { input: JSON.stringify(input), encoding: 'utf8' });
  return { exit: result.status, ...JSON.parse(result.stdout) };
}
function asyncCall(operation, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, operation]); let output = '';
    child.on('error', reject); child.stdout.on('data', data => output += data);
    child.on('close', exit => { try { resolve({ exit, ...JSON.parse(output) }); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify(input));
  });
}
test('init, persistence, Unicode workspace, and fresh process resume', t => {
  const base = initialized(workspace(t)); const created = makeQuiz(base);
  const saved = call('submit-attempt', attempt(base, created));
  assert.equal(saved.ok, true); assert.equal(saved.saved, true);
  const resumed = call('load', base);
  assert.equal(resumed.state.attempts.length, 1);
  assert.deepEqual(resumed.state.attempts[0].results.map(r => r.outcome), ['correct', 'correct']);
  assert.match(fs.readFileSync(resumed.notesPath, 'utf8'), /Position, not endpoint/);
  assert.equal(execute('init', { ...base, title: 'ignored', goal: 'ignored' }).initialized, false);
  assert.equal(execute('list', { workspace: base.workspace }).topics[0].topic, 'tcp');
});
test('single, multi, unknown, invalid and duplicate selections', () => {
  const question = { id: 'q', options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], correctIds: ['a', 'b'], multiSelect: true, explanation: 'why' };
  const grade = (selectedIds, dontKnow = false) => gradeAnswer(question, { questionId: 'q', selectedIds, dontKnow });
  assert.equal(grade(['b', 'a']).outcome, 'correct');
  assert.equal(grade(['a']).outcome, 'incorrect');
  assert.equal(grade(['a', 'b', 'c']).outcome, 'incorrect');
  assert.equal(grade([], true).outcome, 'unknown');
  assert.throws(() => grade(['a'], true)); assert.throws(() => grade([]));
  assert.throws(() => grade(['a', 'a'])); assert.throws(() => grade(['unknown']));
  assert.throws(() => grade(['a'], 'true'));
  assert.throws(() => gradeAnswer({ ...question, multiSelect: false }, { questionId: 'q', selectedIds: ['a', 'b'], dontKnow: false }));
});
test('shuffled order remains canonical across reload and rendering; key never follows position', t => {
  const base = initialized(workspace(t)), created = makeQuiz(base);
  const order = created.quiz.questions.map(q => q.options.map(o => o.id));
  const output = path.join(base.workspace, 'quiz.html');
  execute('render-quiz', { ...base, quizId: created.quiz.id, output });
  const first = fs.readFileSync(output, 'utf8');
  execute('render-quiz', { ...base, quizId: created.quiz.id, output });
  assert.equal(fs.readFileSync(output, 'utf8'), first);
  assert.deepEqual(execute('load', base).state.quizzes[0].questions.map(q => q.options.map(o => o.id)), order);
  assert.equal(execute('submit-attempt', attempt(base, created)).attempt.results[0].outcome, 'correct');
});
test('duplicate attempt is idempotent even after revision changed; changed answers conflict', t => {
  const base = initialized(workspace(t)), created = makeQuiz(base), request = attempt(base, created);
  const first = execute('submit-attempt', request);
  const again = execute('submit-attempt', request);
  assert.equal(again.duplicate, true); assert.equal(again.revision, first.revision);
  request.answers[0].selectedIds = ['port'];
  assert.throws(() => execute('submit-attempt', request), { code: 'ATTEMPT_CONFLICT' });
  assert.equal(execute('load', base).state.attempts.length, 1);
});
test('unknown result records gap; subsequent review preserves evidence and learner notes', t => {
  const base = initialized(workspace(t)), created = makeQuiz(base), request = attempt(base, created);
  request.answers[0] = { questionId: 'q-order', selectedIds: [], dontKnow: true, note: 'Not sure yet.' };
  const saved = execute('submit-attempt', request);
  assert.equal(saved.attempt.results[0].outcome, 'unknown');
  const loaded = execute('load', base);
  fs.writeFileSync(loaded.learnerNotesPath, '# My explanation\nKeep me.');
  execute('save-checkpoint', { ...base, expectedRevision: saved.revision, title: 'Ordering', summary: 'We connected stream positions to ordering.', completedConceptIds: ['ordering'], nextStep: 'Try a fresh ordering question.' });
  const review = call('load', base).state;
  assert.equal(review.gaps.length, 1); assert.equal(review.gaps[0].conceptId, 'ordering');
  assert.equal(review.checkpoints.length, 1);
  assert.match(fs.readFileSync(loaded.notesPath, 'utf8'), /Not sure yet/);
  assert.match(fs.readFileSync(loaded.learnerNotesPath, 'utf8'), /Keep me/);
});
test('gaps require later concept-matched evidence for resolution', t => {
  const base = initialized(workspace(t)); const first = makeQuiz(base); const request = attempt(base, first);
  request.answers[0].selectedIds = ['port']; execute('submit-attempt', request);
  let state = execute('load', base).state;
  assert.throws(() => execute('save-checkpoint', { ...base, expectedRevision: state.revision, title: 'done', summary: 'done', resolvedGapIds: [state.gaps[0].id] }), /requires/);
  const second = makeQuiz(base); const correct = execute('submit-attempt', attempt(base, second));
  state = execute('load', base).state;
  execute('save-checkpoint', { ...base, expectedRevision: state.revision, title: 'Checked', summary: 'A fresh ordering assessment was correct.', resolvedGapIds: [state.gaps[0].id], evidenceAttemptIds: [correct.attempt.id] });
  assert.equal(execute('load', base).state.gaps.length, 0);
});
test('reject stale revisions without losing newer checkpoints', t => {
  const base = initialized(workspace(t));
  execute('save-checkpoint', { ...base, expectedRevision: 0, title: 'first', summary: 'first' });
  assert.throws(() => execute('save-checkpoint', { ...base, expectedRevision: 0, title: 'second', summary: 'second' }), { code: 'REVISION_CONFLICT' });
  assert.equal(execute('load', base).state.checkpoints[0].title, 'first');
});
test('concurrent writers cannot overwrite each other', async t => {
  const base = initialized(workspace(t));
  const results = await Promise.all([1, 2].map(n => asyncCall('save-checkpoint', { ...base, expectedRevision: 0, title: `writer ${n}`, summary: `writer ${n}` })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.ok(['BUSY', 'REVISION_CONFLICT'].includes(results.find(r => !r.ok).error.code));
  const state = execute('load', base).state;
  assert.equal(state.checkpoints.length, 1); assert.equal(state.revision, 1);
});
test('interrupted write preserves old state; dead lock can be recovered', t => {
  const base = initialized(workspace(t)); const file = execute('load', base).statePath;
  const lock = path.join(path.dirname(file), '.write-lock');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import fs from 'node:fs';const p=JSON.parse(process.argv[1]);fs.mkdirSync(p.lock);fs.writeFileSync(p.lock+'/owner.json',JSON.stringify({pid:process.pid}));fs.writeFileSync(p.file+'.abandoned.tmp','{broken');process.exit(7)", JSON.stringify({ file, lock })]);
  assert.equal(child.status, 7);
  assert.equal(execute('load', base).state.revision, 0);
  assert.equal(execute('recover-lock', base).recovered, true);
  execute('save-checkpoint', { ...base, expectedRevision: 0, title: 'recovered', summary: 'old state survived' });
  assert.equal(execute('load', base).state.revision, 1);
});
test('live lock cannot be recovered', t => {
  const base = initialized(workspace(t)); const lock = path.join(path.dirname(execute('load', base).statePath), '.write-lock');
  fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
  assert.throws(() => execute('recover-lock', base), { code: 'BUSY' });
});
test('workspace and topic isolation, path traversal and plugin directory protections', t => {
  const first = initialized(workspace(t)), second = initialized(workspace(t));
  const created = makeQuiz(first);
  assert.throws(() => execute('submit-attempt', { ...attempt(first, created), workspace: second.workspace }), /identity mismatch/);
  assert.equal(execute('load', second).state.quizzes.length, 0);
  for (const topic of ['../escape', '..', 'CON', 'a/b', 'a\\b']) assert.throws(() => execute('load', { ...first, topic }));
  assert.throws(() => execute('init', { workspace: pluginRoot, topic: 'test', title: 'test', goal: 'test' }), { code: 'UNSAFE_PATH' });
});
test('schema and malformed state fail without overwriting files', t => {
  const base = initialized(workspace(t)), p = execute('load', base).statePath;
  const original = fs.readFileSync(p, 'utf8');
  const future = { ...JSON.parse(original), schemaVersion: 99 }; fs.writeFileSync(p, JSON.stringify(future));
  assert.throws(() => execute('load', base), { code: 'SCHEMA_VERSION' });
  fs.writeFileSync(p, '{oops'); assert.throws(() => execute('load', base), { code: 'CORRUPT_STATE' });
  assert.equal(fs.readFileSync(p, 'utf8'), '{oops');
});
test('Markdown failure does not lose a committed result and repair preserves personal notes', t => {
  const base = initialized(workspace(t)), p = execute('load', base);
  fs.unlinkSync(p.notesPath); fs.mkdirSync(p.notesPath);
  const saved = execute('save-checkpoint', { ...base, expectedRevision: 0, title: 'saved', summary: 'durable first' });
  assert.equal(saved.saved, true); assert.equal(saved.warnings.length, 1);
  fs.rmdirSync(p.notesPath); execute('repair-notes', base);
  assert.match(fs.readFileSync(p.notesPath, 'utf8'), /durable first/);
});
test('reject invalid question keys, cyclic concepts and forged attempt IDs', t => {
  const base = initialized(workspace(t));
  assert.throws(() => execute('save-checkpoint', { ...base, expectedRevision: 0, title: 'cycle', summary: 'cycle', concepts: [{ id: 'ordering', title: 'Ordering', dependsOn: ['delivery'] }] }), /acyclic/);
  const created = makeQuiz(base), request = attempt(base, created);
  assert.throws(() => execute('submit-attempt', { ...request, attemptId: 'forged' }), /attempt ID/);
  assert.throws(() => execute('submit-attempt', { ...request, answers: [] }), /every question/);
  assert.throws(() => makeQuiz(base, { questions: [{ ...created.quiz.questions[0], correctIds: ['missing'] }] }), /correctIds/);
});
test('JSON file transport supports BOM and shell-like text literally', t => {
  const root = workspace(t), inputFile = path.join(root, '输入 request.json');
  const title = 'Literal `x` $(echo danger) </script>';
  fs.writeFileSync(inputFile, '\uFEFF' + JSON.stringify({ workspace: root, topic: 'test', title, goal: 'test' }));
  const result = spawnSync(process.execPath, [cli, 'init', '--input', inputFile], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).state.title, title);
});
