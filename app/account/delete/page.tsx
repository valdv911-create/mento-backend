'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LegalShell from '../../components/legal-shell';

export default function DeleteAccountPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [googleAccessToken, setGoogleAccessToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = useMemo(() => {
    const typedConfirmation = confirmationText.trim().toLowerCase();
    return typedConfirmation === 'delete my account' && (password.trim() || googleAccessToken.trim());
  }, [confirmationText, password, googleAccessToken]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!canSubmit) {
      setError('Please type “delete my account” and provide a password or Google re-authentication token.');
      return;
    }

    if (!window.confirm('This will permanently delete your account and all associated data. This action cannot be undone. Continue?')) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/me/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('mento_token') ?? ''}`,
        },
        body: JSON.stringify({
          password: password || undefined,
          googleAccessToken: googleAccessToken || undefined,
          confirmPassword,
          confirmationText,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Account deletion failed.');
      }

      setSuccess(true);
      localStorage.removeItem('mento_token');
      localStorage.removeItem('mento_user');
      setPassword('');
      setConfirmPassword('');
      setConfirmationText('');
      setGoogleAccessToken('');
      window.setTimeout(() => router.push('/'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <LegalShell
      title="Delete Account"
      description="Permanently remove your Mento profile, conversations, notifications, usage logs, wallet data, and other account information."
      eyebrow="Account management"
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm leading-7 text-rose-100">
          This action is irreversible. Once confirmed, your account data will be permanently deleted and cannot be recovered.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
            <label className="text-sm font-medium text-slate-200" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
            <label className="text-sm font-medium text-slate-200" htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter your password"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
            <label className="text-sm font-medium text-slate-200" htmlFor="googleToken">Google re-authentication token</label>
            <input
              id="googleToken"
              type="password"
              value={googleAccessToken}
              onChange={(event) => setGoogleAccessToken(event.target.value)}
              placeholder="Optional: paste a recent Google access token"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
            />
            <p className="mt-2 text-xs leading-6 text-slate-400">You can choose password-based deletion or provide a recent Google sign-in token for Google-linked accounts.</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
            <label className="text-sm font-medium text-slate-200" htmlFor="confirmation">Type confirmation</label>
            <input
              id="confirmation"
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder="delete my account"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
            />
          </div>

          {error ? <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}
          {success ? <p className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">Your account has been deleted. You will be redirected shortly.</p> : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className="rounded-full bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Deleting account…' : 'Delete account permanently'}
            </button>
            <Link href="/legal/help" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200">
              Back to support
            </Link>
          </div>
        </form>
      </div>
    </LegalShell>
  );
}
