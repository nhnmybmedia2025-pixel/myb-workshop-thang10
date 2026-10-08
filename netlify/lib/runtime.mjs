import { PayOS } from '@payos/node';
import { getStore } from '@netlify/blobs';
import QRCode from 'qrcode';
import { createHandlers } from './payment.mjs';

export function handlers() {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) throw new Error('PAYOS_CONFIG_MISSING');
  return createHandlers({
    store: getStore({name:'myb-payos-october-v1', consistency:'strong'}),
    payos: new PayOS({clientId, apiKey, checksumKey, timeout:10000, maxRetries:0, logLevel:'off'}),
    qr: value => QRCode.toDataURL(value, {width:360, margin:2, errorCorrectionLevel:'M'}),
    siteURL: process.env.SITE_URL || process.env.URL
  });
}

export function unavailable() {
  return Response.json({error:'Chưa cấu hình đủ PAYOS_CLIENT_ID, PAYOS_API_KEY và PAYOS_CHECKSUM_KEY trên Netlify.'}, {status:503, headers:{'Cache-Control':'no-store'}});
}
