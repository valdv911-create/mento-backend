'use client';

import LegalShell from '../../components/legal-shell';

const sections = [
  {
    title: 'Information we collect',
    body: 'We collect account details, profile information, conversations, usage logs, wallet data, and support communications that help us provide, improve, and secure the Mento experience.',
  },
  {
    title: 'How we use your data',
    body: 'Your data is used to provide personalized learning support, maintain account functionality, improve model quality, process billing and usage, and respond to support requests.',
  },
  {
    title: 'Data sharing',
    body: 'We do not sell personal data. We may share limited information with service providers that help operate Mento, such as hosting, authentication, analytics, and messaging infrastructure.',
  },
  {
    title: 'Your control',
    body: 'You may request access, correction, or deletion of your account data. Deletion removes your profile, conversations, notifications, usage logs, wallet records, and related information from active systems.',
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      description="This policy explains how Mento collects, uses, and protects your information across the app and support experience."
    >
      <div className="space-y-6">
        <p className="text-sm leading-7 text-slate-300">
          Mento is committed to protecting your privacy and handling your data responsibly. The information below summarizes how we process personal data and how you can exercise your rights.
        </p>
        {sections.map((section) => (
          <div key={section.title} className="rounded-2xl border border-white/10 bg-slate-800/60 p-4">
            <h2 className="text-lg font-semibold text-white">{section.title}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-400">{section.body}</p>
          </div>
        ))}
      </div>
    </LegalShell>
  );
}
