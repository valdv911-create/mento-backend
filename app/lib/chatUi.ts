export function getAttachmentGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  return 'grid-cols-2 sm:grid-cols-3';
}

export function getAttachmentPreviewClass(count: number): string {
  if (count <= 1) return 'max-w-[280px]';
  if (count === 2) return 'max-w-[320px]';
  return 'max-w-[360px]';
}

export function getMessageSurfaceClass(isUser: boolean, isStreaming: boolean, hasError: boolean): string {
  const base = isUser
    ? 'border border-blue-500/20 bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_18px_45px_rgba(10,30,80,0.28)]'
    : 'border border-zinc-800/80 bg-zinc-900/95 text-zinc-100 shadow-[0_18px_42px_rgba(0,0,0,0.24)]';

  if (hasError) {
    return 'w-full max-w-[min(100%,720px)] rounded-[28px] border border-amber-500/24 bg-zinc-900/95 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.24)] backdrop-blur-sm';
  }

  if (isStreaming) {
    return `${base} ring-1 ring-cyan-400/20 backdrop-blur-sm`; 
  }

  return `${base} backdrop-blur-sm`;
}

export function getComposerSurfaceClass(isFocused: boolean, hasPendingAttachments: boolean): string {
  const base = 'flex items-end gap-2 rounded-[24px] border px-3 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.2)] transition-all duration-200';

  if (isFocused) {
    return `${base} border-cyan-400/40 bg-zinc-900/95 shadow-[0_18px_45px_rgba(6,182,212,0.16)]`;
  }

  if (hasPendingAttachments) {
    return `${base} border-zinc-700/80 bg-zinc-900/95`;
  }

  return `${base} border-zinc-800/80 bg-zinc-900/85`;
}
