// Host-specific code lives here. No network calls or filesystem claims.
function createVisualizeAdapter(host, onRestore) {
  const listener = event => {
    if (event.detail?.globals?.widgetState !== undefined) onRestore(event.detail.globals.widgetState);
  };
  host.addEventListener('openai:set_globals', listener);
  return {
    initial: () => host.openai?.widgetState,
    remember(snapshot) {
      try {
        if (new TextEncoder().encode(JSON.stringify(snapshot)).length >= 16384) return;
        Promise.resolve(host.openai?.setWidgetState?.(snapshot)).catch(() => {});
      } catch { /* Interface restoration is best-effort, never durable storage. */ }
    },
    async send(prompt) {
      if (typeof host.openai?.sendFollowUpMessage !== 'function') throw new Error('Follow-up action unavailable');
      const result = await host.openai.sendFollowUpMessage({ prompt, title: 'Save quiz answers and continue learning' });
      if (result === false || result?.cancelled || result?.canceled || ['cancelled', 'canceled'].includes(result?.status)) throw new Error('Follow-up cancelled');
      return result;
    },
    dispose() { host.removeEventListener('openai:set_globals', listener); }
  };
}
