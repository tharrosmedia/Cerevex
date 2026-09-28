import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal-document';
import { LEGAL_CONTACT_EMAIL } from '@/lib/public-paths';

export const metadata: Metadata = {
  title: 'Terms of Service — Cerevex',
  description: 'Draft terms for Cerevex, operated by Tharros Media.',
};

export default function TermsOfServicePage() {
  return (
    <LegalDocument title="Terms of Service">
      <p>
        These terms are a draft outline for how Tharros Media provides Cerevex. Counsel has not signed off.
        When a counsel-cleared version replaces this page, that version controls.
      </p>

      <h2>Who provides Cerevex</h2>
      <p>
        Cerevex is operated by Tharros Media. Cerevex is the product name. It is software for home-service
        businesses: advertising (including Meta and Google ads), SEO, and site modules.
      </p>

      <h2>Accounts and acceptable use</h2>
      <p>
        Access to the Cerevex console is limited to people Tharros Media allows in. You are responsible for
        activity in your workspace, including who can sign in and which stores and ad accounts you connect.
      </p>
      <p>
        Use Cerevex for your own business operations. Do not misuse the service, attempt to break its security,
        or use it in a way that violates Meta, Google, or your store platform.
      </p>

      <h2>What you authorize</h2>
      <p>
        You stay responsible for your ad accounts and your store content. When you Approve or otherwise
        authorize an action in Cerevex, including Apply on ads, you are directing that action. Cerevex does
        not replace your judgment. Choosing not to approve is not a request to change the ad platform.
      </p>

      <h2>Other companies&apos; terms</h2>
      <p>
        Meta, Google, and the content systems you connect (such as Shopify or WordPress) have their own terms.
        Cerevex does not replace those terms. Connect an account only if you have the right to connect it.
      </p>

      <h2>Availability</h2>
      <p>
        Cerevex is provided as available. This draft does not promise uninterrupted service, a particular ad
        result, or a particular search ranking. A limitation of liability, warranty language, and governing law
        will be added when counsel clears this page. This draft does not invent those clauses.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
