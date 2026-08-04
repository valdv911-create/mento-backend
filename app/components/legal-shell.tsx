import Link from 'next/link';
import packageJson from '../../package.json';

interface LegalShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  eyebrow?: string;
}

export default function LegalShell({ title, description, children, eyebrow = 'Legal & account' }: LegalShellProps) {
  const appVersion = packageJson.version ?? '0.1.0';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_28%),linear-gradient(135deg,_#050816_0%,_#0f172a_50%,_#111827_100%)] px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex w-fit items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
                {eyebrow}
              </span>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{description}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Version {appVersion}</span>
              <Link href="/legal/help" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition hover:border-cyan-400/40 hover:text-cyan-200">
                Contact support
              </Link>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
            {children}
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <h2 className="text-lg font-semibold text-white">Helpful links</h2>
              <div className="mt-4 flex flex-col gap-2 text-sm text-slate-300">
                <Link href="/legal/privacy" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 transition hover:border-cyan-400/40 hover:text-cyan-200">Privacy Policy</Link>
                <Link href="/legal/terms" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 transition hover:border-cyan-400/40 hover:text-cyan-200">Terms of Service</Link>
                <Link href="/legal/ai-disclaimer" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 transition hover:border-cyan-400/40 hover:text-cyan-200">AI Disclaimer</Link>
                <Link href="/legal/help" className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 transition hover:border-cyan-400/40 hover:text-cyan-200">Help & Support</Link>
                <Link href="/account/delete" className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-rose-200 transition hover:border-rose-400/40">Delete Account</Link>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <h2 className="text-lg font-semibold text-white">Security notice</h2>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                Mento protects sensitive actions with authentication checks and secure account deletion workflows so your data is handled responsibly and permanently when requested.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
