/**
 * Grok image + video (or storyboard) generation for ad alternatives.
 * Uses XAI_API_KEY. Never writes live ads. Promote creates a proposed rec.
 */

import { eq } from "drizzle-orm";
import { parseRecommendationDraft } from "./audit-schemas";
import type { CreativeFields } from "./creative-analysis";
import { getDb } from "./db";
import { platformLabel } from "./creative-analysis";
import { brainstormIdeas, brainstormSessions, recommendations } from "./schema";
import type { Platform } from "./types";

const XAI_BASE = "https://api.x.ai/v1";

export type GrokAsset = {
  kind: "image" | "video" | "storyboard";
  url?: string | null;
  prompt: string;
  note?: string;
};

export type GrokAlternative = {
  headline: string;
  body: string;
  offer: string;
  videoScript: string;
  assets: GrokAsset[];
  targetPlatform: Platform;
  sourceAdExternalId?: string;
  writes: false;
};

function xaiKey(): string | null {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const key = runtime.process?.env?.XAI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

function xaiModel(): string {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.XAI_MODEL?.trim() || "grok-4.6";
}

async function xaiChat(system: string, user: string): Promise<string> {
  const key = xaiKey();
  if (!key) {
    throw new Error("XAI_API_KEY is not set. Add it to the ads API env — do not hardcode keys.");
  }
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: xaiModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.6,
    }),
  });
  if (!res.ok) {
    throw new Error(`Grok text failed (${res.status}).`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function xaiImage(prompt: string): Promise<string | null> {
  const key = xaiKey();
  if (!key) return null;
  const res = await fetch(`${XAI_BASE}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "grok-2-image",
      prompt,
      n: 1,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  return json.data?.[0]?.url ?? null;
}

async function xaiVideo(prompt: string): Promise<string | null> {
  const key = xaiKey();
  if (!key) return null;
  const res = await fetch(`${XAI_BASE}/videos/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "grok-imagine-video", prompt }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: Array<{ url?: string }> };
  return json.data?.[0]?.url ?? null;
}

function parseJsonBlock(text: string): Record<string, string> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function generateGrokAlternative(input: {
  source: CreativeFields & { name?: string };
  sourcePlatform: Platform;
  targetPlatform: Platform;
  clientName: string;
  sourceAdExternalId?: string;
}): Promise<GrokAlternative> {
  const system =
    "You write short home-service ads for HVAC operators. Plain language. No hype. Return JSON only with keys headline, body, offer, videoScript, imagePrompt.";
  const user = `Client: ${input.clientName}
Winning ${input.sourcePlatform} ad: ${input.source.name ?? "ad"}
Headline: ${input.source.headline ?? ""}
Body: ${input.source.body ?? ""}
Offer: ${input.source.offer ?? ""}
Adapt this for ${input.targetPlatform}. Keep the same service promise. Do not invent prices.`;

  const text = await xaiChat(system, user);
  const parsed = parseJsonBlock(text);
  const headline = parsed.headline || input.source.headline || `${input.clientName} — same-week visit`;
  const body = parsed.body || input.source.body || "Factory-trained techs. Book a home visit.";
  const offer = parsed.offer || input.source.offer || "";
  const videoScript =
    parsed.videoScript ||
    `Open on the home. Voice: ${headline}. Show the tech at the door. End with ${offer || "Book a visit."}`;
  const imagePrompt =
    parsed.imagePrompt ||
    `Photoreal home-service still, warm daylight, HVAC technician at a suburban door, no logos, no unreadable text. ${headline}`;

  const imageUrl = await xaiImage(imagePrompt);
  const videoUrl = await xaiVideo(`15-second home-service video. ${videoScript}`);
  const assets: GrokAsset[] = [
    {
      kind: "image",
      url: imageUrl,
      prompt: imagePrompt,
      note: imageUrl ? "Grok image" : "Grok image prompt saved. Image API did not return a URL.",
    },
    videoUrl
      ? { kind: "video", url: videoUrl, prompt: videoScript, note: "Grok video" }
      : {
          kind: "storyboard",
          url: imageUrl,
          prompt: videoScript,
          note: "Video API was not available. Storyboard + script are saved. Nothing was written to ads.",
        },
  ];

  return {
    headline,
    body,
    offer,
    videoScript,
    assets,
    targetPlatform: input.targetPlatform,
    sourceAdExternalId: input.sourceAdExternalId,
    writes: false,
  };
}

export async function saveGrokIdea(input: {
  workspaceId: string;
  clientId: string;
  title: string;
  alternative: GrokAlternative;
  sourceAdExternalId?: string;
}): Promise<{ sessionId: string; ideaId: string; alternative: GrokAlternative }> {
  const db = getDb();
  const [session] = await db
    .insert(brainstormSessions)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      title: input.title,
      status: "ready",
    })
    .returning();
  const [idea] = await db
    .insert(brainstormIdeas)
    .values({
      sessionId: session.id,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      title: input.title,
      bodyJson: {
        writes: false,
        promoted: false,
        sourceAdExternalId: input.sourceAdExternalId ?? null,
        alternative: input.alternative,
      },
    })
    .returning();
  return { sessionId: session.id, ideaId: idea.id, alternative: input.alternative };
}

