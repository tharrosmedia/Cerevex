import type { ClientSkillConfig, Fact, IndexedFact, MissingFactItem, StoreSkillConfig } from "./types";

function pushFact(
  items: IndexedFact[],
  field: string,
  fact: Fact<unknown> | null | undefined,
  layer: "client" | "store",
  storeKey: string | null,
): void {
  if (!fact) return;
  items.push({ field, layer, storeKey, fact });
}

export function indexFacts(client: ClientSkillConfig): IndexedFact[] {
  const items: IndexedFact[] = [];
  const clientFields: Array<[string, Fact<unknown> | null]> = [
    ["engagement", client.engagement],
    ["profileStatus", client.profileStatus],
    ["approvalOwner", client.approvalOwner],
    ["businessModel", client.businessModel],
    ["offer", client.offer],
    ["qualifiedOutcome", client.qualifiedOutcome],
    ["secondaryOutcome", client.secondaryOutcome],
    ["valueModel", client.valueModel],
    ["segments", client.segments],
    ["qualifyingRules", client.qualifyingRules],
    ["voice", client.voice],
    ["protectedLines", client.protectedLines],
    ["neverSay", client.neverSay],
    ["complianceRules", client.complianceRules],
    ["copyRules", client.copyRules],
    ["voiceDetail", client.voiceDetail],
    ["installs", client.installs],
    ["brands", client.brands],
    ["licenses", client.licenses],
    ["dealerAuthorization", client.dealerAuthorization],
    ["planningNote", client.planningNote],
  ];
  for (const [field, fact] of clientFields) pushFact(items, field, fact, "client", null);
  for (const extra of client.extras) items.push(extra);

  for (const store of client.stores) {
    indexStore(items, store);
  }
  return items;
}

function indexStore(items: IndexedFact[], store: StoreSkillConfig): void {
  const key = store.storeKey;
  const fields: Array<[string, Fact<unknown> | null]> = [
    ["site", store.site],
    ["cms", store.cms],
    ["geo", store.geo],
    ["capacity", store.capacity],
    ["lag", store.lag],
    ["valueModelOverride", store.valueModelOverride],
    ["segmentsOverride", store.segmentsOverride],
    ["measurement.summary", store.measurement.summary],
    ["measurement.conversionTrackingAudit", store.measurement.conversionTrackingAudit],
    ["measurement.callTracking", store.measurement.callTracking],
    ["measurement.crm", store.measurement.crm],
    ["measurement.clickIdCapture", store.measurement.clickIdCapture],
    ["measurement.pixels", store.measurement.pixels],
    ["measurement.ecommercePlatform", store.measurement.ecommercePlatform],
  ];
  for (const [field, fact] of fields) pushFact(items, field, fact, "store", key);
  store.channels.forEach((channel, index) => {
    const base = `channels.${index}.${channel.channel}`;
    pushFact(items, `${base}.status`, channel.status, "store", key);
    pushFact(items, `${base}.access`, channel.access, "store", key);
    pushFact(items, `${base}.notes`, channel.notes, "store", key);
  });
  store.notes.forEach((note, index) => pushFact(items, `notes.${index}`, note, "store", key));
}

export function missingFactsFor(client: ClientSkillConfig): MissingFactItem[] {
  const items: MissingFactItem[] = [];
  for (const indexed of indexFacts(client)) {
    if (indexed.fact.state !== "tbd") continue;
    items.push({
      field: indexed.field,
      layer: indexed.layer,
      storeKey: indexed.storeKey,
      label: indexed.fact.raw || indexed.field,
      origin: "tbd-field",
    });
  }
  for (const question of client.openQuestions) {
    if (/^none\b/i.test(question.trim())) continue;
    items.push({
      field: "openQuestion",
      layer: "client",
      storeKey: null,
      label: question,
      origin: "open-question",
    });
  }
  return items;
}

export function renderMissingFacts(clientName: string, items: MissingFactItem[]): string {
  const lines = [`# Missing facts: ${clientName}`, ""];
  if (items.length === 0) {
    lines.push("No TBD fields.");
    lines.push("");
    return lines.join("\n");
  }
  const fields = items.filter((item) => item.origin === "tbd-field");
  const questions = items.filter((item) => item.origin === "open-question");
  if (fields.length > 0) {
    lines.push("## TBD fields", "");
    for (const item of fields) {
      const where = item.storeKey ? `${item.layer} ${item.storeKey}` : item.layer;
      lines.push(`- [ ] ${item.field} (${where}) — ${item.label}`);
    }
    lines.push("");
  }
  if (questions.length > 0) {
    lines.push("## Open questions", "");
    for (const item of questions) lines.push(`- [ ] ${item.label}`);
    lines.push("");
  }
  return lines.join("\n");
}
