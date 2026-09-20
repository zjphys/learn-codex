// This exact pure function is embedded into the quiz UI as well as used by Node.
// The saved definition, not an interface-supplied verdict, is authoritative.
export function gradeAnswer(question, answer) {
  if (!answer || answer.questionId !== question.id) throw new Error('Question ID mismatch');
  if (!Array.isArray(answer.selectedIds) || typeof answer.dontKnow !== 'boolean') {
    throw new Error('Answer needs selectedIds and a boolean dontKnow');
  }
  const selected = answer.selectedIds;
  const allowed = new Set(question.options.map(option => option.id));
  if (new Set(selected).size !== selected.length || selected.some(id => !allowed.has(id))) {
    throw new Error('Unknown or duplicate option ID');
  }
  if (answer.dontKnow) {
    if (selected.length) throw new Error('Unknown answers cannot also select options');
    return { outcome: 'unknown', correctIds: [...question.correctIds], explanation: question.explanation };
  }
  if (!selected.length || (!question.multiSelect && selected.length !== 1)) {
    throw new Error('Select an answer or choose I don’t know');
  }
  const correct = selected.length === question.correctIds.length && selected.every(id => question.correctIds.includes(id));
  return { outcome: correct ? 'correct' : 'incorrect', correctIds: [...question.correctIds], explanation: question.explanation };
}
