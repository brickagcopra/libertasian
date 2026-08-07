import Link from 'next/link';

import { businessInfo } from '@/features/homepage/server/homepage-content';

export const metadata = {
  title: 'Terms',
  description: 'Terms of Service for LIBERTASIAN Philippine Legal AI Platform.',
};

export default function TermsPage() {
  return (
    <article className="prose prose-headings:font-serif prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: March 21, 2026</p>

      <div className="prose prose-gray mt-10 max-w-none text-sm leading-relaxed text-gray-700">
        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using the LIBERTASIAN platform (&quot;Service&quot;), including the
            website, mobile application, and API, you agree to be bound by these Terms of Service
            (&quot;Terms&quot;). If you do not agree to these Terms, you may not use the Service.
          </p>
          <p>
            LIBERTASIAN is operated by {businessInfo.legalName} (&quot;we,&quot; &quot;us,&quot; or
            &quot;our&quot;), a company organized under the laws of the Republic of the
            Philippines.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            LIBERTASIAN is an AI-powered Philippine legal research platform that provides:
          </p>
          <ul>
            <li>AI-assisted legal research with citation-grounded answers</li>
            <li>Case digest generation from Philippine legal documents</li>
            <li>Codal reader organized by bar subject area</li>
            <li>Mobile camera scanning with OCR and digest generation</li>
            <li>Practice workspace for matter management and team collaboration</li>
            <li>Study tools including flashcards, reviewer packs, and syllabus mode</li>
            <li>Editorial corpus sourced from official Philippine government legal repositories</li>
          </ul>
        </Section>

        <Section title="3. AI Output Disclaimer">
          <p className="font-semibold">
            LIBERTASIAN provides AI-powered legal research tools for informational purposes only.
            AI outputs are NOT legal advice.
          </p>
          <p>
            Under Philippine law, the practice of law is reserved exclusively for members of the
            Philippine Bar (Integrated Bar of the Philippines). LIBERTASIAN does not engage in the
            practice of law. Use of the Service does not create an attorney-client relationship
            between you and LIBERTASIAN.
          </p>
          <p>
            AI-generated content, including but not limited to answers, digests, summaries, memos,
            and analysis, may contain errors, omissions, or inaccuracies despite our best efforts
            to ensure accuracy. You should always:
          </p>
          <ul>
            <li>Verify all AI-generated information against primary legal sources</li>
            <li>Consult a qualified Philippine lawyer before relying on any legal information
              for decision-making</li>
            <li>Not rely solely on AI outputs for legal proceedings, filings, or advice to clients</li>
          </ul>
          <p>
            We clearly label all AI outputs with classification labels: Source Excerpt, Grounded
            Summary, Inferred Analysis, User-Private Digest, or Editorial Draft. Pay attention
            to these labels when evaluating the reliability of content.
          </p>
        </Section>

        <Section title="4. User Accounts and Registration">
          <p>
            To use certain features of the Service, you must create an account. You agree to:
          </p>
          <ul>
            <li>Provide accurate, current, and complete information during registration</li>
            <li>Maintain the security of your password and account credentials</li>
            <li>Accept responsibility for all activities under your account</li>
            <li>Notify us immediately of any unauthorized use of your account</li>
          </ul>
          <p>
            We reserve the right to suspend or terminate accounts that violate these Terms or
            that we reasonably believe are being used fraudulently.
          </p>
        </Section>

        <Section title="5. Subscription Plans and Payment">
          <p>
            The Service is offered under multiple subscription tiers: Free, Edu, Pro, Team, and
            Enterprise. Each tier provides different features, usage limits, and pricing as
            described on our Pricing page.
          </p>
          <ul>
            <li>
              <strong>Billing:</strong> Paid subscriptions are billed in advance on a monthly or
              annual basis. Prices are in Philippine Pesos (PHP).
            </li>
            <li>
              <strong>Cancellation:</strong> You may cancel your subscription at any time.
              Cancellation takes effect at the end of the current billing period, and you keep
              access until then.
            </li>
            <li>
              <strong>Refunds:</strong> Refund eligibility, how to request a refund, and
              processing times are set out in our{' '}
              <Link href="/refund-policy">Refund Policy</Link>, which forms part of these Terms.
              In summary: a full refund may be requested within 7 calendar days of your first
              paid billing period or of an unintended renewal; duplicate and erroneous charges
              are refunded in full at any time; and elapsed billing periods are not refundable.
            </li>
            <li>
              <strong>Usage limits:</strong> Free and Edu plans have usage quotas (AI credits,
              search queries, camera scan digests). Exceeding quotas may require upgrading your plan.
            </li>
            <li>
              <strong>Price changes:</strong> We may adjust pricing with 30 days&apos; notice.
              Existing subscribers will be notified via email before any price change takes effect.
            </li>
          </ul>
        </Section>

        <Section title="6. Service Delivery">
          <p>
            The Service is a digital subscription delivered online. There is no physical
            product, and nothing is shipped to you.
          </p>
          <ul>
            <li>
              <strong>What is delivered:</strong> access to the features included in your plan,
              through {businessInfo.fulfillment.channels.join(' and ')}, using the account you
              subscribed with.
            </li>
            <li>
              <strong>When it is delivered:</strong> your plan is activated{' '}
              {businessInfo.fulfillment.accessGrantedAt}. There is no waiting period, delivery
              window, or manual provisioning step.
            </li>
            <li>
              <strong>No shipment:</strong> we do not ship goods, we do not require a delivery
              address, and no courier or tracking is involved at any point.
            </li>
            <li>
              <strong>Duration:</strong> access continues for the billing period you paid for
              and renews with each subsequent period until you cancel, as set out in section 5.
            </li>
          </ul>
        </Section>

        <Section title="7. Acceptable Use">
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>Violate any applicable law, regulation, or court order</li>
            <li>Infringe the intellectual property or privacy rights of any third party</li>
            <li>Upload content that is defamatory, obscene, or harmful</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its systems</li>
            <li>Use automated tools (bots, scrapers) to access the Service without authorization</li>
            <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
            <li>Redistribute, sublicense, or resell the Service or its content without
              authorization</li>
            <li>Use the Service to provide legal advice to third parties without being a member
              of the Philippine Bar</li>
          </ul>
        </Section>

        <Section title="8. Intellectual Property">
          <h4>7.1 Official Legal Documents</h4>
          <p>
            Official government publications — including laws, court decisions, executive
            issuances, and administrative orders — are generally in the public domain under
            Philippine law. Our presentation, indexing, and AI-generated analysis of these
            documents are proprietary to LIBERTASIAN.
          </p>

          <h4>7.2 Platform Content</h4>
          <p>
            The Service, including its design, software, AI models, editorial digests, summaries,
            and analysis, is owned by LIBERTASIAN and protected by Philippine and international
            intellectual property laws. You may not copy, modify, or distribute platform content
            without authorization.
          </p>

          <h4>7.3 User Content</h4>
          <p>
            You retain ownership of content you upload, scan, or create on the platform (documents,
            notes, annotations). By uploading content, you grant us a limited license to process,
            store, and display your content solely for providing the Service to you.
          </p>
          <p>
            We do not use your private content (uploads, scans, notes) to train our AI models.
            Your content is private by default and is not shared with other users unless you
            explicitly share it.
          </p>

          <h4>7.4 Copyright Compliance</h4>
          <p>
            You must not upload copyrighted commercial legal publications (textbooks, commentaries,
            treatises) for editorial corpus promotion. User-scanned commercial book pages must
            remain in your private workspace.
          </p>
        </Section>

        <Section title="9. Privacy and Data">
          <p>
            Your use of the Service is subject to our{' '}
            <a href="/privacy" className="text-gray-900 underline">
              Privacy Policy
            </a>
            , which describes how we collect, use, and protect your personal data in compliance
            with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).
          </p>
        </Section>

        <Section title="10. Service Availability and Modifications">
          <p>
            We strive to maintain continuous availability of the Service but do not guarantee
            uninterrupted access. We may:
          </p>
          <ul>
            <li>Perform scheduled maintenance with advance notice</li>
            <li>Modify, update, or discontinue features of the Service</li>
            <li>Change usage limits or quotas with reasonable notice</li>
          </ul>
          <p>
            In the event of significant changes that materially affect your use, we will provide
            at least 30 days&apos; notice via email or in-app notification.
          </p>
        </Section>

        <Section title="11. Limitation of Liability">
          <p>
            To the maximum extent permitted by Philippine law:
          </p>
          <ul>
            <li>
              The Service is provided &quot;as is&quot; and &quot;as available&quot; without
              warranties of any kind, express or implied.
            </li>
            <li>
              We do not warrant the accuracy, completeness, or reliability of any AI-generated
              content, digest, or analysis.
            </li>
            <li>
              We are not liable for any damages arising from your reliance on AI outputs for
              legal decision-making.
            </li>
            <li>
              Our total liability for any claim arising from the Service shall not exceed the
              amount you paid us in the 12 months preceding the claim.
            </li>
          </ul>
        </Section>

        <Section title="12. Indemnification">
          <p>
            You agree to indemnify and hold harmless LIBERTASIAN, its officers, directors,
            employees, and agents from any claims, damages, or expenses arising from:
          </p>
          <ul>
            <li>Your use of the Service</li>
            <li>Your violation of these Terms</li>
            <li>Your violation of any third-party rights</li>
            <li>Content you upload, scan, or create on the platform</li>
          </ul>
        </Section>

        <Section title="13. Governing Law and Dispute Resolution">
          <p>
            These Terms are governed by and construed in accordance with the laws of the Republic
            of the Philippines. Any disputes arising from these Terms or the Service shall be
            resolved through:
          </p>
          <ol>
            <li>
              <strong>Good faith negotiation</strong> between the parties for 30 days
            </li>
            <li>
              <strong>Mediation</strong> before a mutually agreed mediator
            </li>
            <li>
              <strong>Arbitration</strong> under the rules of the Philippine Dispute Resolution
              Center, Inc. (PDRCI) in Metro Manila, if mediation fails
            </li>
          </ol>
        </Section>

        <Section title="14. Changes to Terms">
          <p>
            We may update these Terms from time to time. We will notify you of material changes
            via email or in-app notification at least 30 days before the changes take effect.
            Your continued use of the Service after changes take effect constitutes acceptance
            of the revised Terms.
          </p>
        </Section>

        <Section title="15. Contact">
          <p>
            For questions about these Terms, contact us at:
          </p>
          <p>
            <strong>{businessInfo.legalName}</strong>
            <br />
            {businessInfo.address.full}
            <br />
            Email: {businessInfo.email}
            <br />
            Phone: {businessInfo.phoneDisplay}
            <br />
            Website: libertasian.com
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
