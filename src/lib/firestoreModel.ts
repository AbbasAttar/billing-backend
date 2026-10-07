import { convertTimestamps, getDb, snapToData } from './firestoreDb';
import { FieldValue } from 'firebase-admin/firestore';
import { flagExpensiveOp, recordReads } from './readMeter';
import {
  getMirrorDocs,
  getMirrorDocsByIds,
  isMirrored,
  noteMirrorWrite,
  recordMirrorDeletes,
  registerMirror,
} from './collectionMirror';

export interface BaseDoc {
  id?: string;
  _id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => Record<string, any>;
  toJSON?: () => Record<string, any>;
  save?: () => Promise<any>;
  deleteOne?: () => Promise<any>;
  [key: string]: any;
}

const FIELD_TO_COLLECTION_MAP: Record<string, string> = {
  customer: 'customers',
  items: 'invoiceitems',
  frame: 'frames',
  opticalLens: 'opticallens',
  fragrance: 'fragrances',
  contactLens: 'contactlens',
  optician: 'users',
  user: 'users',
};

export function attachDocMethods(doc: any, modelObj?: any): any {
  if (!doc || typeof doc !== 'object') return doc;

  if (!Object.prototype.hasOwnProperty.call(doc, 'save')) {
    Object.defineProperty(doc, 'save', {
      value: async function () {
        const docId = doc.id || doc._id;
        if (modelObj) {
          if (docId) {
            // save() writes the whole document, so the written payload is the result; skip the re-read.
            const updated = await modelObj.findByIdAndUpdate(docId, doc, { returnDoc: false, fullDocument: true });
            return attachDocMethods(updated, modelObj);
          }
          return modelObj.create(doc);
        }
        return doc;
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(doc, 'toObject')) {
    Object.defineProperty(doc, 'toObject', {
      value: () => ({ ...doc }),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(doc, 'toJSON')) {
    Object.defineProperty(doc, 'toJSON', {
      value: () => ({ ...doc }),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(doc, 'deleteOne')) {
    Object.defineProperty(doc, 'deleteOne', {
      value: async function () {
        const docId = doc.id || doc._id;
        if (modelObj && docId) {
          return modelObj.findByIdAndDelete(docId);
        }
        return null;
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  return doc;
}

export function cleanPayload(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj === 'object' && obj._bsontype === 'ObjectID') {
    return obj.toString();
  }
  if (
    typeof obj === 'object' &&
    typeof obj.toString === 'function' &&
    obj.constructor &&
    obj.constructor.name === 'ObjectId'
  ) {
    return obj.toString();
  }
  if (obj instanceof Date || (typeof obj === 'object' && 'toDate' in obj)) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanPayload).filter((v) => v !== undefined && v !== null);
  }
  if (typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined || typeof val === 'function') continue;
      const cleaned = cleanPayload(val);
      if (cleaned !== undefined) {
        clean[key] = cleaned;
      }
    }
    return clean;
  }
  return obj;
}

export function getValueByPath(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: any = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const subPath = parts.slice(i).join('.');
      return current.map((item) => getValueByPath(item, subPath)).flat();
    }

    current = current[part];
  }

  return current;
}

export function setNestedPath(obj: any, path: string, val: any): void {
  if (!obj || typeof obj !== 'object' || !path) return;
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = val;
}

export function matchesMongoFilter(doc: any, filter: any): boolean {
  if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
    return true;
  }
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  for (const [key, val] of Object.entries(filter)) {
    if (val === undefined) continue;

    if (key === '$or') {
      if (!Array.isArray(val)) return false;
      if (!val.some((subFilter) => matchesMongoFilter(doc, subFilter))) {
        return false;
      }
      continue;
    }

    if (key === '$and') {
      if (!Array.isArray(val)) return false;
      if (!val.every((subFilter) => matchesMongoFilter(doc, subFilter))) {
        return false;
      }
      continue;
    }

    if (key === '$nor') {
      if (!Array.isArray(val)) return false;
      if (val.some((subFilter) => matchesMongoFilter(doc, subFilter))) {
        return false;
      }
      continue;
    }

    if (key === '$expr') {
      if (!isTruthy(evalExpr(doc, val))) return false;
      continue;
    }

    const docId = doc.id || doc._id;
    let targetVal: any;
    if (key === '_id' || key === 'id') {
      targetVal = docId ? docId.toString() : undefined;
    } else {
      targetVal = getValueByPath(doc, key);
    }

    if (!matchValue(targetVal, val)) {
      return false;
    }
  }

  return true;
}

/**
 * Range comparison with Mongo's type bracketing: values of different types never match
 * (a string date is not ">= " a Date). An array target matches when any element does.
 */
function rangeMatches(target: any, bound: any, test: (cmp: number) => boolean): boolean {
  if (Array.isArray(target)) return target.some((t) => rangeMatches(t, bound, test));
  if (target === undefined || target === null || bound === undefined || bound === null) return false;
  if (target instanceof Date && bound instanceof Date) return test(target.getTime() - bound.getTime());
  if (typeof target === 'number' && typeof bound === 'number') return test(target - bound);
  if (typeof target === 'string' && typeof bound === 'string') return test(target < bound ? -1 : target > bound ? 1 : 0);
  if (typeof target === 'boolean' && typeof bound === 'boolean') return test(Number(target) - Number(bound));
  return false;
}

function matchValue(target: any, condition: any): boolean {
  if (condition === undefined) return true;

  if (condition instanceof RegExp) {
    if (Array.isArray(target)) {
      return target.some((t) => condition.test(String(t ?? '')));
    }
    return condition.test(String(target ?? ''));
  }

  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    const keys = Object.keys(condition);
    const hasMongoOp = keys.some((k) => k.startsWith('$'));

    if (hasMongoOp) {
      if ('$eq' in condition && !matchValue(target, condition.$eq)) return false;
      if ('$ne' in condition) {
        const neVal = condition.$ne;
        if (neVal instanceof RegExp) {
          if (matchValue(target, neVal)) return false;
        } else if (Array.isArray(target)) {
          if (target.includes(neVal)) return false;
        } else if (target === neVal) {
          return false;
        }
      }
      if ('$exists' in condition) {
        const exists = target !== undefined && target !== null;
        if (Boolean(condition.$exists) !== exists) return false;
      }
      if ('$in' in condition && Array.isArray(condition.$in)) {
        const inVals = condition.$in.map((x: any) => (x && x.toString ? x.toString() : x));
        if (Array.isArray(target)) {
          if (!target.some((t) => inVals.includes(t && t.toString ? t.toString() : t))) return false;
        } else {
          const strTarget = target && target.toString ? target.toString() : target;
          if (!inVals.includes(strTarget)) return false;
        }
      }
      if ('$nin' in condition && Array.isArray(condition.$nin)) {
        const ninVals = condition.$nin.map((x: any) => (x && x.toString ? x.toString() : x));
        if (Array.isArray(target)) {
          if (target.some((t) => ninVals.includes(t && t.toString ? t.toString() : t))) return false;
        } else {
          const strTarget = target && target.toString ? target.toString() : target;
          if (ninVals.includes(strTarget)) return false;
        }
      }
      if ('$gte' in condition && !rangeMatches(target, condition.$gte, (c) => c >= 0)) return false;
      if ('$lte' in condition && !rangeMatches(target, condition.$lte, (c) => c <= 0)) return false;
      if ('$gt' in condition && !rangeMatches(target, condition.$gt, (c) => c > 0)) return false;
      if ('$lt' in condition && !rangeMatches(target, condition.$lt, (c) => c < 0)) return false;
      if ('$arrayContains' in condition) {
        if (!Array.isArray(target) || !target.includes(condition.$arrayContains)) return false;
      }
      if ('$regex' in condition) {
        const pattern =
          typeof condition.$regex === 'object' && 'source' in condition.$regex
            ? condition.$regex.source
            : String(condition.$regex);
        const flags =
          condition.$options ||
          (typeof condition.$regex === 'object' && 'flags' in condition.$regex ? condition.$regex.flags : 'i');
        const rx = new RegExp(pattern, flags);
        if (Array.isArray(target)) {
          if (!target.some((t) => rx.test(String(t ?? '')))) return false;
        } else if (!rx.test(String(target ?? ''))) {
          return false;
        }
      }
      if ('$not' in condition) {
        if (matchValue(target, condition.$not)) return false;
      }
      return true;
    }
  }

  if (Array.isArray(condition)) {
    const condStrs = condition.map((x) => (x && x.toString ? x.toString() : x));
    if (Array.isArray(target)) {
      return target.some((t) => condStrs.includes(t && t.toString ? t.toString() : t));
    }
    const strTarget = target && target.toString ? target.toString() : target;
    return condStrs.includes(strTarget);
  }

  if (Array.isArray(target)) {
    const condStr = condition && condition.toString ? condition.toString() : condition;
    return target.some((t) => (t && t.toString ? t.toString() : t) === condStr);
  }

  const strTarget = target && target.toString ? target.toString() : target;
  const strCond = condition && condition.toString ? condition.toString() : condition;
  return strTarget === strCond;
}

function sortDocs(docs: any[], orderBys: Array<[string, 'asc' | 'desc']>): any[] {
  if (orderBys.length === 0) return docs;

  return [...docs].sort((a, b) => {
    for (const [field, dir] of orderBys) {
      const valA = getValueByPath(a, field);
      const valB = getValueByPath(b, field);

      if (valA === valB) continue;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      let cmp = 0;
      if (valA instanceof Date && valB instanceof Date) {
        cmp = valA.getTime() - valB.getTime();
      } else if (typeof valA === 'string' && typeof valB === 'string') {
        // Document ids compare bytewise, as Firestore orders them.
        cmp = field === 'id' || field === '_id' ? (valA < valB ? -1 : 1) : valA.localeCompare(valB);
      } else {
        cmp = valA < valB ? -1 : 1;
      }

      if (cmp === 0) continue;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function selectFields(obj: any, selectSpec: any): any {
  if (!obj || typeof obj !== 'object' || !selectSpec) return obj;

  let allowFields: Set<string> | null = null;
  let excludeFields: Set<string> | null = null;

  if (typeof selectSpec === 'string') {
    const tokens = selectSpec.trim().split(/\s+/).filter(Boolean);
    const includes = tokens.filter((t) => !t.startsWith('-'));
    const excludes = tokens.filter((t) => t.startsWith('-')).map((t) => t.substring(1));

    if (includes.length > 0) {
      allowFields = new Set(['_id', 'id', ...includes]);
    } else if (excludes.length > 0) {
      excludeFields = new Set(excludes);
    }
  } else if (typeof selectSpec === 'object' && selectSpec !== null) {
    const includes = Object.keys(selectSpec).filter((k) => selectSpec[k] === 1 || selectSpec[k] === true);
    const excludes = Object.keys(selectSpec).filter((k) => selectSpec[k] === 0 || selectSpec[k] === false);

    if (includes.length > 0) {
      allowFields = new Set(['_id', 'id', ...includes]);
    } else if (excludes.length > 0) {
      excludeFields = new Set(excludes);
    }
  }

  if (allowFields) {
    const res: Record<string, any> = {};
    for (const key of allowFields) {
      if (obj[key] !== undefined) {
        res[key] = obj[key];
      }
    }
    return res;
  }

  if (excludeFields) {
    const res: Record<string, any> = { ...obj };
    for (const key of excludeFields) {
      delete res[key];
    }
    return res;
  }

  return obj;
}

export async function populateDocs(docs: any[], specs: any[]): Promise<void> {
  if (!docs || docs.length === 0 || !specs || specs.length === 0) return;

  for (const rawSpec of specs) {
    if (!rawSpec) continue;
    const spec = typeof rawSpec === 'string' ? { path: rawSpec } : rawSpec;
    const path = spec.path;
    if (!path) continue;

    const targetCol =
      spec.model
        ? FIELD_TO_COLLECTION_MAP[spec.model] || spec.model.toLowerCase() + 's'
        : FIELD_TO_COLLECTION_MAP[path] || path.toLowerCase() + 's';

    const idSet = new Set<string>();
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;
      const val = doc[path];
      if (typeof val === 'string' && val.length > 0) {
        idSet.add(val);
      } else if (val && typeof val === 'object' && (val._id || val.id) && typeof (val._id || val.id) === 'string') {
        idSet.add(val._id || val.id);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.length > 0) {
            idSet.add(item);
          } else if (item && typeof item === 'object' && (item._id || item.id)) {
            idSet.add(item._id || item.id);
          }
        }
      }
    }

    if (idSet.size === 0) continue;

    const idsToFetch = Array.from(idSet);
    const fetchedDocsMap = new Map<string, any>();

    // A handful of ids is cheapest as a direct getAll; more come from the target's mirror.
    const fromMirror = isMirrored(targetCol) && idsToFetch.length > 3;
    if (fromMirror) {
      for (const [id, data] of await getMirrorDocsByIds(targetCol, idsToFetch)) {
        attachDocMethods(data);
        fetchedDocsMap.set(id, data);
      }
    }

    const colRef = getDb().collection(targetCol);
    for (let i = 0; !fromMirror && i < idsToFetch.length; i += 100) {
      const chunk = idsToFetch.slice(i, i + 100);
      const refs = chunk.map((id) => colRef.doc(id));
      if (refs.length > 0) {
        const snaps = await getDb().getAll(...refs);
        recordReads(targetCol, snaps.length);
        for (const snap of snaps) {
          const data = snapToData(snap);
          if (data) {
            attachDocMethods(data);
            const key = (data.id || data._id || '').toString();
            if (key) fetchedDocsMap.set(key, data);
          }
        }
      }
    }

    const nestedSpecs = spec.populate ? (Array.isArray(spec.populate) ? spec.populate : [spec.populate]) : null;
    const fetchedDocsList = Array.from(fetchedDocsMap.values());
    if (nestedSpecs && fetchedDocsList.length > 0) {
      await populateDocs(fetchedDocsList, nestedSpecs);
    }

    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;
      const val = doc[path];

      if (typeof val === 'string' || (val && typeof val === 'object' && !Array.isArray(val))) {
        const id = typeof val === 'string' ? val : (val._id || val.id)?.toString();
        if (id && fetchedDocsMap.has(id)) {
          const rawPopulated = fetchedDocsMap.get(id);
          doc[path] = selectFields(rawPopulated, spec.select);
        }
      } else if (Array.isArray(val)) {
        const populatedArr: any[] = [];
        for (const item of val) {
          const id = typeof item === 'string' ? item : (item._id || item.id)?.toString();
          if (id && fetchedDocsMap.has(id)) {
            const rawPopulated = fetchedDocsMap.get(id);
            populatedArr.push(selectFields(rawPopulated, spec.select));
          } else if (item && typeof item === 'object') {
            populatedArr.push(selectFields(item, spec.select));
          }
        }
        doc[path] = populatedArr;
      }
    }
  }
}

// ── Aggregation pipeline emulation ──────────────────────────────────────────
// Mongo semantics for the stages and expression operators this codebase uses. Dates are UTC
// unless an expression passes `timezone` (as in MongoDB).

type ExprVars = Record<string, any>;

const warnedOperators = new Set<string>();

function warnUnsupported(kind: string, name: string): void {
  const key = `${kind}:${name}`;
  if (warnedOperators.has(key)) return;
  warnedOperators.add(key);
  console.warn(`[aggregate] unsupported ${kind} "${name}" — result treated as null`);
}

function cloneDoc<D>(doc: D): D {
  try {
    return structuredClone(doc);
  } catch {
    return JSON.parse(JSON.stringify(doc));
  }
}

const isNullish = (v: any) => v === null || v === undefined;

/** Mongo truthiness: false, null, missing and 0 are false; everything else is true. */
function isTruthy(v: any): boolean {
  return !(v === false || v === 0 || isNullish(v));
}

function typeRank(v: any): number {
  if (isNullish(v)) return 0;
  if (typeof v === 'number') return 1;
  if (typeof v === 'string') return 2;
  if (Array.isArray(v)) return 4;
  if (v instanceof Date) return 6;
  if (typeof v === 'boolean') return 5;
  return 3;
}

function compareValues(a: any, b: any): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (ra === 3 || ra === 4) {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function valuesEqual(a: any, b: any): boolean {
  if (isNullish(a) && isNullish(b)) return true;
  return compareValues(a, b) === 0;
}

function toNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  return null;
}

function asDate(v: any): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function tzOffsetMinutes(tz: any): number {
  if (!tz || typeof tz !== 'string') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 330;
  if (tz !== 'UTC' && tz !== 'GMT' && tz !== 'Etc/UTC') warnUnsupported('timezone', tz);
  return 0;
}

/** Date shifted so its UTC getters return wall-clock parts in `tz`. */
function zoned(date: Date, tz: any): Date {
  return new Date(date.getTime() + tzOffsetMinutes(tz) * 60_000);
}

function dateArg(doc: any, arg: any, vars: ExprVars): { date: Date | null; tz: any } {
  if (arg && typeof arg === 'object' && !Array.isArray(arg) && !(arg instanceof Date) && 'date' in arg) {
    return { date: asDate(evalExpr(doc, arg.date, vars)), tz: evalExpr(doc, arg.timezone, vars) };
  }
  return { date: asDate(evalExpr(doc, Array.isArray(arg) ? arg[0] : arg, vars)), tz: undefined };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatDate(format: string, d: Date): string {
  return format.replace(/%([YmdHMSLjuw%])/g, (_m, code: string) => {
    switch (code) {
      case 'Y': return String(d.getUTCFullYear());
      case 'm': return pad(d.getUTCMonth() + 1);
      case 'd': return pad(d.getUTCDate());
      case 'H': return pad(d.getUTCHours());
      case 'M': return pad(d.getUTCMinutes());
      case 'S': return pad(d.getUTCSeconds());
      case 'L': return pad(d.getUTCMilliseconds(), 3);
      case 'j': {
        const start = Date.UTC(d.getUTCFullYear(), 0, 1);
        return pad(Math.floor((d.getTime() - start) / 86_400_000) + 1, 3);
      }
      case 'u': return String(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
      case 'w': return String(d.getUTCDay());
      default: return '%';
    }
  });
}

/** Mongo $round: half to even. */
function roundHalfEven(value: number, places: number): number {
  const factor = 10 ** places;
  const x = value * factor;
  const r = Math.round(x);
  const isHalf = Math.abs(x % 1) === 0.5;
  const rounded = isHalf && r % 2 !== 0 ? r - 1 : r;
  return rounded / factor;
}

function evalArgs(doc: any, arg: any, vars: ExprVars): any[] {
  return Array.isArray(arg) ? arg.map((a) => evalExpr(doc, a, vars)) : [evalExpr(doc, arg, vars)];
}

function numericValues(values: any[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function evalOperator(doc: any, op: string, arg: any, vars: ExprVars): any {
  switch (op) {
    case '$literal':
      return arg;

    // Arithmetic
    case '$add': {
      const values = evalArgs(doc, arg, vars);
      if (values.some(isNullish)) return null;
      const date = values.find((v) => v instanceof Date);
      const total = values.reduce((sum, v) => sum + (toNumber(v) ?? 0), 0);
      return date ? new Date(total) : total;
    }
    case '$subtract': {
      const [a, b] = evalArgs(doc, arg, vars);
      if (isNullish(a) || isNullish(b)) return null;
      if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
      if (a instanceof Date) return new Date(a.getTime() - (toNumber(b) ?? 0));
      return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
    }
    case '$multiply': {
      const values = evalArgs(doc, arg, vars);
      if (values.some(isNullish)) return null;
      return values.reduce((prod, v) => prod * (toNumber(v) ?? 0), 1);
    }
    case '$divide': {
      const [a, b] = evalArgs(doc, arg, vars);
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na === null || nb === null || nb === 0) return null;
      return na / nb;
    }
    case '$mod': {
      const [a, b] = evalArgs(doc, arg, vars);
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na === null || nb === null || nb === 0) return null;
      return na % nb;
    }
    case '$abs': case '$floor': case '$ceil': {
      const n = toNumber(evalArgs(doc, arg, vars)[0]);
      if (n === null) return null;
      return op === '$abs' ? Math.abs(n) : op === '$floor' ? Math.floor(n) : Math.ceil(n);
    }
    case '$round': {
      const [value, places] = evalArgs(doc, arg, vars);
      const n = toNumber(value);
      if (n === null) return null;
      return roundHalfEven(n, Number(places) || 0);
    }
    case '$sum': case '$avg': case '$max': case '$min': {
      const values = evalArgs(doc, arg, vars);
      // A single array argument aggregates the array's elements.
      const pool = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
      if (op === '$sum') return numericValues(pool).reduce((s, v) => s + v, 0);
      if (op === '$avg') {
        const nums = numericValues(pool);
        return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
      }
      const present = pool.filter((v: any) => !isNullish(v));
      if (present.length === 0) return null;
      return present.reduce((best: any, v: any) => {
        const c = compareValues(v, best);
        return (op === '$max' ? c > 0 : c < 0) ? v : best;
      });
    }

    // Comparison & logic
    case '$eq': case '$ne': case '$gt': case '$gte': case '$lt': case '$lte': {
      const [a, b] = evalArgs(doc, arg, vars);
      if (op === '$eq') return valuesEqual(a, b);
      if (op === '$ne') return !valuesEqual(a, b);
      const c = compareValues(a, b);
      return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
    }
    case '$cmp': {
      const [a, b] = evalArgs(doc, arg, vars);
      return Math.sign(compareValues(a, b));
    }
    case '$and':
      return evalArgs(doc, arg, vars).every(isTruthy);
    case '$or':
      return evalArgs(doc, arg, vars).some(isTruthy);
    case '$not':
      return !isTruthy(evalArgs(doc, arg, vars)[0]);
    case '$in': {
      const [value, list] = evalArgs(doc, arg, vars);
      return Array.isArray(list) && list.some((item) => valuesEqual(item, value) || String(item) === String(value));
    }
    case '$cond': {
      const spec = Array.isArray(arg) ? { if: arg[0], then: arg[1], else: arg[2] } : arg;
      return isTruthy(evalExpr(doc, spec.if, vars)) ? evalExpr(doc, spec.then, vars) : evalExpr(doc, spec.else, vars);
    }
    case '$ifNull': {
      const list = Array.isArray(arg) ? arg : [arg];
      for (let i = 0; i < list.length - 1; i++) {
        const v = evalExpr(doc, list[i], vars);
        if (!isNullish(v)) return v;
      }
      return evalExpr(doc, list[list.length - 1], vars);
    }
    case '$switch': {
      for (const branch of arg?.branches ?? []) {
        if (isTruthy(evalExpr(doc, branch.case, vars))) return evalExpr(doc, branch.then, vars);
      }
      return evalExpr(doc, arg?.default, vars);
    }

    // Arrays
    case '$size': {
      const v = evalArgs(doc, arg, vars)[0];
      return Array.isArray(v) ? v.length : 0;
    }
    case '$arrayElemAt': {
      const [list, index] = evalArgs(doc, arg, vars);
      if (!Array.isArray(list)) return null;
      const i = Number(index);
      return i < 0 ? list[list.length + i] : list[i];
    }
    case '$first': case '$last': {
      const v = evalArgs(doc, arg, vars)[0];
      if (!Array.isArray(v)) return v;
      return op === '$first' ? v[0] : v[v.length - 1];
    }
    case '$concatArrays': {
      const values = evalArgs(doc, arg, vars);
      if (values.some(isNullish)) return null;
      return values.flatMap((v) => (Array.isArray(v) ? v : [v]));
    }
    case '$filter': {
      const input = evalExpr(doc, arg?.input, vars);
      if (!Array.isArray(input)) return null;
      const name = arg?.as || 'this';
      const out = input.filter((item) => isTruthy(evalExpr(doc, arg?.cond, { ...vars, [name]: item })));
      return arg?.limit ? out.slice(0, Number(evalExpr(doc, arg.limit, vars))) : out;
    }
    case '$map': {
      const input = evalExpr(doc, arg?.input, vars);
      if (!Array.isArray(input)) return null;
      const name = arg?.as || 'this';
      return input.map((item) => evalExpr(doc, arg?.in, { ...vars, [name]: item }));
    }
    case '$reduce': {
      const input = evalExpr(doc, arg?.input, vars);
      if (!Array.isArray(input)) return null;
      let value = evalExpr(doc, arg?.initialValue, vars);
      for (const item of input) value = evalExpr(doc, arg?.in, { ...vars, value, this: item });
      return value;
    }

    // Strings & types
    case '$toString': {
      const v = evalArgs(doc, arg, vars)[0];
      if (isNullish(v)) return null;
      return v instanceof Date ? v.toISOString() : String(v);
    }
    case '$toLower': case '$toUpper': {
      const v = evalArgs(doc, arg, vars)[0];
      if (isNullish(v)) return '';
      return op === '$toLower' ? String(v).toLowerCase() : String(v).toUpperCase();
    }
    case '$concat': {
      const values = evalArgs(doc, arg, vars);
      if (values.some(isNullish)) return null;
      return values.map(String).join('');
    }
    case '$strLenCP': {
      const v = evalArgs(doc, arg, vars)[0];
      return typeof v === 'string' ? [...v].length : 0;
    }
    case '$toInt': case '$toDouble': {
      const v = evalArgs(doc, arg, vars)[0];
      if (isNullish(v)) return null;
      const n = v instanceof Date ? v.getTime() : Number(v);
      if (Number.isNaN(n)) return null;
      return op === '$toInt' ? Math.trunc(n) : n;
    }
    case '$toDate': {
      return asDate(evalArgs(doc, arg, vars)[0]);
    }

    // Dates
    case '$dateToString': {
      const date = asDate(evalExpr(doc, arg?.date, vars));
      if (!date) return arg && 'onNull' in arg ? evalExpr(doc, arg.onNull, vars) : null;
      return formatDate(arg?.format ?? '%Y-%m-%dT%H:%M:%S.%LZ', zoned(date, evalExpr(doc, arg?.timezone, vars)));
    }
    case '$year': case '$month': case '$dayOfMonth': case '$dayOfWeek': case '$hour': case '$minute': case '$dayOfYear': {
      const { date, tz } = dateArg(doc, arg, vars);
      if (!date) return null;
      const d = zoned(date, tz);
      if (op === '$year') return d.getUTCFullYear();
      if (op === '$month') return d.getUTCMonth() + 1;
      if (op === '$dayOfMonth') return d.getUTCDate();
      if (op === '$dayOfWeek') return d.getUTCDay() + 1;
      if (op === '$hour') return d.getUTCHours();
      if (op === '$minute') return d.getUTCMinutes();
      return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
    }

    default:
      warnUnsupported('operator', op);
      return null;
  }
}

/** Evaluates an aggregation expression against `doc` (`$field`, `$$var`, operators, literals). */
function evalExpr(doc: any, expr: any, vars: ExprVars = {}): any {
  if (expr === undefined) return undefined;
  if (expr === null) return null;

  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) {
      const [name, ...rest] = expr.slice(2).split('.');
      const base = name === 'ROOT' || name === 'CURRENT' ? doc : vars[name];
      return rest.length ? getValueByPath(base, rest.join('.')) : base;
    }
    if (expr.startsWith('$')) return getValueByPath(doc, expr.slice(1));
    return expr;
  }

  if (typeof expr !== 'object' || expr instanceof Date) return expr;
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(doc, e, vars));

  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith('$')) {
    return evalOperator(doc, keys[0], expr[keys[0]], vars);
  }

  // Expression object: evaluate each field.
  const out: Record<string, any> = {};
  for (const key of keys) {
    const v = evalExpr(doc, expr[key], vars);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function groupDocs(docs: any[], groupSpec: any): any[] {
  const { _id: idExpr, ...accumulators } = groupSpec;
  const groups = new Map<string, { key: any; items: any[] }>();

  for (const doc of docs) {
    let key = evalExpr(doc, idExpr);
    if (key === undefined) key = null;
    const keyStr = JSON.stringify(key);
    let group = groups.get(keyStr);
    if (!group) {
      group = { key, items: [] };
      groups.set(keyStr, group);
    }
    group.items.push(doc);
  }

  const result: any[] = [];
  for (const { key, items } of groups.values()) {
    const groupedDoc: Record<string, any> = { _id: key };

    for (const [field, spec] of Object.entries(accumulators)) {
      if (!spec || typeof spec !== 'object') continue;
      const [op, expr] = Object.entries(spec as Record<string, any>)[0] ?? [];
      const values = () => items.map((item) => evalExpr(item, expr));

      switch (op) {
        case '$sum':
          groupedDoc[field] = expr === 1 ? items.length : numericValues(values()).reduce((s, v) => s + v, 0);
          break;
        case '$avg': {
          const nums = numericValues(values());
          groupedDoc[field] = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
          break;
        }
        case '$min': case '$max': {
          const present = values().filter((v) => !isNullish(v));
          groupedDoc[field] = present.length
            ? present.reduce((best, v) => {
                const c = compareValues(v, best);
                return (op === '$max' ? c > 0 : c < 0) ? v : best;
              })
            : null;
          break;
        }
        case '$first':
          groupedDoc[field] = items.length ? evalExpr(items[0], expr) ?? null : null;
          break;
        case '$last':
          groupedDoc[field] = items.length ? evalExpr(items[items.length - 1], expr) ?? null : null;
          break;
        case '$push':
          groupedDoc[field] = values().filter((v) => v !== undefined);
          break;
        case '$addToSet': {
          const seen = new Map<string, any>();
          for (const v of values()) {
            if (v !== undefined) seen.set(JSON.stringify(v), v);
          }
          groupedDoc[field] = [...seen.values()];
          break;
        }
        case '$count':
          groupedDoc[field] = items.length;
          break;
        default:
          warnUnsupported('accumulator', String(op));
          groupedDoc[field] = null;
      }
    }

    result.push(groupedDoc);
  }

  return result;
}

function projectDocs(docs: any[], projectSpec: any): any[] {
  if (!projectSpec || typeof projectSpec !== 'object') return docs;

  const entries = Object.entries(projectSpec);
  const excludesId = projectSpec._id === 0 || projectSpec._id === false;
  const isExclusion = entries.every(([key, v]) => key === '_id' || v === 0 || v === false);

  return docs.map((doc) => {
    if (isExclusion) {
      const res = { ...doc };
      for (const [key, v] of entries) {
        if (v === 0 || v === false) {
          delete res[key];
          if (key === '_id') delete res.id;
        }
      }
      return res;
    }

    const res: Record<string, any> = {};
    for (const [key, expr] of entries) {
      if (key === '_id' && excludesId) continue;
      const value = expr === 1 || expr === true ? getValueByPath(doc, key) : evalExpr(doc, expr);
      if (value !== undefined) setNestedPath(res, key, value);
    }
    if (!excludesId) {
      if (res._id === undefined) res._id = doc._id ?? doc.id;
      if (res.id === undefined) res.id = doc.id ?? doc._id;
    }
    return res;
  });
}

const idString = (v: any): string | null => {
  if (isNullish(v)) return null;
  if (typeof v === 'object' && !(v instanceof Date)) return String(v.id ?? v._id ?? v);
  return String(v);
};

async function lookupStage(docs: any[], spec: any): Promise<any[]> {
  const { from, localField, foreignField, as: asField } = spec;
  if (!from || !localField || !foreignField || !asField) {
    warnUnsupported('$lookup form', JSON.stringify(Object.keys(spec)));
    return docs;
  }
  if (!isMirrored(from)) {
    flagExpensiveOp(
      `lookup:${from}`,
      `$lookup downloads the whole "${from}" collection. Fetch only the referenced ids instead.`
    );
  }
  const foreignDocs: any[] = await new FirestoreQuery(from, {}, false).exec();

  // Index the foreign side by the string form of foreignField (each element when it is an array).
  const index = new Map<string, any[]>();
  for (const fDoc of foreignDocs) {
    const raw = foreignField === '_id' || foreignField === 'id' ? fDoc.id ?? fDoc._id : getValueByPath(fDoc, foreignField);
    const keys = Array.isArray(raw) ? raw : [raw];
    for (const k of new Set(keys.map(idString).filter((s): s is string => s !== null))) {
      const bucket = index.get(k);
      if (bucket) bucket.push(fDoc);
      else index.set(k, [fDoc]);
    }
  }

  for (const d of docs) {
    const raw = localField === '_id' || localField === 'id' ? d.id ?? d._id : getValueByPath(d, localField);
    const keys = (Array.isArray(raw) ? raw : [raw]).map(idString).filter((s): s is string => s !== null);
    const matches = new Set<any>();
    for (const k of keys) for (const m of index.get(k) ?? []) matches.add(m);
    d[asField] = [...matches].map((m) => cloneDoc(m));
  }
  return docs;
}

function unwindStage(docs: any[], spec: any): any[] {
  const path = (typeof spec === 'string' ? spec : spec.path).replace(/^\$/, '');
  const preserve = typeof spec === 'object' && Boolean(spec.preserveNullAndEmptyArrays);
  const indexField: string | undefined = typeof spec === 'object' ? spec.includeArrayIndex : undefined;

  const out: any[] = [];
  for (const d of docs) {
    const value = getValueByPath(d, path);
    if (Array.isArray(value) && value.length > 0) {
      value.forEach((item, i) => {
        const copy = cloneDoc(d);
        setNestedPath(copy, path, item);
        if (indexField) copy[indexField] = i;
        out.push(copy);
      });
    } else if (!Array.isArray(value) && !isNullish(value)) {
      // A non-array value unwinds to the document itself, as in MongoDB.
      out.push(d);
    } else if (preserve) {
      const copy = cloneDoc(d);
      if (Array.isArray(value)) setNestedPath(copy, path, null);
      if (indexField) copy[indexField] = null;
      out.push(copy);
    }
  }
  return out;
}

async function runPipelineStages(input: any[], pipeline: any[]): Promise<any[]> {
  let docs = input;

  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;
    const [name, spec] = Object.entries(stage)[0] ?? [];

    switch (name) {
      case '$match':
        docs = docs.filter((d) => matchesMongoFilter(d, spec));
        break;
      case '$lookup':
        docs = await lookupStage(docs, spec);
        break;
      case '$unwind':
        docs = unwindStage(docs, spec);
        break;
      case '$group':
        docs = groupDocs(docs, spec);
        break;
      case '$sort': {
        const orderBys: Array<[string, 'asc' | 'desc']> = Object.entries(spec as Record<string, any>).map(([f, d]) => [
          f,
          d === -1 || d === 'desc' ? 'desc' : 'asc',
        ]);
        docs = sortDocs(docs, orderBys);
        break;
      }
      case '$limit': {
        const n = Number(spec);
        if (!Number.isNaN(n) && n >= 0) docs = docs.slice(0, n);
        break;
      }
      case '$skip': {
        const n = Number(spec);
        if (!Number.isNaN(n) && n >= 0) docs = docs.slice(n);
        break;
      }
      case '$project':
        docs = projectDocs(docs, spec);
        break;
      case '$addFields':
      case '$set': {
        const fields = Object.entries(spec as Record<string, any>);
        docs = docs.map((d) => {
          // Every expression sees the input document, then all fields are written.
          const computed = fields.map(([key, expr]) => [key, evalExpr(d, expr)] as const);
          const copy = { ...d };
          for (const [key, value] of computed) setNestedPath(copy, key, value);
          return copy;
        });
        break;
      }
      case '$unset': {
        const fields = Array.isArray(spec) ? spec : [spec];
        docs = docs.map((d) => {
          const copy = cloneDoc(d);
          for (const f of fields) setNestedPath(copy, String(f), undefined);
          return copy;
        });
        break;
      }
      case '$replaceRoot':
      case '$replaceWith': {
        const expr = name === '$replaceRoot' ? (spec as any).newRoot : spec;
        docs = docs.map((d) => evalExpr(d, expr)).filter((d) => d && typeof d === 'object');
        break;
      }
      case '$count':
        docs = [{ [String(spec)]: docs.length }];
        break;
      case '$facet': {
        const out: Record<string, any[]> = {};
        for (const [facet, subPipeline] of Object.entries(spec as Record<string, any[]>)) {
          out[facet] = await runPipelineStages(docs.map((d) => cloneDoc(d)), subPipeline);
        }
        docs = [out];
        break;
      }
      case '$unionWith': {
        const coll = typeof spec === 'string' ? spec : (spec as any).coll;
        const subPipeline = typeof spec === 'string' ? [] : (spec as any).pipeline ?? [];
        if (!isMirrored(coll)) {
          flagExpensiveOp(`unionWith:${coll}`, `$unionWith downloads the whole "${coll}" collection.`);
        }
        const other: any[] = await new FirestoreQuery(coll, {}, false).exec();
        docs = docs.concat(await runPipelineStages(other, subPipeline));
        break;
      }
      default:
        warnUnsupported('stage', String(name));
    }
  }

  return docs;
}

export async function runMongoAggregatePipeline(
  colName: string,
  pipeline: any[],
): Promise<any[]> {
  if (!isMirrored(colName)) {
    flagExpensiveOp(
      `aggregate:${colName}`,
      `aggregate() downloads the whole "${colName}" collection and runs the pipeline in Node. Mirror the collection or use native count()/sum().`
    );
  }
  // For mirrored collections this reads the mirror (see collectionMirror.ts), not every document.
  const docs: any[] = await new FirestoreQuery(colName, {}, false).exec();
  return runPipelineStages(docs, pipeline);
}

export function isMissingIndexError(err: any): boolean {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return (
    err.code === 9 ||
    err.code === 'FAILED_PRECONDITION' ||
    err.code === '9' ||
    msg.includes('requires an index') ||
    msg.includes('create_composite') ||
    msg.includes('failed_precondition')
  );
}

export function extractIndexUrl(err: any): string | null {
  if (!err) return null;
  const str = `${err.message || ''} ${err.details || ''}`;
  const match = str.match(/https:\/\/console\.firebase\.google\.com[^\s)"']+/);
  return match ? match[0] : null;
}

export function logMissingIndexError(colName: string, err: any, action: string = 'query'): string | null {
  const url = extractIndexUrl(err);
  console.error('\n' + '🚨'.repeat(40));
  console.error(`[FIRESTORE MISSING COMPOSITE INDEX ERROR]`);
  console.error(`Collection : "${colName}"`);
  console.error(`Operation  : ${action}`);
  if (url) {
    console.error(`\n👉 DIRECT URL TO CREATE INDEX (Click or copy):\n   \x1b[36m\x1b[4m${url}\x1b[0m\n`);
  } else {
    console.error(`Error details:`, err?.message || err);
  }
  console.error('🚨'.repeat(40) + '\n');
  return url;
}

const NATIVE_FIRESTORE_SUB_OPS = new Set(['$gte', '$gt', '$lte', '$lt', '$eq', '$ne', '$in', '$arrayContains']);

export function isComplexFilter(filter: any): boolean {
  if (!filter || typeof filter !== 'object') return false;
  for (const [k, v] of Object.entries(filter)) {
    if (k.startsWith('$')) {
      return true;
    }
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      for (const subKey of Object.keys(v)) {
        if (subKey.startsWith('$') && !NATIVE_FIRESTORE_SUB_OPS.has(subKey)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function extractWhereFilters(filter: any): Array<[string, FirebaseFirestore.WhereFilterOp, any]> {
  const whereFilters: Array<[string, FirebaseFirestore.WhereFilterOp, any]> = [];
  if (!filter || typeof filter !== 'object') return whereFilters;

  for (const [key, val] of Object.entries(filter)) {
    if (key === '_id' || key === 'id' || key.startsWith('$') || val === undefined) continue;

    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      val instanceof Date
    ) {
      whereFilters.push([key, '==', val]);
    } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if ((val as any).$in && Array.isArray((val as any).$in)) {
        whereFilters.push([key, 'in', (val as any).$in.slice(0, 30)]);
      }
      if ((val as any).$eq !== undefined) whereFilters.push([key, '==', (val as any).$eq]);
      if ((val as any).$ne !== undefined) whereFilters.push([key, '!=', (val as any).$ne]);
      if ((val as any).$gte !== undefined) whereFilters.push([key, '>=', (val as any).$gte]);
      if ((val as any).$gt !== undefined) whereFilters.push([key, '>', (val as any).$gt]);
      if ((val as any).$lte !== undefined) whereFilters.push([key, '<=', (val as any).$lte]);
      if ((val as any).$lt !== undefined) whereFilters.push([key, '<', (val as any).$lt]);
      if ((val as any).$arrayContains !== undefined) whereFilters.push([key, 'array-contains', (val as any).$arrayContains]);
    }
  }
  return whereFilters;
}

function stripHiddenFields(result: any, hidden?: string[]): any {
  if (!hidden || hidden.length === 0 || !result) return result;
  const strip = (doc: any) => {
    if (doc && typeof doc === 'object') for (const f of hidden) delete doc[f];
    return doc;
  };
  return Array.isArray(result) ? result.map(strip) : strip(result);
}

export class FirestoreQuery<T = any> implements PromiseLike<T[]> {
  private colName: string;
  private rawFilter: any;
  private modelObj?: any;
  private simpleWhereFilters: Array<[string, FirebaseFirestore.WhereFilterOp, any]> = [];
  private orderBys: Array<[string, 'asc' | 'desc']> = [];
  private populateSpecs: any[] = [];
  private selectSpec: any = null;
  private limitNum?: number;
  private offsetNum?: number;
  private isSingleDoc: boolean = false;
  private targetId?: string;
  private targetIds?: string[];
  private keepHiddenFields = false;

  constructor(colName: string, initialFilter: any = {}, single: boolean = false, modelObj?: any) {
    this.colName = colName;
    this.rawFilter = initialFilter;
    this.isSingleDoc = single;
    this.modelObj = modelObj;
    this.extractSimpleFilters(initialFilter);
  }

  private extractSimpleFilters(filter: any) {
    if (!filter || typeof filter !== 'object') return;

    const idVal = filter._id ?? filter.id;
    if (idVal) {
      if (typeof idVal === 'string') {
        this.targetId = idVal;
      } else if (typeof idVal === 'object' && idVal !== null) {
        if (idVal.$in && Array.isArray(idVal.$in)) {
          const ids = idVal.$in
            .map((v: any) => (v && v.toString ? v.toString() : String(v)))
            .filter((v: any) => typeof v === 'string' && v !== '[object Object]');
          if (ids.length === 1) {
            this.targetId = ids[0];
          } else if (ids.length > 1) {
            this.targetIds = ids;
          }
        } else if (idVal._bsontype === 'ObjectID' || idVal.constructor?.name === 'ObjectId') {
          this.targetId = idVal.toString();
        }
      }
    }

    this.simpleWhereFilters = extractWhereFilters(filter);
  }

  sort(sortObj: any) {
    if (typeof sortObj === 'string') {
      const isDesc = sortObj.startsWith('-');
      const field = isDesc ? sortObj.substring(1) : sortObj;
      this.orderBys.push([field, isDesc ? 'desc' : 'asc']);
    } else if (typeof sortObj === 'object' && sortObj !== null) {
      for (const [field, dir] of Object.entries(sortObj)) {
        const direction = dir === -1 || dir === 'desc' || dir === 'descending' ? 'desc' : 'asc';
        this.orderBys.push([field, direction]);
      }
    }
    return this;
  }

  limit(n: number) {
    this.limitNum = n;
    return this;
  }

  skip(n: number) {
    this.offsetNum = n;
    return this;
  }

  /** Return hidden helper fields (e.g. searchTokens) too; used by search code that verifies them. */
  withHiddenFields() {
    this.keepHiddenFields = true;
    return this;
  }

  select(fields?: any) {
    if (fields) {
      this.selectSpec = fields;
    }
    return this;
  }

  /**
   * Field paths to push down to Firestore `select()`, or null when the projection is
   * exclusion-only (Firestore cannot exclude fields; those are stripped in memory).
   */
  private projectionFieldPaths(): string[] | null {
    const spec = this.selectSpec;
    if (!spec) return null;

    let includes: string[] = [];
    if (typeof spec === 'string') {
      includes = spec.trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
    } else if (typeof spec === 'object') {
      includes = Object.keys(spec).filter((k) => spec[k] === 1 || spec[k] === true);
    }
    if (includes.length === 0) return null;

    const needed = new Set<string>(includes);
    for (const key of Object.keys(this.rawFilter || {})) {
      if (!key.startsWith('$')) needed.add(key);
    }
    for (const p of this.populateSpecs) {
      if (p?.path) needed.add(p.path);
    }
    for (const [field] of this.orderBys) needed.add(field);

    needed.delete('_id');
    needed.delete('id');
    return Array.from(needed);
  }

  populate(...args: any[]) {
    if (args.length === 0) return this;

    const first = args[0];
    if (typeof first === 'string') {
      const spec: any = { path: first };
      if (typeof args[1] === 'string' || (typeof args[1] === 'object' && args[1] !== null)) {
        spec.select = args[1];
      }
      this.populateSpecs.push(spec);
    } else if (Array.isArray(first)) {
      for (const item of first) {
        if (typeof item === 'string') {
          this.populateSpecs.push({ path: item });
        } else if (item && typeof item === 'object' && item.path) {
          this.populateSpecs.push(item);
        }
      }
    } else if (first && typeof first === 'object' && first.path) {
      this.populateSpecs.push(first);
    }

    return this;
  }

  lean<TR = any>(): FirestoreQuery<TR> {
    return this as any;
  }

  async exec(): Promise<any> {
    const db = getDb();
    const colRef = db.collection(this.colName);

    let results: any = null;

    if (this.targetId) {
      const snap = await colRef.doc(this.targetId).get();
      recordReads(this.colName, 1);
      const data = snapToData<T>(snap);
      if (data && typeof data === 'object') {
        attachDocMethods(data, this.modelObj);
      }
      if (this.isSingleDoc) {
        results = data && matchesMongoFilter(data, this.rawFilter) ? data : null;
      } else {
        results = data && matchesMongoFilter(data, this.rawFilter) ? [data] : [];
      }
    } else if (this.targetIds && this.targetIds.length > 0) {
      const docs: any[] = [];
      for (let i = 0; i < this.targetIds.length; i += 100) {
        const chunk = this.targetIds.slice(i, i + 100);
        const refs = chunk.map((id) => colRef.doc(id));
        if (refs.length > 0) {
          const snaps = await db.getAll(...refs);
          recordReads(this.colName, snaps.length);
          for (const s of snaps) {
            const d = snapToData<T>(s);
            if (d && typeof d === 'object') {
              attachDocMethods(d, this.modelObj);
              if (matchesMongoFilter(d, this.rawFilter)) {
                docs.push(d);
              }
            }
          }
        }
      }
      results = this.isSingleDoc ? (docs.length > 0 ? docs[0] : null) : docs;
    } else {
      let docs: any[] = [];
      const hasComplexFilter = isComplexFilter(this.rawFilter);

      // Mirrored collections answer multi-document queries from the mirror (a couple of reads per
      // request) with Mongo filter semantics. Tiny limited queries stay native.
      const useMirror =
        isMirrored(this.colName) &&
        !this.keepHiddenFields &&
        (hasComplexFilter || !(this.limitNum && this.limitNum > 0 && this.limitNum <= 3));

      if (useMirror) {
        docs = await getMirrorDocs(this.colName, (d) => matchesMongoFilter(d, this.rawFilter));
      } else if (hasComplexFilter) {
        const nativeFilters = this.simpleWhereFilters.length;
        const message = nativeFilters
          ? `complex filter on "${this.colName}": orderBy/limit/offset are not pushed to Firestore, so every doc matching the native filters is downloaded.`
          : `complex filter on "${this.colName}" with no native where clause: this is a FULL COLLECTION SCAN.`;
        // Only a true full scan throws in strict mode; partially filtered scans just warn.
        flagExpensiveOp(`complex:${this.colName}`, message, nativeFilters === 0);
      }

      if (!useMirror) try {
        let query: FirebaseFirestore.Query = colRef;
        for (const [field, op, val] of this.simpleWhereFilters) {
          query = query.where(field, op, val);
        }

        // Fetch only the requested fields when the projection is include-style. Filter, populate and
        // sort fields are kept because they are re-checked or used in memory after the fetch.
        const projected = !hasComplexFilter ? this.projectionFieldPaths() : null;
        if (projected && projected.length > 0) {
          query = query.select(...projected);
        }

        // Push ordering down to Firestore when no in-memory complex filter
        if (this.orderBys.length > 0 && !hasComplexFilter) {
          for (const [field, dir] of this.orderBys) {
            query = query.orderBy(field, dir);
          }
        }

        // Push skip/offset down to Firestore when no in-memory complex filter
        if (this.offsetNum && this.offsetNum > 0 && !hasComplexFilter) {
          query = query.offset(this.offsetNum);
        }

        // Push limit down to Firestore (stops full-collection reads)
        if (this.limitNum && this.limitNum > 0 && !hasComplexFilter) {
          query = query.limit(this.limitNum);
        }

        const snap = await query.get();
        recordReads(this.colName, Math.max(snap.size, 1));
        docs = snap.docs.map((d) => snapToData<T>(d)!);
      } catch (err: any) {
        if (isMissingIndexError(err) && isMirrored(this.colName)) {
          // No composite index for this filter combination: the mirror answers it in memory.
          docs = await getMirrorDocs(this.colName);
        } else if (isMissingIndexError(err)) {
          const indexUrl = logMissingIndexError(this.colName, err, 'query');

          // If strict index mode is enabled, fail loudly to mandate index creation
          if (process.env.FAIL_ON_MISSING_INDEX === 'true' || process.env.STRICT_FIRESTORE_INDEXES === 'true') {
            throw new Error(
              `[Firestore Missing Index] Query on collection "${this.colName}" requires a composite index. Create it here: ${indexUrl || err.message}`
            );
          }

          // Strict last-resort fallback:
          // NEVER do colRef.get() unbounded, as that downloads the entire collection!
          // We remove the Firestore orderBy (which triggered the composite index requirement)
          // while retaining the where filters and a bounded limit.
          console.warn(
            `⚠️ [Firestore] Falling back to where-only query without Firestore orderBy for "${this.colName}". Documents will be sorted in-memory. PLEASE CREATE THE COMPOSITE INDEX VIA THE URL ABOVE TO RESTORE FULL QUERY PERFORMANCE.`
          );

          let safeFallbackQuery: FirebaseFirestore.Query = colRef;
          for (const [field, op, val] of this.simpleWhereFilters) {
            safeFallbackQuery = safeFallbackQuery.where(field, op, val);
          }
          // Cap the fallback read to avoid runaway billing spikes
          const fallbackCap = this.limitNum && this.limitNum > 0 ? Math.max(this.limitNum * 2, 50) : 200;
          safeFallbackQuery = safeFallbackQuery.limit(fallbackCap);

          try {
            const fallbackSnap = await safeFallbackQuery.get();
            recordReads(this.colName, Math.max(fallbackSnap.size, 1));
            docs = fallbackSnap.docs.map((d) => snapToData<T>(d)!);
          } catch (fallbackErr: any) {
            console.error(
              `❌ [Firestore] Safe fallback query also failed for collection "${this.colName}". Throwing error to prevent full collection scan.`
            );
            throw fallbackErr;
          }
        } else {
          console.error(`❌ [Firestore] Query error in collection "${this.colName}":`, err.message || err);
          throw err;
        }
      }

      let filteredDocs = docs.filter((d) => matchesMongoFilter(d, this.rawFilter));

      if (this.orderBys.length > 0) {
        // A native orderBy breaks ties by document id in the direction of the last orderBy;
        // do the same when the mirror stands in for that query.
        const orderBys = useMirror
          ? [...this.orderBys, ['id', this.orderBys[this.orderBys.length - 1][1]] as [string, 'asc' | 'desc']]
          : this.orderBys;
        filteredDocs = sortDocs(filteredDocs, orderBys);
      }

      if (this.offsetNum && this.offsetNum > 0) {
        filteredDocs = filteredDocs.slice(this.offsetNum);
      }

      if (this.limitNum && this.limitNum > 0) {
        filteredDocs = filteredDocs.slice(0, this.limitNum);
      }

      filteredDocs.forEach((item) => {
        if (item && typeof item === 'object') {
          attachDocMethods(item, this.modelObj);
        }
      });

      results = this.isSingleDoc ? (filteredDocs.length > 0 ? filteredDocs[0] : null) : filteredDocs;
    }

    if (this.populateSpecs.length > 0) {
      const docsToPopulate = this.isSingleDoc ? (results ? [results] : []) : (results || []);
      if (docsToPopulate.length > 0) {
        await populateDocs(docsToPopulate, this.populateSpecs);
      }
    }

    if (this.selectSpec && results) {
      if (Array.isArray(results)) {
        results = results.map((d) => selectFields(d, this.selectSpec));
      } else if (typeof results === 'object') {
        results = selectFields(results, this.selectSpec);
      }
    }

    return this.keepHiddenFields ? results : stripHiddenFields(results, this.modelObj?.hiddenFields);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<any> {
    return this.exec().catch(onrejected);
  }
}

function withLeanPromise<T>(promise: Promise<T>): any {
  const p = promise as any;
  p.lean = () => promise;
  p.populate = (...args: any[]) => p;
  return p;
}

// ── Mongo-style update handling ──────────────────────────────────────────────

export interface ParsedUpdate {
  set: Record<string, any>;
  inc: Record<string, number>;
  unset: string[];
  setOnInsert: Record<string, any>;
}

const SUPPORTED_UPDATE_OPS = new Set(['$set', '$inc', '$unset', '$setOnInsert']);

/**
 * Splits a Mongo update document into its operators. Operators are applied together,
 * so `{ $inc, $set }` no longer drops the `$inc`. A plain object (no `$` keys) is a full set.
 */
export function parseUpdate(update: any): ParsedUpdate {
  const parsed: ParsedUpdate = { set: {}, inc: {}, unset: [], setOnInsert: {} };
  if (!update || typeof update !== 'object') return parsed;

  const stripIds = (obj: Record<string, any>) => {
    // Document ids live in the doc path, not in a field.
    delete obj._id;
    delete obj.id;
    return obj;
  };

  const hasOperators = Object.keys(update).some((k) => k.startsWith('$'));
  if (!hasOperators) {
    parsed.set = stripIds(cleanPayload(update) ?? {});
    return parsed;
  }

  for (const [key, body] of Object.entries(update)) {
    if (!key.startsWith('$')) {
      parsed.set[key] = cleanPayload(body);
      continue;
    }
    if (!SUPPORTED_UPDATE_OPS.has(key)) {
      throw new Error(`[Firestore] Unsupported update operator "${key}". Supported: ${[...SUPPORTED_UPDATE_OPS].join(', ')}`);
    }
    if (!body || typeof body !== 'object') continue;
    if (key === '$set') Object.assign(parsed.set, stripIds(cleanPayload(body) ?? {}));
    else if (key === '$setOnInsert') Object.assign(parsed.setOnInsert, stripIds(cleanPayload(body) ?? {}));
    else if (key === '$inc') {
      for (const [path, n] of Object.entries(body as Record<string, any>)) parsed.inc[path] = Number(n) || 0;
    } else if (key === '$unset') parsed.unset.push(...Object.keys(body as Record<string, any>));
  }
  return parsed;
}

/** Firestore cannot address array elements by index, so such paths need read-modify-write. */
export function hasArrayIndexPath(path: string): boolean {
  return /(^|\.)\d+(\.|$)/.test(path);
}

export function updateTouchesArrayIndex(parsed: ParsedUpdate): boolean {
  return [...Object.keys(parsed.set), ...Object.keys(parsed.inc), ...parsed.unset].some(hasArrayIndexPath);
}

/**
 * Builds the object for `set(..., { merge: true })`. Dotted paths become nested maps
 * (a literal `"web.viewCount"` key would create a flat field with a dot in its name),
 * increments use FieldValue.increment and unsets use FieldValue.delete.
 */
export function toMergePayload(parsed: ParsedUpdate): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [path, val] of Object.entries(parsed.set)) setNestedPath(out, path, val);
  for (const [path, n] of Object.entries(parsed.inc)) setNestedPath(out, path, FieldValue.increment(n));
  for (const path of parsed.unset) setNestedPath(out, path, FieldValue.delete());
  return out;
}

/** Sets `value` at `path` inside plain data, walking into arrays by numeric index. */
function setAtPath(data: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === null || typeof current[part] !== 'object') {
      current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[part];
  }
  const last = parts[parts.length - 1];
  if (value === undefined) {
    if (Array.isArray(current)) current.splice(Number(last), 1);
    else delete current[last];
  } else {
    current[last] = value;
  }
}

function getAtPath(data: any, path: string): any {
  return path.split('.').reduce((cur, part) => (cur === null || cur === undefined ? undefined : cur[part]), data);
}

/**
 * Applies a parsed update to an in-memory document (array-index aware) and returns the
 * top-level keys that changed. `$setOnInsert` is only applied when `isInsert` is true.
 */
export function applyUpdateToData(data: Record<string, any>, parsed: ParsedUpdate, isInsert = false): string[] {
  const touched = new Set<string>();
  const touch = (path: string) => touched.add(path.split('.')[0]);

  if (isInsert) {
    for (const [path, val] of Object.entries(parsed.setOnInsert)) {
      setAtPath(data, path, val);
      touch(path);
    }
  }
  for (const [path, val] of Object.entries(parsed.set)) {
    setAtPath(data, path, val);
    touch(path);
  }
  for (const [path, n] of Object.entries(parsed.inc)) {
    const current = Number(getAtPath(data, path)) || 0;
    setAtPath(data, path, current + n);
    touch(path);
  }
  for (const path of parsed.unset) {
    setAtPath(data, path, undefined);
    touch(path);
  }
  return [...touched];
}

/** Builds the document an upsert inserts: filter equalities + $setOnInsert + $set + $inc applied to 0. */
export function buildInsertDoc(filter: any, parsed: ParsedUpdate): Record<string, any> {
  const doc: Record<string, any> = {};
  for (const [key, val] of Object.entries(filter || {})) {
    if (key.startsWith('$') || val === undefined) continue;
    if (key === '_id' || key === 'id') {
      doc._id = val;
      continue;
    }
    if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val) && !(val instanceof RegExp)) {
      const ops = Object.keys(val);
      if (ops.some((k) => k.startsWith('$'))) {
        if ('$eq' in (val as any)) setAtPath(doc, key, (val as any).$eq);
        continue; // range / membership operators say nothing about an inserted value
      }
    }
    setAtPath(doc, key, val);
  }
  applyUpdateToData(doc, parsed, true);
  return doc;
}

