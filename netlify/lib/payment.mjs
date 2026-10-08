import { randomUUID, randomInt } from 'node:crypto';

export const AMOUNT = 299000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function verifiedStatus(record, payment) {
  if (Number(payment.orderCode) !== record.orderCode || Number(payment.amount) !== AMOUNT || payment.id !== record.paymentLinkId) throw new Error('Payment identity mismatch');
  if (payment.status === 'PAID') {
    if (Number(payment.amountPaid) < AMOUNT || Number(payment.amountRemaining) !== 0) throw new Error('Payment amount mismatch');
    return 'PAID';
  }
  return ['PENDING', 'CANCELLED', 'EXPIRED'].includes(payment.status) ? payment.status : 'PENDING';
}

export function createHandlers({ store, payos, qr, now = Date.now, siteURL, log = console }) {
  const read = id => store.get(`order/${id}`, { type: 'json' });
  const visible = record => Object.fromEntries(['publicId','status','expiresAt','qrDataUrl','accountNumber','accountName','bin','amount','description','checkoutUrl'].map(key => [key, record[key]]));
  const refresh = async record => {
    const payment = await payos.paymentRequests.get(record.paymentLinkId);
    const status = verifiedStatus(record, payment);
    // Canonical provider GET is always the authority; no browser query can mark paid.
    return { ...record, status: status === 'PENDING' && now() >= Date.parse(record.expiresAt) ? 'EXPIRED' : status };
  };
  return {
    async orders(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace('/.netlify/functions/orders', '/api/orders');
      const id = path.match(/^\/api\/orders\/([^/]+)$/)?.[1];
      if (request.method === 'GET' && id) {
        if (!uuid.test(id)) return response({ error: 'Đơn hàng không hợp lệ.' }, 400);
        try {
          const record = await read(id);
          if (!record || !record.paymentLinkId) return response({ error: 'Không tìm thấy đơn hàng.' }, 404);
          return response(visible(await refresh(record)));
        } catch (error) { log.error('payOS status failed', error.name); return response({ error: 'Chưa kiểm tra được thanh toán. Vui lòng thử lại.' }, 502); }
      }
      if (path !== '/api/orders' || request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
      // Accept browser requests only from the deployed site, without enabling CORS.
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return response({ error: 'Nguồn yêu cầu không hợp lệ.' }, 403);
      if (!request.headers.get('content-type')?.includes('application/json')) return response({ error: 'Dữ liệu không hợp lệ.' }, 415);
      if (Number(request.headers.get('content-length') || 0) > 8192) return response({ error: 'Dữ liệu quá lớn.' }, 413);
      let data;
      try { const body = await request.text(); if (body.length > 8192) return response({error:'Dữ liệu quá lớn.'},413); data = JSON.parse(body); }
      catch { return response({ error: 'Dữ liệu không hợp lệ.' }, 400); }
      const name = text(data?.name), email = text(data?.email), phone = text(data?.phone, 25), city = text(data?.city);
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d ().-]{8,25}$/.test(phone) || !city) return response({ error: 'Vui lòng điền đủ thông tin đăng ký.' }, 400);
      const publicId = randomUUID();
      const orderCode = now() * 1000 + randomInt(1000);
      const expiredAt = Math.floor(now() / 1000) + 30 * 60;
      const record = { publicId, orderCode, amount: AMOUNT, status: 'CREATING', expiresAt: new Date(expiredAt * 1000).toISOString() };
      try {
        // Persist before creating a provider order so callbacks can be matched.
        await store.setJSON(`order/${publicId}`, record);
        await store.setJSON(`code/${orderCode}`, { publicId });
        const callback = new URL('/uu-dai.html', siteURL || url.origin);
        callback.searchParams.set('payment', publicId);
        const link = await payos.paymentRequests.create({ orderCode, amount: AMOUNT, description: `MYB T10 ${String(orderCode).slice(-10)}`, buyerName: name, buyerEmail: email, buyerPhone: phone, buyerAddress: city, items: [{name:'Bo tai nguyen TikTok AI', quantity:1, price:AMOUNT}], returnUrl:callback.href, cancelUrl:callback.href, expiredAt });
        const checkout = new URL(link.checkoutUrl);
        if (Number(link.orderCode) !== orderCode || Number(link.amount) !== AMOUNT || !link.paymentLinkId || checkout.protocol !== 'https:' || checkout.hostname !== 'pay.payos.vn') throw new Error('Invalid payment link');
        const complete = { ...record, status:'PENDING', paymentLinkId:link.paymentLinkId, bin:link.bin, accountNumber:link.accountNumber, accountName:link.accountName, description:link.description, checkoutUrl:link.checkoutUrl, qrDataUrl:await qr(link.qrCode) };
        await store.setJSON(`order/${publicId}`, complete);
        return response(visible(complete), 201);
      } catch (error) { log.error('payOS create failed', error.name); return response({ error: 'Không tạo được thanh toán. Vui lòng thử lại hoặc liên hệ Zalo 0929.186.866.' }, 502); }
    },
    async webhook(request) {
      if (request.method !== 'POST') return response({ error:'Method not allowed' },405);
      let event;
      try {
        const body = await request.text();
        if (body.length > 16384) return response({error:'Payload too large'},413);
        event = await payos.webhooks.verify(JSON.parse(body));
      } catch { return response({error:'Invalid signature'},400); }
      try {
        const index = await store.get(`code/${event.orderCode}`, {type:'json'});
        // A signed payOS confirmation/test or another site's order needs no mutation.
        if (!index) return response({ok:true, ignored:true});
        const record = await read(index.publicId);
        if (!record?.paymentLinkId) return response({error:'Order not ready'},503);
        if (event.paymentLinkId !== record.paymentLinkId) return response({error:'Order mismatch'},400);
        const verified = await refresh(record);
        // Separate immutable receipt prevents pending readers overwriting a paid state.
        if (verified.status === 'PAID') await store.setJSON(`receipt/${record.publicId}`, {publicId:record.publicId, amount:AMOUNT, verifiedAt:new Date(now()).toISOString()});
        return response({ok:true});
      } catch(error) { log.error('payOS webhook failed',error.name); return response({error:'Payment verification unavailable'},503); }
    }
  };
}
