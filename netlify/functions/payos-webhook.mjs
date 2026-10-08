import { handlers, unavailable } from '../lib/runtime.mjs';
export default async request => {
  try { return await handlers().webhook(request); }
  catch { return unavailable(); }
};
