import { StatusBadge } from '@/components/status-badge';
import type { ChecklistModel, SetupAction, SetupRowModel } from '@/lib/client-setup-checklist';
import { SKILL_PROFILE_ALIASES } from '@/lib/ui-copy';

function actionClass(row: SetupRowModel, primaryRowId: string | null): string {
  return row.id === primaryRowId ? 'btn-cta' : 'btn-secondary';
}

function ContinueForm({
  action,
  storeId,
  className,
  continueAction,
}: {
  action: Extract<SetupAction, { kind: 'continue' }>;
  storeId: string;
  className: string;
  continueAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={continueAction} className="cx-actions">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="next" value={action.next} />
      <button type="submit" className={className}>{action.label}</button>
    </form>
  );
}

function SkillsForm({
  action,
  model,
  className,
  skillsAction,
}: {
  action: Extract<SetupAction, { kind: 'skills' }>;
  model: ChecklistModel;
  className: string;
  skillsAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={skillsAction} className="cx-actions">
      <input type="hidden" name="storeId" value={model.storeId} />
      {model.returnTo ? <input type="hidden" name="returnTo" value={model.returnTo} /> : null}
      {action.slug ? (
        <input type="hidden" name="slug" value={action.slug} />
      ) : (
        <select name="slug" aria-label="Skills profile" defaultValue="hvac-usa">
          {Object.entries(SKILL_PROFILE_ALIASES).map(([slug, names]) => (
            <option key={slug} value={slug}>{names[0]}</option>
          ))}
        </select>
      )}
      <button type="submit" className={className}>{action.label}</button>
    </form>
  );
}

export function ClientSetupChecklist({
  model,
  continueAction,
  skillsAction,
}: {
  model: ChecklistModel;
  continueAction: (formData: FormData) => void | Promise<void>;
  skillsAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="cx-setup">
      {model.reconnectHint ? (
        <p className="cx-banner cx-banner-warn" role="status" data-setup-reconnect>{model.reconnectHint}</p>
      ) : null}
      {model.adsNotice ? <p className="cx-banner cx-banner-warn" role="status">{model.adsNotice}</p> : null}
      {model.requiredComplete ? (
        <p className="cx-help">The required steps are done. The rest can wait.</p>
      ) : null}
      <ul className="cx-setup-list">
        {model.rows.map((row) => (
          <li key={row.id} className="cx-setup-row" data-setup-row={row.id}>
            <div className="cx-setup-head">
              <h3>{row.title}</h3>
              <StatusBadge
                label={row.done ? 'Done' : row.required ? 'To do' : 'Optional'}
                tone={row.done ? 'trust' : row.required ? 'warn' : 'info'}
              />
            </div>
            <p>{row.sentence}</p>
            {row.action?.kind === 'continue' ? (
              <ContinueForm
                action={row.action}
                storeId={model.storeId}
                className={actionClass(row, model.primaryRowId)}
                continueAction={continueAction}
              />
            ) : null}
            {row.action?.kind === 'skills' ? (
              <SkillsForm
                action={row.action}
                model={model}
                className={actionClass(row, model.primaryRowId)}
                skillsAction={skillsAction}
              />
            ) : null}
            {row.details.length > 0 ? (
              <details className="cx-details">
                <summary>Details</summary>
                <ul>
                  {row.details.map((detail, index) => (
                    <li key={`${detail.label}-${index}`}>
                      <span>{detail.label}: </span>
                      {detail.value}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <section className="cx-setup-flags" data-setup-flags>
        <p>{model.sharedFlags.summary}</p>
        {model.sharedFlags.labels.length > 0 ? (
          <details className="cx-details">
            <summary>Details</summary>
            <ul>
              {model.sharedFlags.labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}