export interface IFirestoreModel<T extends BaseDoc = any> {
  new (data?: any): T & { save(): Promise<T> };
  collectionName: string;
  find(filter?: any, ...args: any[]): FirestoreQuery<T>;
  findOne(filter?: any, ...args: any[]): FirestoreQuery<T>;
  findById(id: string | any, ...args: any[]): FirestoreQuery<T>;
  exists(filter?: any): Promise<{ _id: string } | null>;
  distinct(field: string, filter?: any): Promise<any[]>;
  create(docs: any, ...args: any[]): any;
  insertMany(docs: any[], ...args: any[]): any;
  findByIdAndUpdate(id: string | any, update: any, ...args: any[]): any;
  findOneAndUpdate(filter: any, update: any, ...args: any[]): any;
  findByIdAndDelete(id: string | any, ...args: any[]): any;
  updateOne(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: any, ...args: any[]): Promise<{ deletedCount: number }>;
  deleteMany(filter: any, ...args: any[]): Promise<{ deletedCount: number }>;
  bulkWrite(ops: any[], ...args: any[]): Promise<any>;
  countDocuments(filter?: any, ...args: any[]): Promise<number>;
  aggregate(pipeline: any[], ...args: any[]): Promise<any[]>;
}

export interface BeforeWriteContext {
  /** True when `payload` is the complete document (create / save), false for partial updates. */
  full: boolean;
  /** The stored document before this write, for partial updates that depend on other fields (null if none). */
  getExisting: () => Promise<Record<string, any> | null>;
}

