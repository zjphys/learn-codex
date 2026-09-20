# Learn with Codex

A reusable Codex plugin for connected understanding, interactive practice, and resumable learning. Adapted from the teaching approach in [amosblomqvist/learn](https://github.com/amosblomqvist/learn). The original pi implementation remains separate.

## Start learning

After installation, open a **new Codex task** in the folder where you want to learn. Select Learn, Quiz, or Review learning from the plugin's skills, or ask:

- “Teach me TCP from its foundations.”
- “Quiz me on this lesson.”
- “Review my gaps and continue learning.”

Lessons use adaptive depth rather than a mandatory interview. Codex can research sources, inspect code/documents, run small examples, and draw diagrams using available tools. The Learn skill delegates research only when independent work helps.

Quizzes give immediate feedback. Click **Continue and save** and send the follow-up when the host prompts. Codex validates the answers and confirms saving. Closing the quiz before this action does not save an attempt to your workspace. If the bridge is unavailable, use the displayed text fallback. A new task can resume from saved files without the previous conversation.

## Requirements

- Codex with plugin and skill support.
- Node.js 22 or newer on PATH. The runtime has no npm dependencies, API key, or background service.
- Visualize for inline interactive quizzes; numbered chat assessment works without it. Scientific plots use standard plotting tools when available.
- Local workspace write access when saving. The plugin does not change sandbox permissions.

## Installation and updates

This plugin is distributed through the repository's `codex-learning` marketplace. From the repository root, run `codex plugin marketplace add .`, followed by `codex plugin add learn-codex@codex-learning`. For GitHub installation, replace the dot with the published `OWNER/learn-codex` repository. Open a fresh task after installation.

Keep the repository checkout as the editable source. Validate and test changes, update the version for a release, then refresh the marketplace and reinstall. The installed plugin cache is not the source directory. Full publication and update instructions live in the repository's root README and PUBLISHING.md.

## Saved data

In each learning workspace:

```text
.learning/<topic>/
  state.json     # authoritative, versioned progress and quiz history
  generated.md   # generated lesson summaries and quiz results
  learner.md     # personal notes, never overwritten by the helper
```

Every mutation checks a revision and uses a per-topic write lock. Identical attempt retries are idempotent. Corrupt and future-version records are preserved rather than reset. Markdown can be rebuilt with `repair-notes`; use `recover-lock` after a crashed writer only. There is no automatic transcript capture, cloud upload, reminder, or Git commit of personal learning data.

The [helper contract](references/workflow.md) documents all inputs and recovery behavior; [quiz interface guidance](references/quiz-interface.md) describes the host adapter. Plain-text quiz labels support Unicode; LaTeX stays in the surrounding lesson.

## Development

Run `npm test` (Node's built-in test runner; no install needed). Use the bundled Codex skill and plugin validators before installation; on Windows, use Python's `-X utf8` flag. Tests cover grading, persistence, revision conflicts, recovery, isolation, and interface adapter contracts.

The optional `node tests/browser-smoke.mjs <output-directory>` test uses an existing Playwright installation. Set `LEARN_PLAYWRIGHT_MODULE` to its absolute `index.mjs`, `LEARN_VIZ_CSS` to the installed Visualize `assets/visualize.css`, and optionally `LEARN_BROWSER_CHANNEL` to an installed browser such as `msedge`. It exercises real keyboard input, feedback timing, restoration, failed/cancelled follow-up actions, canonical persistence, and 320/736px light/dark layouts. The host follow-up bridge is mocked; actual Codex delivery still needs an in-app click. Test output is simulated fixture data, never learner evidence.

The plugin is for self-study, not secure examinations: immediate feedback embeds its key in the client, while the helper independently validates persisted grades. Native UI capabilities vary by surface; the host adapter is intentionally isolated for updates.
