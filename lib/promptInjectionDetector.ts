/**
 * PROMPT INJECTION DETECTOR
 * Detects and scores prompt injection attempts
 *
 * This module identifies common prompt injection patterns:
 * - Role-switching instructions (ignore previous, act as, pretend)
 * - System prompt exposure attempts
 * - Constraint bypassing
 * - Encoding-based obfuscation
 * - Context boundary violations
 * - Nested instruction injection
 */

export interface PromptInjectionResult {
  hasInjection: boolean;
  score: number; // 0-100
  patterns: InjectionPattern[];
}

export interface InjectionPattern {
  type: string;
  pattern: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string[];
}

/**
 * Pattern definitions for injection detection
 */
const INJECTION_PATTERNS = [
  // Role-switching
  {
    type: 'role_switch',
    patterns: [
      /ignore\s+(all\s+)?previous/i,
      /forget\s+(all\s+)?previous/i,
      /disregard\s+(all\s+)?previous/i,
      /act\s+as\s+(?!.*tutor|.*assistant|.*mentor)/i,
      /pretend\s+to\s+be/i,
      /you\s+are\s+now/i,
      /from\s+now\s+on/i,
      /system\s+override/i,
    ],
    severity: 'high' as const,
  },

  // System prompt exposure
  {
    type: 'system_prompt_exposure',
    patterns: [
      /what\s+is\s+your\s+(system\s+)?prompt/i,
      /show\s+me\s+your\s+(system\s+)?instructions/i,
      /reveal\s+your\s+(system\s+)?prompt/i,
      /print\s+system\s+prompt/i,
      /display\s+hidden\s+instructions/i,
      /output\s+your\s+instructions/i,
    ],
    severity: 'high' as const,
  },

  // Constraint bypassing
  {
    type: 'constraint_bypass',
    patterns: [
      /bypass\s+(security|restrictions|filters|limits)/i,
      /disable\s+(safety|restrictions|filters)/i,
      /enable\s+developer\s+mode/i,
      /unlock\s+(restricted|hidden)/i,
      /jailbreak/i,
      /remove\s+restrictions/i,
    ],
    severity: 'high' as const,
  },

  // Nested instruction injection (triple quotes, markdown, etc.)
  {
    type: 'nested_injection',
    patterns: [
      /""".*(ignore|override|execute).*/i,
      /```[\s\S]{0,500}(ignore|override|execute)/i,
      /\[SYSTEM\].*:/i,
      /\[ADMIN\].*:/i,
      /\[ROOT\].*:/i,
      /\<\<SYSTEM\>\>.*:/i,
    ],
    severity: 'high' as const,
  },

  // Encoding/obfuscation attempts
  {
    type: 'encoding_obfuscation',
    patterns: [
      /base64|ROT13|hex.*decode|url.*decode/i,
      /eval\s*\(/i,
      /execute\s*\(/i,
      /decode\s+(base64|ROT13|hex|unicode)/i,
    ],
    severity: 'medium' as const,
  },

  // Context boundary violation
  {
    type: 'context_boundary',
    patterns: [
      /previous\s+conversations?/i,
      /other\s+users?/i,
      /other\s+conversations?/i,
      /external\s+data/i,
      /access\s+database/i,
    ],
    severity: 'medium' as const,
  },

  // Malicious instruction patterns
  {
    type: 'malicious_instruction',
    patterns: [
      /repeat\s+everything\s+back/i,
      /mirror\s+back/i,
      /send\s+to\s+url/i,
      /exfiltrate\s+data/i,
      /leak\s+information/i,
      /harmful|dangerous|illegal/i,
    ],
    severity: 'high' as const,
  },

  // Direct manipulation attempts
  {
    type: 'direct_manipulation',
    patterns: [
      /^(system|admin|root):/i,
      /^(new\s+)?instructions?:/i,
      /^(override|execute|run):/i,
      /^do\s+not\s+(follow|listen)/i,
    ],
    severity: 'high' as const,
  },

  // Pseudo-code injection
  {
    type: 'pseudocode_injection',
    patterns: [
      /if.*then.*output/i,
      /begin\s+(ignore|override|execute)/i,
      /procedure.*:\s+(ignore|override)/i,
      /algorithm.*:\s+(bypass|ignore)/i,
    ],
    severity: 'medium' as const,
  },

  // Language switching to bypass filters
  {
    type: 'language_switch',
    patterns: [
      /respond\s+in\s+code/i,
      /translate\s+to\s+(binary|hex|morse)/i,
      /use\s+a\s+different\s+language/i,
      /write\s+in\s+pseudocode/i,
    ],
    severity: 'low' as const,
  },

  // Multi-turn manipulation
  {
    type: 'multiturn_manipulation',
    patterns: [
      /in\s+your\s+next\s+response/i,
      /starting\s+from\s+now/i,
      /next\s+time\s+you/i,
      /for\s+all\s+future\s+requests/i,
    ],
    severity: 'medium' as const,
  },
];

/**
 * Detect prompt injection attempts in input
 */
export function detectPromptInjection(input: string): PromptInjectionResult {
  const detectedPatterns: InjectionPattern[] = [];
  let totalScore = 0;

  for (const patternGroup of INJECTION_PATTERNS) {
    const evidence: string[] = [];

    for (const regex of patternGroup.patterns) {
      const matches = input.match(regex);
      if (matches) {
        evidence.push(...matches);
      }
    }

    if (evidence.length > 0) {
      const severityScore = {
        high: 25,
        medium: 15,
        low: 5,
      };

      const score = severityScore[patternGroup.severity];
      totalScore += score * evidence.length;

      detectedPatterns.push({
        type: patternGroup.type,
        pattern: `${patternGroup.patterns.length} patterns`,
        severity: patternGroup.severity,
        evidence: Array.from(new Set(evidence)).slice(0, 3), // Top 3 unique matches
      });
    }
  }

  // Cap score at 100
  totalScore = Math.min(100, totalScore);

  return {
    hasInjection: detectedPatterns.length > 0 && totalScore >= 30,
    score: totalScore,
    patterns: detectedPatterns,
  };
}

/**
 * Check if input contains suspicious character patterns
 */
export function hasSuspiciousCharacterPatterns(input: string): boolean {
  // Multiple zero-width characters
  const zeroWidthChars = (input.match(/[\u200B\u200C\u200D\u2060\uFEFF]/g) || []).length;
  if (zeroWidthChars > 2) return true;

  // Excessive diacritics/combining marks (homograph attacks)
  const combiningMarks = (input.match(/[\u0300-\u036F]/g) || []).length;
  if (combiningMarks > input.length * 0.3) return true;

  // Mixed scripts (potential encoding bypass)
  const hasLatin = /[a-zA-Z]/.test(input);
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(input);
  const hasArabic = /[\u0600-\u06FF]/.test(input);
  const hasHangul = /[\uAC00-\uD7AF]/.test(input);

  const scriptCount = [hasLatin, hasCyrillic, hasArabic, hasHangul].filter(Boolean).length;
  if (scriptCount > 2 && input.length < 100) return true;

  // RTL override characters (bidi attack)
  if (/[\u202E\u202D\u202C]/.test(input)) return true;

  return false;
}

/**
 * Analyze semantic similarity to known injection patterns
 */
export function analyzeSemanticSimilarity(input: string, threshold: number = 0.7): number {
  const injectionKeywords = [
    'ignore', 'forget', 'disregard', 'override', 'bypass', 'disable',
    'system', 'admin', 'root', 'previous', 'prompt', 'instruction',
    'jailbreak', 'unlock', 'restrict', 'secret', 'hidden',
  ];

  const inputTokens = input.toLowerCase().split(/\s+/);
  let matches = 0;

  for (const token of inputTokens) {
    for (const keyword of injectionKeywords) {
      if (token.includes(keyword) || keyword.includes(token)) {
        matches++;
        break;
      }
    }
  }

  return matches / Math.max(inputTokens.length, 1);
}

/**
 * Get detailed injection report for logging
 */
export function getInjectionReport(input: string): Record<string, unknown> {
  const result = detectPromptInjection(input);
  const suspicious = hasSuspiciousCharacterPatterns(input);
  const semantic = analyzeSemanticSimilarity(input);

  return {
    hasInjection: result.hasInjection,
    injectionScore: result.score,
    patternCount: result.patterns.length,
    patternTypes: result.patterns.map((p) => p.type),
    suspiciousCharacters: suspicious,
    semanticSimilarity: semantic,
    overallRisk: result.score > 70 ? 'high' : result.score > 40 ? 'medium' : 'low',
  };
}