export async function listGrokIdeas(workspaceId: string, clientId?: string | null) {
  const db = getDb();
  const rows = await db.select().from(brainstormIdeas).where(eq(brainstormIdeas.workspaceId, workspaceId));
  return rows
    .filter((row) => !clientId || row.clientId === clientId)
    .map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      clientId: row.clientId,
      title: row.title,
      body: (row.bodyJson as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
    }));
}

export async function promoteGrokIdea(input: {
  ideaId: string;
  workspaceId: string;
  clientId: string;
  adAccountId: string;
  campaign: { entityType: string; externalId: string; name: string };
  auditRunId?: string;
}) {
  const db = getDb();
  const idea = await db.query.brainstormIdeas.findFirst({ where: eq(brainstormIdeas.id, input.ideaId) });
  if (!idea || idea.workspaceId !== input.workspaceId) {
    throw new Error("Idea not found");
  }
  const body = (idea.bodyJson as Record<string, unknown>) ?? {};
  const alternative = (body.alternative ?? {}) as Partial<GrokAlternative>;
  const targetPlatform = alternative.targetPlatform === "google" ? "google" : "meta";
  const draft = parseRecommendationDraft({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    adAccountId: input.adAccountId,
    type: "create_alternative",
    title: `Create ${platformLabel(targetPlatform)} ad from Grok`,
    rationale: `Grok adapted “${alternative.headline ?? idea.title}” for ${platformLabel(targetPlatform)}. Approve creates the ad. Brainstorm and generate did not write live ads.`,
    estimatedImpactUsd: null,
    risk: "low",
    confidence: "0.6000",
    evidenceJson: {
      auditRunId: input.auditRunId ?? "00000000-0000-0000-0000-000000000000",
      ruleId: "grok_promote",
      writes: false,
      inbox: "create_alternative",
      platform: targetPlatform,
      ideaId: idea.id,
      alternative,
    },
    proposedMutationsJson: [
      {
        platform: targetPlatform,
        action: "create_ad",
        target: input.campaign,
        payload: {
          proposedName: alternative.headline ?? idea.title,
          headline: alternative.headline,
          body: alternative.body,
          offer: alternative.offer,
          imageUrl: alternative.assets?.find((asset) => asset.kind === "image")?.url,
          videoUrl: alternative.assets?.find((asset) => asset.kind === "video")?.url,
          ideaId: idea.id,
        },
        execute: false,
      },
    ],
    status: "proposed",
    schemaVersion: "1",
  });
  const [rec] = await db.insert(recommendations).values(draft).returning();
  await db
    .update(brainstormIdeas)
    .set({
      bodyJson: { ...body, promoted: true, recommendationId: rec.id, writes: false },
    })
    .where(eq(brainstormIdeas.id, idea.id));
  return rec;
}