export interface FirestoreModelOptions {
  /**
   * Runs on the cleaned payload just before create() / findByIdAndUpdate() writes it.
   * Use it to maintain derived fields (e.g. invoice balance, lab-job flags) so queries can filter natively.
   */
  beforeWrite?: (payload: Record<string, any>, ctx: BeforeWriteContext) => void | Promise<void>;
  /** Stored fields that are removed from returned documents (internal helpers such as searchTokens). */
  hiddenFields?: string[];
  /**
   * Keep a collection mirror (see collectionMirror.ts) so aggregate(), $lookup and unindexed
   * full scans read a few snapshot docs instead of every document. For small collections only.
   */
  mirror?: boolean;
}

export function createFirestoreModel<T extends BaseDoc = any>(
  colName: string,
  options: FirestoreModelOptions = {},
): IFirestoreModel<T> {
  if (options.mirror) registerMirror(colName, { hiddenFields: options.hiddenFields ?? [] });

  const modelObj = {
    collectionName: colName,
    hiddenFields: options.hiddenFields ?? [],
    beforeWrite: options.beforeWrite,

    find(filter: any = {}, ...args: any[]): FirestoreQuery<T> {
      // Mongoose signature: find(filter, projection, options)
      return new FirestoreQuery<T>(colName, filter, false, modelObj).select(args[0]);
    },

    findOne(filter: any = {}, ...args: any[]): FirestoreQuery<T> {
      return new FirestoreQuery<T>(colName, filter, true, modelObj).select(args[0]);
    },

    findById(id: string | any, ...args: any[]): FirestoreQuery<T> {
      const docId = id ? (typeof id === 'string' ? id : id.toString()) : '';
      return new FirestoreQuery<T>(colName, { _id: docId }, true, modelObj);
    },

    async exists(filter: any = {}): Promise<{ _id: string } | null> {
      const doc = await new FirestoreQuery<T>(colName, filter, true, modelObj).exec();
      return doc ? ({ _id: doc.id || doc._id } as any) : null;
    },

    async distinct(field: string, filter: any = {}): Promise<any[]> {
      flagExpensiveOp(
        `distinct:${colName}.${field}`,
        `distinct() downloads every matching doc of "${colName}" to collect one field. Keep a lookup doc instead.`
      );
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      const set = new Set();
      for (const d of docs) {
        const val = getValueByPath(d, field);
        if (val !== undefined && val !== null) {
          if (Array.isArray(val)) {
            val.forEach((item) => set.add(item));
          } else {
            set.add(val);
          }
        }
      }
      return Array.from(set);
    },

    create(docs: any, ...args: any[]): any {
      const p = (async () => {
        const db = getDb();
        const colRef = db.collection(colName);
        const isArray = Array.isArray(docs);
        const items = isArray ? docs : [docs];
        const createdItems: any[] = [];

        for (const item of items) {
          const hasExplicitId = Boolean(item._id || item.id);
          const customId = item._id ? item._id.toString() : item.id ? item.id.toString() : colRef.doc().id;
          const now = new Date();
          const cleaned = cleanPayload(item);
          delete cleaned._id;
          delete cleaned.id;
          cleaned.createdAt = cleaned.createdAt || now;
          cleaned.updatedAt = now;
          await options.beforeWrite?.(cleaned, { full: true, getExisting: async () => null });

          const docRef = colRef.doc(customId);
          await docRef.set(cleaned, { merge: true });
          noteMirrorWrite(colName);

          let data: any;
          if (hasExplicitId) {
            // set(merge) may have merged into an existing doc, so read back the merged result.
            const snap = await docRef.get();
            recordReads(colName, 1);
            data = snapToData(snap);
          } else {
            // Brand-new auto-id doc: the written payload IS the stored doc. No read-after-write.
            data = { ...cleaned, id: customId, _id: customId };
          }
          attachDocMethods(data, modelObj);
          createdItems.push(data);
        }

        const visible = stripHiddenFields(createdItems, options.hiddenFields);
        return isArray ? visible : visible[0];
      })();
      return withLeanPromise(p);
    },

    async insertMany(docs: any[], ...args: any[]): Promise<any> {
      return (this as any).create(docs);
    },

    findByIdAndUpdate(id: string | any, update: any, ...args: any[]): any {
      const p = (async () => {
        if (!id) return null;
        const docId = typeof id === 'string' ? id : id.toString();
        const db = getDb();
        const docRef = db.collection(colName).doc(docId);

        const parsed = parseUpdate(update);
        const returnDoc = args[0]?.returnDoc !== false;

        // Options for internal callers: `existing` is a copy of the doc they already read (avoids a re-read
        // in beforeWrite) and `fullDocument` marks save()-style writes that carry every field.
        const existingHint: Record<string, any> | undefined = args[0]?.existing;
        const hookCtx: BeforeWriteContext = {
          full: args[0]?.fullDocument === true,
          getExisting: async () => {
            if (existingHint) return existingHint;
            const prior = await docRef.get();
            recordReads(colName, 1);
            return prior.exists ? snapToData<Record<string, any>>(prior) : null;
          },
        };

        // Read-modify-write (in a transaction) when Firestore cannot express the update natively:
        //  - array-index paths such as "web.frameVariants.0.stock"
        //  - $inc when the caller needs the new value back (atomic, so concurrent counters stay unique)
        const needsTransaction =
          updateTouchesArrayIndex(parsed) || (returnDoc && Object.keys(parsed.inc).length > 0);

        if (needsTransaction) {
          const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            recordReads(colName, 1);
            const data: Record<string, any> = snap.exists ? convertTimestamps(snap.data() || {}) : {};
            const before: Record<string, any> | null = snap.exists ? convertTimestamps(snap.data() || {}) : null;

            const touched = applyUpdateToData(data, parsed, !snap.exists);
            const writePayload: Record<string, any> = {};
            for (const key of touched) {
              writePayload[key] = data[key] === undefined ? FieldValue.delete() : data[key];
            }
            data.updatedAt = new Date();
            writePayload.updatedAt = data.updatedAt;
            await options.beforeWrite?.(writePayload, { full: false, getExisting: async () => before });
            tx.set(docRef, writePayload, { merge: true });
            return { ...data, id: docId, _id: docId };
          });
          noteMirrorWrite(colName);
          attachDocMethods(result, modelObj);
          return stripHiddenFields(result, options.hiddenFields);
        }

        const payload = toMergePayload(parsed);
        payload.updatedAt = new Date();
        await options.beforeWrite?.(payload, hookCtx);
        await docRef.set(payload, { merge: true });
        noteMirrorWrite(colName);

        // Callers that ignore the result pass { returnDoc: false } to skip the read-after-write.
        // Without it the full merged document is returned, as Mongoose { new: true } callers expect.
        if (!returnDoc) {
          return stripHiddenFields({ ...payload, id: docId, _id: docId }, options.hiddenFields);
        }

        const snap = await docRef.get();
        recordReads(colName, 1);
        const data = snapToData(snap);
        attachDocMethods(data, modelObj);
        return stripHiddenFields(data, options.hiddenFields);
      })();
      return withLeanPromise(p);
    },

    findOneAndUpdate(filter: any, update: any, ...args: any[]): any {
      const options = args[0] || { new: true, upsert: false };
      const p = (async () => {
        const existing = await this.findOne(filter).exec();
        if (!existing && options.upsert) {
          // Apply the operators to a fresh doc instead of storing "$inc"/"$set" keys literally.
          const created = await (this as any).create(buildInsertDoc(filter, parseUpdate(update)));
          return created;
        }
        if (!existing) return null;
        const docId = existing.id || existing._id;
        return (this as any).findByIdAndUpdate(docId, update, options);
      })();
      return withLeanPromise(p);
    },

    findByIdAndDelete(id: string | any, ...args: any[]): any {
      const p = (async () => {
        if (!id) return null;
        const docId = typeof id === 'string' ? id : id.toString();
        const db = getDb();
        const docRef = db.collection(colName).doc(docId);
        const snap = await docRef.get();
        recordReads(colName, 1);
        if (!snap.exists) return null;
        const data = snapToData(snap);
        attachDocMethods(data, modelObj);
        await docRef.delete();
        await recordMirrorDeletes(colName, [docId]);
        noteMirrorWrite(colName);
        return data;
      })();
      return withLeanPromise(p);
    },

    async updateOne(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).limit(1).exec();
      if (docs.length === 0) return { matchedCount: 0, modifiedCount: 0 };
      const docId = docs[0].id || docs[0]._id;
      await (this as any).findByIdAndUpdate(docId, update, { returnDoc: false, existing: docs[0] });
      return { matchedCount: 1, modifiedCount: 1 };
    },

    async updateMany(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      const parsed = parseUpdate(update);

      // $inc and array-index paths need a per-document read-modify-write.
      if (Object.keys(parsed.inc).length > 0 || updateTouchesArrayIndex(parsed)) {
        for (const d of docs) {
          await (this as any).findByIdAndUpdate(d.id || d._id, update, { returnDoc: false, existing: d });
        }
        return { matchedCount: docs.length, modifiedCount: docs.length };
      }

      // Plain merges: run the hook per doc, then commit in batches of up to 400 writes.
      const db = getDb();
      const colRef = db.collection(colName);
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 400)) {
          const payload = toMergePayload(parsed);
          payload.updatedAt = new Date();
          await options.beforeWrite?.(payload, { full: false, getExisting: async () => d });
          batch.set(colRef.doc(d.id || d._id), payload, { merge: true });
        }
        await batch.commit();
      }
      if (docs.length > 0) noteMirrorWrite(colName);
      return { matchedCount: docs.length, modifiedCount: docs.length };
    },

    async deleteOne(filter: any, ...args: any[]): Promise<{ deletedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).limit(1).exec();
      if (docs.length === 0) return { deletedCount: 0 };
      const docId = docs[0].id || docs[0]._id;
      // The doc was just read by the query above; delete directly instead of re-reading it.
      await getDb().collection(colName).doc(docId).delete();
      await recordMirrorDeletes(colName, [docId]);
      noteMirrorWrite(colName);
      return { deletedCount: 1 };
    },

    async deleteMany(filter: any, ...args: any[]): Promise<{ deletedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      const db = getDb();
      const colRef = db.collection(colName);
      // Docs are already loaded: delete in batches of up to 500 with no per-doc re-read.
      for (let i = 0; i < docs.length; i += 500) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 500)) {
          batch.delete(colRef.doc(d.id || d._id));
        }
        await batch.commit();
      }
      await recordMirrorDeletes(colName, docs.map((d) => d.id || d._id));
      noteMirrorWrite(colName);
      return { deletedCount: docs.length };
    },

    async bulkWrite(ops: any[], ...args: any[]): Promise<any> {
      const db = getDb();
      const batch = db.batch();
      for (const op of ops) {
        if (op.updateOne) {
          const { filter, update } = op.updateOne;
          const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).limit(1).exec();
          if (docs.length > 0) {
            const docId = docs[0].id || docs[0]._id;
            const ref = db.collection(colName).doc(docId);
            const parsed = parseUpdate(update);
            if (updateTouchesArrayIndex(parsed)) {
              throw new Error('[Firestore] bulkWrite does not support array-index paths; use updateOne instead.');
            }
            // updatedAt lets collection mirrors pick the change up.
            batch.set(ref, { ...toMergePayload(parsed), updatedAt: new Date() }, { merge: true });
          }
        }
      }
      await batch.commit();
      noteMirrorWrite(colName);
      return { ok: 1 };
    },

    async countDocuments(filter: any = {}, ...args: any[]): Promise<number> {
      const db = getDb();
      let query: FirebaseFirestore.Query = db.collection(colName);
      const hasComplex = isComplexFilter(filter);

      if (!hasComplex) {
        const whereFilters = extractWhereFilters(filter);
        for (const [key, op, val] of whereFilters) {
          query = query.where(key, op, val);
        }
        try {
          const snap = await query.count().get();
          recordReads(colName, 1); // count() bills 1 read per up to 1000 index entries
          return snap.data().count;
        } catch (err: any) {
          if (isMissingIndexError(err)) {
            const indexUrl = logMissingIndexError(colName, err, 'countDocuments');
            if (process.env.FAIL_ON_MISSING_INDEX === 'true' || process.env.STRICT_FIRESTORE_INDEXES === 'true') {
              throw new Error(
                `[Firestore Missing Index] countDocuments on "${colName}" requires an index. Create it here: ${indexUrl || err.message}`
              );
            }
            console.warn(
              `⚠️ [Firestore] count() aggregation failed for "${colName}" due to missing index. Falling back to query execution. PLEASE CREATE THE INDEX VIA THE URL ABOVE.`
            );
          } else {
            console.error(`❌ [Firestore] countDocuments error on "${colName}":`, err.message || err);
            throw err;
          }
        }
      }

      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      return docs.length;
    },

    async aggregate(pipeline: any[], ...args: any[]): Promise<any[]> {
      return runMongoAggregatePipeline(colName, pipeline);
    },
  };

  const ModelConstructor: any = function (data: any) {
    const docData = cleanPayload({ ...data });
    attachDocMethods(docData, modelObj);
    return docData;
  };
  Object.assign(ModelConstructor, modelObj);
  return ModelConstructor as IFirestoreModel<T>;
}

