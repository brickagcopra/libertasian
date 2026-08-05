import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'Privacy',
  description:
    'Privacy Policy for LIBERTASIAN Philippine Legal AI Platform, aligned with the Philippine Data Privacy Act of 2012.',
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: March 21, 2026</p>
      <p className="mt-4 text-sm text-gray-600">
        This Privacy Policy describes how {businessInfo.legalName} (&quot;we,&quot; &quot;us,&quot; or
        &quot;our&quot;) collects, uses, stores, and protects your personal information in
        compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and
        its Implementing Rules and Regulations.
      </p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="1. Data Controller">
          <p>
            {businessInfo.legalName} is the personal information controller for all data processed
            through the LIBERTASIAN platform. We are registered with the National Privacy
            Commission (NPC) as required by the Data Privacy Act for automated data processing
            systems involving AI-driven analysis.
          </p>
          <p>
            <strong>Data Protection Officer:</strong>
            <br />
            {businessInfo.dpo.name}
            <br />
            Email: {businessInfo.dpo.email}
            <br />
            Postal: {businessInfo.address.full}
          </p>
        </Section>

        <Section title="2. Personal Information We Collect">
          <h4>2.1 Information You Provide</h4>
          <ul>
            <li>
              <strong>Account information:</strong> Full name, email address, phone number
              (optional), password (stored as bcrypt hash)
            </li>
            <li>
              <strong>Organization details:</strong> Organization name, type, and membership
              information
            </li>
            <li>
              <strong>Billing information:</strong> Payment method details processed by our
              payment provider (we do not store full card numbers)
            </li>
            <li>
              <strong>User content:</strong> Documents you upload, camera scans, notes,
              annotations, bookmarks, and workspace data
            </li>
            <li>
              <strong>Communications:</strong> Support inquiries and feedback you send us
            </li>
          </ul>

          <h4>2.2 Information Collected Automatically</h4>
          <ul>
            <li>
              <strong>Usage data:</strong> Search queries, features used, pages visited, and
              interaction patterns
            </li>
            <li>
              <strong>Device information:</strong> Device type, operating system, browser type,
              and screen resolution
            </li>
            <li>
              <strong>Log data:</strong> IP address (prefix only for session binding), timestamps,
              and request metadata
            </li>
            <li>
              <strong>Session data:</strong> Authentication tokens (hashed) and active session
              information
            </li>
          </ul>

          <h4>2.3 Information from AI Processing</h4>
          <ul>
            <li>
              <strong>Query logs:</strong> Your search queries and AI interactions are logged
              for service improvement and audit purposes
            </li>
            <li>
              <strong>Model run records:</strong> We record the AI model name, version, prompt
              template version, input/output references, and confidence scores for every AI
              inference call for audit and quality assurance purposes
            </li>
          </ul>
        </Section>

        <Section title="3. Lawful Basis for Processing">
          <p>
            Under the Data Privacy Act, we process your personal information based on the
            following lawful bases:
          </p>
          <ul>
            <li>
              <strong>Consent:</strong> For account creation, marketing communications, and
              optional data sharing
            </li>
            <li>
              <strong>Contractual necessity:</strong> For providing the Service under your
              subscription agreement
            </li>
            <li>
              <strong>Legitimate interest:</strong> For fraud prevention, security monitoring,
              service improvement, and analytics
            </li>
            <li>
              <strong>Legal obligation:</strong> For tax records, audit logs, and compliance
              with Philippine law
            </li>
          </ul>
        </Section>

        <Section title="4. How We Use Your Information">
          <ul>
            <li>
              <strong>Service delivery:</strong> Processing your queries, generating digests,
              providing search results, and maintaining your workspace
            </li>
            <li>
              <strong>Account management:</strong> Authentication, session management, and
              subscription administration
            </li>
            <li>
              <strong>Service improvement:</strong> Analyzing usage patterns, monitoring AI
              quality metrics (accuracy, abstention rate, confidence distribution), and improving
              search relevance
            </li>
            <li>
              <strong>Security:</strong> Detecting and preventing unauthorized access, fraud,
              and abuse through rate limiting and audit logging
            </li>
            <li>
              <strong>Communication:</strong> Sending service notifications, security alerts,
              billing notices, and (with consent) product updates
            </li>
            <li>
              <strong>Legal compliance:</strong> Maintaining audit logs as required by Philippine
              law and responding to lawful requests from authorities
            </li>
          </ul>
        </Section>

        <Section title="5. Private-by-Default Policy">
          <p className="font-semibold">
            Your private content is never shared, published, or used for AI training without
            your explicit consent.
          </p>
          <ul>
            <li>
              Camera scans, document uploads, and notes are <strong>private by default</strong>,
              accessible only to you and your organization members (based on role permissions).
            </li>
            <li>
              Private content is <strong>never</strong> added to the public editorial corpus.
            </li>
            <li>
              Private content is <strong>never</strong> used to train or fine-tune our AI models.
            </li>
            <li>
              Content can only be promoted to editorial review status with your{' '}
              <strong>explicit permission</strong> and must pass an editorial rights review
              before any consideration for corpus inclusion.
            </li>
            <li>
              Copyrighted commercial book content detected by our classifier is blocked from
              editorial promotion.
            </li>
          </ul>
        </Section>

        <Section title="6. Data Storage and Security">
          <h4>6.1 Storage</h4>
          <ul>
            <li>
              Personal data is stored in PostgreSQL databases with encryption at rest
            </li>
            <li>
              Personally identifiable information (PII) fields — email, phone, full name — are
              encrypted at the application level using AES-256-GCM
            </li>
            <li>
              Uploaded files and camera scans are stored in encrypted object storage, isolated
              per organization and user
            </li>
            <li>
              Passwords are hashed using bcrypt with a minimum cost factor of 12
            </li>
            <li>
              Refresh tokens are hashed with SHA-256 before storage
            </li>
          </ul>

          <h4>6.2 Security Measures</h4>
          <ul>
            <li>TLS 1.3 encryption for all data in transit</li>
            <li>JWT access tokens with 15-minute expiry and RS256 signing</li>
            <li>Refresh token rotation with reuse detection</li>
            <li>Rate limiting on all endpoints</li>
            <li>Multi-factor authentication (TOTP) for administrative roles</li>
            <li>File upload validation including magic byte detection, antivirus scanning
              (ClamAV), and size limits</li>
            <li>Append-only audit logs for all data access and modifications</li>
            <li>Multi-tenant isolation with database-level organization scoping</li>
          </ul>

          <h4>6.3 Data Breach</h4>
          <p>
            In the event of a personal data breach, we will notify the National Privacy Commission
            and affected individuals within 72 hours, as required by NPC Circular No. 16-03,
            if the breach is likely to result in serious harm to data subjects.
          </p>
        </Section>

        <Section title="7. Data Sharing">
          <p>We share your personal information only in these circumstances:</p>
          <ul>
            <li>
              <strong>Service providers:</strong> Payment processors, cloud infrastructure
              providers, and email services that help us deliver the Service, under strict data
              processing agreements
            </li>
            <li>
              <strong>Within your organization:</strong> With other members of your organization
              based on their role permissions (e.g., team workspace collaboration)
            </li>
            <li>
              <strong>Legal requirements:</strong> When required by Philippine law, court order,
              or government authority, or to protect our legal rights
            </li>
            <li>
              <strong>Business transfers:</strong> In connection with a merger, acquisition, or
              sale of assets, with notice to affected users
            </li>
          </ul>
          <p>
            We do <strong>not</strong> sell your personal information to third parties.
          </p>
        </Section>

        <Section title="8. Data Retention">
          <ul>
            <li>
              <strong>Account data:</strong> Retained while your account is active, plus 30 days
              after deletion request for recovery
            </li>
            <li>
              <strong>Audit logs:</strong> Retained for a minimum of 2 years as required by
              Philippine law
            </li>
            <li>
              <strong>AI model run records:</strong> Retained for 1 year for quality assurance
              and audit purposes
            </li>
            <li>
              <strong>Billing records:</strong> Retained for 5 years as required by Philippine
              tax law
            </li>
            <li>
              <strong>Uploaded content:</strong> Deleted within 30 days of your deletion request
              or account closure
            </li>
            <li>
              <strong>Search query logs:</strong> Anonymized after 90 days (personal identifiers
              removed)
            </li>
          </ul>
        </Section>

        <Section title="9. Your Rights">
          <p>
            Under the Philippine Data Privacy Act, you have the following rights:
          </p>
          <ul>
            <li>
              <strong>Right to be informed:</strong> To know how your data is collected, used,
              and shared (this Privacy Policy)
            </li>
            <li>
              <strong>Right to access:</strong> To obtain a copy of your personal data we hold
            </li>
            <li>
              <strong>Right to rectification:</strong> To correct inaccurate or incomplete
              personal data
            </li>
            <li>
              <strong>Right to erasure:</strong> To request deletion of your personal data,
              subject to legal retention requirements
            </li>
            <li>
              <strong>Right to object:</strong> To object to the processing of your personal
              data for certain purposes
            </li>
            <li>
              <strong>Right to data portability:</strong> To receive your data in a structured,
              commonly used format
            </li>
            <li>
              <strong>Right to file a complaint:</strong> To lodge a complaint with the National
              Privacy Commission
            </li>
          </ul>
          <p>
            To exercise these rights, contact our Data Protection Officer at{' '}
            {businessInfo.dpo.email}.
            We will respond within 30 days.
          </p>
        </Section>

        <Section title="10. Cookies and Local Storage">
          <ul>
            <li>
              <strong>Essential cookies:</strong> Session management and authentication (required
              for the Service to function)
            </li>
            <li>
              <strong>Local storage:</strong> The mobile app uses MMKV and SQLite for offline
              access and cached content
            </li>
            <li>
              <strong>Analytics:</strong> We may use analytics tools to understand usage patterns,
              but only with anonymized or aggregated data
            </li>
          </ul>
          <p>
            We do not use third-party advertising cookies or tracking pixels.
          </p>
        </Section>

        <Section title="11. Children&apos;s Privacy">
          <p>
            The Service is not directed to individuals under 18 years of age. We do not knowingly
            collect personal information from minors. If you believe we have inadvertently
            collected data from a minor, please contact us immediately at{' '}
            {businessInfo.dpo.email}.
          </p>
        </Section>

        <Section title="12. International Data Transfers">
          <p>
            Your data is primarily processed and stored in the Philippines. If we need to transfer
            data internationally (e.g., to cloud service providers), we ensure adequate safeguards
            are in place, including contractual protections consistent with NPC requirements.
          </p>
        </Section>

        <Section title="13. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be
            communicated via email or in-app notification at least 30 days before taking effect.
            The &quot;Last updated&quot; date at the top indicates the most recent revision.
          </p>
        </Section>

        <Section title="14. Contact Us">
          <p>For privacy-related inquiries:</p>
          <p>
            <strong>{businessInfo.legalName}</strong>
            <br />
            {businessInfo.address.full}
            <br />
            Data Protection Officer: {businessInfo.dpo.name} — {businessInfo.dpo.email}
            <br />
            General inquiries: {businessInfo.email}
            <br />
            Phone: {businessInfo.phoneDisplay}
          </p>
          <p>
            You may also file a complaint with the{' '}
            <strong>National Privacy Commission</strong> of the Philippines:
            <br />
            Website: privacy.gov.ph
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
