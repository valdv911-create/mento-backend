'use client';

import LegalShell from '../../components/legal-shell';

export default function AIDisclaimerPage() {
  return (
    <LegalShell
      title="AI Disclaimer"
      description="Mento uses AI to assist with learning and productivity, but the output should be reviewed carefully."
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-7 text-amber-100">
          AI-generated content may be incorrect, incomplete, or not suitable for your specific context. Please verify important information independently.
        </div>
        <div className="space-y-3 text-sm leading-7 text-slate-400">
          <p>Mento may use third-party models and services to generate responses. Those systems can make errors, hallucinate, or produce content that should not be trusted without review.</p>
          <p>Do not rely on AI-generated content for legal, medical, financial, safety-critical, or high-stakes decisions without professional review.</p>
          <p>You are responsible for evaluating any output before acting on it.</p>
        </div>
      </div>
    </LegalShell>
  );
}
