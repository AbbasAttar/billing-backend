import { getDb, snapToData } from './firestoreDb';
import { FieldValue } from 'firebase-admin/firestore';

export interface BaseDoc {
  id?: string;
  _id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => Record<string, any>;
  toJSON?: () => Record<string, any>;
  save?: () => Promise<any>;
  [key: string]: any;
}

const FIELD_TO_COLLECTION_MAP: Record<string, string> = {
  customer: 'customers',
  items: 'invoiceitems',
  frame: 'frames',
  opticalLens: 'opticallenses',
  fragrance: 'fragrances',
  contactLens: 'contactlenses',
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
            return modelObj.findByIdAndUpdate(docId, doc);
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
      if ('$gte' in condition) {
        if (target === undefined || target === null || target < condition.$gte) return false;
      }
      if ('$lte' in condition) {
        if (target === undefined || target === null || target > condition.$lte) return false;
      }
      if ('$gt' in condition) {
        if (target === undefined || target === null || target <= condition.$gt) return false;
      }
      if ('$lt' in condition) {
        if (target === undefined || target === null || target >= condition.$lt) return false;
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
        cmp = valA.localeCompare(valB);
      } else {
        cmp = valA < valB ? -1 : 1;
      }

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

    const colRef = getDb().collection(targetCol);
    for (let i = 0; i < idsToFetch.length; i += 100) {
      const chunk = idsToFetch.slice(i, i + 100);
      const refs = chunk.map((id) => colRef.doc(id));
      if (refs.length > 0) {
        const snaps = await getDb().getAll(...refs);
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

function evalExpression(doc: any, expr: any): any {
  if (expr === null || expr === undefined) return null;

  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (typeof expr === 'string') {
    if (expr.startsWith('$')) {
      return getValueByPath(doc, expr.substring(1));
    }
    return expr;
  }

  if (typeof expr === 'object' && !Array.isArray(expr)) {
    if ('$subtract' in expr && Array.isArray(expr.$subtract)) {
      const a = evalExpression(doc, expr.$subtract[0]) || 0;
      const b = evalExpression(doc, expr.$subtract[1]) || 0;
      return Number(a) - Number(b);
    }
    if ('$add' in expr && Array.isArray(expr.$add)) {
      return expr.$add.reduce((sum: number, cur: any) => sum + (Number(evalExpression(doc, cur)) || 0), 0);
    }
    if ('$multiply' in expr && Array.isArray(expr.$multiply)) {
      return expr.$multiply.reduce((prod: number, cur: any) => prod * (Number(evalExpression(doc, cur)) || 0), 1);
    }
    if ('$sum' in expr) {
      const val = evalExpression(doc, expr.$sum);
      if (Array.isArray(val)) {
        return val.reduce((acc: number, c: any) => acc + (Number(c) || 0), 0);
      }
      return Number(val) || 0;
    }
  }

  return expr;
}

function groupDocs(docs: any[], groupSpec: any): any[] {
  const { _id: idExpr, ...accumulators } = groupSpec;
  const groups = new Map<string, { groupKeyVal: any; items: any[] }>();

  for (const doc of docs) {
    let keyVal: any = null;
    if (idExpr === null || idExpr === undefined) {
      keyVal = null;
    } else if (typeof idExpr === 'string' && idExpr.startsWith('$')) {
      keyVal = getValueByPath(doc, idExpr.substring(1));
    } else if (typeof idExpr === 'object') {
      keyVal = evalExpression(doc, idExpr);
    } else {
      keyVal = idExpr;
    }

    const groupKeyStr = JSON.stringify(keyVal);
    if (!groups.has(groupKeyStr)) {
      groups.set(groupKeyStr, { groupKeyVal: keyVal, items: [] });
    }
    groups.get(groupKeyStr)!.items.push(doc);
  }

  const result: any[] = [];
  for (const { groupKeyVal, items } of groups.values()) {
    const groupedDoc: Record<string, any> = { _id: groupKeyVal };

    for (const [accField, accExpr] of Object.entries(accumulators)) {
      if (accExpr && typeof accExpr === 'object') {
        if ('$sum' in accExpr) {
          const expr = (accExpr as any).$sum;
          if (expr === 1) {
            groupedDoc[accField] = items.length;
          } else {
            let sum = 0;
            for (const item of items) {
              const val = evalExpression(item, expr);
              if (typeof val === 'number' && !isNaN(val)) sum += val;
            }
            groupedDoc[accField] = sum;
          }
        } else if ('$avg' in accExpr) {
          let sum = 0;
          let count = 0;
          for (const item of items) {
            const val = evalExpression(item, (accExpr as any).$avg);
            if (typeof val === 'number' && !isNaN(val)) {
              sum += val;
              count++;
            }
          }
          groupedDoc[accField] = count > 0 ? sum / count : 0;
        } else if ('$min' in accExpr) {
          let min: any = undefined;
          for (const item of items) {
            const val = evalExpression(item, (accExpr as any).$min);
            if (val !== undefined && val !== null) {
              if (min === undefined || val < min) min = val;
            }
          }
          groupedDoc[accField] = min ?? null;
        } else if ('$max' in accExpr) {
          let max: any = undefined;
          for (const item of items) {
            const val = evalExpression(item, (accExpr as any).$max);
            if (val !== undefined && val !== null) {
              if (max === undefined || val > max) max = val;
            }
          }
          groupedDoc[accField] = max ?? null;
        } else if ('$push' in accExpr) {
          const list: any[] = [];
          for (const item of items) {
            list.push(evalExpression(item, (accExpr as any).$push));
          }
          groupedDoc[accField] = list;
        } else if ('$addToSet' in accExpr) {
          const set = new Set();
          for (const item of items) {
            set.add(JSON.stringify(evalExpression(item, (accExpr as any).$addToSet)));
          }
          groupedDoc[accField] = Array.from(set).map((s) => JSON.parse(s as string));
        }
      }
    }

    result.push(groupedDoc);
  }

  return result;
}

function projectDocs(docs: any[], projectSpec: any): any[] {
  if (!projectSpec || typeof projectSpec !== 'object') return docs;

  return docs.map((doc) => {
    const res: Record<string, any> = {};
    for (const [key, expr] of Object.entries(projectSpec)) {
      if (expr === 1 || expr === true) {
        res[key] = getValueByPath(doc, key);
      } else if (expr === 0 || expr === false) {
        // Skip
      } else {
        res[key] = evalExpression(doc, expr);
      }
    }
    if (res._id === undefined) res._id = doc._id || doc.id;
    if (res.id === undefined) res.id = doc.id || doc._id;
    return res;
  });
}

export async function runMongoAggregatePipeline(
  colName: string,
  pipeline: any[],
): Promise<any[]> {
  let docs: any[] = await new FirestoreQuery(colName, {}, false).exec();

  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;

    if (stage.$match) {
      docs = docs.filter((d) => matchesMongoFilter(d, stage.$match));
    } else if (stage.$unwind) {
      const fieldPath =
        typeof stage.$unwind === 'string'
          ? stage.$unwind.replace(/^\$/, '')
          : stage.$unwind.path.replace(/^\$/, '');
      const preserveNullAndEmptyArrays =
        typeof stage.$unwind === 'object' && stage.$unwind.preserveNullAndEmptyArrays;

      const unwound: any[] = [];
      for (const d of docs) {
        const arr = getValueByPath(d, fieldPath);
        if (Array.isArray(arr) && arr.length > 0) {
          for (const item of arr) {
            const copy = JSON.parse(JSON.stringify(d));
            setNestedPath(copy, fieldPath, item);
            unwound.push(copy);
          }
        } else if (preserveNullAndEmptyArrays) {
          const copy = JSON.parse(JSON.stringify(d));
          setNestedPath(copy, fieldPath, null);
          unwound.push(copy);
        }
      }
      docs = unwound;
    } else if (stage.$group) {
      docs = groupDocs(docs, stage.$group);
    } else if (stage.$sort) {
      const orderBys: Array<[string, 'asc' | 'desc']> = Object.entries(stage.$sort).map(([f, d]) => [
        f,
        d === -1 || d === 'desc' ? 'desc' : 'asc',
      ]);
      docs = sortDocs(docs, orderBys);
    } else if (stage.$limit) {
      const n = typeof stage.$limit === 'number' ? stage.$limit : parseInt(stage.$limit, 10);
      if (!isNaN(n) && n >= 0) docs = docs.slice(0, n);
    } else if (stage.$skip) {
      const n = typeof stage.$skip === 'number' ? stage.$skip : parseInt(stage.$skip, 10);
      if (!isNaN(n) && n >= 0) docs = docs.slice(n);
    } else if (stage.$project) {
      docs = projectDocs(docs, stage.$project);
    }
  }

  return docs;
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

    for (const [key, val] of Object.entries(filter)) {
      if (key === '_id' || key === 'id' || key.startsWith('$') || val === undefined) continue;

      if (
        typeof val === 'string' ||
        typeof val === 'number' ||
        typeof val === 'boolean' ||
        val instanceof Date
      ) {
        this.simpleWhereFilters.push([key, '==', val]);
      } else if (val && typeof val === 'object' && (val as any).$in && Array.isArray((val as any).$in)) {
        this.simpleWhereFilters.push([key, 'in', (val as any).$in.slice(0, 30)]);
      }
    }
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

  select(fields?: any) {
    if (fields) {
      this.selectSpec = fields;
    }
    return this;
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
      try {
        let query: FirebaseFirestore.Query = colRef;
        for (const [field, op, val] of this.simpleWhereFilters) {
          query = query.where(field, op, val);
        }
        const snap = await query.get();
        docs = snap.docs.map((d) => snapToData<T>(d)!);
      } catch {
        const snap = await colRef.get();
        docs = snap.docs.map((d) => snapToData<T>(d)!);
      }

      let filteredDocs = docs.filter((d) => matchesMongoFilter(d, this.rawFilter));

      if (this.orderBys.length > 0) {
        filteredDocs = sortDocs(filteredDocs, this.orderBys);
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

    return results;
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

export function createFirestoreModel<T extends BaseDoc = any>(colName: string): IFirestoreModel<T> {
  const modelObj = {
    collectionName: colName,

    find(filter: any = {}, ...args: any[]): FirestoreQuery<T> {
      return new FirestoreQuery<T>(colName, filter, false, modelObj);
    },

    findOne(filter: any = {}, ...args: any[]): FirestoreQuery<T> {
      return new FirestoreQuery<T>(colName, filter, true, modelObj);
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
          const customId = item._id ? item._id.toString() : item.id ? item.id.toString() : colRef.doc().id;
          const now = new Date();
          const cleaned = cleanPayload(item);
          delete cleaned._id;
          delete cleaned.id;
          cleaned.createdAt = cleaned.createdAt || now;
          cleaned.updatedAt = now;

          const docRef = colRef.doc(customId);
          await docRef.set(cleaned, { merge: true });
          const snap = await docRef.get();
          const data = snapToData(snap);
          attachDocMethods(data, modelObj);
          createdItems.push(data);
        }

        return isArray ? createdItems : createdItems[0];
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

        let payload: Record<string, any> = {};
        if (update.$set) {
          payload = cleanPayload(update.$set);
        } else if (update.$inc) {
          for (const [key, incVal] of Object.entries(update.$inc)) {
            payload[key] = FieldValue.increment(incVal as number);
          }
        } else {
          payload = cleanPayload(update);
        }

        payload.updatedAt = new Date();
        await docRef.set(payload, { merge: true });

        const snap = await docRef.get();
        const data = snapToData(snap);
        attachDocMethods(data, modelObj);
        return data;
      })();
      return withLeanPromise(p);
    },

    findOneAndUpdate(filter: any, update: any, ...args: any[]): any {
      const options = args[0] || { new: true, upsert: false };
      const p = (async () => {
        const existing = await this.findOne(filter).exec();
        if (!existing && options.upsert) {
          const created = await (this as any).create({ ...filter, ...update });
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
        if (!snap.exists) return null;
        const data = snapToData(snap);
        attachDocMethods(data, modelObj);
        await docRef.delete();
        return data;
      })();
      return withLeanPromise(p);
    },

    async updateOne(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).limit(1).exec();
      if (docs.length === 0) return { matchedCount: 0, modifiedCount: 0 };
      const docId = docs[0].id || docs[0]._id;
      await (this as any).findByIdAndUpdate(docId, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },

    async updateMany(filter: any, update: any, ...args: any[]): Promise<{ matchedCount: number; modifiedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      let modified = 0;
      for (const d of docs) {
        const docId = d.id || d._id;
        await (this as any).findByIdAndUpdate(docId, update);
        modified++;
      }
      return { matchedCount: docs.length, modifiedCount: modified };
    },

    async deleteOne(filter: any, ...args: any[]): Promise<{ deletedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).limit(1).exec();
      if (docs.length === 0) return { deletedCount: 0 };
      const docId = docs[0].id || docs[0]._id;
      await (this as any).findByIdAndDelete(docId);
      return { deletedCount: 1 };
    },

    async deleteMany(filter: any, ...args: any[]): Promise<{ deletedCount: number }> {
      const docs = await new FirestoreQuery<T>(colName, filter, false, modelObj).exec();
      for (const d of docs) {
        const docId = d.id || d._id;
        await (this as any).findByIdAndDelete(docId);
      }
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
            const payload = cleanPayload(update.$set ? { ...update.$set } : { ...update });
            batch.set(ref, payload, { merge: true });
          }
        }
      }
      await batch.commit();
      return { ok: 1 };
    },

    async countDocuments(filter: any = {}, ...args: any[]): Promise<number> {
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
