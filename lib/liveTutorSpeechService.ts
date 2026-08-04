import { BrowserVoiceChatService } from './voiceChatService';

export interface LiveTutorSpeechServiceEvents {
  onStateChange?: (state: 'idle' | 'listening' | 'processing' | 'speaking' | 'error') => void;
  onTranscriptChange?: (transcript: string, interimTranscript: string) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface LiveTutorSpeechService {
  startListening(): void;
  stopListening(): void;
  cancelListening(): void;
  speakText(text: string): void;
  stopSpeaking(): void;
  dispose(): void;
}

export class BrowserLiveTutorSpeechService implements LiveTutorSpeechService {
  private readonly service: BrowserVoiceChatService;

  constructor(events: LiveTutorSpeechServiceEvents = {}) {
    this.service = new BrowserVoiceChatService({
      onStateChange: events.onStateChange,
      onTranscriptChange: events.onTranscriptChange,
      onFinalTranscript: events.onFinalTranscript,
      onError: events.onError,
    });
  }

  startListening(): void {
    this.service.startListening();
  }

  stopListening(): void {
    this.service.stopListening();
  }

  cancelListening(): void {
    this.service.cancelListening();
  }

  speakText(text: string): void {
    this.service.speakText(text);
  }

  stopSpeaking(): void {
    this.service.stopSpeaking();
  }

  dispose(): void {
    this.service.dispose();
  }
}
