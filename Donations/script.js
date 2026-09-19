/* ============================================================
   Durga Mahadev Sthan - Donation Portal
   Supabase-backed frontend.

   Supabase project values are kept in assets/js/config.js.
   The donor portal talks to the donor-api Edge Function so
   donor data and private payment proofs are never exposed
   directly to the public browser role.
   ============================================================ */

const APP_CONFIG = {
  maxProofSizeBytes: 5 * 1024 * 1024,
  allowedProofTypes: ["image/jpeg", "image/png"],
  templeName: "Durga Mahadev Sthan",
  templeLocation: "Hulas"
};

const DMS_FUNCTION_NAME = "donor-api";
let DMS_SUPABASE_CONFIG_PROMISE = null;

async function loadDmsConfig() {
  if (window.DMS_SUPABASE_CONFIG) return window.DMS_SUPABASE_CONFIG;
  if (!DMS_SUPABASE_CONFIG_PROMISE) {
    DMS_SUPABASE_CONFIG_PROMISE = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("assets/js/config.js", document.baseURI).href;
      script.onload = () => {
        if (window.DMS_SUPABASE_CONFIG) resolve(window.DMS_SUPABASE_CONFIG);
        else reject(new Error("Supabase configuration is missing."));
      };
      script.onerror = () => reject(new Error("Unable to load assets/js/config.js."));
      document.head.appendChild(script);
    });
  }
  return DMS_SUPABASE_CONFIG_PROMISE;
}

const SUPABASE_CONFIGURED = true;
/* ---------- Existing navigation ---------- */
const mobileNav = document.querySelector(".mobile-navbar-btn");
const navHeader = document.querySelector(".header");

function toggleNavbar() {
  if (!navHeader) return;
  navHeader.classList.toggle("active");
  if (mobileNav) mobileNav.setAttribute("aria-expanded", navHeader.classList.contains("active") ? "true" : "false");
}

if (mobileNav) {
  mobileNav.addEventListener("click", toggleNavbar);
  mobileNav.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleNavbar();
    }
  });
}

document.querySelectorAll(".navbar-link").forEach((link) => {
  link.addEventListener("click", () => {
    if (navHeader) navHeader.classList.remove("active");
    if (mobileNav) mobileNav.setAttribute("aria-expanded", "false");
  });
});

/* ---------- Reveal-on-scroll ---------- */
const revealEls = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach((el) => observer.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("is-visible"));
}

/* ---------- Scroll-to-top ---------- */
const topBtn = document.querySelector(".top");
window.addEventListener("scroll", () => {
  if (topBtn) topBtn.classList.toggle("is-visible", window.scrollY > 400);
});

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ============================================================
   Donor Portal State
   ============================================================ */
const portalOverlay = document.getElementById("portal-overlay");
const portalCloseBtn = document.getElementById("portal-close-btn");
const portalAlert = document.getElementById("portal-alert");
const views = {
  login: document.getElementById("login-view"),
  register: document.getElementById("register-view"),
  dashboard: document.getElementById("dashboard-view"),
  donation: document.getElementById("donation-view"),
  receipt: document.getElementById("receipt-view")
};

let currentDonor = null;
let currentDonation = null;
let donorSessionToken = sessionStorage.getItem("DMS_DONOR_SESSION") || "";

function showAlert(message = "", type = "") {
  if (!portalAlert) return;
  portalAlert.textContent = message;
  portalAlert.className = "portal-alert";
  if (message) portalAlert.classList.add(`is-${type || "info"}`);
}

function openPortal(viewName = "login") {
  if (!portalOverlay) return;
  portalOverlay.classList.add("is-open");
  portalOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  showView(viewName);

  const focusTarget = views[viewName]?.querySelector("input, select, textarea, button");
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 50);
}

function closePortal() {
  if (!portalOverlay) return;
  portalOverlay.classList.remove("is-open");
  portalOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  showAlert("");
}

