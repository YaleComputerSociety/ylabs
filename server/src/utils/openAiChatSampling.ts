const MODELS_THAT_REJECT_TEMPERATURE = /^(gpt-5(-|$)|o\d)/;

export function openAiChatSampling(model: string): Record<string, unknown> {
  return MODELS_THAT_REJECT_TEMPERATURE.test((model ?? '').trim())
    ? { reasoning_effort: 'minimal' }
    : { temperature: 0 };
}
