import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument } from '@/components/legal-document';
import { LEGAL_CONTACT_EMAIL } from '@/lib/public-paths';

export const metadata: Metadata = {
  title: 'Privacy Policy — Cerevex',
  description: 'Draft privacy policy for Cerevex, including Meta and Google ads connections.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      <p>
        This policy is a draft outline of how Tharros Media handles information in Cerevex. Counsel has not
        signed off. It describes the product as it runs today.
      </p>

      <h2>What we collect</h2>
      <p>To run Cerevex we collect and store:</p>
      <ul>
        <li>Account and workspace identity used to sign in, and the stores or sites you add.</li>
        <li>Store and site content you sync, such as catalog, pages, and posts, so SEO and site modules can work.</li>
        <li>
          OAuth and ads data from Meta and from Google when you connect those platforms. That includes access
          tokens, ad account identifiers, and the campaign and performance data we need to show checks and
          suggestions.
        </li>
        <li>
          Google Search Console data when you connect Search Console, including the property you choose and
          the search performance we sync.
        </li>
        <li>
          Other connections you turn on (such as WordPress, CallRail, Clarity, or a CRM) and the credentials
          and records those connections need.
        </li>
        <li>Usage and logs needed to operate, secure, and support the product, such as errors and job status.</li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        We use this information to provide Cerevex, sync the accounts you connect, prepare recommendations
        and analysis, support you, and protect the service.
      </p>

      <h2>Sharing</h2>
      <p>
        We share information with hosting and operations providers only as needed to run Cerevex. We do not
        sell personal data.
      </p>
      <p>
        Meta, Google, and other platforms you connect already hold their own copies under their policies.
        Connecting an account sends data between Cerevex and that platform so the product can work.
      </p>

      <h2>Retention</h2>
      <p>
        We keep information while your workspace is in use and as needed to operate, secure, and support
        Cerevex. This retention note is a draft. Counsel may set a stricter schedule.
      </p>

      <h2>How to request deletion</h2>
      <p>
        You can ask us to delete data Cerevex stores. The steps are on{' '}
        <Link href="/data-deletion">data deletion instructions</Link>. Email{' '}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
