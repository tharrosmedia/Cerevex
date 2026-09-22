'use client';

type StoreOption = {
  id: string;
  name: string;
  shopify_domain?: string;
};

export default function StoreSwitcher({
  stores,
  activeStoreId,
  action,
}: {
  stores: StoreOption[];
  activeStoreId?: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="site-store-switch">
      <label htmlFor="active-store" className="visually-hidden">Store</label>
      <select
        id="active-store"
        name="storeId"
        defaultValue={activeStoreId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {stores.map((store) => (
          <option
            key={store.id}
            value={store.id}
            title={store.shopify_domain ? `${store.name} (${store.shopify_domain})` : store.name}
          >
            {store.name}
          </option>
        ))}
      </select>
    </form>
  );
}
