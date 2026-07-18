export const metadata = {
  title: 'Account & Data Deletion',
  description:
    'How to request deletion of your LIBERTASIAN account and personal data, including what is removed and what is retained.',
};

export default function AccountDeletionPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Delete Your Account and Data</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: July 17, 2026</p>
      <p className="mt-4 text-sm text-gray-600">
        This page explains how to request deletion of your <strong>LIBERTASIAN</strong> account
        (developer: LIBERTASIAN Inc.) and the personal data associated with it, what data is
        removed, and what we are required to retain. It applies to the LIBERTASIAN mobile app and
        the web application at libertasian.com.
      </p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="How to request account deletion">
          <ol>
            <li>
              Email our Data Protection Officer at <strong>dpo@libertasian.com</strong> from the
              email address associated with your LIBERTASIAN account.
            </li>
            <li>
              Use the subject line <em>&quot;Account deletion request.&quot;</em>
            </li>
            <li>
              We verify that you own the account, then deactivate it and permanently delete it after
              the 30-day recovery window described below.
            </li>
            <li>
              We confirm completion by email. The whole process finishes within 30 days of your
              request.
            </li>
          </ol>
        </Section>

        <Section title="What data is deleted">
          <ul>
            <li>
              <strong>Account information:</strong> Your name, email address, phone number, and
              password hash.
            </li>
            <li>
              <strong>Your content:</strong> Uploaded documents, camera scans, notes, annotations,
              bookmarks, digests you created, and workspace data — deleted within 30 days of your
              request or account closure.
            </li>
            <li>
              <strong>Search and AI history:</strong> Your saved search history and AI assistant
              prompts tied to your account.
            </li>
          </ul>
        </Section>

        <Section title="What data is kept, and for how long">
          <p>
            To comply with Philippine law and for fraud prevention, some records are retained after
            account deletion, in de-identified form where possible:
          </p>
          <ul>
            <li>
              <strong>Account data recovery window:</strong> Retained for 30 days after your
              deletion request so the account can be restored if the request was made in error, then
              permanently deleted.
            </li>
            <li>
              <strong>Audit logs:</strong> Retained for a minimum of 2 years as required by the
              Philippine Data Privacy Act.
            </li>
            <li>
              <strong>Billing records:</strong> Retained for 5 years as required by Philippine tax
              law.
            </li>
            <li>
              <strong>AI model run records:</strong> Retained for 1 year for quality assurance and
              audit purposes.
            </li>
            <li>
              <strong>Search query logs:</strong> Anonymized after 90 days, with personal
              identifiers removed.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> sell your personal information, and camera scans and uploads
            are never used to train our AI models.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            For any question about deleting your account or data, contact us at{' '}
            <strong>dpo@libertasian.com</strong>. We respond within 30 days. See our{' '}
            <a href="/privacy" className="text-amber-700 underline">
              Privacy Policy
            </a>{' '}
            for full details on how we handle personal data.
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
