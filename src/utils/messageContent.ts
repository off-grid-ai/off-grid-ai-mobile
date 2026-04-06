const CONTROL_TOKEN_PATTERNS: RegExp[] = [
  /<\|im_start\|>\s*(?:system|assistant|user|tool)?\s*\n?/gi,
  /<\|im_end\|>\s*\n?/gi,
  /<\|end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\/s>/gi,
  /<tool_call>[\s\S]*?<\/tool_call>\s*/g,
  // Gemma 4 native tool call format: <|tool_call>...<tool_call|>
  // The streaming filter in llmToolGeneration suppresses these live;
  // this catches any that slip through into stored message content.
  /<\|tool_call>[\s\S]*?<tool_call\|>\s*/g,
  // Gemma 4 string-delimiter token that may appear outside a tool block
  /<\|">/g,
];

// Patterns for channel-based thinking format (used by some models like Qwen)
const CHANNEL_ANALYSIS_START = /<\|channel\|>analysis<\|message\|>/gi;
const CHANNEL_FINAL_START = /<\|channel\|>final<\|message\|>/gi;

// Gemma 4 thinking tags: <|channel>thought\n...<channel|>
// These are stripped as a safety net; parseThinkingContent handles them before display.
const GEMMA4_THINK_OPEN = /<\|channel>thought\n/gi;
const GEMMA4_THINK_CLOSE = /<channel\|>/gi;

export function stripControlTokens(content: string): string {
  let result = CONTROL_TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ''), content);
  // Remove channel markers but preserve the content after them
  result = result.replace(CHANNEL_ANALYSIS_START, '');
  result = result.replace(CHANNEL_FINAL_START, '');
  result = result.replace(GEMMA4_THINK_OPEN, '');
  result = result.replace(GEMMA4_THINK_CLOSE, '');
  return result;
}