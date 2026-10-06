import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { factFromDecomposed, makeFact, resolveApprovalOwner } from "./fact";
import { isInScopeClient, marketingGateFromStatus } from "./gates";
import { clientPromptLayerPath, storePromptLayerPath } from "./prompt-layer";
import type {
  ChannelFact,
  ClientSkillConfig,
  Fact,
  FactsRegisterRow,
  IndexedFact,
  InScopeClientSlug,
  MeasurementConfig,
  PackId,
  PackRef,
  StoreRole,
  StoreSkillConfig,
} from "./types";

const PACK_IDS: PackId[] = ["ecommerce-dtc", "home-service", "saas-b2b", "local-other"];

export interface ProfileFiles {
  slug: string;
  profileMarkdown: string;
  voiceMarkdown: string | null;
  copyRulesMarkdown: string | null;
  profileHash: string;
}

export function hashProfileFiles(files: {
  profileMarkdown: string;
  voiceMarkdown: string | null;
  copyRulesMarkdown: string | null;
}): string {
  const hash = createHash("sha256");
  hash.update("profile.md\0");
  hash.update(files.profileMarkdown);
  hash.update("\0");
  if (files.voiceMarkdown != null) {
    hash.update("voice.md\0");
    hash.update(files.voiceMarkdown);
    hash.update("\0");
  }
  if (files.copyRulesMarkdown != null) {
    hash.update("copy-rules.md\0");
    hash.update(files.copyRulesMarkdown);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readProfileDir(dir: string): ProfileFiles {
  const slug = path.basename(dir);
  const profileMarkdown = readFileSync(path.join(dir, "profile.md"), "utf8");
  const voicePath = path.join(dir, "voice.md");
  const copyPath = path.join(dir, "copy-rules.md");
  const voiceMarkdown = statExists(voicePath) ? readFileSync(voicePath, "utf8") : null;
  const copyRulesMarkdown = statExists(copyPath) ? readFileSync(copyPath, "utf8") : null;
  return {
    slug,
    profileMarkdown,
    voiceMarkdown,
    copyRulesMarkdown,
    profileHash: hashProfileFiles({ profileMarkdown, voiceMarkdown, copyRulesMarkdown }),
  };
}

function statExists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function listProfileDirs(clientsDir: string): string[] {
  return readdirSync(clientsDir)
    .map((name) => path.join(clientsDir, name))
    .filter((dir) => statSync(dir).isDirectory() && statExists(path.join(dir, "profile.md")))
    .sort((a, b) => a.localeCompare(b));
}

interface Bullet {
  key: string;
  raw: string;
}

interface ParsedHeader {
  displayName: string;
  status: string;
  updatedAt: string;
  source: string;
  sections: Map<string, string>;
}

function parseHeader(markdown: string): ParsedHeader {
  const title = markdown.match(/^#\s+(.+?):\s+client profile/m);
  const statusLine = markdown.match(
    /status:\s*(.+?)\s*·\s*last_updated:\s*(\d{4}-\d{2}-\d{2})\s*·\s*source:\s*(.+)/,
  );
  if (!title || !statusLine) {
    throw new Error("Profile is missing a title or status line");
  }
  const sections = new Map<string, string>();
  for (const chunk of markdown.split(/^## /m).slice(1)) {
    const nl = chunk.indexOf("\n");
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim().toLowerCase();
    const body = nl === -1 ? "" : chunk.slice(nl + 1);
    sections.set(heading, body);
  }
  return {
    displayName: title[1].replace(/\*\*/g, "").trim(),
    status: statusLine[1].replace(/\*\*/g, "").trim(),
    updatedAt: statusLine[2],
    source: statusLine[3].trim(),
    sections,
  };
}

function section(parsed: ParsedHeader, title: string): string {
  return parsed.sections.get(title) ?? "";
}

function bullets(body: string): Bullet[] {
  const items: Bullet[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^- (.+)$/);
    if (!match) continue;
    const text = match[1].trim();
    const colon = text.indexOf(":");
    if (colon === -1) items.push({ key: "", raw: text });
    else items.push({ key: text.slice(0, colon).trim(), raw: text.slice(colon + 1).trim() });
  }
  return items;
}

function bullet(items: Bullet[], ...needles: string[]): Bullet | undefined {
  return items.find((item) => needles.some((needle) => item.key.toLowerCase().includes(needle.toLowerCase())));
}

function parseTable(body: string): string[][] {
  return body
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^[-:\s]+$/.test(cell)));
}

function sourced<T extends string>(raw: string, source: string, asOf: string, key?: string): Fact<T> {
  return makeFact<T>(raw, source, asOf, key);
}

function packsFrom(raw: string, libraryVersion: string): { packs: PackRef[]; dormantPackId: PackId | null } {
  if (/none active/i.test(raw)) {
    const dormant = PACK_IDS.find((id) => raw.includes(id)) ?? null;
    return { packs: [], dormantPackId: dormant };
  }
  const found = PACK_IDS.filter((id) => raw.includes(id));
  const packs = found.map((id, index): PackRef => {
    let role: PackRef["role"] = index === 0 ? "primary" : "rule-set";
    if (id === "local-other" && /fallback/i.test(raw)) role = "fallback";
    const sections = id === "home-service" && /equipment/.test(raw) ? ["equipment"] : [];
    return { id, version: libraryVersion, role, sections };
  });
  return { packs, dormantPackId: null };
}

function parseChannels(body: string, source: string, asOf: string): { channels: ChannelFact[]; declaredNone: boolean } {
  const table = parseTable(body);
  if (table.length <= 1 && /^(none\b|none yet\b)/i.test(body.trim())) {
    return { channels: [], declaredNone: true };
  }
  const rows = table.slice(1);
  const channels = rows.map((row): ChannelFact => {
    const channel = row[0] ?? "";
    const status = row[1] ?? "";
    const access = row[2] ?? "";
    const notes = row[3] ?? "";
    return {
      channel,
      status: sourced(status, source, asOf, "channel status"),
      access: sourced(access, source, asOf, "channel access"),
      notes: notes
        ? sourced(notes, source, asOf, "channel notes")
        : { state: "known", value: "", source, asOf, raw: "" },
    };
  });
  return { channels, declaredNone: false };
}

function mentioned(body: string, pattern: RegExp): string | null {
  const match = body.match(pattern);
  return match ? match[1].trim() : null;
}

function parseMeasurement(body: string, source: string, asOf: string): MeasurementConfig {
  const flat = body.replace(/\s+/g, " ").trim();
  const na = /^(none yet\b|n\/a\b)/i.test(flat);
  const auditRaw = mentioned(flat, /conversion-tracking-audit:\s*([^·]+)/i);
  let auditValue = "not_run";
  if (auditRaw && /not applicable/i.test(auditRaw)) auditValue = "not_applicable";
  else if (auditRaw && /\bpass\b/i.test(auditRaw)) auditValue = "pass";
  else if (auditRaw && /\bfail\b/i.test(auditRaw)) auditValue = "fail";
  else if (auditRaw && /not run/i.test(auditRaw)) auditValue = "not_run";

  const factOrNull = (raw: string | null, key: string): Fact<string> | null => {
    if (raw == null) {
      if (!na) return null;
      return { state: "known", value: "n/a", source, asOf, raw: "n/a" };
    }
    return sourced(raw, source, asOf, key);
  };

  return {
    summary: na
      ? { state: "known", value: flat, source, asOf, raw: flat }
      : sourced(flat, source, asOf, "measurement"),
    conversionTrackingAudit: {
      state: "known",
      value: auditValue,
      source,
      asOf,
      raw: auditRaw ?? auditValue,
    },
    callTracking: factOrNull(mentioned(flat, /call tracking:?\s*([^·]+)/i), "call tracking"),
    crm: factOrNull(mentioned(body, /CRM:\s*([^\n]+)/i), "crm"),
    clickIdCapture: factOrNull(mentioned(body, /click-id capture[^:\n]*:\s*([^\n]+)/i), "click-id capture"),
    pixels: factOrNull(
      mentioned(flat, /pixels?\s*:?\s*(TBD)/i) ?? mentioned(flat, /pixel\/CAPI status\s*(TBD|[^·]+)/i),
      "pixels",
    ),
    ecommercePlatform: factOrNull(mentioned(flat, /e-?com platform\s*:?\s*(TBD|[^·]+)/i), "ecommerce platform"),
  };
}

function parseFactsRegister(body: string): FactsRegisterRow[] {
  const table = parseTable(body);
  return table.slice(1).map((row) => {
    const fact = row[0] ?? "";
    const source = row[1] ?? "";
    const date = row[2] ?? "";
    const blob = `${fact} ${source} ${date}`;
    let state: FactsRegisterRow["state"] = "known";
    if (/\binference\b/i.test(blob)) state = "inference";
    else if (/\bunconfirmed\b|\bCONFIRM\b/i.test(blob)) state = "assumption";
    else if (/\bTBD\b/.test(fact)) state = "tbd";
    return { fact, source, date, state };
  });
}

function parseVoice(body: string, source: string, asOf: string): {
  voice: Fact<string>;
  protectedLines: Fact<string> | null;
  neverSay: Fact<string> | null;
} {
  const protectedMatch = body.match(/protected lines?:\s*([^\n]+)/i);
  const neverMatch = body.match(/never say:\s*([^\n]+)/i);
  const phoneTbd = /phone:?\s*TBD/i.test(body);
  let voiceRaw = body.trim();
  if (/^TBD\b/i.test(body.trim())) {
    const first = body.trim().split(/(?<=\.)\s+/)[0] ?? body.trim();
    voiceRaw = first;
  }
  return {
    voice: sourced(voiceRaw, source, asOf, "voice"),
    protectedLines: protectedMatch ? sourced(protectedMatch[1], source, asOf, "protected lines") : null,
    neverSay: neverMatch
      ? sourced(neverMatch[1], source, asOf, "never say")
      : phoneTbd
        ? null
        : null,
  };
}

function emptyLayer(layerPath: string): { seeded: false; version: null; path: string } {
  return { seeded: false, version: null, path: layerPath };
}

/** Slice 1 seeds the HVAC USA client layer from the profile. Store layers stay empty. */
function clientLayer(slug: InScopeClientSlug): { seeded: boolean; version: string | null; path: string } {
  const path = clientPromptLayerPath(slug);
  if (slug === "hvac-usa") return { seeded: true, version: "hvac-usa@v1", path };
  return { seeded: false, version: null, path };
}

function makeStore(input: {
  storeKey: string;
  role: StoreRole;
  site: Fact<string> | null;
  geo: Fact<string> | null;
  channels: ChannelFact[];
  channelsDeclaredNone: boolean;
  measurement: MeasurementConfig;
  capacity: Fact<string> | null;
  lag: Fact<string> | null;
  notes?: Fact<string>[];
}): StoreSkillConfig {
  return {
    storeKey: input.storeKey,
    role: input.role,
    brainStoreId: null,
    site: input.site,
    cms: null,
    geo: input.geo,
    channels: input.channels,
    channelsDeclaredNone: input.channelsDeclaredNone,
    measurement: input.measurement,
    capacity: input.capacity,
    lag: input.lag,
    valueModelOverride: null,
    segmentsOverride: null,
    notes: input.notes ?? [],
    promptLayer: emptyLayer(storePromptLayerPath(input.storeKey.slice(0, input.storeKey.indexOf("/")), input.storeKey)),
  };
}

function gapExtras(
  field: string,
  raw: string,
  source: string,
  asOf: string,
  layer: "client" | "store",
  storeKey: string | null,
): { fact: Fact<string>; extras: IndexedFact[] } {
  const decomposed = factFromDecomposed(raw, source, asOf, field);
  const extras = decomposed.gaps
    .filter((gap) => gap.fact.state === "tbd")
    .map((gap) => ({
      field: `${field}.${gap.label.replace(/\s+/g, "_").toLowerCase()}`,
      layer,
      storeKey,
      fact: gap.fact,
    }));
  return { fact: decomposed.fact, extras };
}

export function parseProfile(input: {
  files: ProfileFiles;
  libraryVersion: string;
  snapshotId: string;
}): ClientSkillConfig {
  if (!isInScopeClient(input.files.slug)) {
    throw new Error(`Refusing to import ${input.files.slug}: not an in-scope client`);
  }
  const slug = input.files.slug;
  const parsed = parseHeader(input.files.profileMarkdown);
  const source = parsed.source;
  const asOf = parsed.updatedAt;
  const identity = bullets(section(parsed, "identity"));
  const business = bullets(section(parsed, "business"));
  const conversion = bullets(section(parsed, "conversion and value model"));
  const voiceBody = section(parsed, "voice");
  const complianceBody = section(parsed, "compliance");
  const channelBody = section(parsed, "channels");
  const measurementBody = section(parsed, "measurement stack");
  const legacyBody = section(parsed, "from legacy copy rules: confirm with adam");

  const engagement = bullet(identity, "engagement");
  const approval = bullet(identity, "approval_owner");
  const siteBullet = bullet(identity, "site");
  const vertical = bullet(business, "vertical pack");
  const model = bullet(business, "business_model");
  const offer = bullet(business, "what they sell") ?? bullet(business, "what it is");
  const geoBullet = bullet(business, "geo");
  const brands = bullet(business, "brands");
  const dealer = bullet(business, "dealer authorization");
  const licenses = bullet(business, "licenses");
  const installs = bullet(business, "installs");
  const planning = bullet(business, "internal context");
  const storeBullet = bullet(business, "store");
  const qualified = bullet(conversion, "qualified_outcome");
  const secondary = bullet(conversion, "secondary");
  const valueModelBullet = bullet(conversion, "value model");
  const segmentsBullet = bullet(conversion, "segments");
  const qualifying = bullet(conversion, "qualifying");
  const capacityBullet = bullet(conversion, "capacity");
  const lagBullet = bullet(conversion, "lag");
  const combinedValue = conversion.find((item) => /value model/i.test(item.key) && /capacity/i.test(item.key));

  const extras: IndexedFact[] = [];
  const take = (field: string, item: Bullet | undefined, fallbackRaw?: string): Fact<string> => {
    const raw = item?.raw ?? fallbackRaw ?? "";
    const split = gapExtras(field, raw, source, asOf, "client", null);
    extras.push(...split.extras);
    return split.fact;
  };

  const voice = parseVoice(voiceBody, source, asOf);
  const channels = parseChannels(channelBody, source, asOf);
  const measurement = parseMeasurement(measurementBody, source, asOf);
  const packInfo = packsFrom(vertical?.raw ?? "", input.libraryVersion);
  const approvalFact = sourced(approval?.raw ?? "", source, asOf, "approval_owner");
  const marketingGate = marketingGateFromStatus(parsed.status);

  const siteFact = siteBullet ? sourced(siteBullet.raw, source, asOf, "site") : null;
  const geoSplit = geoBullet ? gapExtras("geo", geoBullet.raw, source, asOf, "store", null) : null;
  const capacitySplit = capacityBullet
    ? gapExtras("capacity", capacityBullet.raw, source, asOf, "store", null)
    : null;
  const lagFact = lagBullet ? sourced(lagBullet.raw, source, asOf, "lag") : null;

  const naCombined = combinedValue ? sourced(combinedValue.raw, source, asOf, "value model") : null;

  const clientRules = bullets(complianceBody).find((item) => /client rule/i.test(item.key));
  const complianceFact = clientRules
    ? sourced(clientRules.raw, source, asOf, "client rules")
    : sourced(complianceBody.trim(), source, asOf, "compliance");

  const openQuestions = bullets(section(parsed, "open questions"))
    .map((item) => (item.key && item.raw ? `${item.key}: ${item.raw}` : item.raw || item.key))
    .filter(Boolean);

  const factsRegister = parseFactsRegister(section(parsed, "facts register"));
  const localPage = factsRegister.find((row) => row.fact.includes("/pages/local-ductless-stores"));
  const noCage = factsRegister.find((row) => /no cage number/i.test(row.fact));

  const stores = buildStores({
    slug,
    source,
    asOf,
    siteFact,
    geo: geoSplit?.fact ?? null,
    geoExtras: geoSplit?.extras ?? [],
    channels,
    measurement,
    capacity: naCombined ?? capacitySplit?.fact ?? null,
    lag: naCombined ?? lagFact,
    legacyBody,
    storeBullet,
    localPage: localPage?.fact ?? null,
    noCage: noCage?.fact ?? null,
  });
  for (const extra of geoSplit?.extras ?? []) {
    for (const store of stores) {
      extras.push({ ...extra, layer: "store", storeKey: store.storeKey });
    }
  }

  const copyRules = input.files.copyRulesMarkdown
    ? {
        state: "known" as const,
        value: input.files.copyRulesMarkdown.trim(),
        source,
        asOf,
        raw: "copy-rules.md",
      }
    : null;
  const voiceDetail = input.files.voiceMarkdown
    ? {
        state: "known" as const,
        value: input.files.voiceMarkdown.trim(),
        source,
        asOf,
        raw: "voice.md",
      }
    : null;

  return {
    slug,
    displayName: parsed.displayName,
    snapshotId: input.snapshotId,
    profileHash: input.files.profileHash,
    profileUpdatedAt: asOf,
    pilot: slug === "hvac-usa",
    marketingGate,
    scopeAllowed: true,
    forbidClientNamesAndResults: slug === "tharros-media" || slug === "cerevex",
    engagement: sourced(engagement?.raw ?? "", source, asOf, "engagement"),
    profileStatus: { state: "known", value: parsed.status, source, asOf, raw: parsed.status },
    approvalOwner: approvalFact,
    approvalOwnerResolved: resolveApprovalOwner(approvalFact),
    packs: packInfo.packs,
    dormantPackId: packInfo.dormantPackId,
    businessModel: take("businessModel", model),
    offer: take("offer", offer),
    qualifiedOutcome: take("qualifiedOutcome", qualified),
    secondaryOutcome: secondary ? take("secondaryOutcome", secondary) : null,
    valueModel: naCombined ?? take("valueModel", valueModelBullet),
    segments: naCombined ?? take("segments", segmentsBullet),
    qualifyingRules: qualifying ? take("qualifyingRules", qualifying) : null,
    voice: voice.voice,
    protectedLines: voice.protectedLines,
    neverSay: voice.neverSay,
    complianceRules: complianceFact,
    copyRules,
    voiceDetail,
    installs: installs ? take("installs", installs) : null,
    brands: brands ? take("brands", brands) : null,
    licenses: licenses ? take("licenses", licenses) : null,
    dealerAuthorization: dealer ? take("dealerAuthorization", dealer) : null,
    planningNote: planning ? sourced(planning.raw, source, asOf, planning.key) : null,
    factsRegister,
    openQuestions,
    stores,
    extras,
    promptLayer: clientLayer(slug),
  };
}

function buildStores(input: {
  slug: InScopeClientSlug;
  source: string;
  asOf: string;
  siteFact: Fact<string> | null;
  geo: Fact<string> | null;
  geoExtras: IndexedFact[];
  channels: { channels: ChannelFact[]; declaredNone: boolean };
  measurement: MeasurementConfig;
  capacity: Fact<string> | null;
  lag: Fact<string> | null;
  legacyBody: string;
  storeBullet: Bullet | undefined;
  localPage: string | null;
  noCage: string | null;
}): StoreSkillConfig[] {
  const notes: Fact<string>[] = [];
  if (input.slug === "hvac-usa" && input.noCage) {
    notes.push({
      state: "known",
      value: input.noCage,
      source: "agency owner",
      asOf: "2026-09-30",
      raw: input.noCage,
    });
    notes.push({
      state: "known",
      value: "Never link, cite, or add /pages/local-ductless-stores. That page is Got Ductless only.",
      source: "agency owner",
      asOf: "2026-09-30",
      raw: "/pages/local-ductless-stores is Got Ductless only",
    });
  }

  if (input.slug === "got-ductless") {
    const gbp = input.channels.channels.filter((channel) => /business profile/i.test(channel.channel));
    const webChannels = input.channels.channels.filter((channel) => !/business profile/i.test(channel.channel));
    const webGeo = input.geo;
    const address = input.storeBullet
      ? makeFact(input.storeBullet.raw, input.source, input.asOf, "store")
      : null;
    const legacy = input.legacyBody.trim()
      ? makeFact(input.legacyBody.trim().slice(0, 500), input.source, input.asOf, "legacy confirm")
      : null;
    const marylandNotes: Fact<string>[] = [];
    if (input.localPage) {
      marylandNotes.push({
        state: "known",
        value: input.localPage,
        source: "agency owner",
        asOf: "2026-09-30",
        raw: input.localPage,
      });
    }
    if (legacy) marylandNotes.push(legacy);
    return [
      makeStore({
        storeKey: "got-ductless/web",
        role: "web",
        site: input.siteFact,
        geo: webGeo,
        channels: webChannels,
        channelsDeclaredNone: false,
        measurement: input.measurement,
        capacity: input.capacity,
        lag: input.lag,
      }),
      makeStore({
        storeKey: "got-ductless/maryland",
        role: "storefront",
        site: input.localPage
          ? {
              state: "known",
              value: "/pages/local-ductless-stores",
              source: "agency owner",
              asOf: "2026-09-30",
              raw: input.localPage,
            }
          : null,
        geo: address,
        channels: gbp,
        channelsDeclaredNone: gbp.length === 0,
        measurement: input.measurement,
        capacity: input.capacity,
        lag: input.lag,
        notes: marylandNotes,
      }),
    ];
  }

  const role: StoreRole =
    input.slug === "cerevex"
      ? "product"
      : input.slug === "kc-prestige-hvac" || input.slug === "elmar-hvac"
        ? "service-area"
        : "web";
  const storeKey =
    input.slug === "cerevex"
      ? "cerevex/product"
      : input.slug === "kc-prestige-hvac" || input.slug === "elmar-hvac"
        ? `${input.slug}/service`
        : `${input.slug}/web`;

  return [
    makeStore({
      storeKey,
      role,
      site: input.siteFact,
      geo: input.geo,
      channels: input.channels.channels,
      channelsDeclaredNone: input.channels.declaredNone,
      measurement: input.measurement,
      capacity: input.capacity,
      lag: input.lag,
      notes,
    }),
  ];
}
