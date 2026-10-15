import type { ReactNode } from 'react';
import { SubmitButton } from '@/components/submit-button';
import {
  addClientHref,
  profileFoundForName,
} from '@/lib/add-client-flow';
import {
  ADD_CLIENT,
  ADD_STORE_CONNECT_LATER,
  CLIENT_NAME_LABEL,
  CONTINUE_ADD,
  MAKE_NEW_CLIENT,
  PASTE_ADMIN_TOKEN,
  SKILLS_PROFILE_FOUND,
  THEIR_WEBSITE,
  WHAT_KIND_OF_BUSINESS,
  WHO_IS_THIS,
  alreadyClientUse,
  useExistingClient,
} from '@/lib/ui-copy';
import {
  CLIENT_BUSINESS_TYPES,
  CLIENT_BUSINESS_TYPE_LABELS,
  isClientBusinessType,
} from '@/src/lib/db/client-workspace';
import { SHOPIFY_REQUIRED_SCOPES } from '@/src/lib/shopify/verify';

export function AddClientButton({ href }: { href: string }) {
  return <a className="btn-cta" href={href}>{ADD_CLIENT}</a>;
}

export function AddClientFlow({
  step,
  name,
  businessType,
  suggestions,
  existingClientName,
  platform,
  message,
  identityAction,
  shopifyAction,
  wordpress,
}: {
  step: 'who' | 'site';
  name: string;
  businessType: string;
  suggestions: string[];
  existingClientName: string | null;
  platform: 'shopify' | 'wordpress' | null;
  message: string | null;
  identityAction: (formData: FormData) => void | Promise<void>;
  shopifyAction: (formData: FormData) => void | Promise<void>;
  wordpress: ReactNode;
}) {
  const business = isClientBusinessType(businessType) ? businessType : '';
  const profileFound = profileFoundForName(name, suggestions);
  const siteHref = (next: 'shopify' | 'wordpress') => addClientHref({
    step: 'site',
    name,
    business,
    platform: next,
  });

  return (
    <section className="cx-panel cx-add-client" id="add">
      <p><a className="cx-back" href="/stores">Back to stores</a></p>
      {message ? <p className="cx-banner cx-banner-warn" role="status">{message}</p> : null}

      {step === 'who' ? (
        <form action={identityAction} className="cx-form">
          <h2>Step 1. {WHO_IS_THIS}</h2>
          <div className="cx-field">
            <label htmlFor="client-name">{CLIENT_NAME_LABEL}</label>
            <input id="client-name" name="name" defaultValue={name} autoComplete="organization" required />
            {suggestions.length > 0 ? (
              <ul className="cx-choice-grid" aria-label="Name suggestions">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <a className="cx-choice" href={addClientHref({ step: 'who', name: suggestion, business })}>{suggestion}</a>
                  </li>
                ))}
              </ul>
            ) : null}
            {profileFound ? <p className="cx-help">{SKILLS_PROFILE_FOUND}</p> : null}
          </div>
          <fieldset className="cx-radios">
            <legend>{WHAT_KIND_OF_BUSINESS}</legend>
            {CLIENT_BUSINESS_TYPES.map((type) => (
              <label key={type}>
                <input type="radio" name="businessType" value={type} defaultChecked={business === type} required />
                <span>{CLIENT_BUSINESS_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </fieldset>
          {existingClientName ? (
            <div className="cx-actions">
              <p>{alreadyClientUse(existingClientName)}</p>
              <SubmitButton name="choice" value="use" className="btn-cta" pendingLabel="Continuing…">
                {useExistingClient(existingClientName)}
              </SubmitButton>
              <SubmitButton name="choice" value="new" className="btn-secondary" pendingLabel="Continuing…">
                {MAKE_NEW_CLIENT}
              </SubmitButton>
            </div>
          ) : (
            <SubmitButton name="choice" value="continue" className="btn-cta" pendingLabel="Continuing…">
              {CONTINUE_ADD}
            </SubmitButton>
          )}
        </form>
      ) : (
        <div className="cx-form">
          <h2>Step 2. {THEIR_WEBSITE}</h2>
          <p className="cx-help">{name}</p>
          <div className="cx-choice-grid" role="group" aria-label="Site type">
            <a
              href={siteHref('shopify')}
              className={`cx-choice${platform === 'shopify' ? ' cx-choice-current' : ''}`}
              aria-current={platform === 'shopify' ? 'true' : undefined}
            >
              <strong>Shopify store</strong>
              <span>Add the store now. Connect Shopify when you are ready.</span>
            </a>
            <a
              href={siteHref('wordpress')}
              className={`cx-choice${platform === 'wordpress' ? ' cx-choice-current' : ''}`}
              aria-current={platform === 'wordpress' ? 'true' : undefined}
            >
              <strong>WordPress site</strong>
              <span>Connect with the Cerevex plugin.</span>
            </a>
          </div>

          {platform === 'shopify' ? (
            <form action={shopifyAction} className="cx-form">
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="businessType" value={business} />
              <div className="cx-field">
                <label htmlFor="store-domain">Store address</label>
                <input id="store-domain" name="shopify_domain" placeholder="mystore.myshopify.com" autoComplete="off" required />
                <p className="cx-help">Your .myshopify.com address. You can paste the full URL.</p>
              </div>
              <SubmitButton name="connect" value="later" className="btn-cta" pendingLabel="Adding store…">
                {ADD_STORE_CONNECT_LATER}
              </SubmitButton>
              <details className="cx-details">
                <summary>{PASTE_ADMIN_TOKEN}</summary>
                <div className="cx-field">
                  <label htmlFor="store-token">Admin API access token</label>
                  <input id="store-token" name="shopify_access_token" placeholder="shpat_…" type="password" autoComplete="off" />
                  <ol className="cx-help cx-steps">
                    <li>In Shopify admin, open Settings → Apps and sales channels → Develop apps.</li>
                    <li>Create an app, then choose Configure Admin API scopes.</li>
                    <li>Turn on: {SHOPIFY_REQUIRED_SCOPES.join(', ')}.</li>
                    <li>Install the app and copy the Admin API access token.</li>
                  </ol>
                </div>
                <SubmitButton name="connect" value="paste" className="btn-secondary" pendingLabel="Checking connection…">
                  Connect store
                </SubmitButton>
              </details>
            </form>
          ) : null}

          {platform === 'wordpress' ? wordpress : null}
        </div>
      )}
    </section>
  );
}
