'use client';

import { Children, useState, useRef, useEffect, useCallback, type ReactNode, type ChangeEvent } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getAttachmentGridClass, getAttachmentPreviewClass, getMessageSurfaceClass, getComposerSurfaceClass } from './lib/chatUi';
import { createLiveTutorOrchestrator, type LiveTutorAvatarAdapter, type LiveTutorStatus } from '@/lib/liveTutorOrchestrator';
import { createOfflineResilienceManager } from '@/lib/offlineResilience';
import NotificationCenter from './components/NotificationCenter';
import { CHAT_SCROLL_THRESHOLD_PX, shouldAutoScroll } from './lib/chatScroll';
import { classifyChatErrorState } from '@/lib/errorHandling';
import { getEmptyChatSuggestions } from '@/lib/emptyChatSuggestions';

interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  mimeType?: string;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
  isStreaming?: boolean;
  errorState?: {
    kind: 'offline' | 'timeout' | 'rate_limit' | 'provider_unavailable' | 'cancelled' | 'unknown';
    title: string;
    message: string;
    retryable: boolean;
  } | null;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  conversationId?: string;
}

type ChatScrollPositions = Record<string, number>;

interface ChatCache {
  sessions: ChatSession[];
  activeSessionId: string;
  scrollPositions: ChatScrollPositions;
}

interface MarkdownRendererProps {
  content: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

interface MarkdownListItemProps {
  children?: ReactNode;
  checked?: boolean | null;
  taskList?: boolean;
}

const CHAT_CACHE_KEY = 'mento:chat-cache';

function safeParseChatCache(value: string | null): ChatCache | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ChatCache;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.sessions) || typeof parsed.activeSessionId !== 'string') return null;
    return {
      sessions: parsed.sessions,
      activeSessionId: parsed.activeSessionId,
      scrollPositions: parsed.scrollPositions ?? {},
    };
  } catch {
    return null;
  }
}

function persistChatCache(cache: ChatCache) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures.
  }
}

function mergeServerMessages(
  localMessages: Message[],
  remoteMessages: Array<{ id: string; role: 'user' | 'assistant'; text?: string | null; content?: string | null }>
) {
  const normalizedRemote = remoteMessages.map((message) => ({
    id: message.id,
    role: message.role,
    text: (message.text ?? message.content ?? '').trim(),
  }));

  if (normalizedRemote.length === 0) {
    return localMessages;
  }

  const localStreaming = localMessages.find((message) => message.role === 'assistant' && message.isStreaming);
  const merged = normalizedRemote.map((remote, index): Message => {
    const local = localMessages[index];
    if (!local || local.role !== remote.role || local.id !== remote.id) {
      return {
        ...remote,
        isStreaming: false,
      };
    }
    return {
      ...local,
      text: local.text.length >= remote.text.length ? local.text : remote.text,
    };
  });

  if (localStreaming && merged.length > 0) {
    const lastMerged = merged[merged.length - 1];
    if (lastMerged.role === 'assistant') {
      merged[merged.length - 1] = {
        ...lastMerged,
        isStreaming: true,
      };
    }
  }

  if (merged.length < localMessages.length) {
    return [...merged, ...localMessages.slice(merged.length)];
  }

  return merged;
}

const ThinkingIndicator = () => (
  <div className="flex w-full justify-start px-1 py-1 transition-opacity duration-300 ease-out sm:px-2">
    <div className="chat-bubble-enter flex max-w-[min(86%,680px)] items-center gap-3 rounded-[28px] border border-cyan-500/20 bg-zinc-900/95 px-4 py-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.26)] backdrop-blur-sm sm:px-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-500/10 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
        M
      </div>
      <div className="min-w-[188px]">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-400/80">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          Mento
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <span className="font-medium text-zinc-100">Thinking through the response…</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="chat-thinking-dot h-2.5 w-2.5 rounded-full bg-zinc-400/80" style={{ animationDelay: '0ms' }} />
            <span className="chat-thinking-dot h-2.5 w-2.5 rounded-full bg-zinc-400/80" style={{ animationDelay: '160ms' }} />
            <span className="chat-thinking-dot h-2.5 w-2.5 rounded-full bg-zinc-400/80" style={{ animationDelay: '320ms' }} />
          </span>
        </div>
      </div>
    </div>
  </div>
);

