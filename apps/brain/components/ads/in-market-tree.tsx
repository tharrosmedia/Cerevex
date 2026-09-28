import type { InMarketNode } from '@cerevex/contracts';
import { formatMoney } from '@/lib/ads-copy';

function resultCount(value: string | null): string | null {
  if (value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2).replace(/\.?0+$/, '');
}

function MetricCells({ node }: { node: InMarketNode }) {
  const metrics = node.metrics;
  const spend = metrics.hasMetrics ? formatMoney(metrics.spendUsd) ?? '—' : '—';
  const count = metrics.hasMetrics ? resultCount(metrics.resultCount) : null;
  const cost = metrics.hasMetrics ? formatMoney(metrics.costUsd) : null;
  return (
    <>
      <span className="cx-market-spend">{spend}</span>
      <span className="cx-market-result">
        {count == null ? '—' : `${count} ${metrics.resultLabel.toLowerCase()}`}
        {cost ? <span className="cx-market-cost"> · {cost} {metrics.costLabel.toLowerCase()}</span> : null}
      </span>
    </>
  );
}

function NodeRow({ node }: { node: InMarketNode }) {
  const rate = node.metrics.hasMetrics && node.metrics.clickRate != null
    ? `${(node.metrics.clickRate * 100).toFixed(2)}%`
    : null;
  return (
    <div className="cx-market-item">
      <details className="cx-market-details">
        <summary>
          <span className="cx-market-summary">
            <span className="cx-market-name">
              <span className="cx-market-level">{node.levelLabel}</span>
              {node.name}
            </span>
            <span className={`cx-market-chip cx-market-chip-${node.chip.toLowerCase()}`}>{node.chipLabel}</span>
            <MetricCells node={node} />
          </span>
        </summary>
        {node.metrics.hasMetrics ? (
          <p className="cx-market-details-metrics">
            {node.metrics.impressions ?? 0} impressions · {node.metrics.clicks ?? 0} clicks
            {rate ? ` · Click rate ${rate}` : ''}
          </p>
        ) : null}
        {node.children.length > 0 ? (
          <div className="cx-market-children">
            {node.children.map((child) => (
              <NodeRow key={child.id} node={child} />
            ))}
          </div>
        ) : null}
      </details>
      {node.deepLink && node.deepLinkLabel ? (
        <a className="cx-market-open" href={node.deepLink} target="_blank" rel="noopener noreferrer">
          {node.deepLinkLabel}
        </a>
      ) : null}
    </div>
  );
}

export function InMarketTree({ campaigns }: { campaigns: InMarketNode[] }) {
  return (
    <div className="cx-market-tree">
      {campaigns.map((campaign) => (
        <NodeRow key={campaign.id} node={campaign} />
      ))}
    </div>
  );
}
