(() => {
  const header = document.querySelector("[data-header]");
  const form = document.querySelector("[data-register-form]");
  const error = document.querySelector("[data-form-error]");
  const success = document.querySelector("[data-form-success]");
  const formConfig = window.MYB_FORM_CONFIG || {};
  const eventTime = new Date("2026-10-15T19:30:00+07:00").getTime();

  const setHeaderState = () => {
    header?.classList.toggle("is-scrolled", window.scrollY > 16);
  };

  setHeaderState();
  window.addEventListener("scroll", setHeaderState, { passive: true });

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    revealItems.forEach((item) => item.classList.add("is-pending"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove("is-pending");
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const pad = (value) => String(value).padStart(2, "0");
  const countdownFields = {
    days: document.querySelector("[data-days]"),
    hours: document.querySelector("[data-hours]"),
    minutes: document.querySelector("[data-minutes]"),
    seconds: document.querySelector("[data-seconds]"),
  };

  const updateCountdown = () => {
    const remaining = Math.max(0, eventTime - Date.now());
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (countdownFields.days) countdownFields.days.textContent = pad(days);
    if (countdownFields.hours) countdownFields.hours.textContent = pad(hours);
    if (countdownFields.minutes) countdownFields.minutes.textContent = pad(minutes);
    if (countdownFields.seconds) countdownFields.seconds.textContent = pad(seconds);
  };

  updateCountdown();
  window.setInterval(updateCountdown, 1000);

  const normalizeName = (value) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toLocaleUpperCase("vi-VN") + word.slice(1).toLocaleLowerCase("vi-VN"))
      .join(" ");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const requiredFields = [...form.querySelectorAll("[required]")];
    requiredFields.forEach((field) => field.classList.remove("is-invalid"));

    const invalid = requiredFields.filter((field) => !field.checkValidity());
    if (invalid.length) {
      invalid.forEach((field) => field.classList.add("is-invalid"));
      error.textContent = "Vui lòng điền đầy đủ họ tên, số điện thoại, email và vai trò.";
      error.classList.add("is-visible");
      invalid[0].focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    data.name = normalizeName(data.name || "");
    data.workshop = "TikTok AI 15/10/2026";
    data.registeredAt = new Date().toISOString();
    data.source = new URLSearchParams(window.location.search).get("nguon") || "website";
    data.pageUrl = window.location.href;
    data.token = formConfig.token || "";

    const endpoint = String(formConfig.endpoint || "").trim();
    if (!endpoint || endpoint.includes("DAN_URL_WEB_APP")) {
      error.textContent = "Form chưa được kết nối Google Sheets. Vui lòng cấu hình URL Web App trong file config.js.";
      error.classList.add("is-visible");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    const originalButtonText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = "Đang gửi thông tin...";

    try {
      await fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        body: JSON.stringify(data),
      });
    } catch (_) {
      error.textContent = "Chưa thể gửi dữ liệu. Vui lòng kiểm tra kết nối mạng và thử lại.";
      error.classList.add("is-visible");
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonText;
      return;
    }

    try {
      localStorage.setItem("myb_ads_workshop_registration", JSON.stringify(data));
    } catch (_) {
      // The confirmation still works when storage is disabled.
    }

    error.classList.remove("is-visible");
    const query = new URLSearchParams({
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      nguon: data.source,
    });
    window.location.href = `uu-dai.html?${query.toString()}`;
  });
})();
