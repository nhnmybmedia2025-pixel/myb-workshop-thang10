const PAYMENT_STORAGE_KEY = "myb_payment_public_id";
const PAID_RECEIPT_STORAGE_KEY = "myb_payment_success";
const DEFAULT_PAID_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nextPollDelay({ failures = 0, hidden = false } = {}) {
  const baseDelay = hidden ? 10000 : 3000;
  return Math.min(30000, baseDelay * 2 ** Math.max(0, failures));
}

export function formatCurrency(amount) {
  return `${new Intl.NumberFormat("vi-VN").format(Number(amount) || 0)}đ`;
}

export function createPollingLifecycle() {
  let generation = 0;
  let activeRequest = null;

  return {
    stop() {
      generation += 1;
      activeRequest?.controller?.abort();
      activeRequest = null;
    },
    isBusy() {
      return activeRequest?.generation === generation;
    },
    async run({ publicId, fetchOrder, isCurrent, onOrder, onMissing, onFailure, onComplete }) {
      const currentGeneration = generation;
      if (activeRequest?.generation === currentGeneration) return false;
      const controller = new AbortController();
      activeRequest = { generation: currentGeneration, controller };
      const ownsRequest = () => generation === currentGeneration && isCurrent(currentGeneration, publicId);
      try {
        const response = await fetchOrder(publicId, controller.signal);
        if (!ownsRequest()) return false;
        if (response.status === 404) {
          onMissing();
          return true;
        }
        if (!response.ok) throw new Error("status request failed");
        onOrder(await response.json());
        return true;
      } catch (_) {
        if (!controller.signal.aborted && ownsRequest()) onFailure();
        return false;
      } finally {
        if (activeRequest?.generation === currentGeneration && activeRequest.controller === controller) activeRequest = null;
        if (ownsRequest()) onComplete();
      }
    }
  };
}

export function deriveCheckoutView(order, now = Date.now()) {
  if (order.status === "CREATING") return { state: "creating", showQr: false, canRetry: false, terminal: false, message: "Đang tạo đơn..." };
  if (order.status === "PENDING") {
    const expiresAt = Date.parse(order.expiresAt || "");
    if (Number.isFinite(expiresAt) && now >= expiresAt) return { state: "expired", showQr: false, canRetry: true, terminal: true, message: "Đơn đã hết hạn" };
    return { state: "pending", showQr: true, canRetry: false, terminal: false, message: "Đang chờ thanh toán" };
  }
  if (order.status === "EXPIRED") return { state: "expired", showQr: false, canRetry: true, terminal: true, message: "Đơn đã hết hạn" };
  if (order.status === "PAID") return { state: "paid", showQr: false, canRetry: false, terminal: true, message: "Đã nhận 299.000đ — Thanh toán thành công" };
  if (order.status === "FAILED") return { state: "error", showQr: false, canRetry: true, terminal: true, message: "Không thể tạo đơn. Vui lòng thử lại." };
  if (order.status === "CANCELLED") return { state: "cancelled", showQr: false, canRetry: true, terminal: true, message: "Đơn đã được hủy" };
  return { state: "error", showQr: false, canRetry: true, terminal: true, message: "Không thể tải trạng thái đơn hàng. Vui lòng thử lại." };
}

