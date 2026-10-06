import { adsApi } from '@/lib/ads-bff';
import {
  boundWorkspaceId,
  decideAdsPause,
  pauseCaller,
} from '@/lib/ads-pause';
import { credentialsFrom } from '@/lib/sensitive-auth';

export const dynamic = 'force-dynamic';

export type PauseRead = (workspaceId: string) => Promise<
  | { ok: true; applyKillSwitch: boolean }
  | { ok: false; status: number; message: string }
>;

export type PauseWrite = (input: {
  workspaceId: string;
  applyKillSwitch: true;
}) => Promise<
  | { ok: true; applyKillSwitch: boolean }
  | { ok: false; status: number; message: string }
>;

type PauseDeps = {
  read?: PauseRead;
  write?: PauseWrite;
};

async function defaultRead(workspaceId: string): ReturnType<PauseRead> {
  const result = await adsApi<{ workspace: { id?: string; applyKillSwitch?: boolean } | null }>(
    `/workspace?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  if (!result.ok) return { ok: false, status: result.status, message: result.message };
  const workspace = result.data.workspace;
  if (!workspace || (workspace.id && workspace.id !== workspaceId)) {
    return { ok: false, status: 403, message: 'That workspace is not this site.' };
  }
  return { ok: true, applyKillSwitch: workspace.applyKillSwitch !== false };
}

async function defaultWrite(input: {
  workspaceId: string;
  applyKillSwitch: true;
}): ReturnType<PauseWrite> {
  const result = await adsApi<{ workspace: { applyKillSwitch?: boolean } | null }>('/workspace', {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId: input.workspaceId, applyKillSwitch: true }),
  });
  if (!result.ok) return { ok: false, status: result.status, message: result.message };
  const value = result.data.workspace?.applyKillSwitch;
  return { ok: true, applyKillSwitch: typeof value === 'boolean' ? value : input.applyKillSwitch };
}

function jsonError(error: string, status: number, code?: string) {
  return Response.json(code ? { error, code } : { error }, { status });
}

export async function postPause(request: Request, deps: PauseDeps = {}): Promise<Response> {
  const creds = credentialsFrom({ headers: request.headers, url: request.url });
  const caller = pauseCaller(creds);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const decision = decideAdsPause({
    caller,
    applyKillSwitch: record.applyKillSwitch,
    requestedWorkspaceId: record.workspaceId,
    boundWorkspaceId: boundWorkspaceId(),
  });
  if (!decision.ok) return jsonError(decision.error, decision.status, decision.code);

  const read = deps.read ?? defaultRead;
  const write = deps.write ?? defaultWrite;
  const current = await read(decision.workspaceId);
  if (!current.ok) return jsonError(current.message, current.status);
  if (current.applyKillSwitch === true) {
    return Response.json({
      applyKillSwitch: true,
      unchanged: true,
      workspaceId: decision.workspaceId,
    });
  }

  const written = await write({
    workspaceId: decision.workspaceId,
    applyKillSwitch: true,
  });
  if (!written.ok) return jsonError(written.message, written.status);
  return Response.json({
    applyKillSwitch: written.applyKillSwitch,
    unchanged: false,
    workspaceId: decision.workspaceId,
  });
}

export async function POST(request: Request) {
  return postPause(request);
}