function showView(viewName) {
  Object.entries(views).forEach(([name, el]) => {
    if (el) el.hidden = name !== viewName;
  });
  showAlert("");
  const modal = document.querySelector(".portal-modal");
  if (modal) modal.scrollTop = 0;
}

function handleViewSwitch(event) {
  const target = event.currentTarget.dataset.switchView;
  if (!target) return;
  if (target === "dashboard" && !currentDonor) {
    showView("login");
    return;
  }
  showView(target);
}

document.getElementById("open-login-btn")?.addEventListener("click", () => openPortal("login"));
document.getElementById("open-register-btn")?.addEventListener("click", () => openPortal("register"));
portalCloseBtn?.addEventListener("click", closePortal);
portalOverlay?.addEventListener("click", (event) => {
  if (event.target === portalOverlay) closePortal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && portalOverlay?.classList.contains("is-open")) closePortal();
});
document.querySelectorAll("[data-switch-view]").forEach((button) => {
  button.addEventListener("click", handleViewSwitch);
});

/* ============================================================
   Helpers
   ============================================================ */
function digitsOnly(value, maxLength) {
  return String(value || "").replace(/\D/g, "").slice(0, maxLength);
}

function normalizeMobile(value) {
  return digitsOnly(value, 10);
}

function formatIndianCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validDateParts(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);

  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return false;
  if (m < 1 || m > 12 || d < 1 || y < 1900) return false;

  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) return false;
  return true;
}

function dobGroupValue(prefix) {
  const day = digitsOnly(document.getElementById(`${prefix}-dob-day`)?.value, 2);
  const month = digitsOnly(document.getElementById(`${prefix}-dob-month`)?.value, 2);
  const year = digitsOnly(document.getElementById(`${prefix}-dob-year`)?.value, 4);

  return { day, month, year };
}

function formatDOB(group) {
  if (!group?.day || !group?.month || !group?.year) return "";
  return `${String(group.day).padStart(2, "0")}-${String(group.month).padStart(2, "0")}-${group.year}`;
}

function dobToISO(group) {
  if (!validDateParts(group.day, group.month, group.year)) return "";
  return `${group.year}-${String(group.month).padStart(2, "0")}-${String(group.day).padStart(2, "0")}`;
}

function setDOBGroup(prefix, isoDate) {
  if (!isoDate) return;
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return;
  document.getElementById(`${prefix}-dob-day`).value = String(date.getDate()).padStart(2, "0");
  document.getElementById(`${prefix}-dob-month`).value = String(date.getMonth() + 1).padStart(2, "0");
  document.getElementById(`${prefix}-dob-year`).value = String(date.getFullYear());
}

function validateDOB(prefix) {
  const parts = dobGroupValue(prefix);
  return validDateParts(parts.day, parts.month, parts.year) ? formatDOB(parts) : "";
}

function setButtonBusy(button, busy, busyText = "Please wait...") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function assertBackendConfigured() { return true; }

/* ============================================================
   DOB controls - DD - MM - YYYY + calendar picker
   ============================================================ */
function wireDOBGroup(prefix) {
  const fields = [
    document.getElementById(`${prefix}-dob-day`),
    document.getElementById(`${prefix}-dob-month`),
    document.getElementById(`${prefix}-dob-year`)
  ];

  fields.forEach((field, index) => {
    if (!field) return;
    field.addEventListener("input", () => {
      field.value = digitsOnly(field.value, index === 2 ? 4 : 2);
      const max = index === 2 ? 4 : 2;
      if (field.value.length >= max && fields[index + 1]) fields[index + 1].focus();
    });
  });

  const calendarBtn = document.querySelector(`[data-calendar-target="${prefix}"]`);
  const picker = document.getElementById(`${prefix}-dob-picker`);
  calendarBtn?.addEventListener("click", () => {
    if (!picker) return;
    const current = dobGroupValue(prefix);
    const iso = dobToISO(current);
    if (iso) picker.value = iso;
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  });

  picker?.addEventListener("change", () => {
    setDOBGroup(prefix, picker.value);
  });
}

