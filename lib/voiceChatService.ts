export type VoiceChatStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceChatServiceEvents {
  onStateChange?: (state: VoiceChatStatus) => void;
  onTranscriptChange?: (transcript: string, interimTranscript: string) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    transcript: string;
    confidence: number;
  }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export class BrowserVoiceChatService {
  private recognition: SpeechRecognitionLike | null = null;
  private transcript = '';
  private interimTranscript = '';
  private state: VoiceChatStatus = 'idle';
  private readonly events: VoiceChatServiceEvents;
  private readonly lang: string;

  constructor(events: VoiceChatServiceEvents = {}, lang = 'en-US') {
    this.events = events;
    this.lang = lang;
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  public getStatus(): VoiceChatStatus {
    return this.state;
  }

  public getTranscript(): string {
    return this.transcript;
  }

  public startListening(): void {
    if (typeof window === 'undefined') {
      this.reportError('Voice input is not available in this browser.');
      return;
    }

    if (!this.isSupported()) {
      this.reportError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    if (this.recognition) {
      this.recognition.stop();
      this.recognition.abort();
    }

    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      this.reportError('Speech recognition is not available.');
      return;
    }

    this.transcript = '';
    this.interimTranscript = '';
    this.emitTranscriptChange('', '');

    const recognition = new RecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = this.lang;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result.transcript?.trim() ?? '';

        if (result.isFinal) {
          finalText = finalText ? `${finalText} ${text}` : text;
        } else {
          interimText = interimText ? `${interimText} ${text}` : text;
        }
      }

      if (finalText) {
        this.transcript = finalText;
        this.interimTranscript = '';
        this.emitTranscriptChange(this.transcript, '');
        this.emitFinalTranscript(this.transcript);
        this.setState('processing');
      }

      if (interimText) {
        this.interimTranscript = interimText;
        this.emitTranscriptChange(this.transcript, this.interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed'
        ? 'Microphone access was denied.'
        : 'Voice recording stopped unexpectedly.';
      this.reportError(message);
      this.setState('idle');
    };

    recognition.onend = () => {
      if (this.state === 'listening') {
        this.setState('idle');
      }
    };

    this.recognition = recognition;
    this.setState('listening');
    recognition.start();
  }

  public stopListening(): void {
    if (!this.recognition) {
      this.setState('idle');
      return;
    }

    this.recognition.stop();
    this.recognition = null;
    this.setState('idle');
  }

  public cancelListening(): void {
    if (!this.recognition) {
      this.transcript = '';
      this.interimTranscript = '';
      this.emitTranscriptChange('', '');
      this.setState('idle');
      return;
    }

    this.recognition.abort();
    this.recognition = null;
    this.transcript = '';
    this.interimTranscript = '';
    this.emitTranscriptChange('', '');
    this.setState('idle');
  }

  public speakText(text: string): void {
    if (typeof window === 'undefined' || !text.trim()) {
      return;
    }

    if (typeof window.speechSynthesis === 'undefined') {
      this.reportError('Text-to-speech is not available in this browser.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => this.setState('speaking');
    utterance.onend = () => this.setState('idle');
    utterance.onerror = () => this.setState('idle');

    window.speechSynthesis.speak(utterance);
  }

  public stopSpeaking(): void {
    if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
    }
    this.setState('idle');
  }

  public dispose(): void {
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }

    if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
    }

    this.transcript = '';
    this.interimTranscript = '';
    this.setState('idle');
  }

  private emitTranscriptChange(transcript: string, interimTranscript: string): void {
    this.events.onTranscriptChange?.(transcript, interimTranscript);
  }

  private emitFinalTranscript(text: string): void {
    this.events.onFinalTranscript?.(text);
  }

  private setState(nextState: VoiceChatStatus): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.events.onStateChange?.(nextState);
  }

  private reportError(message: string): void {
    this.setState('error');
    this.events.onError?.(message);
  }
}