if (typeof document !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const form = document.querySelector("[data-checkout]");
  const error = form?.querySelector(".err");
  const submitButton = form?.querySelector(".pay-submit");
  const panel = document.querySelector("[data-payment-panel]");
  const status = document.querySelector("[data-payment-status]");
  const qr = document.querySelector("[data-payment-qr]");
  const account = document.querySelector("[data-payment-account]");
  const accountHolder = document.querySelector("[data-payment-account-holder]");
  const bank = document.querySelector("[data-payment-bank]");
  const amount = document.querySelector("[data-payment-amount]");
  const description = document.querySelector("[data-payment-description]");
  const copyFeedback = document.querySelector("[data-payment-copy-feedback]");
  const countdown = document.querySelector("[data-payment-countdown]");
  const checkoutUrl = document.querySelector("[data-checkout-url]");
  const paidPanel = document.querySelector("[data-payment-paid]");
  const paidZaloButton = document.querySelector("[data-payment-zalo]");
  const paidNewOrderButton = document.querySelector("[data-payment-new-order]");
  const retryPanel = document.querySelector("[data-payment-retry]");
  const retryError = document.querySelector("[data-payment-error]");
  const retryButton = document.querySelector("[data-payment-retry-button]");
  const originalButtonText = submitButton?.textContent || "Tạo đơn hàng 299.000đ";
  let activeOrder = null;
  let activePublicId = null;
  let pollTimer = null;
  let countdownTimer = null;
  let paidRedirectTimer = null;
  let submitting = false;
  const polling = createPollingLifecycle();
  let failures = 0;

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} },
    remove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  };
  const registration = (() => { try { return JSON.parse(storage.get("myb_ads_workshop_registration") || "{}"); } catch (_) { return {}; } })();
  const initial = { name: params.get("name") || registration.name || "", email: params.get("email") || registration.email || "", phone: params.get("phone") || registration.phone || "" };
  document.querySelectorAll("[data-customer-name]").forEach((node) => { node.textContent = initial.name; node.hidden = !initial.name; });
  Object.entries(initial).forEach(([key, value]) => { const input = form?.elements.namedItem(key); if (input && value) input.value = value; });

  const pad = (value) => String(value).padStart(2, "0");
  const scrollTo = (node) => node?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  const clearTimers = () => {
    window.clearTimeout(pollTimer);
    window.clearInterval(countdownTimer);
    window.clearTimeout(paidRedirectTimer);
    pollTimer = null;
    countdownTimer = null;
    paidRedirectTimer = null;
  };
  const stopPolling = () => { clearTimers(); polling.stop(); };
  const showFormError = (message) => { if (error) { error.textContent = message; error.classList.add("show"); } };
  const clearFormError = () => { if (error) { error.textContent = ""; error.classList.remove("show"); } };
  const resetPanels = () => {
    panel.hidden = true; paidPanel.hidden = true; retryPanel.hidden = true;
    qr.hidden = true; qr.removeAttribute("src");
    checkoutUrl.hidden = true; checkoutUrl.removeAttribute("href");
  };
  const updateCountdown = () => {
    if (!activeOrder || !countdown) return;
    const expiry = Date.parse(activeOrder.expiresAt || "");
    const remaining = Number.isFinite(expiry) ? Math.max(0, expiry - Date.now()) : 0;
    countdown.textContent = `${pad(Math.floor(remaining / 60000))}:${pad(Math.floor((remaining % 60000) / 1000))}`;
    if (remaining === 0 && deriveCheckoutView(activeOrder).state === "expired") renderOrder(activeOrder, "local-expiry");
  };
  const startCountdown = () => { window.clearInterval(countdownTimer); updateCountdown(); if (!deriveCheckoutView(activeOrder).terminal) countdownTimer = window.setInterval(updateCountdown, 1000); };
  const paidDestination = () => {
    const url = window.MYB_PAYMENT_CONFIG?.successRedirectUrl;
    return typeof url === "string" && url.trim() ? url.trim() : "https://zalo.me/g/mixgjjhbqo0ge0t9lhud";
  };
  const paidReceiptRetentionMs = () => {
    const configured = Number(window.MYB_PAYMENT_CONFIG?.paidReceiptRetentionMs);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PAID_RECEIPT_RETENTION_MS;
  };
  const savePaidReceipt = () => {
    if (!UUID_PATTERN.test(activePublicId || "")) return;
    const recordedAt = Date.now();
    storage.set(PAID_RECEIPT_STORAGE_KEY, JSON.stringify({
      publicId: activePublicId,
      recordedAt,
      expiresAt: recordedAt + paidReceiptRetentionMs()
    }));
    storage.remove(PAYMENT_STORAGE_KEY);
    activePublicId = null;
  };
  const savedPaidReceipt = () => {
    try {
      const rawReceipt = storage.get(PAID_RECEIPT_STORAGE_KEY);
      if (!rawReceipt) return null;
      const receipt = JSON.parse(rawReceipt);
      if (!receipt || !UUID_PATTERN.test(receipt.publicId || "") || !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= Date.now()) throw new Error("expired receipt");
      return receipt;
    } catch (_) {
      storage.remove(PAID_RECEIPT_STORAGE_KEY);
      return null;
    }
  };
  const schedulePaidRedirect = () => {
    if (paidRedirectTimer !== null) return;
    const configuredDelay = Number(window.MYB_PAYMENT_CONFIG?.successRedirectDelayMs);
    const delay = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : 3000;
    paidRedirectTimer = window.setTimeout(() => { window.location.assign(paidDestination()); }, delay);
  };
  const renderOrder = (order, source) => {
    activeOrder = order;
    const view = deriveCheckoutView(order);
    const isVerifiedPaid = view.state === "paid" && source === "status";
    const isRestoredPaid = view.state === "paid" && source === "paid-receipt";
    const showPaid = isVerifiedPaid || isRestoredPaid;
    form.hidden = true;
    if (source === "restore" && submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Đang tải đơn...";
    }
    panel.hidden = view.terminal || showPaid;
    paidPanel.hidden = !showPaid;
    retryPanel.hidden = !view.canRetry;
    status.textContent = view.message;
    retryError.textContent = view.canRetry ? view.message : "";
    qr.hidden = !view.showQr;
    if (view.showQr && order.qrDataUrl) qr.src = order.qrDataUrl; else qr.removeAttribute("src");
    account.textContent = order.accountNumber || "";
    accountHolder.textContent = order.accountName || "";
    const bankNames = { "970426": "MSB", "970422": "MB Bank", "970432": "VPBank" };
    bank.textContent = order.bin ? `${bankNames[order.bin] || "Ngân hàng nhận"} · BIN ${order.bin}` : "Ngân hàng nhận";
    amount.textContent = formatCurrency(order.amount);
    description.textContent = order.description || "";
    checkoutUrl.hidden = !order.checkoutUrl;
    if (order.checkoutUrl) checkoutUrl.href = order.checkoutUrl; else checkoutUrl.removeAttribute("href");
    if (view.terminal) { stopPolling(); countdown.textContent = "00:00"; }
    else startCountdown();
    if (showPaid) {
      if (paidZaloButton) paidZaloButton.href = paidDestination();
      paidPanel.focus({ preventScroll: true });
      scrollTo(paidPanel);
    }
    if (isVerifiedPaid) {
      savePaidReceipt();
      schedulePaidRedirect();
    }
  };
  const resetPayment = () => {
    stopPolling(); storage.remove(PAYMENT_STORAGE_KEY); storage.remove(PAID_RECEIPT_STORAGE_KEY); activeOrder = null; activePublicId = null; failures = 0;
    resetPanels(); form.hidden = false; submitButton.disabled = false; submitButton.textContent = originalButtonText; clearFormError();
  };
  const schedulePoll = () => {
    if (!activePublicId || deriveCheckoutView(activeOrder || { status: "FAILED" }).terminal) return;
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => { void pollOrder(); }, nextPollDelay({ failures, hidden: document.hidden }));
  };
  const pollOrder = async () => {
    if (!activePublicId || polling.isBusy() || deriveCheckoutView(activeOrder || { status: "FAILED" }).terminal) return;
    await polling.run({
      publicId: activePublicId,
      fetchOrder: (publicId, signal) => fetch(`/api/orders/${encodeURIComponent(publicId)}`, { cache: "no-store", headers: { Accept: "application/json" }, signal }),
      isCurrent: (_generation, publicId) => publicId === activePublicId,
      onMissing: () => { resetPayment(); showFormError("Không tìm thấy đơn hàng trước đó. Vui lòng tạo đơn mới."); },
      onOrder: (order) => { failures = 0; renderOrder(order, "status"); },
      onFailure: () => { failures += 1; },
      onComplete: () => {
        if (!deriveCheckoutView(activeOrder || { status: "FAILED" }).terminal) schedulePoll();
      }
    });
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || form.hidden) return;
    clearFormError();
    if (!form.checkValidity()) { showFormError("Vui lòng điền họ tên, email, số điện thoại và tỉnh thành."); form.reportValidity(); return; }
    const fields = Object.fromEntries(new FormData(form).entries());
    submitting = true;
    submitButton.disabled = true; submitButton.textContent = "Đang tạo đơn...";
    try {
      const response = await fetch("/api/orders", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name: fields.name, email: fields.email, phone: fields.phone, city: fields.city }) });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || "Không tạo được đơn thanh toán.");
      if (!UUID_PATTERN.test(order.publicId || "")) throw new Error("missing public order id");
      activePublicId = order.publicId;
      storage.set(PAYMENT_STORAGE_KEY, activePublicId);
      // A create response starts the flow; only a later backend GET may display paid UI.
      renderOrder(order.status === "PAID" ? { ...order, status: "CREATING" } : order, "create");
      void pollOrder();
    } catch (checkoutError) {
      submitButton.disabled = false; submitButton.textContent = originalButtonText; form.hidden = false;
      showFormError(checkoutError.message || "Hệ thống thanh toán MYB hiện chưa phản hồi. Vui lòng liên hệ Zalo 0929.186.866.");
    } finally {
      submitting = false;
    }
  });
  retryButton?.addEventListener("click", () => { resetPayment(); form.querySelector("input, select")?.focus(); scrollTo(form); });
  paidNewOrderButton?.addEventListener("click", () => { resetPayment(); form.querySelector("input, select")?.focus(); scrollTo(form); });
  paidZaloButton?.addEventListener("click", () => { storage.remove(PAID_RECEIPT_STORAGE_KEY); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && activePublicId && !polling.isBusy()) { window.clearTimeout(pollTimer); void pollOrder(); } });
  document.querySelectorAll("[data-copy-payment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const values = { account: account?.textContent, amount: String(activeOrder?.amount ?? ""), description: description?.textContent };
      const value = values[button.dataset.copyPayment] || "";
      if (!value) { copyFeedback.textContent = "Chưa có dữ liệu để sao chép."; return; }
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(value);
        copyFeedback.textContent = "Đã sao chép.";
      } catch (_) {
        copyFeedback.textContent = "Không thể sao chép tự động. Hãy chọn và sao chép thủ công.";
      }
    });
  });
  window.addEventListener("pagehide", stopPolling, { once: true });
  const receipt = savedPaidReceipt();
  const callbackId = params.get("payment");
  const savedPublicId = UUID_PATTERN.test(callbackId || "") ? callbackId : receipt?.publicId || storage.get(PAYMENT_STORAGE_KEY);
  if (savedPublicId) {
    if (UUID_PATTERN.test(savedPublicId)) {
      activePublicId = savedPublicId;
      renderOrder({ status: "CREATING" }, "restore");
      void pollOrder();
    }
    else storage.remove(PAYMENT_STORAGE_KEY);
  }
}