// ── Transactions ────────────────────────────────────────────────────────────

type TxModel = { collectionName: string; hiddenFields?: string[]; beforeWrite?: FirestoreModelOptions['beforeWrite'] };

/**
 * Model-aware wrapper around a Firestore transaction: writes run the model's beforeWrite hook and
 * stamp createdAt/updatedAt like the non-transactional methods. Firestore requires every read
 * (get/getMany/query) to happen before the first write in the callback.
 */
export class ModelTx {
  readonly touched = new Set<string>();
  readonly deleted = new Map<string, string[]>();

  constructor(readonly tx: FirebaseFirestore.Transaction) {}

  private ref(model: TxModel, id: string) {
    return getDb().collection(model.collectionName).doc(id);
  }

  /** A new auto id for `model`, e.g. to link child docs before the parent is written. */
  newId(model: TxModel): string {
    return getDb().collection(model.collectionName).doc().id;
  }

  async get<D = any>(model: TxModel, id: string): Promise<D | null> {
    const snap = await this.tx.get(this.ref(model, id));
    recordReads(model.collectionName, 1);
    return snapToData<D>(snap);
  }

  async getMany<D = any>(model: TxModel, ids: string[]): Promise<Map<string, D>> {
    const out = new Map<string, D>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return out;
    const snaps = await this.tx.getAll(...unique.map((id) => this.ref(model, id)));
    recordReads(model.collectionName, snaps.length);
    for (const snap of snaps) {
      const data = snapToData<D>(snap);
      if (data) out.set(snap.id, data);
    }
    return out;
  }

