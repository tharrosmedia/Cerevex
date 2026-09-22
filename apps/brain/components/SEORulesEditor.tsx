'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { SEORule, RuleCategory } from '@/src/lib/seo/rules';
import { RULE_CATEGORIES } from '@/src/lib/seo/rules';

interface SEORulesEditorProps {
  initialRules: SEORule[];
}

export function SEORulesEditor({ initialRules }: SEORulesEditorProps) {
  const [rules, setRules] = useState<SEORule[]>(initialRules);
  const [showRaw, setShowRaw] = useState(false);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialRules, null, 2));
  const [error, setError] = useState<string | null>(null);

  const updateRules = (newRules: SEORule[]) => {
    setRules(newRules);
    setRawJson(JSON.stringify(newRules, null, 2));
    setError(null);
  };

  const addRule = () => {
    const category: RuleCategory = 'overall';
    const short = Math.random().toString(36).slice(2, 6);
    const id = `custom-${category}-${short}`;
    const newRule: SEORule = { id, category, rule: '' };
    const newRules = [...rules, newRule];
    updateRules(newRules);
  };

  const removeRule = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    updateRules(newRules);
  };

  const updateRule = (index: number, field: keyof SEORule, value: string) => {
    const newRules = rules.map((rule, i) => {
      if (i === index) {
        return { ...rule, [field]: value } as SEORule;
      }
      return rule;
    });
    updateRules(newRules);
  };

  const toggleRaw = () => {
    if (!showRaw) {
      // Switching to raw: sync from structured
      setRawJson(JSON.stringify(rules, null, 2));
      setError(null);
    } else {
      // Switching from raw to structured: try to parse
      try {
        const parsed = JSON.parse(rawJson);
        if (!Array.isArray(parsed)) {
          throw new Error('Must be an array');
        }
        const validRules: SEORule[] = parsed.map((item: any, i: number) => {
          if (!item || typeof item !== 'object') throw new Error(`Item ${i} invalid`);
          const id = String(item.id || '').trim();
          const rule = String(item.rule || '').trim();
          const category = item.category as RuleCategory;
          if (!id) throw new Error(`Item ${i} missing id`);
          if (!rule) throw new Error(`Item ${i} missing rule text`);
          if (!RULE_CATEGORIES.includes(category)) throw new Error(`Item ${i} invalid category`);
          return { id, category, rule };
        });
        updateRules(validRules);
      } catch (e: any) {
        setError('Invalid JSON: ' + (e?.message || 'parse error'));
        return; // don't switch if invalid
      }
    }
    setShowRaw(!showRaw);
  };

  const handleRawChange = (value: string) => {
    setRawJson(value);
    setError(null);
  };

  const applyRaw = () => {
    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) throw new Error('Must be an array');
      const validRules: SEORule[] = parsed.map((item: any, i: number) => {
        if (!item || typeof item !== 'object') throw new Error(`Item ${i} invalid`);
        const id = String(item.id || '').trim();
        const rule = String(item.rule || '').trim();
        const category = item.category as RuleCategory;
        if (!id) throw new Error(`Item ${i} missing id`);
        if (!rule) throw new Error(`Item ${i} missing rule text`);
        if (!RULE_CATEGORIES.includes(category)) throw new Error(`Item ${i} invalid category`);
        return { id, category, rule };
      });
      updateRules(validRules);
      setError(null);
    } catch (e: any) {
      setError('Invalid JSON: ' + (e?.message || 'parse error'));
    }
  };

  // Basic client validation for structured
  const hasErrors = rules.some(r => !r.id.trim() || !r.rule.trim() || !RULE_CATEGORIES.includes(r.category));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={toggleRaw}
            className="mr-1"
          />
          Advanced: edit raw JSON
        </label>
        {showRaw && (
          <Button type="button" variant="outline" size="sm" onClick={applyRaw}>
            Apply changes to structured
          </Button>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>
      )}

      {!showRaw && (
        <>
          {rules.length === 0 && (
            <div className="text-sm text-muted-foreground">No rules. Click Add to create one.</div>
          )}
          {rules.map((rule, index) => (
            <div key={index} className="border p-3 rounded space-y-2 bg-muted/30">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">ID (freely editable, used in feedback)</label>
                  <Input
                    value={rule.id}
                    onChange={(e) => updateRule(index, 'id', e.target.value)}
                    className="font-mono text-sm"
                    placeholder="e.g. my-custom-rule"
                  />
                </div>
                <div className="w-40">
                  <label className="block text-xs font-medium mb-1">Category</label>
                  <select
                    value={rule.category}
                    onChange={(e) => updateRule(index, 'category', e.target.value as RuleCategory)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    {RULE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeRule(index)}
                  className="mb-0.5"
                >
                  Remove
                </Button>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Rule description</label>
                <Textarea
                  value={rule.rule}
                  onChange={(e) => updateRule(index, 'rule', e.target.value)}
                  className="text-sm"
                  placeholder="Describe the rule..."
                  rows={2}
                />
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addRule}>
            + Add Rule
          </Button>
          {hasErrors && (
            <div className="text-xs text-amber-600">Some rules have missing ID or description.</div>
          )}
        </>
      )}

      {showRaw && (
        <div>
          <Textarea
            name="seoRulesJson"
            value={rawJson}
            onChange={(e) => handleRawChange(e.target.value)}
            className="font-mono text-xs h-64"
            placeholder="JSON array of rules..."
          />
          <div className="text-xs text-muted-foreground mt-1">
            Edit the JSON above, then toggle off (or use Apply) to sync to structured view before saving.
          </div>
        </div>
      )}

      {/* Hidden input for structured mode (submits the current rules array) */}
      {!showRaw && (
        <input
          type="hidden"
          name="seoRulesJson"
          value={JSON.stringify(rules)}
          readOnly
        />
      )}
    </div>
  );
}
