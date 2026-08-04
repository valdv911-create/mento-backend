'use client';

import LegalShell from '../../components/legal-shell';

const points = [
  'You must provide accurate account information and keep your login credentials secure.',
  'You may use Mento for lawful educational, professional, and personal purposes, and must not attempt to exploit the platform or bypass safeguards.',
  'Mento provides AI-generated assistance that may occasionally be incomplete, outdated, or inaccurate. You remain responsible for reviewing and validating outputs.',
  'You are responsible for your content and for any actions taken through your account.',
];

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      description="These terms outline how you can use Mento and what to expect from the platform and its AI features."
    >
      <div className="space-y-6">
        <p className="text-sm leading-7 text-slate-300">
          By accessing or using Mento, you agree to these terms. These terms may be updated over time as the service evolves.
        </p>
        <ul className="space-y-3 text-sm leading-7 text-slate-400">
          {points.map((point) => (
            <li key={point} className="rounded-2xl border border-white/10 bg-slate-800/60 p-3">{point}</li>
          ))}
        </ul>
      </div>
    </LegalShell>
  );
}