  /** Native equality/range query inside the transaction (no in-memory filters). */
  async query<D = any>(model: TxModel, filter: Record<string, any>, limit?: number): Promise<D[]> {
    let q: FirebaseFirestore.Query = getDb().collection(model.collectionName);
    for (const [field, op, val] of extractWhereFilters(filter)) q = q.where(field, op, val);
    for (const [field, val] of Object.entries(filter)) {
      if (val === null) q = q.where(field, '==', null);
    }
    if (limit) q = q.limit(limit);
    const snap = await this.tx.get(q);
    recordReads(model.collectionName, Math.max(snap.size, 1));
    return snap.docs.map((d) => snapToData<D>(d)!);
  }

  /** Creates a document (full write). Returns the stored data with id/_id. */
  async create<D = any>(model: TxModel, data: Record<string, any>, id?: string): Promise<D> {
    const docId = id ?? data._id?.toString() ?? data.id?.toString() ?? this.newId(model);
    const payload = cleanPayload(data);
    delete payload._id;
    delete payload.id;
    const now = new Date();
    payload.createdAt = payload.createdAt || now;
    payload.updatedAt = now;
    await model.beforeWrite?.(payload, { full: true, getExisting: async () => null });
    this.tx.set(this.ref(model, docId), payload);
    this.touched.add(model.collectionName);
    return stripHiddenFields({ ...payload, id: docId, _id: docId }, model.hiddenFields) as D;
  }

