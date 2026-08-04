export interface EmptyChatSuggestion {
  title: string;
  subtitle: string;
  prompt: string;
  accent: 'blue' | 'purple' | 'emerald' | 'amber';
}

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text?: string | null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasCodingSignals(text: string): boolean {
  const normalized = normalize(text);
  return /(code|program|debug|error|react|typescript|javascript|python|api|function|class|git|loop|async|bug|test)/.test(normalized);
}

function hasWritingSignals(text: string): boolean {
  const normalized = normalize(text);
  return /(write|essay|email|draft|grammar|tone|paragraph|story|resume|cover letter|letter)/.test(normalized);
}

function hasStudySignals(text: string): boolean {
  const normalized = normalize(text);
  return /(study|exam|learn|concept|math|history|science|biology|chemistry|physics|memor|revision)/.test(normalized);
}

function hasPlanningSignals(text: string): boolean {
  const normalized = normalize(text);
  return /(plan|schedule|day|week|goal|routine|todo|agenda|calendar|organize)/.test(normalized);
}

export function getEmptyChatSuggestions(history: ChatHistoryItem[]): EmptyChatSuggestion[] {
  const joinedHistory = history.map((item) => item.text ?? '').join(' ');
  const hasCoding = hasCodingSignals(joinedHistory);
  const hasWriting = hasWritingSignals(joinedHistory);
  const hasStudy = hasStudySignals(joinedHistory);
  const hasPlanning = hasPlanningSignals(joinedHistory);

  const baseSuggestions: EmptyChatSuggestion[] = [
    {
      title: 'Explain this concept',
      subtitle: 'Break down something complex into easy steps.',
      prompt: 'Explain this concept clearly and simply.',
      accent: 'blue',
    },
    {
      title: 'Help me study',
      subtitle: 'Turn notes into a focused study plan.',
      prompt: 'Help me study this topic with a simple plan.',
      accent: 'purple',
    },
    {
      title: 'Plan my day',
      subtitle: 'Shape your tasks into a calm, realistic routine.',
      prompt: 'Plan my day with priority tasks and a balanced schedule.',
      accent: 'emerald',
    },
    {
      title: 'Improve my writing',
      subtitle: 'Refine tone, clarity, and structure.',
      prompt: 'Improve my writing and make it clearer.',
      accent: 'amber',
    },
    {
      title: 'Learn coding',
      subtitle: 'Practice a coding concept with guided help.',
      prompt: 'Teach me a coding concept step by step.',
      accent: 'blue',
    },
  ];

  const prioritized = [
    ...(hasCoding ? [{ ...baseSuggestions[4], subtitle: 'Work through code, debugging, and best practices.' }] : []),
    ...(hasWriting ? [{ ...baseSuggestions[3], subtitle: 'Polish an email, essay, or message with confidence.' }] : []),
    ...(hasStudy ? [{ ...baseSuggestions[1], subtitle: 'Create a focused study path from what you are learning.' }] : []),
    ...(hasPlanning ? [{ ...baseSuggestions[2], subtitle: 'Turn your goals into a realistic day plan.' }] : []),
  ];

  const remaining = baseSuggestions.filter((suggestion) => !prioritized.some((entry) => entry.title === suggestion.title));
  return [...prioritized, ...remaining].slice(0, 4);
}
