import fs from 'node:fs';
import path from 'node:path';
import { gradeAnswer } from './grading.mjs';
import { pluginRoot, fail, atomicWrite } from './store.mjs';

export function renderQuiz({ state, quiz, attempt, workspace, output }) {
  if (typeof output !== 'string' || !path.isAbsolute(output) || path.extname(output) !== '.html') fail('INVALID_INPUT', 'output must be an absolute .html path in a writable visualization directory');
  const parent = fs.realpathSync(path.dirname(output));
  const plugin = fs.realpathSync(pluginRoot);
  if (parent === plugin || parent.startsWith(plugin + path.sep)) fail('UNSAFE_PATH', 'Render outside the installed plugin');
  const rootId = 'learn-' + quiz.id + '-' + quiz.attemptId;
  const payload = { version: 1, rootId, workspace, topic: state.topic, topicId: state.topicId, revision: state.revision, quiz, savedAttempt: attempt ?? null };
  // Escape script delimiters; text is inserted into the DOM only with textContent.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  let html = fs.readFileSync(path.join(pluginRoot, 'assets', 'quiz.html'), 'utf8');
  const adapter = fs.readFileSync(path.join(pluginRoot, 'scripts', 'visualize-adapter.js'), 'utf8');
  const client = fs.readFileSync(path.join(pluginRoot, 'scripts', 'quiz-client.js'), 'utf8');
  html = html.replaceAll('__ROOT_ID__', rootId).replace('/*__GRADING__*/', () => gradeAnswer.toString())
    .replace('/*__ADAPTER__*/', () => adapter).replace('/*__CLIENT__*/', () => client).replace('/*__DATA__*/', () => json);
  if (Buffer.byteLength(html) >= 1024 * 1024) fail('INVALID_INPUT', 'Quiz fragment exceeds 1 MB');
  atomicWrite(path.join(parent, path.basename(output)), html);
  const chat = quiz.questions.map((q, i) => `${i + 1}. ${q.prompt}\n${q.options.map((o, j) => `   ${j + 1}. ${o.label}`).join('\n')}\n   I don't know (optional note)`).join('\n\n');
  return { path: path.join(parent, path.basename(output)), quizId: quiz.id, attemptId: quiz.attemptId, revision: state.revision, saved: !!attempt, chat };
}
