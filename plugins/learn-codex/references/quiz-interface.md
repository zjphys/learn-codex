# Quiz interface adapter

Detect the installed Visualize skill in the current capability list and read it before producing a visualization. Follow its output and theme rules. Do not assume rendering exists in CLI/IDE sessions and do not install plugins without a user request.

Use the saved quiz with `render-quiz`. The reusable literal template is `assets/quiz.html`; it embeds `scripts/quiz-client.js`, the pure `gradeAnswer` function from `scripts/grading.mjs`, and the small host adapter `scripts/visualize-adapter.js`. The fragment uses only native controls and host theme utilities. There are no network calls or runtime packages. Content is inserted through textContent, with script delimiters escaped. Quiz labels are plain text (Unicode notation is supported); render complex equations in the surrounding lesson rather than promising LaTeX rendering inside these controls.

Read the generated file back and check the primary interaction. Return the current skill's content reference on its own line with the absolute fragment path:

```text
visualize{"path":"<absolute-fragment-path>"}
```

## Data flow

1. The canonical quiz is saved with stable question IDs, option IDs, attempt ID, and shuffled order.
2. The fragment presents selections and optional notes. “Check answer” requires a real answer or explicit unknown, locks that question, and reveals its explanation.
3. Interface snapshots use `window.openai.setWidgetState` and restore through `widgetState` / `openai:set_globals`, scoped to the exact topic, quiz, and attempt. Snapshots omit answer keys and stay below 16 KiB. State events never write snapshots back.
4. “Continue and save” calls `window.openai.sendFollowUpMessage({prompt,title})` with the answer data and a request for Codex to grade, save, explain gaps, and continue. Host confirmation may be required. A cancelled, missing, or failed action leaves answers intact and exposes text the learner can send manually. Retrying reuses the attempt ID.
5. Codex checks the workspace, loads canonical state, regrades, and persists with the helper. Only this step establishes durable saving. The interface never treats a sent message as a saved result.
6. To display a saved acknowledgment inside the component, render again from the saved attempt. The helper includes it only after reading it from disk. The same source can also be reopened without losing its saved result.

The widget contains the answer key for immediate local feedback; this is a self-study interface, not a secure examination system. Keys are not displayed until a question is checked. Never include credentials or private access tokens in quiz material or widget snapshots.

If the current host bridge differs from this installed version, use chat assessment while reporting the limitation. Change only the adapter after checking the available runtime documentation; do not invent another bridge or silently claim the result was saved.
