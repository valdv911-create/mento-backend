function hasBinary(text: string) {
  // Null byte or many non-printable control chars
  if (text.indexOf('\0') !== -1) return true;
  const controlMatches = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  if (controlMatches && controlMatches.length > 5) return true;
  return false;
}

function removeScriptTags(text: string) {
  return text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '[removed script]');
}

function stripJavascriptUris(text: string) {
  return text.replace(/javascript:/gi, '');
}

function stripControlChars(text: string) {
  // allow tab/newline/carriage-return
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function collapseWhitespace(text: string) {
  return text.replace(/\s{2,}/g, ' ').trim();
}

export function validateAndSanitizeHistory(history: unknown): { role: string; text: string }[] {
  if (!Array.isArray(history)) throw new Error('History must be an array');

  const sanitized: { role: string; text: string }[] = [];

  for (const msg of history) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      throw new Error('Invalid message format');
    }

    const message = msg as { text?: unknown; role?: unknown };
    if (typeof message.text !== 'string') throw new Error('Invalid message format');

    let text = message.text;

    // Basic length limit to prevent cost attacks
    if (text.length > 2000) {
      throw new Error('Message too long');
    }

    // Reject binary or suspicious payloads
    if (hasBinary(text)) {
      throw new Error('Binary or invalid characters in message');
    }

    // Remove script tags and javascript: URIs
    text = removeScriptTags(text);
    text = stripJavascriptUris(text);

    // Strip other control chars
    text = stripControlChars(text);

    // Collapse excessive whitespace
    text = collapseWhitespace(text);

    // Spam heuristics: extremely long repeated characters
    if (/([\S])\1{500,}/.test(text)) {
      throw new Error('Spam or repeated characters detected');
    }

    if (text.length === 0) {
      throw new Error('Message empty after sanitization');
    }

    sanitized.push({ role: typeof message.role === 'string' ? message.role : 'user', text });
  }

  return sanitized;
}

const inputSanitizerApi = { validateAndSanitizeHistory };

export default inputSanitizerApi;
