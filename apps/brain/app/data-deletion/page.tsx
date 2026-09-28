import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument } from '@/components/legal-document';
import { LEGAL_CONTACT_EMAIL } from '@/lib/public-paths';

export const metadata: Metadata = {
  title: 'Data Deletion Instructions — Cerevex',
  description: 'How to ask Tharros Media to delete Cerevex data and disconnect Meta or Google.',
};

const deletionMailto = `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent('Cerevex data deletion request')}`;

export default function DataDeletionPage() {
  return (
    <LegalDocument title="Data Deletion Instructions">
      <p>
        These instructions explain how to ask Tharros Media to delete data Cerevex stores and how to stop
        Meta and Google from syncing. This is a draft for counsel review. There is no separate delete-everything
        wizard in the product.
      </p>

      <h2>1. Email a deletion request</h2>
      <p>
        Email <a href={deletionMailto}>{LEGAL_CONTACT_EMAIL}</a> with the Cerevex account email and a clear
        statement that you want your data deleted. Include the store or site name if you have more than one.
      </p>
      <p>
        <a className="btn-cta" href={deletionMailto}>
          Request deletion
        </a>
      </p>

      <h2>2. Disconnect Meta, Google, and other connections</h2>
      <p>Sign in to Cerevex, then stop the connections you no longer want synced.</p>
      <ol>
        <li>
          Open <Link href="/settings#connects">Settings → Connects</Link>.
        </li>
        <li>
          Where a connection shows a Disconnect button, use it. Search Console uses <strong>Disconnect</strong>.
          WordPress uses <strong>Disconnect</strong>. CallRail, Clarity, Housecall Pro, and bundled call
          tracking use the Disconnect button on that panel when the panel is shown.
        </li>
        <li>
          Meta and Google Ads are connected per store. In Connects, Ads accounts tells you to open{' '}
          <Link href="/ads">Ads</Link> with that store selected. Connected accounts are listed there as Meta
          or Google Ads. That screen offers <strong>Connect Meta</strong> and <strong>Connect Google Ads</strong>{' '}
          (or Add Meta accounts / Add Google Ads accounts when one is already connected). It does not include
          a Disconnect button for those ad accounts. In your deletion email, ask us to disconnect Meta and
          Google Ads. We remove the tokens Cerevex stores so those platforms stop syncing.
        </li>
      </ol>
      <p>
        You can also remove Cerevex in your Meta and Google account settings. That tells those companies to
        stop sharing new access with us. It does not delete data they already hold, and it does not by itself
        delete data already stored in Cerevex.
      </p>

      <h2>3. What we delete</h2>
      <p>
        On a valid request we delete or anonymize the account data Cerevex stores. That includes store
        connection details we hold and the OAuth tokens and ads data we stored after you connected Meta or
        Google.
      </p>
      <p>
        We do not erase copies Meta or Google keep under their own policies. Disconnecting Cerevex, and
        deleting data in Cerevex, does not erase those companies&apos; own copies.
      </p>

      <h2>4. Timing</h2>
      <p>
        We aim to acknowledge your request within 7 business days and to complete deletion of the data
        Cerevex holds within 30 days where feasible. This timing is a draft. Counsel may tighten it.
      </p>

      <h2>5. Contact</h2>
      <p>
        Deletion requests: <a href={deletionMailto}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
