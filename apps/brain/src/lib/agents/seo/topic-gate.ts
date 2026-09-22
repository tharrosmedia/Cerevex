export function checkTopicGate({ draft, brief, research, gscQueries = [] }: { draft: any; brief?: any; research?: any; gscQueries?: string[]; [k: string]: any }) {
  const keyword = (brief?.primaryKeyword || brief?.keyword || '').toLowerCase();
  const mustCover = (brief?.mustCover || []).map((s: string) => s.toLowerCase());
  const mustNot = (brief?.mustNotCover || []).map((s: string) => s.toLowerCase());
  const secondaries = (gscQueries || []).map((s: string) => s.toLowerCase());
  const content = ((draft.title || '') + ' ' + (draft.metaTitle || '') + ' ' + (draft.metaDescription || '') + ' ' + (draft.bodyHtml || '')).toLowerCase();

  let onTopic = true;
  const violations: string[] = [];
  if (keyword && !content.includes(keyword)) {
    onTopic = false;
    violations.push(`missing primary keyword: ${keyword}`);
  }
  for (const mc of mustCover) {
    if (mc && !content.includes(mc)) {
      onTopic = false;
      violations.push(`missing must-cover: ${mc}`);
    }
  }
  for (const mn of mustNot) {
    if (mn && content.includes(mn)) {
      onTopic = false;
      violations.push(`includes forbidden: ${mn}`);
    }
  }
  return { onTopic, violations };
}