wireDOBGroup("login");
wireDOBGroup("register");

/* ---------- Mobile input hardening ---------- */
["login-mobile", "register-mobile"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", (event) => {
    event.target.value = normalizeMobile(event.target.value);
  });
});

/* ============================================================
   Supabase Edge Function bridge
   ============================================================ */
async function callBackend(action, payload = {}) {
  const config = await loadDmsConfig();
  const supabaseUrl = String(config?.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = String(config?.supabasePublishableKey || "");
  const functionName = String(config?.donorFunctionName || DMS_FUNCTION_NAME);

  if (!supabaseUrl || !publishableKey || publishableKey.startsWith("YOUR_")) {
    showAlert("Online donation backend is not configured. Update assets/js/config.js with your Supabase project URL and publishable/anon key.", "error");
    throw new Error("BACKEND_NOT_CONFIGURED");
  }

  const endpoint = `${supabaseUrl}/functions/v1/${functionName}`;
  const proofFile = payload?.proof?.file instanceof File ? payload.proof.file : null;
  let response;

  if (proofFile) {
    const form = new FormData();
    form.append("action", action);
    Object.entries(payload).forEach(([key, value]) => {
      if (key === "proof") return;
      form.append(key, value == null ? "" : String(value));
    });
    form.append("proof", proofFile, proofFile.name);
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`
      },
      body: form
    });
  } else {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...payload })
    });
  }

  const responseText = await response.text();
  let result = null;
  try { result = responseText ? JSON.parse(responseText) : null; }
  catch (_) { throw new Error("Donation backend returned an invalid response."); }

  if (!response.ok || !result?.success) {
    throw new Error(result?.message || `Backend HTTP ${response.status}`);
  }
  return result.data;
}

/* ============================================================
   Registration
   ============================================================ */
document.getElementById("register-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAlert("");

  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const fullName = document.getElementById("register-name")?.value.trim();
  const fatherName = document.getElementById("register-father")?.value.trim();
  const mobile = normalizeMobile(document.getElementById("register-mobile")?.value);
  const dob = validateDOB("register");
  const parts = dobGroupValue("register");
  const address = document.getElementById("register-address")?.value.trim();
  const city = document.getElementById("register-city")?.value.trim();
  const state = document.getElementById("register-state")?.value;
  const confirm = document.getElementById("register-confirm")?.checked;

  if (!fullName || !fatherName || mobile.length !== 10 || !dob || !validDateParts(parts.day, parts.month, parts.year) || !address || !city || !state || !confirm) {
    showAlert("Please complete all required fields with valid information before registering.", "error");
    return;
  }

  setButtonBusy(button, true, "Registering...");
  try {
    const data = await callBackend("registerDonor", {
      mobile,
      fullName,
      fatherName,
      dob,
      address,
      city,
      state
    });

    currentDonor = data?.donor || data;
    showAlert("Registration successful. You can now login to your donor account.", "success");

    // Clear form and switch to login after a short pause.
    form.reset();
    ["register-dob-day", "register-dob-month", "register-dob-year"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    window.setTimeout(() => showView("login"), 900);
  } catch (error) {
    if (error.message !== "BACKEND_NOT_CONFIGURED") {
      showAlert(error.message || "Registration failed. Please try again.", "error");
    }
  } finally {
    setButtonBusy(button, false);
  }
});

/* ============================================================
   Login
   ============================================================ */
document.getElementById("login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAlert("");

  const button = event.currentTarget.querySelector("button[type=submit]");
  const mobile = normalizeMobile(document.getElementById("login-mobile")?.value);
  const dob = validateDOB("login");

  if (mobile.length !== 10) {
    showAlert("Please enter a valid 10-digit mobile number.", "error");
    return;
  }
  if (!dob) {
    showAlert("Please enter a valid date of birth in DD - MM - YYYY format.", "error");
    return;
  }

  setButtonBusy(button, true, "Logging in...");
  try {
    const data = await callBackend("loginDonor", { mobile, dob });
    donorSessionToken = String(data?.token || "");
    if (donorSessionToken) sessionStorage.setItem("DMS_DONOR_SESSION", donorSessionToken);
    currentDonor = data?.donor || data;
    populateDashboard(data);
    showView("dashboard");
  } catch (error) {
    if (error.message !== "BACKEND_NOT_CONFIGURED") {
      showAlert(error.message || "Login failed. Please check your mobile number and date of birth.", "error");
    }
  } finally {
    setButtonBusy(button, false);
  }
});

/* ============================================================
   Dashboard
   ============================================================ */
function normalizeDonationList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.donations)) return data.donations;
  return [];
}

function populateDashboard(data) {
  const donor = data?.donor || currentDonor || {};
  const donations = normalizeDonationList(data);
  currentDonor = donor;

  const welcomeName = document.getElementById("dashboard-welcome");
  if (welcomeName) welcomeName.textContent = `Welcome, ${donor.fullName || donor.name || "Donor"}`;

  const profileGrid = document.getElementById("profile-grid");
  if (profileGrid) {
    const rows = [
      ["Full Name", donor.fullName || donor.name],
      ["Father's Name", donor.fatherName],
      ["Mobile Number", donor.mobile],
      ["Date of Birth", donor.dob],
      ["Village / Complete Address", donor.address],
      ["Current City", donor.city],
      ["State", donor.state]
    ];
    profileGrid.innerHTML = rows.map(([label, value]) => `
      <div class="profile-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || "—")}</strong>
      </div>
    `).join("");
  }

  renderDonationHistory(donations);
}

function renderDonationHistory(donations) {
  const history = document.getElementById("donation-history");
  if (!history) return;

  let verifiedTotal = 0;
  let pendingTotal = 0;
  let submittedTotal = 0;

  if (!donations.length) {
    history.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <h5>No donations recorded yet</h5>
        <p>Your donation history will appear here after your first online donation.</p>
        <button type="button" class="small-action-btn" id="empty-make-donation-btn">＋ Make Your First Donation</button>
      </div>`;
    document.getElementById("empty-make-donation-btn")?.addEventListener("click", () => showView("donation"));
  } else {
    const sorted = [...donations].sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    history.innerHTML = sorted.map((item, index) => {
      const amount = Number(item.amount || 0);
      const status = String(item.status || item.verificationStatus || "Pending");
      const isVerified = status.toLowerCase() === "verified";
      const isPending = status.toLowerCase() === "pending";

      submittedTotal += amount;
      if (isVerified) verifiedTotal += amount;
      if (isPending) pendingTotal += amount;

      return `
        <article class="donation-history-item">
          <div class="history-main">
            <div class="history-year-badge">${escapeHtml(item.year || "—")}</div>
            <div>
              <h5>Durga Puja ${escapeHtml(item.year || "")}</h5>
              <p>${escapeHtml(item.paymentApp || item.app || "Payment app not specified")} · UPI ${escapeHtml(item.upiTransactionId || item.transactionId || "—")}</p>
            </div>
          </div>
          <div class="history-right">
            <strong>${formatIndianCurrency(amount)}</strong>
            <span class="status-badge ${isVerified ? "verified" : "pending"}">${isVerified ? "✅ Verified" : "⏳ Pending"}</span>
            <button type="button" class="receipt-link" data-receipt-index="${index}">View Receipt</button>
          </div>
        </article>`;
    }).join("");

    history.querySelectorAll("[data-receipt-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.receiptIndex);
        openReceipt(sorted[index]);
      });
    });
  }

  document.getElementById("verified-total").textContent = formatIndianCurrency(verifiedTotal);
  document.getElementById("pending-total").textContent = formatIndianCurrency(pendingTotal);
  document.getElementById("submitted-total").textContent = formatIndianCurrency(submittedTotal);
}

