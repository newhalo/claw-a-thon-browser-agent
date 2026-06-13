let customSystemPrompt = process.env.CUSTOM_SYSTEM_PROMPT || null;

export function getCustomSystemPrompt() {
  return customSystemPrompt;
}

export function setCustomSystemPrompt(prompt) {
  customSystemPrompt = prompt || null;
  console.log(`[config] Custom system prompt ${customSystemPrompt ? 'set' : 'cleared'}`);
}
