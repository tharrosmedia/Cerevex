import type { Metadata } from 'next';
import './globals.css';
import { cookies, headers } from 'next/headers';
import { listStores } from '@/src/lib/db/stores';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { redirect } from 'next/navigation';
import SeoNav from '@/components/seo-nav';

export const metadata: Metadata = {
  title: 'Cerevex',
  description: 'Cerevex — ads and SEO for home-service businesses',
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
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') || '';
  const isLogin = pathname === '/login';

  const cookieStore = await cookies();
  let activeStoreId = cookieStore.get('activeStoreId')?.value;
  let stores: any[] = [];
  if (!isLogin) {
    try {
      stores = await listStores();
    } catch {}
    if (!activeStoreId && stores.length > 0) {
      activeStoreId = stores[0].id;
    }
  }

  return (
    <html lang="en">
      <body>
        {isLogin ? (
          children
        ) : (
          <>
            <header className="site-header">
              <div className="site-header-inner">
                <div className="site-header-brand">
                  <Link href="/" className="site-wordmark">Cerevex</Link>
                  <SeoNav />
                </div>
                {stores.length > 0 && (
                  <form action={setActiveStore} className="site-store-switch">
                    <select name="storeId" defaultValue={activeStoreId}>
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
          </>
        )}
      </body>
    </html>
  );
}