document.getElementById("open-donation-form-btn")?.addEventListener("click", () => showView("donation"));
document.getElementById("logout-btn")?.addEventListener("click", async () => {
  try {
    if (donorSessionToken && currentDonor?.mobile && SUPABASE_CONFIGURED) {
      await callBackend("logout", { token: donorSessionToken, mobile: currentDonor.mobile });
    }
  } catch (error) {
    console.warn(error);
  } finally {
    currentDonor = null;
    currentDonation = null;
    donorSessionToken = "";
    sessionStorage.removeItem("DMS_DONOR_SESSION");
    document.getElementById("login-form")?.reset();
    ["login-dob-day", "login-dob-month", "login-dob-year"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    showView("login");
    showAlert("You have been logged out.", "success");
  }
});

/* ============================================================
   Donation Form
   ============================================================ */
document.getElementById("donation-app")?.addEventListener("change", (event) => {
  const otherField = document.getElementById("other-app-field");
  const otherInput = document.getElementById("donation-other-app");
  const show = event.target.value === "Other";
  if (otherField) otherField.hidden = !show;
  if (otherInput) otherInput.required = show;
  if (!show && otherInput) otherInput.value = "";
});

document.getElementById("donation-proof")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  const nameEl = document.getElementById("donation-proof-name");
  if (nameEl) nameEl.textContent = file ? file.name : "No file selected";

  if (!file) return;
  if (!APP_CONFIG.allowedProofTypes.includes(file.type)) {
    showAlert("Please upload a JPG, JPEG or PNG payment screenshot.", "error");
    event.target.value = "";
    if (nameEl) nameEl.textContent = "No file selected";
    return;
  }
  if (file.size > APP_CONFIG.maxProofSizeBytes) {
    showAlert("Payment screenshot must be 5 MB or smaller.", "error");
    event.target.value = "";
    if (nameEl) nameEl.textContent = "No file selected";
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("donation-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAlert("");

  if (!currentDonor?.mobile) {
    showView("login");
    showAlert("Please login before submitting a donation.", "error");
    return;
  }

  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const amount = Number(document.getElementById("donation-amount")?.value);
  const txnId = document.getElementById("donation-txn")?.value.trim();
  const paymentApp = document.getElementById("donation-app")?.value;
  const otherApp = document.getElementById("donation-other-app")?.value.trim();
  const proof = document.getElementById("donation-proof")?.files?.[0];

  if (!Number.isFinite(amount) || amount <= 0) {
    showAlert("Please enter a valid donation amount.", "error");
    return;
  }
  if (!txnId) {
    showAlert("Please enter the UPI Transaction ID.", "error");
    return;
  }
  if (!paymentApp) {
    showAlert("Please select the payment app.", "error");
    return;
  }
  if (paymentApp === "Other" && !otherApp) {
    showAlert("Please enter the name of the payment app.", "error");
    return;
  }
  if (!proof) {
    showAlert("Please upload the payment screenshot/proof.", "error");
    return;
  }
  if (!APP_CONFIG.allowedProofTypes.includes(proof.type) || proof.size > APP_CONFIG.maxProofSizeBytes) {
    showAlert("Please upload a JPG, JPEG or PNG file up to 5 MB.", "error");
    return;
  }

  setButtonBusy(button, true, "Submitting...");
  try {
    /*
      The Edge Function decides the donation year from Asia/Kolkata time,
      so the browser never chooses the yearly partition.
    */
    const data = await callBackend("submitDonation", {
      mobile: currentDonor.mobile,
      token: donorSessionToken,
      amount: Number(amount.toFixed(2)),
      upiTransactionId: txnId,
      paymentApp,
      otherApp: paymentApp === "Other" ? otherApp : "",
      proof: {
        fileName: proof.name,
        mimeType: proof.type,
        file: proof
      }
    });

    currentDonation = data?.donation || data;
    form.reset();
    document.getElementById("other-app-field").hidden = true;
    document.getElementById("donation-other-app").required = false;
    document.getElementById("donation-proof-name").textContent = "No file selected";

    showAlert("Donation submitted successfully. It is pending admin verification.", "success");
    window.setTimeout(async () => {
      try {
        await refreshDashboard();
      } finally {
        showView("dashboard");
      }
    }, 800);
  } catch (error) {
    if (error.message !== "BACKEND_NOT_CONFIGURED") {
      showAlert(error.message || "Donation submission failed. Please try again.", "error");
    }
  } finally {
    setButtonBusy(button, false);
  }
});

async function refreshDashboard() {
  if (!currentDonor?.mobile || !SUPABASE_CONFIGURED) return;
  try {
    const data = await callBackend("getDonorDashboard", { mobile: currentDonor.mobile, token: donorSessionToken });
    populateDashboard(data);
  } catch (error) {
    // Dashboard can still display the previous data if refresh fails.
    console.warn(error);
  }
}

/* ============================================================
   Receipt
   ============================================================ */
async function openReceipt(donation) {
  if (!donation) return;
  try {
    if (donorSessionToken && currentDonor?.mobile && donation.donationId && donation.year && SUPABASE_CONFIGURED) {
      const data = await callBackend("getReceipt", {
        token: donorSessionToken,
        mobile: currentDonor.mobile,
        year: donation.year,
        donationId: donation.donationId
      });
      donation = data?.donation || donation;
      currentDonor = data?.donor || currentDonor;
    }
  } catch (error) {
    console.warn("Receipt refresh failed; showing cached donation data.", error);
  }

  currentDonation = donation;

  const donor = currentDonor || {};
  const receiptRows = [
    ["Donor Name", donor.fullName || donor.name || "—"],
    ["Father's Name", donor.fatherName || "—"],
    ["Mobile Number", donor.mobile || "—"],
    ["Village / Complete Address", donor.address || "—"],
    ["Donation Year", donation.year ? `Durga Puja ${donation.year}` : "—"],
    ["Donation Amount", formatIndianCurrency(donation.amount)],
    ["UPI Transaction ID", donation.upiTransactionId || donation.transactionId || "—"],
    ["Payment App", donation.paymentApp || donation.app || donation.otherApp || "—"]
  ];

  const grid = document.getElementById("receipt-info-grid");
  if (grid) {
    grid.innerHTML = receiptRows.map(([label, value]) => `
      <div class="receipt-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");
  }

  const status = String(donation.status || donation.verificationStatus || "Pending");
  const statusEl = document.getElementById("receipt-status");
  if (statusEl) {
    const verified = status.toLowerCase() === "verified";
    const rejected = status.toLowerCase() === "rejected";
    statusEl.textContent = verified ? "✅ VERIFIED" : rejected ? "❌ REJECTED" : "⏳ PENDING VERIFICATION";
    statusEl.className = verified ? "status-verified" : rejected ? "status-rejected" : "status-pending";
  }

  showView("receipt");
}

document.getElementById("download-receipt-btn")?.addEventListener("click", async () => {
  const button = document.getElementById("download-receipt-btn");
  const receipt = document.getElementById("receipt-card");

  if (!receipt) {
    showAlert("Receipt could not be found.", "error");
    return;
  }

  if (typeof html2canvas === "undefined") {
    showAlert("Receipt download is temporarily unavailable. Please refresh the page and try again.", "error");
    return;
  }

  const originalText = button?.textContent;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing Receipt...";
    }

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const canvas = await html2canvas(receipt, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false
    });

    const link = document.createElement("a");
    const year = currentDonation?.year || new Date().getFullYear();
    const donationId = currentDonation?.donationId || "Receipt";

    link.download = `Durga-Mahadev-Receipt-${year}-${donationId}.png`;
    link.href = canvas.toDataURL("image/png");

    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    console.error("Receipt download failed:", error);
    showAlert("Unable to download the receipt. Please try again.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "⬇ Download Receipt";
    }
  }
});

/* ---------- Protect against accidental form submission while offline ---------- */
window.addEventListener("offline", () => {
  if (portalOverlay?.classList.contains("is-open")) {
    showAlert("You appear to be offline. Please reconnect before submitting a registration or donation.", "error");
  }
});