const CodeBlock = ({ inline, className, children }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const match = /language-([^\s]+)/.exec(className || '');
  const language = match?.[1] ?? 'text';
  const codeText = Children.toArray(children)
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('');

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setCopied(false);
      return;
    }

    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (inline) {
    return (
      <code className="rounded-md border border-zinc-700/70 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.9em] text-amber-300">
        {children}
      </code>
    );
  }

  return (
    <div className="my-4 w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500/80" />
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500/80" />
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          <span className="ml-2">{language}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded border border-zinc-700/80 px-2.5 py-1 text-[10px] font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <div className="max-w-full overflow-x-auto">
        <SyntaxHighlighter
          language={language === 'text' ? undefined : language}
          style={oneDark}
          customStyle={{
            margin: 0,
            background: 'transparent',
            padding: '1rem 1rem',
            fontSize: '0.9rem',
            whiteSpace: 'pre',
            wordBreak: 'normal',
            display: 'block',
            width: '100%',
            minWidth: '100%',
            overflowX: 'auto',
            boxSizing: 'border-box',
            lineHeight: 1.65,
          }}
          wrapLongLines={false}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
              fontSize: '0.9rem',
            },
          }}
        >
          {codeText}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const markdownComponents: Components = {
  p: ({ children }: { children?: ReactNode }) => <p className="mb-3 break-words whitespace-pre-wrap leading-7 text-[0.96rem] text-zinc-200/95 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }: { children?: ReactNode }) => <em className="italic text-zinc-100">{children}</em>,
  h1: ({ children }: { children?: ReactNode }) => <h1 className="mb-3 mt-5 text-xl font-semibold tracking-tight text-white">{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className="mb-2.5 mt-4 text-lg font-semibold tracking-tight text-zinc-100">{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="mb-2 mt-3 text-base font-semibold tracking-tight text-zinc-100">{children}</h3>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="mb-3 ml-6 list-disc space-y-2 text-zinc-200/95">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="mb-3 ml-6 list-decimal space-y-2 text-zinc-200/95">{children}</ol>,
  li: ({ children, checked, taskList }: MarkdownListItemProps) => {
    if (taskList) {
      return (
        <li className="flex items-start gap-2 leading-7">
          <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${checked ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-900/70 text-zinc-500'}`}>
            {checked ? '✓' : ''}
          </span>
          <span className={checked ? 'text-zinc-500 line-through' : 'text-zinc-200/95'}>{children}</span>
        </li>
      );
    }

    return <li className="leading-7 text-zinc-200/95">{children}</li>;
  },
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-4 rounded-2xl border-l-4 border-cyan-500/40 bg-zinc-900/70 px-4 py-3 italic text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-zinc-800/80" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-4 overflow-x-auto rounded-2xl border border-zinc-800/80">
      <table className="min-w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => <thead className="bg-zinc-900/80">{children}</thead>,
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => <tr className="border-b border-zinc-800/90 last:border-b-0">{children}</tr>,
  th: ({ children }: { children?: ReactNode }) => <th className="border border-zinc-800 px-3 py-2 text-left font-semibold uppercase tracking-wide text-zinc-400">{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="border border-zinc-800 px-3 py-2 align-top text-zinc-300">{children}</td>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-cyan-400 underline decoration-cyan-500/40 underline-offset-2">
      {children}
    </a>
  ),
  code: CodeBlock,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkBreaks]}
    components={markdownComponents}
    skipHtml
  >
    {content}
  </ReactMarkdown>
);

const MessageContent = ({
  message,
  isUser,
  onOpenActions,
  onLongPressStart,
  onLongPressEnd,
  isEditing,
  editDraft,
  setEditDraft,
  onSaveEdit,
  onCancelEdit,
  onRetryMessage,
  copiedMessageId,
}: {
  message: Message;
  isUser: boolean;
  onOpenActions: (message: Message) => void;
  onLongPressStart: (message: Message) => void;
  onLongPressEnd: () => void;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (value: string) => void;
  onSaveEdit: (message: Message) => void;
  onCancelEdit: () => void;
  onRetryMessage: (message: Message) => void;
  copiedMessageId: string | null;
}) => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const attachments = message.attachments ?? [];
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image' && attachment.url);
  const fileAttachments = attachments.filter((attachment) => attachment.type === 'file');

  return (
    <div
      className={`relative flex w-full flex-col gap-3 px-1 sm:px-2 ${isUser ? 'items-end' : 'items-start'}`}
      onMouseDown={(event) => {
        if (event.button === 0) {
          onLongPressStart(message);
        }
      }}
      onMouseUp={onLongPressEnd}
      onMouseLeave={onLongPressEnd}
      onTouchStart={() => onLongPressStart(message)}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenActions(message);
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenActions(message);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenActions(message);
        }}
        className="absolute right-1.5 top-1.5 z-10 rounded-full border border-zinc-700/70 bg-zinc-950/90 p-1.5 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
        aria-label="Open message actions"
      >
        ⋯
      </button>
      {imageAttachments.length > 0 ? (
        <div className={`flex w-full flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`grid w-full gap-2 ${getAttachmentGridClass(imageAttachments.length)} ${getAttachmentPreviewClass(imageAttachments.length)}`}>
            {imageAttachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                onClick={() => setPreviewImage(attachment.url ?? null)}
                className="group overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/70 shadow-none transition duration-200 hover:scale-[1.01]"
              >
                <div className="relative h-56 w-full">
                  <Image
                    src={attachment.url ?? ''}
                    alt={attachment.name}
                    fill
                    unoptimized
                    className="object-cover transition duration-300 group-hover:brightness-110"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {fileAttachments.length > 0 ? (
        <div className={`flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {fileAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-900/70 px-3 py-1.5 text-[12px] text-zinc-300"
            >
              <span>📄</span>
              <span className="max-w-[180px] truncate">{attachment.name}</span>
            </div>
          ))}
        </div>
      ) : null}

      {message.errorState ? (
        <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div className="w-full max-w-[min(100%,720px)] rounded-[24px] border border-amber-500/20 bg-zinc-900/95 p-4 shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-sm font-semibold text-amber-300">
                !
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{message.errorState.title}</div>
                <p className="mt-1 text-sm leading-6 text-zinc-300">{message.errorState.message}</p>
                {message.errorState.retryable ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryMessage(message);
                    }}
                    className="mt-3 rounded-full border border-zinc-700/80 bg-zinc-950/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-200 transition hover:bg-zinc-800"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {message.text ? (
        <div className={`chat-bubble-enter flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
          {isEditing ? (
            <div className={`w-full max-w-[min(100%,720px)] min-w-[260px] rounded-[28px] border px-4 py-3.5 shadow-[0_18px_42px_rgba(0,0,0,0.24)] backdrop-blur-sm sm:min-w-[320px] ${isUser ? 'border-blue-500/25 bg-gradient-to-br from-blue-600/95 to-indigo-600/90 text-white' : 'border-zinc-800/80 bg-zinc-900/95 text-zinc-100'}`}>
              <textarea
                rows={4}
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-zinc-50 outline-none placeholder:text-zinc-300/70"
                placeholder="Edit your message"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-medium text-zinc-100/90 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onSaveEdit(message)}
                  className="rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/20"
                >
                  Save & regenerate
                </button>
              </div>
            </div>
          ) : (
            <div className={`w-fit max-w-full rounded-[28px] border px-4 py-3.5 backdrop-blur-sm sm:px-5 sm:py-4 ${getMessageSurfaceClass(isUser, Boolean(message.isStreaming), Boolean(message.errorState))}`}>
              <div className="max-w-[640px]">
                <MarkdownRenderer content={message.text} />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {copiedMessageId === message.id ? (
        <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-400">
          Copied
        </div>
      ) : null}

      {previewImage ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white"
            onClick={() => setPreviewImage(null)}
          >
            Close
          </button>
          <div className="relative max-h-[85vh] max-w-full rounded-2xl shadow-2xl">
            <Image
              src={previewImage}
              alt="Preview"
              width={1200}
              height={800}
              unoptimized
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85vh] max-w-full rounded-2xl object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function Home() {
  const [query, setQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('mento:chat-draft') ?? '';
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const cache = safeParseChatCache(window.localStorage.getItem(CHAT_CACHE_KEY));
    return Boolean(cache?.sessions.some((session) => session.messages.some((message) => message.role === 'assistant' && message.isStreaming)));
  });
  const [learningTier, setLearningTier] = useState<'standard' | 'premium_live'>('standard');
  
  // Video and session Elements
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avatarClient = useRef<any>(null);
  const [isAiStreaming, setIsAiStreaming] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [camOff, setCamOff] = useState<boolean>(false);

  // Python Sandbox Controls
  const [sandboxCode, setSandboxCode] = useState<string>(
`# Type code here to test it out!
def verify_mento():
    print("Mento Engine Active")

verify_mento()`
  );
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    '> Mento Engine Active'
  ]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  
  const [scrollPositions, setScrollPositions] = useState<ChatScrollPositions>({});
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window === 'undefined') return [{ id: '1', title: 'hello...', messages: [] }];
    const saved = window.localStorage.getItem('mento:chat-cache');
    if (!saved) return [{ id: '1', title: 'hello...', messages: [] }];
    try {
      const parsed = JSON.parse(saved) as ChatCache;
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        return parsed.sessions;
      }
    } catch {
      window.localStorage.removeItem('mento:chat-cache');
    }
    return [{ id: '1', title: 'hello...', messages: [] }];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return '1';
    const saved = window.localStorage.getItem('mento:chat-cache');
    if (!saved) return '1';
    try {
      const parsed = JSON.parse(saved) as ChatCache;
      return parsed.activeSessionId || '1';
    } catch {
      return '1';
    }
  });
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(() => {
    if (typeof window === 'undefined') return [];
    const savedAttachments = window.localStorage.getItem('mento:chat-pending-attachments');
    if (!savedAttachments) return [];
    try {
      return JSON.parse(savedAttachments) as Attachment[];
    } catch {
      window.localStorage.removeItem('mento:chat-pending-attachments');
      return [];
    }
  });
  const [lastSyncedHash, setLastSyncedHash] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollCaptureFrameRef = useRef<number | null>(null);
  const userAtBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<LiveTutorStatus>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [voiceInterimTranscript, setVoiceInterimTranscript] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string>('');
  const [liveSubtitle, setLiveSubtitle] = useState<string>('');
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [activeMessageAction, setActiveMessageAction] = useState<{ messageId: string | null; role: Message['role'] } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const tutorControllerRef = useRef<ReturnType<typeof createLiveTutorOrchestrator> | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const currentSessionRef = useRef<ChatSession | null>(null);
  const offlineManagerRef = useRef<ReturnType<typeof createOfflineResilienceManager> | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantMessageRef = useRef<{ sessionId: string; messageId: string } | null>(null);

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const initLiveTeacherStream = useCallback(async () => {
    try {
      setIsAiStreaming(false);
      const res = await fetch('/api/stream', { method: 'POST' });
      const config = await res.json();

      if (!res.ok) throw new Error(config.error || 'Failed backend configuration');

      avatarClient.current = {
        start: async () => {
          if (videoRef.current) {
            avatarClient.current?.attach(videoRef.current);
          }
          setIsAiStreaming(true);
        },
        stop: async () => {
          setIsAiStreaming(false);
        },
        attach: (element: HTMLVideoElement) => {
          if (element) {
            element.srcObject = null;
          }
        },
        speak: async () => undefined,
        interrupt: () => undefined,
      };

      await avatarClient.current.start();
    } catch (err: unknown) {
      console.error('Simli session initialization failed:', err);
      setConsoleLogs((prev) => [
        ...prev,
        '> Sync failure. Ensure your Simli environment configuration is correct.',
      ]);
    }
  }, []);

  const terminateStream = useCallback(async () => {
    if (avatarClient.current) {
      try {
        await avatarClient.current.stop();
      } catch (e) {
        console.error('Error tearing down session stream:', e);
      }
      avatarClient.current = null;
      setIsAiStreaming(false);
    }
  }, []);

  useEffect(() => {
    if (learningTier === 'premium_live' && !avatarClient.current) {
      void initLiveTeacherStream();
    }

    return () => {
      if (learningTier === 'standard' && avatarClient.current) {
        void terminateStream();
      }
    };
  }, [learningTier, initLiveTeacherStream, terminateStream]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const manager = createOfflineResilienceManager({
      storage: window.localStorage,
      storageKey: 'mento:offline:chat-queue',
      isOnline: navigator.onLine,
      baseDelayMs: 600,
      maxDelayMs: 8000,
      timeoutMs: 15000,
    });
    offlineManagerRef.current = manager;

    const handleOnline = () => {
      manager.setOnline(true);
    };
    const handleOffline = () => {
      manager.setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('mento:chat-draft', query);
  }, [query]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('mento:chat-pending-attachments', JSON.stringify(pendingAttachments));
  }, [pendingAttachments]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleScroll = () => {
      if (!chatScrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
      const atBottom = scrollHeight - (scrollTop + clientHeight) <= CHAT_SCROLL_THRESHOLD_PX;
      userAtBottomRef.current = atBottom;
      if (atBottom) {
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
      setScrollPositions((previous) => {
        const next = { ...previous, [activeSessionId]: scrollTop };
        persistChatCache({ sessions, activeSessionId, scrollPositions: next });
        return next;
      });
    };

    const scrollContainer = chatScrollRef.current;
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer?.removeEventListener('scroll', handleScroll);
      if (scrollCaptureFrameRef.current) {
        window.cancelAnimationFrame(scrollCaptureFrameRef.current);
      }
    };
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = safeParseChatCache(window.localStorage.getItem(CHAT_CACHE_KEY));
    if (!saved) return;
    setScrollPositions(saved.scrollPositions ?? {});
    if (saved.activeSessionId && saved.sessions.some((session) => session.id === saved.activeSessionId)) {
      setActiveSessionId(saved.activeSessionId);
    }
    if (saved.sessions.length > 0) {
      setSessions(saved.sessions);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const json = JSON.stringify({ sessions, activeSessionId, scrollPositions });
    const hash = btoa(unescape(encodeURIComponent(json))); // simple content diff
    if (hash === lastSyncedHash) return;
    setLastSyncedHash(hash);
    persistChatCache({ sessions, activeSessionId, scrollPositions });
  }, [sessions, activeSessionId, scrollPositions, lastSyncedHash]);

  const handleNewChat = () => {
    const newId = Date.now().toString();
    const newSession: ChatSession = { id: newId, title: 'New Track...', messages: [] };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newId);
    setLearningTier('standard');
  };

  const handleRunCode = () => {
    setIsRunning(true);
    setConsoleLogs(['> Running code...']);
    setTimeout(() => {
      if (sandboxCode.includes('print(')) {
        const matches = sandboxCode.match(/print\(([^)]+)\)/g);
        if (matches) {
          const outputs = matches.map(m => `> ${m.replace('print(', '').replace(')', '').replace(/['"]/g, '')}`);
          setConsoleLogs(['> Success:', ...outputs]);
        } else {
          setConsoleLogs(['> Success (0 string outputs)']);
        }
      } else {
        setConsoleLogs(['> Success (Exit Code 0)']);
      }
      setIsRunning(false);
    }, 600);
  };

  const handleAttachmentSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;

    const nextAttachments: Attachment[] = Array.from(files).map((file, index) => {
      const isImage = file.type.startsWith('image/');
      const url = isImage ? URL.createObjectURL(file) : undefined;
      if (url) objectUrlsRef.current.push(url);

      return {
        id: `${Date.now()}-${index}`,
        type: isImage ? 'image' : 'file',
        name: file.name,
        url,
        mimeType: file.type
      };
    });

    setPendingAttachments((prev) => [...prev, ...nextAttachments]);
    event.target.value = '';
  };

  const scrollToNewestMessage = useCallback((force = false) => {
    if (typeof window === 'undefined' || !chatScrollRef.current) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }

    const container = chatScrollRef.current;
    const shouldScroll = force || shouldAutoScroll(container, false, CHAT_SCROLL_THRESHOLD_PX);
    if (!shouldScroll) {
      userAtBottomRef.current = false;
      setShowJumpToLatest(true);
      return;
    }

    userAtBottomRef.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const openMessageActions = useCallback((message: Message) => {
    if (!message.id) return;
    setActiveMessageAction({ messageId: message.id, role: message.role });
  }, []);

  const closeMessageActions = useCallback(() => {
    setActiveMessageAction(null);
  }, []);

  const beginLongPress = useCallback((message: Message) => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      openMessageActions(message);
    }, 420);
  }, [openMessageActions]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCopyMessage = useCallback(async (message: Message) => {
    const content = message.text?.trim() ? message.text : '';
    if (!content) {
      closeMessageActions();
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else if (typeof window !== 'undefined') {
        const textarea = window.document.createElement('textarea');
        textarea.value = content;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        window.document.body.appendChild(textarea);
        textarea.select();
        window.document.execCommand('copy');
        window.document.body.removeChild(textarea);
      }
      if (message.id) {
        setCopiedMessageId(message.id);
        window.setTimeout(() => setCopiedMessageId((current) => (current === message.id ? null : current)), 1400);
      }
    } catch {
      // Ignore clipboard failures.
    } finally {
      closeMessageActions();
    }
  }, [closeMessageActions]);

  const handleShareMessage = useCallback(async (message: Message) => {
    const content = message.text?.trim() ? message.text : '';
    if (!content) {
      closeMessageActions();
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        await navigator.share({
          title: 'Mento message',
          text: content,
        });
      } else {
        await handleCopyMessage(message);
      }
    } catch {
      await handleCopyMessage(message);
    } finally {
      closeMessageActions();
    }
  }, [closeMessageActions, handleCopyMessage]);

  const handleDeleteMessage = useCallback((messageId?: string) => {
    if (!messageId) {
      closeMessageActions();
      return;
    }

    const sessionId = activeSessionIdRef.current;
    setSessions((prev) => prev.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      const targetIndex = session.messages.findIndex((entry) => entry.id === messageId);
      if (targetIndex < 0) {
        return session;
      }

      return {
        ...session,
        messages: session.messages.slice(0, targetIndex),
      };
    }));
    closeMessageActions();
  }, [closeMessageActions]);

  const handleStartEditMessage = useCallback((message: Message) => {
    if (message.role !== 'user' || !message.id) {
      closeMessageActions();
      return;
    }

    setEditingMessageId(message.id);
    setEditingDraft(message.text);
    closeMessageActions();
  }, [closeMessageActions]);

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft('');
  }, []);

  const submitMessage = async (overrideText?: string, options?: { replaceMessageId?: string; resetConversation?: boolean }) => {
    const fallbackText = query.trim() || (pendingAttachments.length ? 'Shared attachments' : '');
    const userText = (overrideText ?? fallbackText).trim();
    if ((!userText && pendingAttachments.length === 0) || isLoading) return;

    const sessionId = activeSessionIdRef.current;
    const session = currentSessionRef.current;
    const assistantMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const targetMessage = options?.replaceMessageId
      ? session?.messages.find((message) => message.id === options.replaceMessageId)
      : undefined;
    const messageAttachments = targetMessage?.attachments && options?.replaceMessageId
      ? targetMessage.attachments
      : (pendingAttachments.length ? pendingAttachments : undefined);

    setQuery('');
    setIsLoading(true);
    setVoiceError('');
    setVoiceStatus('processing');

    const userMessage: Message = {
      id: options?.replaceMessageId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      role: 'user',
      text: userText,
      attachments: messageAttachments,
    };

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      isStreaming: true,
    };

    setPendingAttachments([]);
    setSessions(prev => prev.map((s) => {
      if (s.id !== sessionId) {
        return s;
      }

      const replaceIndex = options?.replaceMessageId
        ? s.messages.findIndex((message) => message.id === options.replaceMessageId)
        : -1;
      const baseMessages = replaceIndex >= 0 ? s.messages.slice(0, replaceIndex) : s.messages;

      return {
        ...s,
        title: s.title === 'hello...' || s.title === 'New Track...' ? `${userText.slice(0, 15)}...` : s.title,
        messages: [...baseMessages, userMessage, assistantMessage],
      };
    }));
    scrollToNewestMessage();

    try {
      const unreadAttachments = messageAttachments ?? [];
      const queuedPayload = { sessionId, userText, conversationId: session?.conversationId, attachments: unreadAttachments };

      if (!navigator.onLine) {
        await offlineManagerRef.current?.enqueue({
          type: 'chat',
          payload: queuedPayload,
          maxAttempts: 5,
          timeoutMs: 15000,
        }, async () => {
          const startResponse = await fetch('/api/chat/start', { method: 'POST' });
          const startData = await startResponse.json();
          if (!startResponse.ok) {
            throw new Error(startData.error || 'Unable to start a conversation.');
          }
          const conversationId = startData.conversationId as string;
          setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, conversationId } : s));
          const assistantText = await tutorControllerRef.current?.sendText(userText) || '';
          setSessions(prev => prev.map(s => s.id === sessionId ? {
            ...s,
            messages: [...s.messages, { role: 'assistant', text: assistantText }]
          } : s));
          return assistantText;
        });
        const offlineErrorState = classifyChatErrorState(new Error('offline'));
        setSessions(prev => prev.map(s => s.id === sessionId ? {
          ...s,
          messages: s.messages.map((msg) => msg.id === assistantMessageId ? {
            ...msg,
            text: '',
            isStreaming: false,
            errorState: offlineErrorState,
          } : msg)
        } : s));
        return;
      }

      let conversationId = session?.conversationId;
      if (!conversationId) {
        const startResponse = await fetch('/api/chat/start', { method: 'POST' });
        const startData = await startResponse.json();
        if (!startResponse.ok) {
          throw new Error(startData.error || 'Unable to start a conversation.');
        }
        conversationId = startData.conversationId;
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, conversationId } : s));
      }

      const controller = new AbortController();
      streamAbortControllerRef.current = controller;
      activeAssistantMessageRef.current = { sessionId, messageId: assistantMessageId };

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userText,
          conversationId,
          requestId,
          image: messageAttachments?.length ? undefined : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || payload.message || 'Unable to stream a response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const rawChunk = buffer.slice(0, boundaryIndex).trim();
          buffer = buffer.slice(boundaryIndex + 2);
          boundaryIndex = buffer.indexOf('\n\n');

          const lines = rawChunk.split('\n').map((line) => line.replace(/^data:\s?/, ''));
          for (const line of lines) {
            if (!line) continue;
            try {
              const payload = JSON.parse(line) as { type?: string; token?: string; message?: string };
              if (payload.type === 'token' && payload.token) {
                finalText += payload.token;
                setSessions(prev => prev.map(s => s.id === sessionId ? {
                  ...s,
                  messages: s.messages.map((msg) => msg.id === assistantMessageId ? { ...msg, text: finalText, isStreaming: true } : msg)
                } : s));
                scrollToNewestMessage();
              }
              if (payload.type === 'done') {
                setSessions(prev => prev.map(s => s.id === sessionId ? {
                  ...s,
                  messages: s.messages.map((msg) => msg.id === assistantMessageId ? { ...msg, text: finalText, isStreaming: false } : msg)
                } : s));
                scrollToNewestMessage();
              }
              if (payload.type === 'error') {
                const friendly = classifyChatErrorState(payload.message || 'Unable to stream a response.');
                setSessions(prev => prev.map(s => s.id === sessionId ? {
                  ...s,
                  messages: s.messages.map((msg) => msg.id === assistantMessageId ? {
                    ...msg,
                    text: finalText || '',
                    isStreaming: false,
                    errorState: friendly,
                  } : msg)
                } : s));
                throw new Error(friendly.message);
              }
            } catch {
              // Ignore malformed or non-streaming events.
            }
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n').map((line) => line.replace(/^data:\s?/, ''));
        for (const line of lines) {
          if (!line) continue;
          try {
            const payload = JSON.parse(line) as { type?: string; token?: string; message?: string };
            if (payload.type === 'token' && payload.token) {
              finalText += payload.token;
              setSessions(prev => prev.map(s => s.id === sessionId ? {
                ...s,
                messages: s.messages.map((msg) => msg.id === assistantMessageId ? { ...msg, text: finalText, isStreaming: true } : msg)
              } : s));
              scrollToNewestMessage();
            }
            if (payload.type === 'done') {
              setSessions(prev => prev.map(s => s.id === sessionId ? {
                ...s,
                messages: s.messages.map((msg) => msg.id === assistantMessageId ? { ...msg, text: finalText, isStreaming: false } : msg)
              } : s));
              scrollToNewestMessage();
            }
            if (payload.type === 'error') {
              const friendly = classifyChatErrorState(payload.message || 'Unable to stream a response.');
              setSessions(prev => prev.map(s => s.id === sessionId ? {
                ...s,
                messages: s.messages.map((msg) => msg.id === assistantMessageId ? {
                  ...msg,
                  text: finalText || '',
                  isStreaming: false,
                  errorState: friendly,
                } : msg)
              } : s));
              throw new Error(friendly.message);
            }
          } catch {
            // Ignore malformed or non-streaming events.
          }
        }
      }
    } catch (err: unknown) {
      const friendly = classifyChatErrorState(err);
      setSessions(prev => prev.map(s => s.id === sessionId ? {
        ...s,
        messages: s.messages.map((msg) => msg.id === assistantMessageId ? {
          ...msg,
          text: msg.text || '',
          isStreaming: false,
          errorState: friendly,
        } : msg)
      } : s));
      setVoiceError(friendly.message);
      console.error('Chat send failed:', err);
    } finally {
      streamAbortControllerRef.current = null;
      activeAssistantMessageRef.current = null;
      setIsLoading(false);
      setVoiceStatus((current) => current === 'processing' ? 'idle' : current);
      scrollToNewestMessage();
    }
  };

  const handleSaveEditedMessage = useCallback(async (message: Message) => {
    const nextText = editingDraft.trim();
    if (!message.id || !nextText) {
      handleCancelEditMessage();
      return;
    }

    setEditingMessageId(null);
    setEditingDraft('');
    await submitMessage(nextText, { replaceMessageId: message.id, resetConversation: true });
  }, [editingDraft, handleCancelEditMessage]);

  const handleCancelGeneration = () => {
    if (!streamAbortControllerRef.current) {
      return;
    }
    streamAbortControllerRef.current.abort();
    streamAbortControllerRef.current = null;
    setIsLoading(false);
    setVoiceStatus('idle');
    if (activeAssistantMessageRef.current) {
      const { sessionId, messageId } = activeAssistantMessageRef.current;
      setSessions(prev => prev.map((s) => s.id === sessionId ? {
        ...s,
        messages: s.messages.map((msg) => msg.id === messageId ? { ...msg, isStreaming: false, errorState: classifyChatErrorState(new DOMException('The operation was aborted', 'AbortError')) } : msg)
      } : s));
    }
    activeAssistantMessageRef.current = null;
    scrollToNewestMessage();
  };

  const handleRetryLastMessage = useCallback(async (messageId?: string) => {
    const session = currentSessionRef.current;
    if (!session || !messageId) return;

    const targetMessage = session.messages.find((msg) => msg.id === messageId && msg.role === 'assistant');
    if (!targetMessage) return;

    const retryMessage = session.messages.find((msg) => msg.id === messageId);
    if (!retryMessage) return;

    const lastUserMessage = [...session.messages].reverse().find((msg) => msg.role === 'user' && msg.id !== messageId);
    if (!lastUserMessage?.text?.trim()) return;

    const controller = new AbortController();
    streamAbortControllerRef.current = controller;
    activeAssistantMessageRef.current = { sessionId: session.id, messageId };

    setSessions(prev => prev.map((s) => s.id === session.id ? {
      ...s,
      messages: s.messages.map((msg) => msg.id === messageId ? { ...msg, text: '', isStreaming: true, errorState: null } : msg)
    } : s));

    try {
      const response = await fetch('/api/chat/message/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || payload.message || 'Unable to regenerate the response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const rawChunk = buffer.slice(0, boundaryIndex).trim();
          buffer = buffer.slice(boundaryIndex + 2);
          boundaryIndex = buffer.indexOf('\n\n');

          const lines = rawChunk.split('\n').map((line) => line.replace(/^data:\s?/, ''));
          for (const line of lines) {
            if (!line) continue;
            try {
              const payload = JSON.parse(line) as { type?: string; token?: string; message?: string };
              if (payload.type === 'token' && payload.token) {
                finalText += payload.token;
                setSessions(prev => prev.map((s) => s.id === session.id ? {
                  ...s,
                  messages: s.messages.map((msg) => msg.id === messageId ? { ...msg, text: finalText, isStreaming: true } : msg)
                } : s));
                scrollToNewestMessage();
              }
              if (payload.type === 'done') {
                setSessions(prev => prev.map((s) => s.id === session.id ? {
                  ...s,
                  messages: s.messages.map((msg) => msg.id === messageId ? { ...msg, text: finalText, isStreaming: false, errorState: null } : msg)
                } : s));
                scrollToNewestMessage();
              }
              if (payload.type === 'error') {
                throw new Error(payload.message || 'Unable to regenerate the response.');
              }
            } catch {
              // Ignore malformed stream frames.
            }
          }
        }
      }
    } catch (err: unknown) {
      const friendly = classifyChatErrorState(err);
      setSessions(prev => prev.map((s) => s.id === session.id ? {
        ...s,
        messages: s.messages.map((msg) => msg.id === messageId ? {
          ...msg,
          text: msg.text || friendly.title,
          isStreaming: false,
          errorState: friendly,
        } : msg)
      } : s));
      console.error('Regenerate failed:', err);
    } finally {
      streamAbortControllerRef.current = null;
      activeAssistantMessageRef.current = null;
      setIsLoading(false);
      setVoiceStatus((current) => current === 'processing' ? 'idle' : current);
      scrollToNewestMessage();
    }
  }, []);

  const handleRegenerate = async (messageId?: string) => {
    await handleRetryLastMessage(messageId);
  };

  const handleSendMessage = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    await submitMessage();
  };

  const handleVoiceStart = async () => {
    setVoiceError('');
    setVoiceTranscript('');
    setVoiceInterimTranscript('');
    await tutorControllerRef.current?.startListening();
  };

  const handleVoiceCancel = async () => {
    await tutorControllerRef.current?.cancelListening();
    setVoiceTranscript('');
    setVoiceInterimTranscript('');
    setVoiceError('');
  };

  const handleVoiceStopSpeaking = async () => {
    await tutorControllerRef.current?.interruptSpeech();
  };

  const handleToggleScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setVoiceError('Screen sharing is not supported in this browser.');
      return;
    }

    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      setLiveSubtitle('Screen sharing stopped');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      if (screenShareVideoRef.current) {
        screenShareVideoRef.current.srcObject = stream;
        await screenShareVideoRef.current.play();
      }
      setIsScreenSharing(true);
      setLiveSubtitle('Screen sharing enabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start screen sharing.';
      setVoiceError(message);
    }
  };

  useEffect(() => {
    const avatarAdapter: LiveTutorAvatarAdapter | null = learningTier === 'premium_live'
      ? {
          start: async () => {
            if (!avatarClient.current) {
              await initLiveTeacherStream();
            }
          },
          stop: async () => {
            await terminateStream();
          },
          attach: (element) => {
            if (avatarClient.current) {
              avatarClient.current.attach(element);
            }
          },
          speak: async (text) => {
            if (learningTier !== 'premium_live' || !avatarClient.current) return;
            const cleanText = text.replace(/[#*`]/g, '');
            if (typeof avatarClient.current?.speak === 'function') {
              await avatarClient.current.speak({ text: cleanText });
            }
          },
          interrupt: () => {
            if (typeof avatarClient.current?.interrupt === 'function') {
              avatarClient.current.interrupt();
            }
          },
        }
      : null;

    const controller = createLiveTutorOrchestrator(avatarAdapter, {
      onStatusChange: (nextStatus) => setVoiceStatus(nextStatus),
      onTranscriptChange: (transcript, interimTranscript) => {
        setVoiceTranscript(transcript);
        setVoiceInterimTranscript(interimTranscript);
      },
      onSubtitleChange: (subtitle) => setLiveSubtitle(subtitle),
      onError: (message) => setVoiceError(message),
      onConversationMessage: ({ role, text }) => {
        if (role === 'assistant') {
          setLiveSubtitle(text);
        }
      },
    });

    tutorControllerRef.current = controller;
    void controller.initialize();

    return () => {
      controller.dispose();
      tutorControllerRef.current = null;
    };
  }, [learningTier, initLiveTeacherStream, terminateStream]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    const container = chatScrollRef.current;
    const saved = scrollPositions[activeSessionId];
    if (typeof saved === 'number') {
      container.scrollTop = saved;
      userAtBottomRef.current = saved >= Math.max(0, container.scrollHeight - container.clientHeight - CHAT_SCROLL_THRESHOLD_PX);
      setShowJumpToLatest(!userAtBottomRef.current);
      return;
    }
    container.scrollTop = container.scrollHeight;
    userAtBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [activeSessionId, currentSession.messages.length, scrollPositions]);

  useEffect(() => {
    const sessionToSync = sessions.find((session) => session.id === activeSessionId);
    if (!sessionToSync?.conversationId || typeof window === 'undefined') return;

    const controller = new AbortController();
    const syncSession = async () => {
      try {
        const response = await fetch(`/api/chat/${sessionToSync.conversationId}?limit=100`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = await response.json();
        const messages = data?.conversation?.messages;
        if (!Array.isArray(messages)) return;

        setSessions((previous) => previous.map((session) => {
          if (session.id !== sessionToSync.id) return session;
          return {
            ...session,
            messages: mergeServerMessages(session.messages, messages),
          };
        }));
      } catch {
        // silent sync failure
      }
    };

    void syncSession();
    return () => controller.abort();
  }, [activeSessionId, sessions]);

  const latestAssistantMessage = [...currentSession.messages].reverse().find((message) => message.role === 'assistant');
  const showThinkingIndicator = (isLoading || Boolean(latestAssistantMessage?.isStreaming)) && !latestAssistantMessage?.text?.trim();
  const historyForSuggestions = sessions.flatMap((session) => session.messages);
  const emptyChatSuggestions = getEmptyChatSuggestions(historyForSuggestions);

  const handleSuggestionSelect = (prompt: string) => {
    setQuery(prompt);
    setTimeout(() => {
      void submitMessage(prompt);
    }, 0);
  };

  return (
    <div className="h-screen w-screen bg-black text-zinc-200 flex flex-col font-sans overflow-hidden select-none">
      
      {/* APP TOP NAVIGATION HEADER */}
      <header className="h-16 shrink-0 border-b border-zinc-900/80 bg-zinc-950/95 px-4 sm:px-6">
        <div className="flex h-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-base font-semibold text-cyan-300">
              M
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[0.24em] text-zinc-100 uppercase">Mento Universal Mentor</p>
              <p className="truncate text-[11px] text-zinc-500">Premium chat and live coaching workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              type="button"
              onClick={() => setLearningTier(learningTier === 'standard' ? 'premium_live' : 'standard')}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-all ${
                learningTier === 'premium_live' 
                  ? 'border-red-500/40 bg-red-500/10 text-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.15)]' 
                  : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
              }`}
            >
              {learningTier === 'premium_live' ? '● Live teaching' : '✨ Live classroom'}
            </button>
            <NotificationCenter />
            <button 
              type="button"
              onClick={handleNewChat}
              className="rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-300 transition hover:bg-zinc-800"
            >
              + New Session
            </button>
          </div>
        </div>
      </header>

      {/* CORE FRAME LAYOUT */}
      <div className="flex-1 flex overflow-hidden w-full">
        
        {/* LEFTSIDE BAR */}
        <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-zinc-900/80 bg-zinc-950/90">
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-600">Navigation</div>
            <div className="space-y-1.5">
              <button 
                type="button"
                onClick={() => setLearningTier('standard')}
                className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-xs font-medium transition ${learningTier === 'standard' ? 'bg-zinc-900 text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]' : 'text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200'}`}
              >
                <span className="text-base">💬</span> Text Assistant
              </button>
              <button 
                type="button"
                onClick={() => setLearningTier('premium_live')}
                className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-xs font-medium transition ${learningTier === 'premium_live' ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' : 'text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200'}`}
              >
                <span className="text-base">📹</span> Live Instructor View
              </button>
            </div>

            <div className="mt-5 flex flex-1 flex-col overflow-hidden">
              <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-600">Recent Sessions</div>
              <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSessionId(s.id)}
                    className={`block w-full truncate rounded-2xl border px-3 py-2.5 text-left text-xs font-medium transition ${s.id === activeSessionId ? 'border-zinc-800 bg-zinc-900 text-cyan-300 shadow-[0_10px_24px_rgba(0,0,0,0.16)]' : 'border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-zinc-200'}`}
                  >
                    📁 {s.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-zinc-900/80 bg-zinc-950/70 p-4 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-xs font-semibold text-cyan-300">M</div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[11px] font-medium text-zinc-300">Mento Core Node</span>
              <span className="truncate text-[10px] text-zinc-600">v0.1 · premium-ready</span>
            </div>
          </div>
        </aside>

        {activeMessageAction?.messageId ? (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={closeMessageActions}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Message actions</div>
              <button type="button" onClick={closeMessageActions} className="rounded-full border border-zinc-700/70 px-2.5 py-1 text-[10px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-white">
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {currentSession.messages.find((message) => message.id === activeMessageAction.messageId)?.role === 'user' ? (
                <>
                  <button type="button" onClick={() => {
                    const message = currentSession.messages.find((entry) => entry.id === activeMessageAction.messageId);
                    if (message) {
                      handleStartEditMessage(message);
                    }
                  }} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
                    Edit
                  </button>
                  <button type="button" onClick={() => {
                    handleCopyMessage(currentSession.messages.find((entry) => entry.id === activeMessageAction.messageId) as Message);
                  }} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
                    Copy
                  </button>
                  <button type="button" onClick={() => {
                    handleDeleteMessage(activeMessageAction.messageId ?? undefined);
                  }} className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20">
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => {
                    const message = currentSession.messages.find((entry) => entry.id === activeMessageAction.messageId);
                    if (message) {
                      handleCopyMessage(message);
                    }
                  }} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
                    Copy
                  </button>
                  <button type="button" onClick={() => {
                    if (activeMessageAction.messageId) {
                      void handleRegenerate(activeMessageAction.messageId);
                    }
                  }} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
                    Regenerate
                  </button>
                  <button type="button" onClick={() => {
                    const message = currentSession.messages.find((entry) => entry.id === activeMessageAction.messageId);
                    if (message) {
                      void handleShareMessage(message);
                    }
                  }} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
                    Share
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {learningTier === 'standard' ? (
          
          /* VIEW 1: MARKDOWN TEXT CHAT INTERFACE */
          <main className="flex-1 flex flex-col bg-zinc-950 overflow-hidden min-w-0 items-center justify-between relative">
            <div ref={chatScrollRef} className="w-full max-w-3xl flex-1 overflow-y-auto p-6 space-y-4 min-h-0 container">
              {currentSession.messages.length === 0 && !isLoading ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-2xl mx-auto py-6">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
                      <span className="h-2 w-2 rounded-full bg-cyan-400" />
                      Fresh start
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-100">What would you like to explore?</h2>
                    <p className="text-sm leading-6 text-zinc-400">Pick a prompt to begin, or ask anything and I’ll guide you from there.</p>
                  </div>
                  <div className="grid gap-3 w-full sm:grid-cols-2">
                    {emptyChatSuggestions.map((suggestion) => {
                      const accentClass = suggestion.accent === 'purple'
                        ? 'border-purple-500/20 bg-purple-500/10 text-purple-200 hover:border-purple-400/40 hover:bg-purple-500/20'
                        : suggestion.accent === 'emerald'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/40 hover:bg-emerald-500/20'
                          : suggestion.accent === 'amber'
                            ? 'border-amber-500/20 bg-amber-500/10 text-amber-200 hover:border-amber-400/40 hover:bg-amber-500/20'
                            : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/40 hover:bg-cyan-500/20';

                      return (
                        <button
                          key={suggestion.title}
                          type="button"
                          onClick={() => handleSuggestionSelect(suggestion.prompt)}
                          className={`rounded-2xl border p-4 text-left shadow-[0_10px_30px_rgba(0,0,0,0.16)] transition duration-200 hover:-translate-y-0.5 ${accentClass}`}
                        >
                          <p className="text-sm font-semibold">{suggestion.title}</p>
                          <p className="mt-1 text-[12px] leading-5 text-zinc-300/90">{suggestion.subtitle}</p>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setLearningTier('premium_live')}
                      className="sm:col-span-2 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 text-left text-purple-200 transition hover:border-purple-400/40 hover:bg-purple-500/20"
                    >
                      <p className="text-sm font-semibold">✨ Jump into live teaching</p>
                      <p className="mt-1 text-[12px] leading-5 text-purple-300/90">Switch to the live classroom for guided lessons and follow-along coaching.</p>
                    </button>
                  </div>
                </div>
              ) : null}

              {currentSession.messages.map((msg, index) => (
                <div key={msg.id ?? index} className={`flex w-full px-1 py-1.5 sm:px-2 sm:py-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`w-full max-w-[min(92%,760px)] ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
                    <MessageContent
                      message={msg}
                      isUser={msg.role === 'user'}
                      onOpenActions={openMessageActions}
                      onLongPressStart={beginLongPress}
                      onLongPressEnd={cancelLongPress}
                      isEditing={editingMessageId === msg.id}
                      editDraft={editingDraft}
                      setEditDraft={setEditingDraft}
                      onSaveEdit={handleSaveEditedMessage}
                      onCancelEdit={handleCancelEditMessage}
                      onRetryMessage={(message) => {
                        if (message.id) {
                          void handleRegenerate(message.id);
                        }
                      }}
                      copiedMessageId={copiedMessageId}
                    />
                  </div>
                </div>
              ))}
              <div ref={messageEndRef} />

              {showJumpToLatest ? (
                <button
                  type="button"
                  onClick={() => scrollToNewestMessage(true)}
                  className="fixed bottom-28 right-6 z-40 rounded-full border border-blue-500/40 bg-zinc-900/95 px-4 py-2 text-sm font-medium text-blue-300 shadow-lg shadow-black/30 backdrop-blur transition hover:bg-zinc-800"
                >
                  Jump to latest
                </button>
              ) : null}

              {showThinkingIndicator ? (
                <div className="transition-all duration-300 ease-out">
                  <ThinkingIndicator />
                </div>
              ) : null}

              {isLoading ? (
                <div className="mt-2 flex justify-start">
                  <button
                    type="button"
                    onClick={handleCancelGeneration}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-300 transition hover:bg-rose-500/20"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>

            <div className="w-full max-w-3xl p-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent shrink-0">
              <form onSubmit={handleSendMessage} className="relative">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.zip"
                  className="hidden"
                  onChange={handleAttachmentSelect}
                />
                {pendingAttachments.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingAttachments.map((attachment) => (
                      <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-900/70 px-3 py-1 text-[12px] text-zinc-300">
                        <span>{attachment.type === 'image' ? '🖼️' : '📄'}</span>
                        <span className="max-w-[160px] truncate">{attachment.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className={getComposerSurfaceClass(isComposerFocused, pendingAttachments.length > 0)}>
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    className="shrink-0 rounded-full border border-zinc-700/70 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                    aria-label="Attach files"
                  >
                    📎
                  </button>
                  <textarea
                    rows={2}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                      if (e.key === 'Escape') {
                        e.currentTarget.blur();
                      }
                    }}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    placeholder="Ask Mento a text question or type code..."
                    className="min-h-[48px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={!query.trim() && pendingAttachments.length === 0 || isLoading}
                    className="shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 p-2 text-white shadow-[0_10px_24px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ▲
                  </button>
                </div>

                <div className="mt-3 rounded-[22px] border border-zinc-800/70 bg-zinc-900/80 p-3 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
                      <span className={`h-2.5 w-2.5 rounded-full ${voiceStatus === 'listening' ? 'bg-red-500 animate-pulse' : voiceStatus === 'speaking' ? 'bg-emerald-500 animate-pulse' : voiceStatus === 'processing' ? 'bg-amber-500' : 'bg-zinc-600'}`} />
                      {voiceStatus === 'listening' ? 'Listening' : voiceStatus === 'speaking' ? 'Speaking' : voiceStatus === 'processing' ? 'Thinking' : 'Voice Chat Ready'}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleVoiceStart}
                        className="rounded-full border border-zinc-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                      >
                        🎤 Start
                      </button>
                      <button
                        type="button"
                        onClick={handleVoiceCancel}
                        className="rounded-full border border-zinc-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                      >
                        ✕ Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleVoiceStopSpeaking}
                        className="rounded-full border border-zinc-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                      >
                        ⏹ Stop
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-zinc-800/70 bg-black/25 p-3 text-sm text-zinc-300">
                    {voiceTranscript || voiceInterimTranscript ? (
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Live transcript</p>
                        <p className="min-h-[24px] whitespace-pre-wrap">{voiceTranscript || voiceInterimTranscript}</p>
                        {voiceInterimTranscript && voiceTranscript ? (
                          <p className="text-zinc-500">{voiceInterimTranscript}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-zinc-500">Tap Start, speak naturally, and Mento will turn your words into a chat message and read the answer aloud.</p>
                    )}
                    {voiceError ? <p className="mt-2 text-xs text-red-400">{voiceError}</p> : null}
                  </div>
                </div>
              </form>
            </div>
          </main>

        ) : (
          
          /* VIEW 2: SPLIT SCREEN WEBRTC STREAM + COMPILER SANDBOX */
          <>
            <main className="flex-1 flex flex-col bg-zinc-900/10 border-r border-zinc-900 overflow-hidden min-w-0">
              
              <div className="p-4 shrink-0 flex justify-center bg-zinc-950/40 border-b border-zinc-900">
                <div className="w-full max-w-2xl aspect-[16/9] rounded-xl border border-zinc-800 bg-black relative overflow-hidden shadow-2xl">
                  
                  {/* WebRTC Target Video Handle */}
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${isAiStreaming ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                  />

                  <div className={`absolute inset-0 bg-zinc-950 flex items-center justify-center transition-opacity duration-500 ${isAiStreaming ? 'opacity-0' : 'opacity-100'}`}>
                    <div className="bg-black/60 px-4 py-2 border border-zinc-800 text-zinc-400 text-xs font-mono rounded-lg backdrop-blur-md tracking-wide">
                      ⚡ Synchronizing Instructor Feed...
                    </div>
                  </div>
                  
                  <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                    <span className="bg-red-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded tracking-widest flex items-center gap-1 shadow-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
                      AI STREAM ACTIVE
                    </span>
                  </div>

                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-zinc-950/95 border border-zinc-800 px-4 py-1.5 rounded-full flex items-center gap-4 shadow-xl backdrop-blur-sm z-20">
                    <button type="button" onClick={() => setIsMuted(!isMuted)} className="text-xs">{isMuted ? '🔇' : '🎙️'}</button>
                    <button type="button" onClick={() => setCamOff(!camOff)} className="text-xs">{camOff ? '❌' : '📹'}</button>
                    <button type="button" onClick={handleToggleScreenShare} className={`text-xs ${isScreenSharing ? 'text-emerald-400' : ''}`}>
                      {isScreenSharing ? '🖥️ Sharing' : '🖥️'}
                    </button>
                    <div className="h-3.5 w-px bg-zinc-800"></div>
                    <button type="button" onClick={() => setLearningTier('standard')} className="text-[10px] font-bold text-zinc-400 hover:text-white tracking-tight">Exit Call</button>
                  </div>

                  {isScreenSharing ? (
                    <video
                      ref={screenShareVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : null}

                  <div className="absolute left-3 right-3 bottom-16 z-20 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-200 shadow-lg backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Live subtitle</div>
                    <div className="mt-1 min-h-[18px]">{liveSubtitle || 'Listening for your next question…'}</div>
                  </div>
                </div>
              </div>

              <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 p-4 sm:p-6 min-[1200px]:p-8 container">
                {showJumpToLatest ? (
                  <button
                    type="button"
                    onClick={() => scrollToNewestMessage(true)}
                    className="fixed bottom-28 right-6 z-40 rounded-full border border-blue-500/40 bg-zinc-900/95 px-4 py-2 text-sm font-medium text-blue-300 shadow-lg shadow-black/30 backdrop-blur transition hover:bg-zinc-800"
                  >
                    Jump to latest
                  </button>
                ) : null}
                {currentSession.messages.map((msg, index) => (
                  <div key={msg.id ?? index} className={`flex w-full flex-col px-1 py-1.5 sm:px-2 sm:py-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`w-full max-w-[min(92%,760px)] ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
                      <MessageContent
                        message={msg}
                        isUser={msg.role === 'user'}
                        onOpenActions={openMessageActions}
                        onLongPressStart={beginLongPress}
                        onLongPressEnd={cancelLongPress}
                        isEditing={editingMessageId === msg.id}
                        editDraft={editingDraft}
                        setEditDraft={setEditingDraft}
                        onSaveEdit={handleSaveEditedMessage}
                        onCancelEdit={handleCancelEditMessage}
                        onRetryMessage={(message) => {
                          if (message.id) {
                            void handleRegenerate(message.id);
                          }
                        }}
                        copiedMessageId={copiedMessageId}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-zinc-950 border-t border-zinc-900 shrink-0">
                <form onSubmit={handleSendMessage} className="max-w-xl mx-auto relative">
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.zip"
                    className="hidden"
                    onChange={handleAttachmentSelect}
                  />
                  {pendingAttachments.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {pendingAttachments.map((attachment) => (
                        <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300">
                          <span>{attachment.type === 'image' ? '🖼️' : '📄'}</span>
                          <span className="max-w-[140px] truncate">{attachment.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className={getComposerSurfaceClass(false, pendingAttachments.length > 0)}>
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      className="shrink-0 rounded-full border border-zinc-700/70 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                      aria-label="Attach files"
                    >
                      📎
                    </button>
                    <textarea
                      rows={2}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                        if (e.key === 'Escape') {
                          e.currentTarget.blur();
                        }
                      }}
                      onFocus={() => setIsComposerFocused(true)}
                      onBlur={() => setIsComposerFocused(false)}
                      placeholder="Talk live with the AI instructor..."
                      className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-500"
                    />
                    <button
                      type="submit"
                      disabled={!query.trim() && pendingAttachments.length === 0 || isLoading}
                      className="shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 p-2 text-white shadow-[0_10px_24px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ▲
                    </button>
                  </div>
                </form>
              </div>
            </main>

            {/* INTERACTIVE COMPILER COMPONENT */}
            <aside className="w-80 bg-zinc-950 flex flex-col shrink-0">
              <div className="h-11 border-b border-zinc-900 px-4 flex items-center justify-between text-xs font-mono bg-zinc-950 shrink-0">
                <span className="text-zinc-400">sandbox_runtime.py</span>
                <button 
                  type="button"
                  onClick={handleRunCode}
                  disabled={isRunning}
                  className="px-2 py-0.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 font-bold text-[10px]"
                >
                  {isRunning ? 'RUNNING...' : '▶ RUN'}
                </button>
              </div>
              
              <div className="flex-1 p-2 bg-zinc-950 overflow-hidden flex">
                <textarea
                  value={sandboxCode}
                  onChange={(e) => setSandboxCode(e.target.value)}
                  className="w-full h-full bg-black border border-zinc-900 rounded-lg p-3 text-xs font-mono text-zinc-300 outline-none resize-none"
                  spellCheck="false"
                />
              </div>

              <div className="h-40 border-t border-zinc-900 bg-black p-4 font-mono text-xs flex flex-col overflow-hidden shrink-0">
                <div className="text-zinc-600 text-[10px] uppercase font-bold tracking-wider mb-1.5">Live Execution Output</div>
                <div className="flex-1 overflow-y-auto space-y-1 text-[11px] text-emerald-500 font-mono">
                  {consoleLogs.map((log, idx) => <div key={idx}>{log}</div>)}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}