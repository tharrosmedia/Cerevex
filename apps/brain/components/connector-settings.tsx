'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createMcpIdentityAction,
  grantMcpClientsAction,
  revokeMcpIdentityAction,
  setConnectorKillSwitchAction,
} from '@/lib/mcp-connector-actions';
import {
  MCP_SCOPE_LABELS,
  MCP_SCOPES,
  connectorSwitchView,
  type ConnectorClient,
  type McpIdentityView,
} from '@/lib/mcp-connector';

export function ConnectorSettings({
  killSwitch,
  envForcedOff = false,
  identities,
  clients,
  loadError,
}: {
  killSwitch: boolean | null;
  envForcedOff?: boolean;
  identities: McpIdentityView[];
  clients: ConnectorClient[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(loadError);
  const [token, setToken] = useState<string | null>(null);
  const connector = connectorSwitchView({ killSwitch, envForcedOff });

  function run(action: () => Promise<{ ok: boolean; message: string; token?: string }>) {
    start(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.token) setToken(result.token);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="cx-panel" id="connector-admin">
      <h2>Agent identities</h2>
      <p className="cx-help">
        Owner only. Each agent gets one token, shown once on this page. Paste it into the Grok Bot connector
        settings. Revoking it takes effect on the next call. This does not change the ads pause switch.
      </p>
      {message ? <p className="cx-help">{message}</p> : null}
      {token ? (
        <div className="cx-field">
          <label htmlFor="mcp-token">Token, shown once</label>
          <input id="mcp-token" readOnly value={token} />
        </div>
      ) : null}

      <form
        className="cx-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(() => setConnectorKillSwitchAction(data));
        }}
      >
        <p role="status" data-connector={connector.known ? (connector.off ? 'off' : 'on') : 'unknown'}>
          {connector.status}
        </p>
        <label className="cx-field cx-switch">
          <span>
            <input
              type="checkbox"
              role="switch"
              name="connectorOn"
              defaultChecked={connector.known && !connector.savedOff}
              disabled={!connector.canEdit}
            />{' '}
            Connector on
          </span>
          <p className="cx-help">
            Turn on to allow connector calls. Leave it off to refuse them. An environment override still forces the
            connector off.
          </p>
        </label>
        <button type="submit" className="btn-secondary" disabled={pending || !connector.canEdit}>
          Save connector switch
        </button>
      </form>

      <form
        className="cx-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          run(async () => {
            const result = await createMcpIdentityAction(data);
            if (result.ok) form.reset();
            return result;
          });
        }}
      >
        <div className="cx-field">
          <label htmlFor="mcp-name">Identity name</label>
          <input id="mcp-name" name="name" autoComplete="off" placeholder="example-seo-agent" />
        </div>
        <fieldset className="cx-field">
          <legend>Scopes</legend>
          {MCP_SCOPES.map((scope) => (
            <label key={scope}>
              <input type="checkbox" name="scopes" value={scope} /> {MCP_SCOPE_LABELS[scope]}
            </label>
          ))}
        </fieldset>
        <fieldset className="cx-field">
          <legend>Granted clients</legend>
          {clients.length === 0 ? <p className="cx-help">No clients loaded.</p> : null}
          {clients.map((client) => (
            <label key={client.id}>
              <input type="checkbox" name="clientIds" value={client.id} /> {client.name}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn-cta" disabled={pending}>
          Create identity
        </button>
      </form>

      {identities.length === 0 ? <p className="cx-help">No identities yet.</p> : null}
      {identities.map((identity) => (
        <form
          key={identity.id}
          className="cx-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() => grantMcpClientsAction(identity.id, data));
          }}
        >
          <h3>{identity.name}</h3>
          <p className="cx-help">
            {identity.scopes.join(', ')}
            {identity.revokedAt ? ' · revoked' : ''}
          </p>
          <fieldset className="cx-field">
            <legend>Clients for {identity.name}</legend>
            {clients.map((client) => (
              <label key={client.id}>
                <input
                  type="checkbox"
                  name="clientIds"
                  value={client.id}
                  defaultChecked={identity.clientIds.includes(client.id)}
                  disabled={identity.revokedAt !== null}
                />{' '}
                {client.name}
              </label>
            ))}
          </fieldset>
          <div className="cx-actions">
            <button type="submit" className="btn-secondary" disabled={pending || identity.revokedAt !== null}>
              Save clients
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || identity.revokedAt !== null}
              onClick={() => run(() => revokeMcpIdentityAction(identity.id))}
            >
              Revoke
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
