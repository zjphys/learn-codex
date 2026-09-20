import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function text(value, name, max = 10000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_INPUT', `${name} must be nonempty text, at most ${max} characters`);
  return value.trim();
}
export function id(value, name = 'id') {
  const result = text(value, name, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result)) fail('INVALID_INPUT', `Invalid ${name}`);
  return result;
}
export function list(value, name, max = 200) {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT', `${name} must be an array with at most ${max} entries`);
  return value;
}
export function unique(values, name) {
  if (new Set(values).size !== values.length) fail('INVALID_INPUT', `Duplicate ${name}`);
}
function regular(target, directory = false) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('UNSAFE_PATH', `Expected a regular ${directory ? 'directory' : 'file'}: ${target}`);
}
export function paths(workspace, topic, create = false) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) fail('INVALID_INPUT', 'workspace must be an absolute existing directory');
  const root = fs.realpathSync(workspace);
  const plugin = fs.realpathSync(pluginRoot);
  if (root === plugin || root.startsWith(plugin + path.sep)) fail('UNSAFE_PATH', 'Learning data must live outside the installed plugin');
  if (!fs.statSync(root).isDirectory()) fail('INVALID_INPUT', 'workspace must be a directory');
  id(topic, 'topic');
  const learning = path.join(root, '.learning');
  regular(learning, true);
  if (create) fs.mkdirSync(learning, { recursive: true });
  const dir = path.join(learning, topic);
  regular(dir, true);
  if (create) fs.mkdirSync(dir, { recursive: true });
  const state = path.join(dir, 'state.json');
  regular(state);
  return { root, dir, state, lock: path.join(dir, '.write-lock'), notes: path.join(dir, 'generated.md'), learner: path.join(dir, 'learner.md') };
}
export function readState(p) {
  if (!fs.existsSync(p.state)) fail('NOT_FOUND', 'Topic not found; initialize it first');
  regular(p.state);
  let state;
  try { state = JSON.parse(fs.readFileSync(p.state, 'utf8')); }
  catch { fail('CORRUPT_STATE', 'state.json is unreadable JSON; preserve it and restore a verified backup'); }
  if (state.schemaVersion !== 1) fail('SCHEMA_VERSION', 'Unsupported state version; no files were changed');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.topicId !== 'string' ||
      state.topic !== path.basename(p.dir) || !['concepts', 'gaps', 'sources', 'quizzes', 'attempts', 'checkpoints'].every(k => Array.isArray(state[k]))) {
    fail('CORRUPT_STATE', 'Invalid state structure; no files were changed');
  }
  return state;
}
export function withLock(p, fn) {
  try { fs.mkdirSync(p.lock); }
  catch (error) { if (error.code === 'EEXIST') fail('BUSY', 'Topic is locked. Retry after the other writer completes; use recover-lock only after a crashed writer.'); throw error; }
  try {
    fs.writeFileSync(path.join(p.lock, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });
    return fn();
  } finally {
    fs.rmSync(path.join(p.lock, 'owner.json'), { force: true });
    fs.rmdirSync(p.lock);
  }
}
export function recoverLock(p) {
  regular(p.lock, true);
  if (!fs.existsSync(p.lock)) return { recovered: false };
  const ownerPath = path.join(p.lock, 'owner.json');
  regular(ownerPath);
  let owner;
  try { owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); }
  catch { fail('BUSY', 'Lock has no readable owner; inspect it manually before recovery'); }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) fail('BUSY', 'Invalid lock owner; inspect it manually');
  try { process.kill(owner.pid, 0); fail('BUSY', 'Lock owner is still running'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  // Rename claims the dead lock; never recursively delete an arbitrary path.
  const retired = p.lock + '-' + randomUUID();
  fs.renameSync(p.lock, retired);
  fs.unlinkSync(path.join(retired, 'owner.json'));
  fs.rmdirSync(retired);
  return { recovered: true };
}
export function atomicWrite(target, content) {
  regular(target);
  const temp = target + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}
const quote = value => String(value).split('\n').map(line => '> ' + line).join('\n');
export function markdown(state) {
  const out = [`# ${state.title.replace(/[\r\n]/g, ' ')}`, '', '> Generated from state.json. Put personal notes in learner.md.', '', `Revision: ${state.revision}`, '', '## Learning goal', '', state.goal, '', '## Next step', '', state.nextStep || 'Choose the next useful concept.', '', '## Current gaps', ''];
  out.push(...(state.gaps.length ? state.gaps.map(gap => `- ${gap.description.replace(/[\r\n]/g, ' ')} (${gap.conceptId})`) : ['No recorded unresolved gaps. This does not establish mastery.']));
  for (const checkpoint of state.checkpoints) out.push('', `## ${checkpoint.title.replace(/[\r\n]/g, ' ')}`, '', checkpoint.summary, '', `Checkpoint: ${checkpoint.id} · ${checkpoint.createdAt}`);
  for (const attempt of state.attempts) {
    const quiz = state.quizzes.find(q => q.id === attempt.quizId);
    out.push('', `## Quiz: ${quiz.title.replace(/[\r\n]/g, ' ')}`, '', `Attempt: ${attempt.id} · ${attempt.createdAt}`);
    for (const result of attempt.results) {
      const q = quiz.questions.find(q => q.id === result.questionId);
      const answer = attempt.answers.find(a => a.questionId === q.id);
      out.push('', quote(q.prompt), '', `Result: **${result.outcome}**`, '', 'Answer: ' + (answer.dontKnow ? 'I don’t know' : answer.selectedIds.map(i => q.options.find(o => o.id === i).label).join('; ')), '', 'Correct answer: ' + q.correctIds.map(i => q.options.find(o => o.id === i).label).join('; '), '', q.explanation);
      if (answer.note) out.push('', 'Learner note:', '', quote(answer.note));
    }
  }
  out.push('', '## Sources', '');
  for (const source of state.sources) out.push(`- ${source.id}: ${source.title.replace(/[\r\n]/g, ' ')} — ${source.location}`);
  return out.join('\n') + '\n';
}
export function projectNotes(p, state) {
  atomicWrite(p.notes, markdown(state));
  regular(p.learner);
  if (!fs.existsSync(p.learner)) fs.writeFileSync(p.learner, '# My learning notes\n\n', { flag: 'wx', mode: 0o600 });
}
export function commit(p, state) {
  state.updatedAt = new Date().toISOString();
  atomicWrite(p.state, JSON.stringify(state, null, 2) + '\n');
  const warnings = [];
  try { projectNotes(p, state); } catch (error) { warnings.push(`Progress is saved, but Markdown projection failed: ${error.message}. Run repair-notes.`); }
  return { revision: state.revision, topicId: state.topicId, saved: true, warnings, statePath: p.state, notesPath: p.notes };
}
