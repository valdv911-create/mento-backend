import { fetchWithTimeout } from './resilience';

export interface LiveTutorGeminiService {
  startConversation(): Promise<string>;
  sendMessage(message: string, conversationId: string): Promise<string>;
}

export class RemoteLiveTutorGeminiService implements LiveTutorGeminiService {
  async startConversation(): Promise<string> {
    const response = await fetchWithTimeout('/api/chat/start', { method: 'POST' }, 15000, 'simli');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to start a tutor conversation.');
    }
    return payload.conversationId as string;
  }

  async sendMessage(message: string, conversationId: string): Promise<string> {
    const response = await fetchWithTimeout('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId }),
    }, 15000, 'gemini');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to get a response.');
    }
    return payload.result as string;
  }
}
