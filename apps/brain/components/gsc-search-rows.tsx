import {
  formatGscCtr,
  formatGscPosition,
  gscPagePath,
  gscQueryText,
  sortGscRowsByClicks,
  type GscDisplayRow,
} from '@/src/lib/gsc/display';

export function GscSearchRows({ rows }: { rows: GscDisplayRow[] }) {
  const sorted = sortGscRowsByClicks(rows);

  return (
    <div className="table-wrap gsc-rows">
      <div className="gsc-rows-head" aria-hidden="true">
        <span>Query</span>
        <span>Page</span>
        <span>Clicks</span>
        <span>Impr</span>
        <span>CTR</span>
        <span>Pos</span>
      </div>
      <ul className="gsc-row-list">
        {sorted.map((row, index) => {
          const page = (row.page || '').trim();
          const path = gscPagePath(row.page);
          return (
            <li key={`${row.query || ''}-${page}-${index}`} className="gsc-row">
              <div className="gsc-row-copy">
                <p className="gsc-row-query">{gscQueryText(row.query)}</p>
                <p className="gsc-row-page" title={page || undefined}>
                  {path}
                </p>
              </div>
              <dl className="gsc-row-metrics">
                <div>
                  <dt>Clicks</dt>
                  <dd>{row.clicks ?? 0}</dd>
                </div>
                <div>
                  <dt>Impr</dt>
                  <dd>{row.impressions ?? 0}</dd>
                </div>
                <div>
                  <dt>CTR</dt>
                  <dd>{formatGscCtr(row.ctr)}</dd>
                </div>
                <div>
                  <dt>Pos</dt>
                  <dd>{formatGscPosition(row.position)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
