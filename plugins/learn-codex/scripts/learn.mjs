#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { gradeAnswer } from './grading.mjs';
import { renderQuiz } from './render.mjs';
import { paths, readState, withLock, recoverLock, commit, projectNotes, fail, text, id, list, unique } from './store.mjs';

const now = () => new Date().toISOString();
const newId = prefix => prefix + '-' + randomUUID();
function revision(state, input) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== state.revision) {
    fail('REVISION_CONFLICT', `Reload topic and retry with expectedRevision ${state.revision}`);
  }
}
function references(values = [], sources) {
  list(values, 'sourceIds', 30).forEach(v => { if (!sources.some(s => s.id === v)) fail('INVALID_INPUT', `Unknown source: ${v}`); });
  unique(values, 'source IDs');
  return values;
}
function concepts(values) {
  const result = list(values, 'concepts').map(c => ({ id: id(c.id), title: text(c.title, 'concept title', 300), dependsOn: list(c.dependsOn ?? [], 'dependsOn', 40).map(v => id(v)) }));
  unique(result.map(c => c.id), 'concept IDs');
  const visited = new Set(), active = new Set(), lookup = new Map(result.map(c => [c.id, c]));
  function visit(key) {
    if (active.has(key)) fail('INVALID_INPUT', 'Concept dependencies must be acyclic');
    if (visited.has(key)) return;
    const item = lookup.get(key);
    if (!item) fail('INVALID_INPUT', `Unknown dependency: ${key}`);
    active.add(key); item.dependsOn.forEach(visit); active.delete(key); visited.add(key);
  }
  result.forEach(c => visit(c.id));
  return result;
}
function sourceList(values) {
  const result = list(values, 'sources').map(s => ({ id: id(s.id), title: text(s.title, 'source title', 500), location: text(s.location, 'source location', 2000) }));
  unique(result.map(s => s.id), 'source IDs');
  return result;
}
function quizDefinition(input, state) {
  const questions = list(input.questions, 'questions', 5).map(q => {
    const options = list(q.options, 'options', 6).map(o => ({ id: id(o.id ?? newId('option')), label: text(o.label, 'option label', 500) }));
    if (options.length < 2) fail('INVALID_INPUT', 'A question needs at least two options');
    unique(options.map(o => o.id), 'option IDs');
    const correctIds = list(q.correctIds, 'correctIds', 6).map(v => id(v));
    unique(correctIds, 'correct IDs');
    if (!correctIds.length || correctIds.some(v => !options.some(o => o.id === v))) fail('INVALID_INPUT', 'correctIds must refer to options');
    if (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean') fail('INVALID_INPUT', 'multiSelect must be boolean');
    if (q.shuffle !== undefined && typeof q.shuffle !== 'boolean') fail('INVALID_INPUT', 'shuffle must be boolean');
    const multiSelect = q.multiSelect ?? false;
    if (!multiSelect && correctIds.length !== 1) fail('INVALID_INPUT', 'Single-choice questions need one correct answer');
    if (!state.concepts.some(c => c.id === q.conceptId)) fail('INVALID_INPUT', `Unknown concept: ${q.conceptId}`);
    if (q.shuffle !== false) for (let i = options.length - 1; i > 0; i--) { const j = randomInt(i + 1); [options[i], options[j]] = [options[j], options[i]]; }
    return { id: id(q.id ?? newId('question')), conceptId: q.conceptId, prompt: text(q.prompt, 'question prompt', 2000), options, correctIds, multiSelect,
      explanation: text(q.explanation, 'explanation', 5000), sourceIds: references(q.sourceIds, state.sources) };
  });
  if (!questions.length) fail('INVALID_INPUT', 'A quiz needs at least one question');
  unique(questions.map(q => q.id), 'question IDs');
  return { id: id(input.quizId ?? newId('quiz')), attemptId: newId('attempt'), title: text(input.title, 'quiz title', 200), createdAt: now(), questions };
}
function normalizedAnswers(quiz, input) {
  const answers = list(input.answers, 'answers', 5).map(a => {
    if (a.note !== undefined && (typeof a.note !== 'string' || a.note.length > 300)) fail('INVALID_INPUT', 'note must be text of at most 300 characters');
    return { questionId: id(a.questionId), selectedIds: list(a.selectedIds, 'selectedIds', 6).map(v => id(v)), dontKnow: a.dontKnow, note: (a.note ?? '').trim() };
  });
  unique(answers.map(a => a.questionId), 'answer question IDs');
  if (answers.length !== quiz.questions.length || answers.some(a => !quiz.questions.some(q => q.id === a.questionId))) fail('INVALID_INPUT', 'Answer every question in this quiz exactly once');
  return quiz.questions.map(q => {
    const answer = answers.find(a => a.questionId === q.id);
    gradeAnswer(q, answer);
    return { ...answer, selectedIds: [...answer.selectedIds].sort() };
  });
}
export function execute(operation, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'Expected a JSON object');
  if (operation === 'list') {
    // Reuse path validation with a harmless topic name; no directory is created.
    const p = paths(input.workspace, 'topic');
    const parent = path.dirname(p.dir);
    const topics = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => {
      try { const s = readState(paths(input.workspace, e.name)); return { topic: s.topic, title: s.title, revision: s.revision, nextStep: s.nextStep }; }
      catch (e2) { return { topic: e.name, error: e2.code ?? 'ERROR' }; }
    }) : [];
    return { topics };
  }
  const p = paths(input.workspace, input.topic, operation === 'init');
  if (operation === 'load') return { state: readState(p), statePath: p.state, notesPath: p.notes, learnerNotesPath: p.learner };
  if (operation === 'recover-lock') return recoverLock(p);
  if (operation === 'render-quiz') {
    const state = readState(p);
    const quiz = state.quizzes.find(q => q.id === input.quizId);
    if (!quiz) fail('NOT_FOUND', 'Quiz not found');
    const attempt = state.attempts.find(a => a.id === quiz.attemptId);
    return renderQuiz({ state, quiz, attempt, workspace: p.root, output: input.output });
  }
  if (!['init', 'create-quiz', 'submit-attempt', 'save-checkpoint', 'repair-notes'].includes(operation)) fail('INVALID_INPUT', 'Unknown operation');
  return withLock(p, () => {
    if (operation === 'init') {
      if (fs.existsSync(p.state)) return { initialized: false, state: readState(p) };
      const state = { schemaVersion: 1, topicId: newId('topic'), topic: input.topic, title: text(input.title, 'title', 200), goal: text(input.goal, 'goal'), revision: 0,
        createdAt: now(), updatedAt: now(), concepts: concepts(input.concepts ?? []), gaps: [], sources: sourceList(input.sources ?? []), quizzes: [], attempts: [], checkpoints: [], nextStep: '' };
      return { ...commit(p, state), initialized: true, state };
    }
    const state = readState(p);
    if (operation === 'repair-notes') { projectNotes(p, state); return { repaired: true, revision: state.revision }; }
    if (operation === 'submit-attempt') {
      if (input.topicId !== state.topicId) fail('INVALID_INPUT', 'Topic identity mismatch; use the original workspace');
      const quiz = state.quizzes.find(q => q.id === input.quizId);
      if (!quiz || input.attemptId !== quiz.attemptId) fail('INVALID_INPUT', 'Unknown quiz or attempt ID');
      const answers = normalizedAnswers(quiz, input);
      const existing = state.attempts.find(a => a.id === input.attemptId);
      if (existing) {
        if (JSON.stringify(existing.answers) !== JSON.stringify(answers)) fail('ATTEMPT_CONFLICT', 'This attempt is already saved with different answers; create a new quiz to retry');
        return { saved: true, duplicate: true, revision: state.revision, attempt: existing, statePath: p.state };
      }
      revision(state, input);
      const results = quiz.questions.map(q => ({ questionId: q.id, conceptId: q.conceptId, ...gradeAnswer(q, answers.find(a => a.questionId === q.id)) }));
      const attempt = { id: quiz.attemptId, quizId: quiz.id, createdAt: now(), answers, results };
      state.attempts.push(attempt);
      for (const result of results.filter(r => r.outcome !== 'correct')) {
        state.gaps.push({ id: newId('gap'), conceptId: result.conceptId, description: `${result.outcome === 'unknown' ? 'Unknown answer' : 'Incorrect answer'}: ${quiz.questions.find(q => q.id === result.questionId).prompt}`, attemptId: attempt.id, questionId: result.questionId });
      }
      state.nextStep = results.some(r => r.outcome !== 'correct') ? 'Review the latest quiz gaps and check the underlying reasoning.' : 'Connect this evidence to the next concept; one correct quiz does not establish mastery.';
      state.revision++;
      return { ...commit(p, state), duplicate: false, attempt };
    }
    revision(state, input);
    if (operation === 'create-quiz') {
      const quiz = quizDefinition(input, state);
      if (state.quizzes.some(q => q.id === quiz.id)) fail('INVALID_INPUT', 'Quiz ID already exists');
      state.quizzes.push(quiz); state.revision++;
      return { ...commit(p, state), quiz };
    }
    if (input.concepts !== undefined) {
      const merged = new Map(state.concepts.map(c => [c.id, c]));
      list(input.concepts, 'concepts').forEach(c => merged.set(id(c.id), c));
      state.concepts = concepts([...merged.values()]);
    }
    if (input.sources !== undefined) {
      const merged = new Map(state.sources.map(s => [s.id, s]));
      list(input.sources, 'sources').forEach(s => merged.set(id(s.id), s));
      state.sources = sourceList([...merged.values()]);
    }
    const completedConceptIds = list(input.completedConceptIds ?? [], 'completedConceptIds').map(v => id(v));
    if (completedConceptIds.some(v => !state.concepts.some(c => c.id === v))) fail('INVALID_INPUT', 'Unknown completed concept');
    const evidenceAttemptIds = list(input.evidenceAttemptIds ?? [], 'evidenceAttemptIds').map(v => id(v));
    if (evidenceAttemptIds.some(v => !state.attempts.some(a => a.id === v))) fail('INVALID_INPUT', 'Unknown evidence attempt');
    const resolvedGapIds = list(input.resolvedGapIds ?? [], 'resolvedGapIds').map(v => id(v));
    if (resolvedGapIds.some(v => !state.gaps.some(g => g.id === v))) fail('INVALID_INPUT', 'Unknown gap ID');
    if (resolvedGapIds.length && !evidenceAttemptIds.length) fail('INVALID_INPUT', 'Resolving quiz gaps requires a saved follow-up assessment');
    for (const gapId of resolvedGapIds) {
      const gap = state.gaps.find(g => g.id === gapId);
      const origin = state.attempts.findIndex(a => a.id === gap.attemptId);
      if (!state.attempts.some((a, index) => index > origin && evidenceAttemptIds.includes(a.id) && a.results.some(r => r.conceptId === gap.conceptId && r.outcome === 'correct'))) {
        fail('INVALID_INPUT', 'Gap resolution needs later correct evidence for that concept');
      }
    }
    const checkpoint = { id: id(input.checkpointId ?? newId('checkpoint')), title: text(input.title, 'checkpoint title', 200), summary: text(input.summary, 'summary', 30000), completedConceptIds,
      evidenceAttemptIds, resolvedGapIds, sourceIds: references(input.sourceIds, state.sources), createdAt: now() };
    if (state.checkpoints.some(c => c.id === checkpoint.id)) fail('INVALID_INPUT', 'Checkpoint ID already exists; load before retrying');
    state.checkpoints.push(checkpoint);
    state.gaps = state.gaps.filter(g => !resolvedGapIds.includes(g.id));
    if (input.nextStep !== undefined) state.nextStep = text(input.nextStep, 'nextStep', 2000);
    state.revision++;
    return { ...commit(p, state), checkpoint };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) fail('RUNTIME_VERSION', 'Node.js 22 or newer is required');
    const [operation, flag, filename] = process.argv.slice(2);
    if (!operation || (flag && flag !== '--input') || (flag && !filename) || process.argv.length > 5) fail('INVALID_INPUT', 'Usage: node learn.mjs <operation> [--input request.json]; otherwise reads JSON from stdin');
    const raw = fs.readFileSync(filename ?? 0, 'utf8').replace(/^\uFEFF/, '');
    if (Buffer.byteLength(raw) > 1024 * 1024) fail('INVALID_INPUT', 'Request exceeds 1 MB');
    const data = JSON.parse(raw);
    process.stdout.write(JSON.stringify({ ok: true, ...execute(operation, data) }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code ?? 'INVALID_INPUT', message: error.message } }) + '\n');
    process.exitCode = 1;
  }
}