  /**
   * Merges `$set` / plain fields (and `$unset`) into an existing document. `existing` is the doc as
   * read in this transaction; hooks use it instead of re-reading. `$inc` and array-index paths are
   * not supported here: compute the new value from `existing` instead.
   */
  async update(model: TxModel, id: string, update: Record<string, any>, existing: Record<string, any> | null): Promise<void> {
    const parsed = parseUpdate(update);
    if (Object.keys(parsed.inc).length > 0 || updateTouchesArrayIndex(parsed)) {
      throw new Error(`[ModelTx] update on "${model.collectionName}" must not use $inc or array-index paths`);
    }
    const payload = toMergePayload(parsed);
    payload.updatedAt = new Date();
    await model.beforeWrite?.(payload, { full: false, getExisting: async () => existing });
    this.tx.set(this.ref(model, id), payload, { merge: true });
    this.touched.add(model.collectionName);
  }

  /** Replaces a whole document (save()-style full write). */
  async replace(model: TxModel, id: string, data: Record<string, any>): Promise<void> {
    const payload = cleanPayload(data);
    delete payload._id;
    delete payload.id;
    payload.updatedAt = new Date();
    await model.beforeWrite?.(payload, { full: true, getExisting: async () => null });
    this.tx.set(this.ref(model, id), payload);
    this.touched.add(model.collectionName);
  }

  delete(model: TxModel, id: string): void {
    this.tx.delete(this.ref(model, id));
    const list = this.deleted.get(model.collectionName) ?? [];
    list.push(id);
    this.deleted.set(model.collectionName, list);
  }
}

/**
 * Runs `fn` in a Firestore transaction (retried on contention) and, after it commits, tells the
 * collection mirrors about the writes. All-or-nothing: if `fn` throws, nothing is written.
 */
export async function runModelTransaction<R>(fn: (t: ModelTx) => Promise<R>): Promise<R> {
  let last: ModelTx | null = null;
  const result = await getDb().runTransaction(async (tx) => {
    last = new ModelTx(tx);
    return fn(last);
  });
  const done = last as ModelTx | null;
  if (done) {
    for (const [col, ids] of done.deleted) await recordMirrorDeletes(col, ids);
    for (const col of new Set([...done.touched, ...done.deleted.keys()])) noteMirrorWrite(col);
  }
  return result;
}

/** `base` (or now) plus `days`, for TTL `expireAt` fields. */
export function expireAfterDays(base: unknown, days: number): Date {
  const start = base instanceof Date && !Number.isNaN(base.getTime()) ? base.getTime() : Date.now();
  return new Date(start + days * 86_400_000);
}
