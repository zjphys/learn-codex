import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execute } from '../scripts/learn.mjs';

export function workspace(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, 'learn-codex-学习 '));
  t?.after(() => {
    if (path.resolve(dir).startsWith(parent + path.sep) && path.basename(dir).startsWith('learn-codex-')) fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
export function initialized(root) {
  const base = { workspace: root, topic: 'tcp' };
  execute('init', { ...base, title: 'Understanding TCP', goal: 'Understand ordering and reliable delivery.', concepts: [
    { id: 'ordering', title: 'Byte ordering', dependsOn: [] }, { id: 'delivery', title: 'Delivery mechanisms', dependsOn: ['ordering'] }
  ] });
  return base;
}
export function makeQuiz(base, changes = {}) {
  const state = execute('load', base).state;
  return execute('create-quiz', { ...base, expectedRevision: state.revision, title: 'TCP check', questions: [
    { id: 'q-order', conceptId: 'ordering', prompt: 'Which information identifies a byte’s place in a stream?', options: [{ id: 'seq', label: 'Sequence number' }, { id: 'port', label: 'Port number' }], correctIds: ['seq'], explanation: 'Sequence numbers identify stream positions.', shuffle: true },
    { id: 'q-delivery', conceptId: 'delivery', prompt: 'Which mechanisms contribute to reliable delivery?', multiSelect: true,
      options: [{ id: 'ack', label: 'Acknowledgments' }, { id: 'retry', label: 'Retransmission' }, { id: 'port', label: 'A port number by itself' }], correctIds: ['ack', 'retry'], explanation: 'Acknowledgments and retransmission help detect and recover missing data.' }
  ], ...changes });
}
export function attempt(base, created) {
  return { ...base, topicId: created.topicId, expectedRevision: created.revision, quizId: created.quiz.id, attemptId: created.quiz.attemptId, answers: [
    { questionId: 'q-order', selectedIds: ['seq'], dontKnow: false, note: 'Position, not endpoint.' },
    { questionId: 'q-delivery', selectedIds: ['retry', 'ack'], dontKnow: false, note: '' }
  ] };
}
