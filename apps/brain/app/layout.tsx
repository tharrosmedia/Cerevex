import type { Metadata } from 'next';
import './globals.css';
import { cookies } from 'next/headers';
import { listStores } from '@/src/lib/db/stores';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { redirect } from 'next/navigation';
import SeoNav from '@/components/seo-nav';

export const metadata: Metadata = {
  title: 'Shopify Brain',
  description: 'AI agent command center for Shopify stores',
};

async function setActiveStore(formData: FormData) {
  'use server';
  const storeId = formData.get('storeId') as string;
  const cookieStore = await cookies();
  cookieStore.set('activeStoreId', storeId, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  redirect('/');
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  let activeStoreId = cookieStore.get('activeStoreId')?.value;
  let stores: any[] = [];
  try {
    stores = await listStores();
  } catch {}
  if (!activeStoreId && stores.length > 0) {
    activeStoreId = stores[0].id;
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <header className="border-b p-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="font-bold text-xl">Shopify Brain</Link>
              <SeoNav />
            </div>
            {stores.length > 0 && (
              <form action={setActiveStore} className="flex items-center gap-2">
                <select name="storeId" defaultValue={activeStoreId} className="border p-1 text-sm">
                  {stores.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.shopify_domain})</option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">Switch</Button>
              </form>
            )}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
