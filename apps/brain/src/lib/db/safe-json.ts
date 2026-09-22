import 'dotenv/config';

export function toSafeJsonb(value: any, field = 'unknown') {
  if (value == null) return null;
  const t = typeof value;
  if (t === 'string') {
    try {
      // Recover if it was accidentally a JSON-string (e.g. from LLM or prior stringify)
      const parsed = JSON.parse(value);
      // Only return if it parsed to a valid non-primitive? No, allow any valid json value
      // but to be consistent, we can return the parsed (could be obj/array/prim)
      return parsed;
    } catch {
      console.warn(`[safe-json] string for jsonb ${field}, nulling`);
      return null;
    }
  }
  if (t === 'object' || Array.isArray(value)) {
    try {
      // Roundtrip to guarantee valid JSON-serializable plain value (strips undefined, functions, Dates->string, cycles->error)
      const str = JSON.stringify(value);
      if (str === undefined) {
        console.warn(`[safe-json] unserializable for jsonb ${field}, nulling`);
        return null;
      }
      return JSON.parse(str);
    } catch (e: any) {
      console.warn(`[safe-json] bad object for jsonb ${field}, nulling: ${e?.message || e}`);
      return null;
    }
  }
  // allow top level primitives for jsonb (number/bool are valid json values)
  if (t === 'number' || t === 'boolean') {
    return value;
  }
  console.warn(`[safe-json] bad type ${t} for jsonb ${field}, nulling`);
  return null;
}
