import 'dotenv/config';
import { generateText } from 'ai';
import { xai, XAI_MODEL } from '../src/lib/ai/xai.js';
import { buildResearchMessages, buildWriterMessages } from '../src/lib/prompts/seo/index.js';
import { research } from '../src/lib/agents/seo/research.js';
import { writeDraft } from '../src/lib/agents/seo/writer.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const isReal = args.includes('--real');
const isDry = args.includes('--dry');
let brandVoice: string | undefined = undefined;
const brandIdx = args.indexOf('--brand');
if (brandIdx !== -1 && args[brandIdx + 1]) brandVoice = args[brandIdx + 1];
let platform = 'shopify';
const platIdx = args.indexOf('--platform');
if (platIdx !== -1 && args[platIdx + 1]) platform = args[platIdx + 1];
const keyword = args.find(a => !a.startsWith('--') && a !== cmd) || 'daikin single zone mini split';
const type = 'collection';
const storeArgIdx = args.indexOf('--store');
const storeId = (storeArgIdx !== -1 ? args[storeArgIdx + 1] : process.env.DEV_STORE_ID) as string;
if (!storeId) {
  console.error('DEV_STORE_ID or --store <id> required for test script');
  process.exit(1);
}

if (cmd === 'help' || cmd === '--help') {
  console.log('Usage: tsx scripts/test-prompt.ts <research|writer> [keyword] [--real] [--brand "voice here"] [--platform "shopify"] [--store <id>]');
  process.exit(0);
}

async function run() {
  if (cmd === 'research') {
    const sampleData = { results: [{ title: 'Sample', content: 'Key facts about ' + keyword }] };
    const allMsgs = buildResearchMessages({ keyword, type, searchData: sampleData, brandVoice, platform });
    if (isDry) {
      console.log('DRY research messages:', JSON.stringify(allMsgs, null, 2));
      return;
    }
      if (isReal) {
      console.log('Running real research (Tavily + LLM)...');
      const result = await research({ storeId, keyword, type, platform, brandVoice });
      console.dir(result, { depth: 2 });
    } else {
      console.log('Running isolated research prompt...');
      const sys = allMsgs.find(m => m.role === 'system')?.content;
      const userMsgs = allMsgs.filter(m => m.role !== 'system');
      const { text } = await generateText({ model: xai(XAI_MODEL), system: sys, messages: userMsgs });
      console.log('OUTPUT:\n' + text);
    }
  } else if (cmd === 'writer') {
    const sampleBrief = { keyword, type, platform, brandVoice, intent: 'commercial', sections: ['intro', 'specs'], researchSummary: 'Sample research for ' + keyword };
    const allMsgs = buildWriterMessages({ brief: sampleBrief, type, brandVoice, platform, seoRules: undefined });
    if (isDry) {
      console.log('DRY writer messages:', JSON.stringify(allMsgs, null, 2));
      return;
    }
    if (isReal) {
      console.log('Running real writeDraft...');
      const result = await writeDraft({ storeId, brief: sampleBrief, type, platform, brandVoice, seoRules: undefined });
      console.dir(result, { depth: 1 });
    } else {
      console.log('Running isolated writer prompt...');
      const sys = allMsgs.find(m => m.role === 'system')?.content;
      const userMsgs = allMsgs.filter(m => m.role !== 'system');
      const { text } = await generateText({ model: xai(XAI_MODEL), system: sys, messages: userMsgs });
      console.log('OUTPUT:\n' + text);
    }
  } else {
    console.log('Unknown command. Use research or writer');
  }
}

run();
