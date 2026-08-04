'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import LegalShell from '../../components/legal-shell';
import packageJson from '../../../package.json';

const supportItems = [
  {
    title: 'Email support',
    detail: 'mentosupport@gmail.com',
    href: 'mailto:mentosupport@gmail.com',
  },
  {
    title: 'App version',
    detail: packageJson.version ?? '0.1.0',
    href: null,
  },
  {
    title: 'Delete account',
    detail: 'Permanently remove your Mento account and associated data.',
    href: '/account/delete',
  },
];

export default function HelpPage() {
  const supportItemsMemo = useMemo(() => supportItems, []);

  return (
    <LegalShell
      title="Help & Support"
      description="Get assistance with account questions, security concerns, or usage issues."
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm leading-7 text-cyan-100">
          Need a hand? Reach us at <a href="mailto:mentosupport@gmail.com" className="font-semibold underline">mentosupport@gmail.com</a> and we will help with account, billing, or product questions.
        </div>
        <div className="grid gap-3">
          {supportItemsMemo.map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                </div>
                {item.href ? (
                  item.href.startsWith('mailto:') ? (
                    <a href={item.href} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200">Contact</a>
                  ) : (
                    <Link href={item.href} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200">Open</Link>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </LegalShell>
  );
}
