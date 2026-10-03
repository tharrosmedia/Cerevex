import type { Metadata } from 'next';
import './globals.css';
import { cookies, headers } from 'next/headers';
import { listStores } from '@/src/lib/db/stores';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LegalLinks } from '@/components/legal-links';
import SiteNav from '@/components/site-nav';
import StoreSwitcher from '@/components/store-switcher';
import { adsModuleOrigin } from '@/lib/module-origins';
import { isProductionRuntime } from '@/lib/runtime-env';
import { isPublicLegalPath } from '@/lib/public-paths';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

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
    secure: isProductionRuntime(),
    sameSite: 'lax',
  });
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') || '/';
  redirect(pathname.startsWith('/') ? pathname : '/');
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') || '';
  const isLogin = pathname === '/login';
  const isLegal = isPublicLegalPath(pathname);
  const isBare = isLogin || isLegal;

  const cookieStore = await cookies();
  let activeStoreId = cookieStore.get('activeStoreId')?.value;
  let stores: any[] = [];
  let modules = null;
  let capabilities = null;
  if (!isBare) {
    try {
      stores = await listStores();
    } catch {}
    if (!activeStoreId && stores.length > 0) {
      activeStoreId = stores[0].id;
    }
    try {
      const settings = await getWorkspaceProductSettings();
      modules = settings.modules;
      capabilities = settings.capabilities;
    } catch {}
  }

  return (
    <html lang="en">
      <body>
        {isBare ? (
          children
        ) : (
          <>
            <header className="site-header">
              <div className="site-header-inner">
                <Link href="/" className="site-wordmark" aria-label="Cerevex home">
                  Cerevex
                </Link>
                <SiteNav
                  adsOrigin={adsModuleOrigin(capabilities)}
                  modules={modules}
                  capabilities={capabilities}
                  railExtra={
                    stores.length > 0 ? (
                      <StoreSwitcher
                        stores={stores.map((store: { id: string; name: string; shopify_domain?: string }) => ({
                          id: store.id,
                          name: store.name,
                          shopify_domain: store.shopify_domain,
                        }))}
                        activeStoreId={activeStoreId}
                        action={setActiveStore}
                      />
                    ) : null
                  }
                />
              </div>
            </header>
            <main>{children}</main>
            <footer className="site-footer">
              <LegalLinks className="site-footer-links" />
            </footer>
          </>
        )}
      </body>
    </html>
  );
}
