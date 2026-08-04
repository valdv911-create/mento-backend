import { BrowserLiveTutorSpeechService } from './liveTutorSpeechService';
import { RemoteLiveTutorGeminiService } from './liveTutorGeminiService';
import { type LiveTutorAvatarService } from './liveTutorAvatarService';
import { createOfflineResilienceManager } from './offlineResilience';

export type LiveTutorStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export type LiveTutorAvatarAdapter = LiveTutorAvatarService;

export interface LiveTutorOrchestratorOptions {
  onStatusChange?: (status: LiveTutorStatus) => void;
  onTranscriptChange?: (transcript: string, interimTranscript: string) => void;
  onSubtitleChange?: (subtitle: string) => void;
  onError?: (message: string) => void;
  onConversationMessage?: (message: { role: 'user' | 'assistant'; text: string }) => void;
  onConversationReady?: (conversationId: string) => void;
}

export interface LiveTutorController {
  initialize(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;
  interruptSpeech(): Promise<void>;
  sendText(text: string): Promise<string>;
  dispose(): void;
}

export function createLiveTutorOrchestrator(
  avatarAdapter: LiveTutorAvatarAdapter | null,
  options: LiveTutorOrchestratorOptions = {}
): LiveTutorController {
  return new LiveTutorOrchestrator(avatarAdapter, options);
}

class LiveTutorOrchestrator implements LiveTutorController {
  private readonly voiceService: BrowserLiveTutorSpeechService;
  private readonly geminiService: RemoteLiveTutorGeminiService;
  private readonly options: LiveTutorOrchestratorOptions;
  private conversationId: string | null = null;
  private status: LiveTutorStatus = 'idle';
  private readonly avatarAdapter: LiveTutorAvatarAdapter | null;
  private currentSubtitle = '';
  private readonly offlineManager = typeof window === 'undefined'
    ? createOfflineResilienceManager({ isOnline: true })
    : createOfflineResilienceManager({
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        storage: window.localStorage,
        storageKey: 'mento:offline:tutor-queue',
        baseDelayMs: 600,
        maxDelayMs: 8000,
        timeoutMs: 15000,
        restoreExecutor: (task) => {
          if (task.type !== 'tutor') return undefined;
          const payload = task.payload as { action?: string; text?: string; conversationId?: string | null } | undefined;
          if (!payload?.action) return undefined;
          return async () => {
            if (payload.action === 'startConversation') {
              const nextConversationId = await this.geminiService.startConversation();
              this.conversationId = typeof nextConversationId === 'string' && nextConversationId.trim() ? nextConversationId : null;
              if (this.conversationId) {
                this.options.onConversationReady?.(this.conversationId);
              }
              return this.conversationId;
            }
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (!text) return '';
            const conversationId = typeof payload.conversationId === 'string' && payload.conversationId.trim() ? payload.conversationId : this.conversationId || '';
            const nextAssistantText = await this.geminiService.sendMessage(text, conversationId);
            this.options.onConversationMessage?.({ role: 'assistant', text: nextAssistantText });
            this.setSubtitle(nextAssistantText);
            this.options.onStatusChange?.('speaking');
            if (!nextAssistantText.startsWith('Error:')) {
              const cleanText = nextAssistantText.replace(/[#*`]/g, '');
              await this.avatarAdapter?.speak(cleanText);
              this.voiceService.speakText(cleanText);
            }
            return nextAssistantText;
          };
        },
      });

  constructor(avatarAdapter: LiveTutorAvatarAdapter | null, options: LiveTutorOrchestratorOptions = {}) {
    this.avatarAdapter = avatarAdapter;
    this.options = options;
    this.geminiService = new RemoteLiveTutorGeminiService();
    this.voiceService = new BrowserLiveTutorSpeechService({
      onStateChange: (nextStatus) => {
        this.status = nextStatus;
        this.options.onStatusChange?.(nextStatus);
      },
      onTranscriptChange: (transcript, interimTranscript) => {
        this.options.onTranscriptChange?.(transcript, interimTranscript);
      },
      onFinalTranscript: async (text) => {
        await this.handleUserText(text);
      },
      onError: (message) => {
        this.options.onError?.(message);
      },
    });
  }

  async initialize(): Promise<void> {
    if (this.conversationId) return;
    try {
      const conversationId = await this.geminiService.startConversation();
      this.conversationId = typeof conversationId === 'string' && conversationId.trim()
        ? conversationId
        : null;
      if (this.conversationId) {
        this.options.onConversationReady?.(this.conversationId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start a tutor conversation.';
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await this.offlineManager.enqueue({
          type: 'tutor',
          payload: { action: 'startConversation' },
          maxAttempts: 5,
          timeoutMs: 15000,
        }, async () => {
          const nextConversationId = await this.geminiService.startConversation();
          this.conversationId = typeof nextConversationId === 'string' && nextConversationId.trim() ? nextConversationId : null;
          if (this.conversationId) {
            this.options.onConversationReady?.(this.conversationId);
          }
          return this.conversationId;
        });
        this.options.onConversationReady?.(this.conversationId || 'pending');
        return;
      }
      this.options.onError?.(message);
      throw error;
    }
  }

  async startListening(): Promise<void> {
    await this.initialize();
    this.voiceService.startListening();
  }

  async stopListening(): Promise<void> {
    this.voiceService.stopListening();
  }

  async cancelListening(): Promise<void> {
    this.voiceService.cancelListening();
  }

  async interruptSpeech(): Promise<void> {
    this.voiceService.stopSpeaking();
    this.avatarAdapter?.interrupt();
    this.setSubtitle('Interrupted');
  }

  async sendText(text: string): Promise<string> {
    return this.handleUserText(text);
  }

  dispose(): void {
    this.voiceService.dispose();
  }

  private async handleUserText(text: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }

    await this.initialize();
    this.options.onConversationMessage?.({ role: 'user', text: trimmed });
    this.setSubtitle('Thinking…');
    this.options.onStatusChange?.('processing');

    try {
      let assistantText = '';
      try {
        assistantText = await this.geminiService.sendMessage(trimmed, this.conversationId || '');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tutor reply failed.';
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await this.offlineManager.enqueue({
            type: 'tutor',
            payload: { action: 'sendMessage', text: trimmed, conversationId: this.conversationId },
            maxAttempts: 5,
            timeoutMs: 15000,
          }, async () => {
            const nextAssistantText = await this.geminiService.sendMessage(trimmed, this.conversationId || '');
            this.options.onConversationMessage?.({ role: 'assistant', text: nextAssistantText });
            this.setSubtitle(nextAssistantText);
            this.options.onStatusChange?.('speaking');
            if (!nextAssistantText.startsWith('Error:')) {
              const cleanText = nextAssistantText.replace(/[#*`]/g, '');
              await this.avatarAdapter?.speak(cleanText);
              this.voiceService.speakText(cleanText);
            }
            return nextAssistantText;
          });
          return `Queued offline: ${trimmed}`;
        }
        assistantText = `Error: ${message}`;
      }

      this.options.onConversationMessage?.({ role: 'assistant', text: assistantText });
      this.setSubtitle(assistantText);
      this.options.onStatusChange?.('speaking');

      if (!assistantText.startsWith('Error:')) {
        const cleanText = assistantText.replace(/[#*`]/g, '');
        await this.avatarAdapter?.speak(cleanText);
        this.voiceService.speakText(cleanText);
      }

      return assistantText;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tutor reply failed.';
      this.options.onError?.(message);
      this.options.onStatusChange?.('error');
      return message;
    }
  }

  private setSubtitle(subtitle: string): void {
    this.currentSubtitle = subtitle;
    this.options.onSubtitleChange?.(subtitle);
  }
}
