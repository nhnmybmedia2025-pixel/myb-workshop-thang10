import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandlers, AMOUNT} from '../netlify/lib/payment.mjs';

function fixture() {
  const db = new Map(); let created; let state = 'PENDING'; let paid = 0; let badId = false;
  const store = { get:async key => db.get(key) || null, setJSON:async (key,value) => db.set(key, structuredClone(value)) };
  const payos = {
    paymentRequests:{
      create:async input => { created = input; return {orderCode:input.orderCode, amount:input.amount, paymentLinkId:'provider-link', bin:'970426', accountNumber:'123', accountName:'MYB', description:input.description, checkoutUrl:'https://pay.payos.vn/web/provider-link', qrCode:'mock-qr'}; },
      get:async () => ({id:badId ? 'wrong-link':'provider-link', orderCode:created.orderCode, amount:AMOUNT, amountPaid:paid, amountRemaining:Math.max(0,AMOUNT-paid), status:state})
    },
    webhooks:{verify:async value => { if(value.signature !== 'valid') throw Error('invalid'); return value.data; }}
  };
  const handlers = createHandlers({store, payos, qr:async ()=>'data:image/png;base64,test', now:()=>1791450000000, log:{error(){}},siteURL:'https://stalwart-dragon-988b54.netlify.app'});
  const create = (extra={}) => handlers.orders(new Request('https://stalwart-dragon-988b54.netlify.app/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Test',email:'test@example.com',phone:'0901234567',city:'Ha Noi',...extra})}));
  return {handlers, create, db, created:()=>created, set:(s,p,b=false)=>{state=s;paid=p;badId=b;}};
}

test('create fixes amount server side and callback targets the new site',async()=>{
  const f=fixture(), r=await f.create({amount:1}), order=await r.json();
  assert.equal(r.status,201); assert.equal(order.amount,299000); assert.equal(order.status,'PENDING');
  assert.equal(f.created().amount,299000); assert.match(f.created().returnUrl,/stalwart-dragon-988b54\.netlify\.app\/uu-dai.html\?payment=/);
  assert.equal(order.qrDataUrl,'data:image/png;base64,test'); assert.equal(order.email,undefined);
});
test('only provider confirmed full payment can report paid',async()=>{
  const f=fixture(), o=await(await f.create()).json();
  const get=()=>f.handlers.orders(new Request(`https://stalwart-dragon-988b54.netlify.app/api/orders/${o.publicId}?status=PAID`));
  assert.equal((await(await get()).json()).status,'PENDING');
  f.set('PAID',100); assert.equal((await get()).status,502);
  f.set('PAID',AMOUNT,true); assert.equal((await get()).status,502);
  f.set('PAID',AMOUNT); assert.equal((await(await get()).json()).status,'PAID');
});
test('webhook signature rejected and valid callback independently checked',async()=>{
  const f=fixture(), o=await(await f.create()).json();
  const send=signature=>f.handlers.webhook(new Request('https://example.com/api/payos-webhook',{method:'POST',body:JSON.stringify({signature,data:{orderCode:f.created().orderCode,paymentLinkId:'provider-link'}})}));
  assert.equal((await send('bad')).status,400);
  assert.equal((await send('valid')).status,200); assert.equal(f.db.has(`receipt/${o.publicId}`),false);
  f.set('PAID',AMOUNT); assert.equal((await send('valid')).status,200); assert.equal(f.db.get(`receipt/${o.publicId}`).amount,AMOUNT);
});
test('reject invalid form, cross origin and unknown order',async()=>{
  const f=fixture(); assert.equal((await f.create({email:'bad'})).status,400);
  assert.equal((await f.handlers.orders(new Request('https://example.com/api/orders',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'}))).status,403);
  assert.equal((await f.handlers.orders(new Request('https://example.com/api/orders/00000000-0000-4000-8000-000000000000'))).status,404);
});
