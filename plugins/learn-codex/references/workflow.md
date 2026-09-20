# Workspace workflow and helper contract

The plugin root is two directories above a skill directory. Resolve `scripts/learn.mjs` relative to the loaded skill, not the current shell directory. Node.js 22+ is the only helper dependency; no npm install, API key, pi runtime, or server is required.

Run `node <absolute-plugin-root>/scripts/learn.mjs <operation> --input <absolute-request.json>`. Alternatively supply JSON on stdin. Write request files with a file tool; never interpolate questions, notes, paths, or JSON into shell code. Use the user's active learning workspace as `workspace`, an absolute existing directory outside the plugin. In a projectless task, use its assigned workspace. If a user chooses a new standalone project, initialize Git there. Do not modify an unrelated project merely to add learning state.

Responses are one JSON object: success has `ok: true`; errors have `ok: false, error: {code, message}` and a nonzero exit code. Mutations return `revision`, `saved`, and any `warnings`. `init` on an existing topic returns its state without altering it. Reads do not repair or rewrite files.

## Operations

All operations require `workspace`. All except `list` require `topic`, a short ASCII slug (letters, digits, hyphens, underscores; no Windows device names). Titles, content, and workspace paths support Unicode. Use UUID-backed helper-generated IDs unless a stable caller ID is needed.

| Operation | Additional input | Result |
| --- | --- | --- |
| `list` | None | Topic names, revisions, next steps |
| `init` | `title`, `goal`; optional `concepts`, `sources` | New state at revision 0, or unchanged existing state |
| `load` | None | Full state and paths to generated and learner notes |
| `save-checkpoint` | `expectedRevision`, `title`, `summary`; optional fields below | Saved checkpoint and new revision |
| `create-quiz` | `expectedRevision`, `title`, `questions`; optional `quizId` | Persisted quiz, stable attempt ID, display order, new revision |
| `render-quiz` | `quizId`, `output` (absolute `.html` file; parent must exist) | Fragment path and numbered `chat` alternative |
| `submit-attempt` | `expectedRevision`, `topicId`, `quizId`, `attemptId`, `answers` | Recomputed results and durable save acknowledgment |
| `repair-notes` | None | Rebuild generated notes without changing the revision |
| `recover-lock` | None | Remove a lock only if its recorded process is no longer alive |

`render-quiz` writes only the explicitly named output file. It does not start a server. Use a task-owned writable visualization directory, not the plugin directory. A text-only client can present stored questions directly, without rendering.

### Topic data

`concepts`: `[{id, title, dependsOn: [conceptId]}]`. Dependencies must exist and be acyclic. `sources`: `[{id, title, location}]` where location is a verified URL or source-file reference. These source locations are citations, never executable commands.

`save-checkpoint` optionally accepts `concepts` and `sources` to upsert by ID; `completedConceptIds`, `sourceIds`, `evidenceAttemptIds`, `resolvedGapIds`, `nextStep`, and `checkpointId`. Completed means covered in a lesson, not mastered. To resolve a recorded quiz gap, include a later saved correct attempt for the same concept in `evidenceAttemptIds`, and its gap ID in `resolvedGapIds`. Explain why the evidence is adequate in the summary. Other gaps are preserved.

### Question

```json
{
  "id": "ordering-check",
  "conceptId": "ordering",
  "prompt": "Which information lets a receiver put bytes back in order?",
  "options": [
    {"id": "sequence", "label": "Sequence numbers"},
    {"id": "port", "label": "Port numbers"}
  ],
  "correctIds": ["sequence"],
  "multiSelect": false,
  "shuffle": true,
  "explanation": "Sequence numbers identify positions in the byte stream; port numbers identify endpoints within a host.",
  "sourceIds": []
}
```

One quiz has 1–5 questions with 2–6 options each. Use explicit option IDs when referencing a key. Single-choice needs one correct ID. Multiple-choice uses exact-set grading without partial credit. `shuffle` defaults to true and is performed only when creating the quiz. Explain and verify the key before publishing the question, without revealing it to the learner.

### Attempt

```json
{
  "questionId": "ordering-check",
  "selectedIds": ["sequence"],
  "dontKnow": false,
  "note": "I think these describe positions, not destinations."
}
```

An attempt must answer each quiz question exactly once. Notes have a 300-character limit. Unknown answers have `dontKnow: true` and `selectedIds: []`. The helper accepts only known IDs and grades from its saved key. Returned grades from a widget are never authoritative. Each quiz has one stable attempt ID: a reassessment is a new quiz, not an overwrite of history.

## Persistence and recovery

Each subject has `.learning/<topic>/state.json` (schema version 1), `generated.md`, and `learner.md`. JSON is authoritative and contains identity, revision, goal, concept graph, sources, checkpoints, quizzes, attempts, unresolved gaps, and next step. Quiz HTML is a separate presentation file. Do not commit personal learning data without a request.

Read the current revision before mutations. A per-topic filesystem lock serializes writers; the expected revision prevents lost updates. Repeated identical attempt IDs return their original result; conflicting reuse fails. On `REVISION_CONFLICT`, reload, reconcile the intended change, then retry. Never replace unrelated concurrent learning changes. On `BUSY`, wait for the writer to finish; if it crashed, `recover-lock` checks that its process is dead. An ownerless/corrupt lock requires inspection instead of blind deletion.

Writes use a same-directory temporary file, fsync, then rename. A crash before rename leaves the old state; abandoned temporary files are ignored. If JSON saved but Markdown generation failed, the helper returns `saved: true` with a warning. Run `repair-notes`, preserving `learner.md`. Unknown schema versions or corrupt state fail without overwriting data. Restore a verified backup or report the problem rather than inventing history.

The helper rejects plugin-internal learning workspaces, unsafe topic paths, symlinked data directories and files, and unsupported versions. It does not read Codex private transcripts, install hooks, or use widget state as a database.
