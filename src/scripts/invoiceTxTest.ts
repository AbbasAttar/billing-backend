/**
 * End-to-end test of the transactional invoice writes. EMULATOR ONLY: it seeds data, creates and
 * edits invoices and checks every side effect, so it refuses to run against a real database.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx ts-node --transpile-only src/scripts/invoiceTxTest.ts
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST (this test writes data).');
  process.exit(1);
}

import type { AddressInfo } from 'node:net';
import { getDb } from '../lib/firestoreDb';
import { runModelTransaction } from '../lib/firestoreModel';
import { Customer } from '../models/Customer.model';

let failures = 0;
const check = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`);
};

async function count(col: string) {
  return (await getDb().collection(col).count().get()).data().count;
}
async function doc(col: string, id: string) {
  return (await getDb().collection(col).doc(id).get()).data() as any;
}

async function seed() {
  const db = getDb();
  await db.collection('frames').doc('f1').set({
    name: 'Round', companyName: 'Acme', costPrice: 400, sellPrice: 1000, stock: 5, isArchived: false,
    web: { isPublished: false, frameVariants: [{ label: 'Black', stock: 3 }, { label: 'Gold', stock: 1 }] },
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('fragrances').doc('g1').set({
    name: 'Oud', companyName: 'Attar Co', costPrice: 100, sellPrice: 500, isArchived: false,
    variants: [{ label: '6ml', stock: 4, costPrice: 120 }, { label: '12ml', stock: 2 }],
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('lensstocks').doc('s1').set({
    lensType: 'Single Vision', material: 'CR', coating: 'ARC', color: 'White', sph: -1, cyl: 0, add: null,
    quantity: 3, reorderLevel: 2, costPrice: 50, createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('invoicecounters').doc('c1').set({ year: '26-27', lastSeq: 41 });
}

async function run() {
  await seed();
  const { default: app } = await import('../app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json };
  };

  const invoiceBody = {
    customerName: 'Test Person',
    customerMobile: '9876543210',
    billDate: '2026-10-07T10:00:00.000Z',
    discount: 100,
    items: [
      { type: 'frame', frame: 'f1', frameVariantLabel: 'Black', quantity: 1, price: 1200 },
      { type: 'fragrance', fragrance: 'g1', fragranceGrade: '6ml', quantity: 2, price: 600 },
      {
        type: 'opticalLens', quantity: 1, price: 900, eye: 'both', lensLabel: 'Distance',
        lensType: 'Single Vision', lensMaterial: 'CR', lensCoating: 'ARC', lensColor: 'White',
        lensBrand: 'Kodak', lensName: 'Clean', lensCategory: 'Single Vision',
        rightSpherical: -1, rightCylinder: 0, leftSpherical: -1, leftCylinder: 0,
      },
    ],
    initialPayments: [{ amount: 1000, method: 'cash' }],
  };

  // ── Validation failure writes nothing ─────────────────────────────────────
  const before = { inv: await count('invoices'), items: await count('invoiceitems'), cust: await count('customers'), rx: await count('prescriptions') };
  const bad = await call('POST', '/invoices', { ...invoiceBody, discount: 999999 });
  check('discount >= subtotal rejected', bad.status === 400, bad.json?.message);
  const badPay = await call('POST', '/invoices', { ...invoiceBody, initialPayments: [{ amount: 999999, method: 'cash' }] });
  check('overpayment rejected', badPay.status === 400, badPay.json?.message);
  const after = { inv: await count('invoices'), items: await count('invoiceitems'), cust: await count('customers'), rx: await count('prescriptions') };
  check('rejected requests wrote nothing', JSON.stringify(before) === JSON.stringify(after), { before, after });
  check('stock untouched after rejection', (await doc('frames', 'f1')).web.frameVariants[0].stock === 3);

  // ── Create ────────────────────────────────────────────────────────────────
  const created = await call('POST', '/invoices', invoiceBody);
  check('create returns 201', created.status === 201, created.status === 201 ? '' : created.json);
  const inv = created.json;
  const invId = inv._id ?? inv.id;
  check('invoice number from counter', inv.invoiceNumber === 'INV0042/26-27', inv.invoiceNumber);
  check('counter incremented', (await doc('invoicecounters', 'c1')).lastSeq === 42);
  check('totals', inv.subtotal === 3300 && inv.total === 3200, { subtotal: inv.subtotal, total: inv.total });
  check('due fields derived', inv.balance === 2200 && inv.hasDue === true, { balance: inv.balance, hasDue: inv.hasDue });
  check('new customer linked', inv.customer?.name === 'Test Person');
  check('3 items created and populated', inv.items?.length === 3);
  const itemDocs = await Promise.all(inv.items.map((i: any) => doc('invoiceitems', i._id ?? i.id)));
  check('items linked to invoice', itemDocs.every((d) => d.invoiceId === invId && d.invoiceNumber === inv.invoiceNumber));
  const lensItem = itemDocs.find((d) => d.type === 'opticalLens');
  check('lens item has prescription + catalog lens', Boolean(lensItem.prescription && lensItem.opticalLens));
  check('lens lab flags set by hook', lensItem.isLabItem === true && lensItem.isOpenLabJob === true);
  check('cogs uses variant cost', inv.totalCogs === 400 + 2 * 120, inv.totalCogs);
  const frame = await doc('frames', 'f1');
  check('frame variant stock 3 -> 2, price updated', frame.web.frameVariants[0].stock === 2 && frame.sellPrice === 1200 && frame.web.isPublished === false);
  const frag = await doc('fragrances', 'g1');
  check('fragrance variant stock 4 -> 2', frag.variants[0].stock === 2 && frag.variants[1].stock === 2);
  check('lens stock 3 -> 1 (both eyes)', (await doc('lensstocks', 's1')).quantity === 1);
  check('catalog lens created', (await count('opticallens')) === 1);

  // ── Payments (including concurrent adds) ─────────────────────────────────
  const adds = await Promise.all([1, 2, 3, 4, 5].map(() => call('PATCH', `/invoices/${invId}/payment`, { amount: 100, method: 'online' })));
  check('5 concurrent payments accepted', adds.every((r) => r.status === 200), adds.map((r) => r.status));
  let stored = await doc('invoices', invId);
  check('no lost updates (6 payments)', stored.payments.length === 6 && stored.paidAmount === 1500, { n: stored.payments.length, paid: stored.paidAmount });

  const up = await call('PATCH', `/invoices/${invId}/payment/1`, { amount: 300 });
  check('update payment', up.status === 200 && up.json.balance === 1500, up.json.balance);
  const del = await call('DELETE', `/invoices/${invId}/payment/1`);
  check('delete payment', del.status === 200 && del.json.payments.length === 5, del.json.payments?.length);
  const over = await call('PATCH', `/invoices/${invId}/payment`, { amount: 999999, method: 'cash' });
  check('overpayment on add rejected', over.status === 400);

  const settle = await call('PATCH', `/invoices/${invId}/payment`, { amount: 1800, method: 'cash' });
  stored = await doc('invoices', invId);
  check('full payment clears bill', settle.status === 200 && stored.hasDue === false && Boolean(stored.billClearDate), { hasDue: stored.hasDue });
  await call('DELETE', `/invoices/${invId}/payment/5`);
  stored = await doc('invoices', invId);
  check('removing a payment un-clears the bill', stored.hasDue === true && stored.billClearDate === undefined, { billClearDate: stored.billClearDate });

  // ── Items ─────────────────────────────────────────────────────────────────
  const added = await call('POST', `/invoices/${invId}/items`, { type: 'frame', frame: 'f1', quantity: 1, price: 500 });
  check('add item', added.status === 200 && added.json.items.length === 4 && added.json.subtotal === 3800, { n: added.json.items?.length, sub: added.json.subtotal });
  const newItemId = added.json.items[3]._id ?? added.json.items[3].id;
  check('added item linked', (await doc('invoiceitems', newItemId)).invoiceId === invId);
  const edited = await call('PUT', `/invoices/${invId}/items/${newItemId}`, { quantity: 2, price: 500 });
  check('update item recalcs', edited.status === 200 && edited.json.subtotal === 4300, edited.json.subtotal);
  const removed = await call('DELETE', `/invoices/${invId}/items/3`);
  check('remove item', removed.status === 200 && removed.json.items.length === 3 && removed.json.subtotal === 3300, removed.json.subtotal);
  check('removed item doc deleted', (await doc('invoiceitems', newItemId)) === undefined);

  const upd = await call('PUT', `/invoices/${invId}`, { discount: 300 });
  check('update invoice discount', upd.status === 200 && upd.json.total === 3000, upd.json.total);
  const badUpd = await call('PUT', `/invoices/${invId}`, { discount: 999999 });
  check('bad discount rejected, invoice unchanged', badUpd.status === 400 && (await doc('invoices', invId)).total === 3000);

  // ── Transaction rollback (helper level) ──────────────────────────────────
  const custBefore = await count('customers');
  try {
    await runModelTransaction(async (t) => {
      await t.create(Customer, { name: 'Should Not Exist' });
      throw new Error('boom');
    });
  } catch { /* expected */ }
  check('throw inside transaction writes nothing', (await count('customers')) === custBefore);

  // ── Delete ────────────────────────────────────────────────────────────────
  const gone = await call('DELETE', `/invoices/${invId}`);
  check('delete invoice', gone.status === 200);
  check('invoice + items removed', (await doc('invoices', invId)) === undefined && (await Promise.all(itemDocs.map((_, i) => doc('invoiceitems', inv.items[i]._id ?? inv.items[i].id)))).every((d) => d === undefined));
  check('frame variant stock restored to 3', (await doc('frames', 'f1')).web.frameVariants[0].stock === 3);
  const missing = await call('DELETE', `/invoices/${invId}`);
  check('delete missing invoice -> 404', missing.status === 404);

  server.close();
}

run()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(() => {
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  });
