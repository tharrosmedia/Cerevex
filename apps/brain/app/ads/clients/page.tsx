import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Each store or site is its own ads client; they're managed on the Stores page. */
export default function AdsClientsPage() {
  redirect('/stores');
}
