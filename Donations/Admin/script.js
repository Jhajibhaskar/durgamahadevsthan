/*
 * Durga Mahadev Sthan - Admin Portal
 * Supabase-backed admin dashboard.
 *
 * The existing Admin HTML can stay unchanged. This script loads the
 * Supabase CDN and assets/js/config.js dynamically, signs the admin in
 * with Supabase Auth (email + password), verifies membership in
 * public.admin_users, and performs all CRUD operations through RLS.
 */
const ADMIN_CONFIG = Object.freeze({
  currency: "INR",
  sessionKey: "DMS_ADMIN_SESSION" // compatibility marker; Supabase owns the real session
});

let supabaseClient = null;
let adminUser = null;
let adminToken = "";
let donorsCache = [];
let donationsCache = [];
let currentEditingDonation = null;
let supabaseReadyPromise = null;

const $ = (id) => document.getElementById(id);
const adminYear = $("admin-year");
if (adminYear) adminYear.textContent = new Date().getFullYear();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}
function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: ADMIN_CONFIG.currency, minimumFractionDigits: 2 }).format(Number(value || 0));
}
function digitsOnly(value, max = 10) { return String(value || "").replace(/\D/g, "").slice(0, max); }
function showAlert(el, message, type = "info") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "alert" + (message ? ` show ${type}` : "");
}
function setBusy(button, busy, text = "Please wait...") {
  if (!button) return;
  if (busy) { button.dataset.original = button.textContent; button.textContent = text; button.disabled = true; }
  else { button.textContent = button.dataset.original || button.textContent; button.disabled = false; }
}

function loadScriptOnce(src, globalName) {
  return new Promise((resolve, reject) => {
    if (globalName && window[globalName]) return resolve(window[globalName]);
    const existing = [...document.scripts].find((s) => s.src === src);
    if (existing) {
      existing.addEventListener("load", () => resolve(window[globalName]));
      existing.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(script);
  });
}

async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!supabaseReadyPromise) {
    supabaseReadyPromise = (async () => {
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "supabase");
      if (!window.supabase?.createClient) throw new Error("Supabase client library could not be loaded.");

      if (!window.DMS_SUPABASE_CONFIG) {
        await loadScriptOnce(new URL("../assets/js/config.js", document.baseURI).href, "DMS_SUPABASE_CONFIG");
      }

      const config = window.DMS_SUPABASE_CONFIG || {};
      const url = String(config.supabaseUrl || "").trim();
      const key = String(config.supabasePublishableKey || "").trim();
      if (!url || !key || key.startsWith("YOUR_")) {
        throw new Error("Update assets/js/config.js with your Supabase project URL and publishable/anon key.");
      }

      supabaseClient = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return supabaseClient;
    })();
  }
  return supabaseReadyPromise;
}

async function requireAdmin() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your admin session has expired. Please login again.");

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw error;
  if (!isAdmin) {
    await supabase.auth.signOut();
    throw new Error("This account is not authorized as a temple administrator.");
  }

  adminUser = user;
  return { supabase, user };
}

async function api(action, payload = {}) {
  const supabase = await getSupabase();

  switch (action) {
    case "adminLogin": {
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Please enter a valid admin email address.");
      if (!password) throw new Error("Please enter the admin password.");

      // Authenticate the administrator with the existing Supabase Auth
      // email/password account, then verify that the Auth user is listed
      // in public.admin_users.
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;

      const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
      if (adminError) {
        await supabase.auth.signOut();
        throw adminError;
      }
      if (!isAdmin) {
        await supabase.auth.signOut();
        throw new Error("This account is not authorized as a temple administrator.");
      }

      adminUser = data.user;
      sessionStorage.setItem(ADMIN_CONFIG.sessionKey, "supabase-auth");
      return { user: data.user, session: data.session };
    }

    case "getAdminDashboard": {
      await requireAdmin();
      const [{ count: registeredDonors, error: donorCountError }, { data: donations, error: donationError }] = await Promise.all([
        supabase.from("donors").select("id", { count: "exact", head: true }),
        supabase.from("donations").select("amount,status")
      ]);
      if (donorCountError) throw donorCountError;
      if (donationError) throw donationError;
      const stats = (donations || []).reduce((acc, row) => {
        const amount = Number(row.amount || 0);
        const status = String(row.status || "").toLowerCase();
        if (status === "verified") acc.totalVerified += amount;
        if (status === "pending") { acc.totalPending += amount; acc.pendingDonationCount += 1; }
        return acc;
      }, { totalVerified: 0, totalPending: 0, pendingDonationCount: 0 });
      return { stats: { registeredDonors: registeredDonors || 0, ...stats } };
    }

    case "getAdminDonors": {
      await requireAdmin();
      const { data, error } = await supabase.from("donors").select("*").order("full_name", { ascending: true });
      if (error) throw error;
      let donors = (data || []).map(donorFromDb);
      const search = String(payload.search || "").trim().toLowerCase();
      if (search) {
        donors = donors.filter((d) => [d.mobile, d.fullName, d.fatherName, d.address, d.city, d.state, d.dob].some((v) => String(v || "").toLowerCase().includes(search)));
      }
      return { donors };
    }

    case "getAdminYears": {
      await requireAdmin();
      const { data, error } = await supabase.from("donations").select("year").order("year", { ascending: false });
      if (error) throw error;
      return { years: [...new Set((data || []).map((r) => Number(r.year)).filter(Number.isFinite))] };
    }

    case "getAdminDonations": {
      await requireAdmin();
      let query = supabase.from("donations").select("*").order("year", { ascending: false }).order("submitted_at", { ascending: false });
      if (payload.year) query = query.eq("year", Number(payload.year));
      if (payload.status) query = query.eq("status", String(payload.status));
      const { data, error } = await query;
      if (error) throw error;
      let donations = (data || []).map(donationFromDb);
      const search = String(payload.search || "").trim().toLowerCase();
      if (search) {
        donations = donations.filter((d) => [d.mobile, d.fullName, d.fatherName, d.address, d.donationId, d.upiTransactionId, d.paymentApp, d.otherApp, d.status].some((v) => String(v || "").toLowerCase().includes(search)));
      }
      return { donations };
    }

    case "addDonor": {
      await requireAdmin();
      const donor = normalizeDonorPayload(payload);
      const { data, error } = await supabase.from("donors").insert(donor).select("*").single();
      if (error) {
        if (error.code === "23505") throw new Error("This mobile number is already registered.");
        throw error;
      }
      return { donor: donorFromDb(data) };
    }

    case "addDonation": {
      const { user } = await requireAdmin();
      const donation = await createAdminDonation(payload, user.id);
      return { donation: donationFromDb(donation) };
    }

    case "updateDonor": {
      await requireAdmin();
      const originalMobile = digitsOnly(payload.originalMobile || payload.mobile);
      const donor = normalizeDonorPayload(payload);
      const { data: existing, error: findError } = await supabase.from("donors").select("id").eq("mobile", originalMobile).maybeSingle();
      if (findError) throw findError;
      if (!existing) throw new Error("Donor not found.");
      if (donor.mobile !== originalMobile) {
        const { data: duplicate, error: dupError } = await supabase.from("donors").select("id").eq("mobile", donor.mobile).neq("id", existing.id).maybeSingle();
        if (dupError) throw dupError;
        if (duplicate) throw new Error("The new mobile number already belongs to another donor.");
      }

      const { data: updated, error: updateError } = await supabase.from("donors").update(donor).eq("id", existing.id).select("*").single();
      if (updateError) throw updateError;

      // Keep the denormalized donation fields synchronized with the donor.
      const { error: donationUpdateError } = await supabase.from("donations").update({
        mobile: donor.mobile,
        full_name: donor.full_name,
        father_name: donor.father_name,
        address: donor.address
      }).eq("donor_id", existing.id);
      if (donationUpdateError) throw donationUpdateError;

      return { donor: donorFromDb(updated) };
    }

    case "deleteDonor": {
      await requireAdmin();
      if (payload.confirmDelete !== true) throw new Error("Delete confirmation is required.");
      const mobile = digitsOnly(payload.mobile);
      const { data: donor, error: findError } = await supabase.from("donors").select("id").eq("mobile", mobile).maybeSingle();
      if (findError) throw findError;
      if (!donor) throw new Error("Donor not found.");

      const { data: proofs, error: proofError } = await supabase.from("donations").select("proof_path").eq("donor_id", donor.id);
      if (proofError) throw proofError;
      const paths = (proofs || []).map((r) => r.proof_path).filter(Boolean);
      const { error: deleteError } = await supabase.from("donors").delete().eq("id", donor.id);
      if (deleteError) throw deleteError;
      if (paths.length) await removeStorageFiles(paths);
      return { mobile, deletedDonations: proofs?.length || 0, trashedProofs: paths.length };
    }

    case "updateDonation": {
      const { user } = await requireAdmin();
      const donationId = String(payload.donationId || "").trim();
      if (!donationId) throw new Error("Donation ID is required.");
      const { data: existing, error } = await supabase.from("donations").select("*").eq("donation_id", donationId).eq("year", Number(payload.year)).maybeSingle();
      if (error) throw error;
      if (!existing) throw new Error("Donation not found.");

      const mobile = digitsOnly(payload.mobile || existing.mobile);
      const { data: donor, error: donorError } = await supabase.from("donors").select("*").eq("mobile", mobile).maybeSingle();
      if (donorError) throw donorError;
      if (!donor) throw new Error("The selected donor does not exist.");

      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid donation amount.");
      const paymentApp = String(payload.paymentApp || existing.payment_app || "").trim();
      const otherApp = String(payload.otherApp || "").trim();
      const status = normalizeStatus(payload.status || existing.status);
      if (paymentApp && !["GPay", "PhonePe", "Paytm", "BHIM", "Other", "Cash / Manual"].includes(paymentApp)) throw new Error("Invalid payment app.");
      if (paymentApp === "Other" && !otherApp) throw new Error("Other app name is required.");

      const txnId = String(payload.upiTransactionId ?? existing.upi_transaction_id ?? "").trim();
      if (txnId) {
        const { data: duplicate, error: duplicateError } = await supabase.from("donations").select("id").ilike("upi_transaction_id", txnId).neq("id", existing.id).maybeSingle();
        if (duplicateError) throw duplicateError;
        if (duplicate) throw new Error("This UPI Transaction ID is already used.");
      }

      const verified = status === "Verified";
      const update = {
        donor_id: donor.id,
        mobile: donor.mobile,
        full_name: donor.full_name,
        father_name: donor.father_name,
        address: donor.address,
        amount: Number(amount.toFixed(2)),
        upi_transaction_id: txnId || null,
        payment_app: paymentApp || null,
        other_app: paymentApp === "Other" ? otherApp : null,
        status,
        admin_notes: String(payload.adminNotes || "").trim() || null,
        verified_at: verified ? (existing.verified_at || new Date().toISOString()) : null,
        verified_by: verified ? (existing.verified_by || user.id) : null
      };

      const { data: updated, error: updateError } = await supabase.from("donations").update(update).eq("id", existing.id).select("*").single();
      if (updateError) throw updateError;
      return { donation: donationFromDb(updated) };
    }

    case "deleteDonation": {
      await requireAdmin();
      if (payload.confirmDelete !== true) throw new Error("Delete confirmation is required.");
      const donationId = String(payload.donationId || "").trim();
      const { data: donation, error } = await supabase.from("donations").select("id,proof_path").eq("year", Number(payload.year)).eq("donation_id", donationId).maybeSingle();
      if (error) throw error;
      if (!donation) throw new Error("Donation not found.");
      const { error: deleteError } = await supabase.from("donations").delete().eq("id", donation.id);
      if (deleteError) throw deleteError;
      if (donation.proof_path) await removeStorageFiles([donation.proof_path]);
      return { donationId, year: Number(payload.year) };
    }

    case "verifyDonation":
      return await setDonationStatus(payload, "Verified");

    case "rejectDonation":
      return await setDonationStatus(payload, "Rejected");

    case "getPaymentProof": {
      await requireAdmin();
      const { data: donation, error } = await supabase.from("donations").select("proof_path,proof_file_name").eq("year", Number(payload.year)).eq("donation_id", String(payload.donationId || "")).maybeSingle();
      if (error) throw error;
      if (!donation) throw new Error("Donation not found.");
      if (!donation.proof_path) throw new Error("Payment proof is not available.");
      const { data: signed, error: signedError } = await supabase.storage.from("payment-proofs").createSignedUrl(donation.proof_path, 600);
      if (signedError) throw signedError;
      return { dataUrl: signed.signedUrl, fileName: donation.proof_file_name || donation.proof_path.split("/").pop() };
    }

    case "logout":
      await supabase.auth.signOut();
      sessionStorage.removeItem(ADMIN_CONFIG.sessionKey);
      adminUser = null;
      return { loggedOut: true };

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

function normalizeDonorPayload(payload) {
  const mobile = digitsOnly(payload.mobile);
  const fullName = String(payload.fullName || "").trim();
  const fatherName = String(payload.fatherName || "").trim();
  const dob = normalizeDobText(payload.dob);
  const address = String(payload.address || "").trim();
  const city = String(payload.city || "").trim();
  const state = String(payload.state || "").trim();
  if (!/^\d{10}$/.test(mobile)) throw new Error("Please enter a valid 10-digit mobile number.");
  if (!fullName || !fatherName || !dob || !address || !city || !state) throw new Error("Please complete all required donor fields.");
  return { mobile, full_name: fullName, father_name: fatherName, dob: dobToIso(dob), address, city, state };
}

function normalizeDobText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) throw new Error("Date of Birth must be in DD-MM-YYYY format.");
  const d = Number(match[1]), m = Number(match[2]), y = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || date > new Date()) throw new Error("Please enter a valid date of birth.");
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}
function dobToIso(text) {
  const [dd, mm, yyyy] = text.split("-");
  return `${yyyy}-${mm}-${dd}`;
}
function formatDob(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const [yyyy, mm, dd] = text.split("-");
  return `${dd}-${mm}-${yyyy}`;
}
function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}
function donorFromDb(row) {
  return {
    id: row.id,
    mobile: String(row.mobile || ""),
    fullName: String(row.full_name || ""),
    fatherName: String(row.father_name || ""),
    dob: formatDob(row.dob),
    address: String(row.address || ""),
    city: String(row.city || ""),
    state: String(row.state || ""),
    registeredOn: formatDate(row.registered_at),
    lastUpdated: formatDate(row.updated_at)
  };
}
function donationFromDb(row) {
  return {
    id: row.id,
    donationId: String(row.donation_id || ""),
    year: Number(row.year),
    donorId: row.donor_id,
    mobile: String(row.mobile || ""),
    fullName: String(row.full_name || ""),
    fatherName: String(row.father_name || ""),
    address: String(row.address || ""),
    amount: Number(row.amount || 0),
    upiTransactionId: String(row.upi_transaction_id || ""),
    paymentApp: String(row.payment_app || ""),
    otherApp: String(row.other_app || ""),
    proofPath: String(row.proof_path || ""),
    proofFileName: String(row.proof_file_name || ""),
    status: String(row.status || "Pending"),
    adminNotes: String(row.admin_notes || ""),
    submittedOn: formatDate(row.submitted_at),
    verifiedOn: formatDate(row.verified_at),
    verifiedBy: row.verified_by || ""
  };
}
function normalizeStatus(value) {
  const status = String(value || "Pending");
  if (!["Pending", "Verified", "Rejected"].includes(status)) throw new Error("Invalid verification status.");
  return status;
}

async function createAdminDonation(payload, adminId) {
  const supabase = await getSupabase();
  const year = Number(payload.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2200) throw new Error("Invalid donation year.");
  const mobile = digitsOnly(payload.mobile);
  const { data: donor, error: donorError } = await supabase.from("donors").select("*").eq("mobile", mobile).maybeSingle();
  if (donorError) throw donorError;
  if (!donor) throw new Error("The selected donor does not exist.");

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid donation amount.");
  const paymentApp = String(payload.paymentApp || "").trim();
  const otherApp = String(payload.otherApp || "").trim();
  const status = normalizeStatus(payload.status || "Pending");
  if (paymentApp && !["GPay", "PhonePe", "Paytm", "BHIM", "Other", "Cash / Manual"].includes(paymentApp)) throw new Error("Invalid payment app.");
  if (paymentApp === "Other" && !otherApp) throw new Error("Other app name is required.");

  let proofPath = null;
  let proofFileName = null;
  let proofMimeType = null;
  try {
    const file = payload.proofFile instanceof File ? payload.proofFile : null;
    if (file) {
      validateProof(file);
      proofFileName = file.name;
      proofMimeType = file.type;
      proofPath = await uploadProofFile(file, donor, year);
    }

    const donationId = makeDonationId();
    const { data, error } = await supabase.from("donations").insert({
      donation_id: donationId,
      year,
      donor_id: donor.id,
      mobile: donor.mobile,
      full_name: donor.full_name,
      father_name: donor.father_name,
      address: donor.address,
      amount: Number(amount.toFixed(2)),
      upi_transaction_id: String(payload.upiTransactionId || "").trim() || null,
      payment_app: paymentApp || null,
      other_app: paymentApp === "Other" ? otherApp : null,
      proof_path: proofPath,
      proof_file_name: proofFileName,
      proof_mime_type: proofMimeType,
      status,
      admin_notes: String(payload.adminNotes || "").trim() || null,
      verified_at: status === "Verified" ? new Date().toISOString() : null,
      verified_by: status === "Verified" ? adminId : null
    }).select("*").single();
    if (error) throw error;
    return data;
  } catch (error) {
    if (proofPath) await removeStorageFiles([proofPath]);
    if (error?.code === "23505") throw new Error("This donation or UPI Transaction ID already exists.");
    throw error;
  }
}

function validateProof(file) {
  if (!(file instanceof File)) throw new Error("Invalid payment proof file.");
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Payment proof must be JPG, JPEG or PNG.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Payment proof must be 5 MB or smaller.");
}
async function uploadProofFile(file, donor, year) {
  const supabase = await getSupabase();
  const extension = file.type === "image/png" ? "png" : "jpg";
  const safeName = String(donor.full_name || "Donor").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "Donor";
  const path = `${year}/${donor.mobile}/manual-${crypto.randomUUID()}-${safeName}.${extension}`;
  const { error } = await supabase.storage.from("payment-proofs").upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}
async function removeStorageFiles(paths) {
  const supabase = await getSupabase();
  const clean = [...new Set((paths || []).filter(Boolean))];
  for (let i = 0; i < clean.length; i += 100) {
    const { error } = await supabase.storage.from("payment-proofs").remove(clean.slice(i, i + 100));
    if (error) console.warn("Storage cleanup failed:", error);
  }
}
function makeDonationId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `DN${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function setDonationStatus(payload, status) {
  const { user } = await requireAdmin();
  const supabase = await getSupabase();
  const donationId = String(payload.donationId || "").trim();
  const year = Number(payload.year);
  const { data, error } = await supabase.from("donations").select("*").eq("year", year).eq("donation_id", donationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Donation not found.");
  const { data: updated, error: updateError } = await supabase.from("donations").update({
    status,
    admin_notes: String(payload.adminNotes || data.admin_notes || "").trim() || null,
    verified_at: status === "Verified" ? (data.verified_at || new Date().toISOString()) : null,
    verified_by: status === "Verified" ? (data.verified_by || user.id) : null
  }).eq("id", data.id).select("*").single();
  if (updateError) throw updateError;
  return { donation: donationFromDb(updated) };
}

function openModal(html) {
  $("modal-content").innerHTML = html;
  $("modal").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("modal").hidden = true;
  $("modal-content").innerHTML = "";
  document.body.style.overflow = "";
  currentEditingDonation = null;
}
$("modal-close")?.addEventListener("click", closeModal);
$("modal")?.addEventListener("click", (event) => { if (event.target === $("modal")) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$(("modal" )).hidden) closeModal(); });

async function loginAdmin() {
  const email = String($("admin-email").value || "").trim().toLowerCase();
  const password = $("admin-password").value;
  const button = document.querySelector("#admin-login-form button[type=submit]");
  setBusy(button, true, "Logging in...");
  showAlert($("login-alert"), "");
  try {
    await api("adminLogin", { email, password });
    $("admin-login-card").hidden = true;
    $("admin-dashboard").hidden = false;
    await loadEverything();
  } catch (error) {
    showAlert($("login-alert"), error.message || "Admin login failed.", "error");
  } finally { setBusy(button, false); }
}

$("admin-login-form")?.addEventListener("submit", (event) => { event.preventDefault(); loginAdmin(); });

async function loadEverything() {
  try {
    await Promise.all([loadStats(), loadDonors(), loadDonationYears(), loadDonations()]);
    showAlert($("dash-alert"), "");
  } catch (error) {
    if (/session|authorized|login/i.test(error.message || "")) logoutLocal();
    else showAlert($("dash-alert"), error.message || "Unable to load dashboard.", "error");
  }
}
async function loadStats() { const data = await api("getAdminDashboard"); $("stat-donors").textContent = data?.stats?.registeredDonors ?? 0; $("stat-verified").textContent = money(data?.stats?.totalVerified); $("stat-pending").textContent = money(data?.stats?.totalPending); $("stat-pending-count").textContent = data?.stats?.pendingDonationCount ?? 0; }
async function loadDonors() { const data = await api("getAdminDonors", { search: $("donor-search").value.trim() }); donorsCache = Array.isArray(data?.donors) ? data.donors : []; renderDonors(); }
function renderDonors() { const tbody = $("donors-tbody"); if (!donorsCache.length) { tbody.innerHTML = '<tr><td colspan="8">No donor records found.</td></tr>'; return; } tbody.innerHTML = donorsCache.map(d => `<tr><td>${escapeHtml(d.mobile)}</td><td>${escapeHtml(d.fullName)}</td><td>${escapeHtml(d.fatherName)}</td><td>${escapeHtml(d.dob)}</td><td>${escapeHtml(d.address)}</td><td>${escapeHtml(d.city)}</td><td>${escapeHtml(d.state)}</td><td><div class="row-actions"><button class="tiny-btn" data-action="edit-donor" data-mobile="${escapeHtml(d.mobile)}">Edit</button><button class="tiny-btn" data-action="delete-donor" data-mobile="${escapeHtml(d.mobile)}">Delete</button></div></td></tr>`).join(""); }
async function loadDonationYears() { const data = await api("getAdminYears"); const years = Array.isArray(data?.years) ? data.years : []; const select = $("donation-year-filter"); if (!select) return; const old = select.value; select.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join(""); if (years.includes(Number(old))) select.value = old; }
async function loadDonations() { const data = await api("getAdminDonations", { year: $("donation-year-filter").value, status: $("donation-status-filter").value, search: $("donation-search").value.trim() }); donationsCache = Array.isArray(data?.donations) ? data.donations : []; renderDonations(); }
function statusHtml(status) { const s = String(status || "Pending"); const cls = s.toLowerCase() === "verified" ? "verified" : s.toLowerCase() === "rejected" ? "rejected" : "pending"; return `<span class="status ${cls}">${escapeHtml(s)}</span>`; }
function renderDonations() { const tbody = $("donations-tbody"); if (!donationsCache.length) { tbody.innerHTML = '<tr><td colspan="9">No donation records found.</td></tr>'; return; } tbody.innerHTML = donationsCache.map(d => `<tr><td>${escapeHtml(d.year)}</td><td>${escapeHtml(d.mobile)}</td><td>${escapeHtml(d.fullName)}</td><td>${money(d.amount)}</td><td>${escapeHtml(d.upiTransactionId)}</td><td>${escapeHtml(d.paymentApp === "Other" ? d.otherApp : d.paymentApp)}</td><td>${statusHtml(d.status)}</td><td>${escapeHtml(d.submittedOn)}</td><td><div class="row-actions"><button class="tiny-btn" data-action="view-donation" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">View</button><button class="tiny-btn" data-action="receipt" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">Receipt</button><button class="tiny-btn" data-action="proof" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">Proof</button><button class="tiny-btn" data-action="edit-donation" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">Edit</button>${String(d.status).toLowerCase() === "pending" ? `<button class="tiny-btn" data-action="verify" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">Verify</button>` : ""}<button class="tiny-btn" data-action="delete-donation" data-year="${escapeHtml(d.year)}" data-id="${escapeHtml(d.donationId)}">Delete</button></div></td></tr>`).join(""); }
function donorForMobile(mobile) { return donorsCache.find(d => d.mobile === mobile) || null; }
function donationFor(year, id) { return donationsCache.find(d => Number(d.year) === Number(year) && d.donationId === id) || null; }
function fileToBase64(file) { return Promise.resolve(file); }

function addDonorModal() {
  openModal(`<h3>Add Donor</h3><p>Create a donor record directly from the admin dashboard. Mobile number must be unique.</p><form id="add-donor-form" class="modal-form"><label><span>Mobile Number *</span><input id="ad-mobile" maxlength="10" inputmode="numeric" required></label><label><span>Full Name *</span><input id="ad-name" required></label><label><span>Father's Name *</span><input id="ad-father" required></label><label><span>Date of Birth *</span><input id="ad-dob" placeholder="DD-MM-YYYY" maxlength="10" required></label><label class="wide"><span>Village / Complete Address *</span><textarea id="ad-address" rows="3" required></textarea></label><label><span>Current City *</span><input id="ad-city" required></label><label><span>State *</span><input id="ad-state" required></label><div class="modal-actions wide"><button type="button" class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" type="submit">Add Donor</button></div></form>`);
  $("ad-mobile")?.addEventListener("input", e => e.target.value = digitsOnly(e.target.value));
  $("ad-dob")?.addEventListener("input", e => { let v = e.target.value.replace(/\D/g, "").slice(0, 8); if (v.length > 4) v = v.slice(0, 2) + "-" + v.slice(2, 4) + "-" + v.slice(4); else if (v.length > 2) v = v.slice(0, 2) + "-" + v.slice(2); e.target.value = v; });
  $("cancel-modal")?.addEventListener("click", closeModal);
  $("add-donor-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button[type=submit]"); setBusy(button, true, "Adding..."); try { await api("addDonor", { mobile: digitsOnly($("ad-mobile").value), fullName: $("ad-name").value.trim(), fatherName: $("ad-father").value.trim(), dob: $("ad-dob").value.trim(), address: $("ad-address").value.trim(), city: $("ad-city").value.trim(), state: $("ad-state").value.trim() }); closeModal(); await Promise.all([loadStats(), loadDonors()]); showAlert($("dash-alert"), "Donor added successfully.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } finally { setBusy(button, false); } });
}

function addDonationModal() {
  openModal(`<h3>Add Donation</h3><p>Add a donation manually. Payment proof is optional for admin-entered records.</p><form id="add-donation-form" class="modal-form"><label><span>Donation Year *</span><input id="add-dn-year" type="number" min="2020" max="2200" value="${new Date().getFullYear()}" required></label><label><span>Donor Mobile *</span><input id="add-dn-mobile" maxlength="10" inputmode="numeric" required></label><label><span>Amount *</span><input id="add-dn-amount" type="number" min="0.01" step="0.01" required></label><label><span>UPI Transaction ID</span><input id="add-dn-txn" placeholder="Optional for admin/manual entries"></label><label><span>Payment App</span><select id="add-dn-app"><option value="">Not specified</option><option>GPay</option><option>PhonePe</option><option>Paytm</option><option>BHIM</option><option>Other</option><option>Cash / Manual</option></select></label><label id="add-dn-other-wrap"><span>Other App</span><input id="add-dn-other"></label><label><span>Verification Status *</span><select id="add-dn-status"><option>Verified</option><option>Pending</option><option>Rejected</option></select></label><label><span>Admin Notes</span><input id="add-dn-notes"></label><label class="wide"><span>Payment Proof (optional)</span><input id="add-dn-proof" type="file" accept="image/jpeg,image/png"><small id="add-dn-proof-name">No file selected · Max 5 MB</small></label><div class="modal-actions wide"><button type="button" class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" type="submit">Add Donation</button></div></form>`);
  $("add-dn-mobile")?.addEventListener("input", e => e.target.value = digitsOnly(e.target.value));
  const otherWrap = $("add-dn-other-wrap");
  const updateOther = () => { if (otherWrap) otherWrap.style.display = $("add-dn-app").value === "Other" ? "" : "none"; };
  $("add-dn-app")?.addEventListener("change", updateOther); updateOther();
  $("add-dn-proof")?.addEventListener("change", e => { const file = e.target.files?.[0]; if ($("add-dn-proof-name")) $("add-dn-proof-name").textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "No file selected · Max 5 MB"; if (file) { try { validateProof(file); } catch (error) { showAlert($("dash-alert"), error.message, "error"); e.target.value = ""; } } });
  $("cancel-modal")?.addEventListener("click", closeModal);
  $("add-donation-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button[type=submit]"), file = $("add-dn-proof")?.files?.[0]; setBusy(button, true, "Adding..."); try { if (file) validateProof(file); await api("addDonation", { year: Number($("add-dn-year").value), mobile: digitsOnly($("add-dn-mobile").value), amount: Number($("add-dn-amount").value), upiTransactionId: $("add-dn-txn").value.trim(), paymentApp: $("add-dn-app").value, otherApp: $("add-dn-other").value.trim(), status: $("add-dn-status").value, adminNotes: $("add-dn-notes").value.trim(), proofFile: file || null }); closeModal(); await Promise.all([loadStats(), loadDonationYears(), loadDonations()]); showAlert($("dash-alert"), "Donation added successfully.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } finally { setBusy(button, false); } });
}

function openDonorEditor(donor) {
  if (!donor) return;
  openModal(`<h3>Edit Donor</h3><p>Mobile number remains the unique identifier. Changing it updates donation records for this donor.</p><form id="donor-edit-form" class="modal-form"><label><span>Original Mobile</span><input id="ed-original-mobile" value="${escapeHtml(donor.mobile)}" readonly></label><label><span>Mobile Number *</span><input id="ed-mobile" value="${escapeHtml(donor.mobile)}" maxlength="10" inputmode="numeric" required></label><label><span>Full Name *</span><input id="ed-name" value="${escapeHtml(donor.fullName)}" required></label><label><span>Father's Name *</span><input id="ed-father" value="${escapeHtml(donor.fatherName)}" required></label><label><span>Date of Birth *</span><input id="ed-dob" value="${escapeHtml(donor.dob)}" placeholder="DD-MM-YYYY" required></label><label><span>Current City *</span><input id="ed-city" value="${escapeHtml(donor.city)}" required></label><label class="wide"><span>Village / Complete Address *</span><textarea id="ed-address" rows="3" required>${escapeHtml(donor.address)}</textarea></label><label><span>State *</span><input id="ed-state" value="${escapeHtml(donor.state)}" required></label><div class="modal-actions wide"><button type="button" class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" type="submit">Save Changes</button></div></form>`);
  $("cancel-modal")?.addEventListener("click", closeModal);
  $("ed-mobile")?.addEventListener("input", e => e.target.value = digitsOnly(e.target.value));
  $("donor-edit-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button[type=submit]"); setBusy(button, true, "Saving..."); try { await api("updateDonor", { originalMobile: donor.mobile, mobile: digitsOnly($("ed-mobile").value), fullName: $("ed-name").value.trim(), fatherName: $("ed-father").value.trim(), dob: $("ed-dob").value.trim(), address: $("ed-address").value.trim(), city: $("ed-city").value.trim(), state: $("ed-state").value.trim() }); closeModal(); await Promise.all([loadStats(), loadDonors(), loadDonations()]); showAlert($("dash-alert"), "Donor updated successfully.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } finally { setBusy(button, false); } });
}
async function deleteDonor(mobile) { const donor = donorForMobile(mobile); if (!donor) return; if (!confirm(`Delete donor ${donor.fullName} (${mobile}) and ALL of their donation records? This cannot be undone.`)) return; try { await api("deleteDonor", { mobile, confirmDelete: true }); await loadEverything(); showAlert($("dash-alert"), "Donor and related donation records were deleted.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } }

function openDonationEditor(donation) {
  if (!donation) return;
  currentEditingDonation = donation;
  openModal(`<h3>Edit Donation · ${escapeHtml(donation.year)}</h3><form id="donation-edit-form" class="modal-form"><label><span>Donation ID</span><input value="${escapeHtml(donation.donationId)}" readonly></label><label><span>Mobile Number *</span><input id="dn-mobile" value="${escapeHtml(donation.mobile)}" maxlength="10" inputmode="numeric" required></label><label><span>Amount *</span><input id="dn-amount" type="number" min="0.01" step="0.01" value="${Number(donation.amount || 0).toFixed(2)}" required></label><label><span>UPI Transaction ID *</span><input id="dn-txn" value="${escapeHtml(donation.upiTransactionId)}" required></label><label><span>Payment App *</span><select id="dn-app"><option>GPay</option><option>PhonePe</option><option>Paytm</option><option>BHIM</option><option>Other</option><option>Cash / Manual</option></select></label><label id="dn-other-wrap"><span>Other App</span><input id="dn-other" value="${escapeHtml(donation.otherApp)}"></label><label><span>Verification Status *</span><select id="dn-status"><option>Pending</option><option>Verified</option><option>Rejected</option></select></label><label><span>Admin Notes</span><input id="dn-notes" value="${escapeHtml(donation.adminNotes)}"></label><div class="modal-actions wide"><button type="button" class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" type="submit">Save Donation</button></div></form>`);
  $("dn-app").value = donation.paymentApp || ""; $("dn-status").value = donation.status || "Pending"; $("dn-mobile")?.addEventListener("input", e => e.target.value = digitsOnly(e.target.value)); const otherWrap = $("dn-other-wrap"); const updateOther = () => { if (otherWrap) otherWrap.style.display = $("dn-app").value === "Other" ? "" : "none"; }; $("dn-app")?.addEventListener("change", updateOther); updateOther(); $("cancel-modal")?.addEventListener("click", closeModal);
  $("donation-edit-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button[type=submit]"); setBusy(button, true, "Saving..."); try { await api("updateDonation", { year: donation.year, donationId: donation.donationId, mobile: digitsOnly($("dn-mobile").value), amount: Number($("dn-amount").value), upiTransactionId: $("dn-txn").value.trim(), paymentApp: $("dn-app").value, otherApp: $("dn-other").value.trim(), status: $("dn-status").value, adminNotes: $("dn-notes").value.trim() }); closeModal(); await Promise.all([loadStats(), loadDonations()]); showAlert($("dash-alert"), "Donation updated successfully.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } finally { setBusy(button, false); } });
}
function openDonationViewer(donation) { if (!donation) return; openModal(`<h3>Donation Receipt Details</h3><div class="detail-grid">${[["Year", `Durga Puja ${donation.year}`],["Donation ID",donation.donationId],["Mobile Number",donation.mobile],["Donor Name",donation.fullName],["Father's Name",donation.fatherName],["Address",donation.address],["Amount",money(donation.amount)],["UPI Transaction ID",donation.upiTransactionId],["Payment App",donation.paymentApp === "Other" ? donation.otherApp : donation.paymentApp],["Verification Status",donation.status],["Submitted On",donation.submittedOn],["Verified On",donation.verifiedOn || "—"],["Admin Notes",donation.adminNotes || "—"]].map(([k,v]) => `<div class="detail-box"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>`); }
async function viewProof(donation) { try { const data = await api("getPaymentProof", { year: donation.year, donationId: donation.donationId }); if (!data?.dataUrl) throw new Error("Payment proof image could not be loaded."); openModal(`<h3>Payment Proof</h3><p>${escapeHtml(data.fileName)}</p><img class="proof-image" src="${data.dataUrl}" alt="Payment proof">`); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } }
function openAdminReceipt(donation) { if (!donation) return; openModal(`<h3>Donation Receipt · Durga Mahadev Sthan, Hulas</h3><div class="receipt-preview"><div class="kicker">DONATION RECEIPT · ${escapeHtml(donation.year)}</div><h3>${escapeHtml(donation.fullName)}</h3><p>Thank you for your generous contribution towards Durga Puja ${escapeHtml(donation.year)}.</p><div class="detail-grid">${[["Father's Name",donation.fatherName],["Mobile Number",donation.mobile],["Village / Complete Address",donation.address],["Amount",money(donation.amount)],["UPI Transaction ID",donation.upiTransactionId],["Payment App",donation.paymentApp === "Other" ? donation.otherApp : donation.paymentApp],["Verification Status",donation.status]].map(([k,v]) => `<div class="detail-box"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v || "—")}</strong></div>`).join("")}</div></div>`); }
async function verifyDonation(donation) { if (!confirm(`Verify ${donation.donationId} for ${money(donation.amount)}?`)) return; try { await api("verifyDonation", { year: donation.year, donationId: donation.donationId }); await Promise.all([loadStats(), loadDonations()]); showAlert($("dash-alert"), "Donation verified.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } }
async function deleteDonation(donation) { if (!confirm(`Delete donation ${donation.donationId} from ${donation.year}? The stored payment proof will also be deleted from Supabase Storage.`)) return; try { await api("deleteDonation", { year: donation.year, donationId: donation.donationId, confirmDelete: true }); await Promise.all([loadStats(), loadDonationYears(), loadDonations()]); showAlert($("dash-alert"), "Donation deleted.", "success"); } catch (error) { showAlert($("dash-alert"), error.message, "error"); } }

document.addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (!button) return; const action = button.dataset.action; if (action === "edit-donor") openDonorEditor(donorForMobile(button.dataset.mobile)); if (action === "delete-donor") deleteDonor(button.dataset.mobile); if (action === "view-donation") openDonationViewer(donationFor(button.dataset.year, button.dataset.id)); if (action === "receipt") openAdminReceipt(donationFor(button.dataset.year, button.dataset.id)); if (action === "proof") viewProof(donationFor(button.dataset.year, button.dataset.id)); if (action === "edit-donation") openDonationEditor(donationFor(button.dataset.year, button.dataset.id)); if (action === "verify") verifyDonation(donationFor(button.dataset.year, button.dataset.id)); if (action === "delete-donation") deleteDonation(donationFor(button.dataset.year, button.dataset.id)); });
let donorSearchTimer; $("donor-search")?.addEventListener("input", () => { clearTimeout(donorSearchTimer); donorSearchTimer = setTimeout(loadDonors, 300); }); $("refresh-donors")?.addEventListener("click", loadDonors); $("add-donor-btn")?.addEventListener("click", addDonorModal); $("donation-year-filter")?.addEventListener("change", loadDonations); $("donation-status-filter")?.addEventListener("change", loadDonations); let donationSearchTimer; $("donation-search")?.addEventListener("input", () => { clearTimeout(donationSearchTimer); donationSearchTimer = setTimeout(loadDonations, 300); }); $("refresh-donations")?.addEventListener("click", loadDonations); $("add-donation-btn")?.addEventListener("click", addDonationModal);
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); document.querySelectorAll(".tab-panel").forEach(p => { p.classList.remove("active"); p.hidden = true; }); tab.classList.add("active"); const panel = $(tab.dataset.tab); if (!panel) return; panel.hidden = false; panel.classList.add("active"); }));

async function logout() { try { await api("logout"); } catch (_) { logoutLocal(); } finally { logoutLocal(); } }
function logoutLocal() { adminToken = ""; adminUser = null; sessionStorage.removeItem(ADMIN_CONFIG.sessionKey); if ($("admin-dashboard")) $("admin-dashboard").hidden = true; if ($("admin-login-card")) $("admin-login-card").hidden = false; if ($("admin-password")) $("admin-password").value = "";
  if ($("admin-email")) $("admin-email").value = ""; }
$("admin-logout")?.addEventListener("click", logout);

(async function restoreSession() {
  try {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: isAdmin, error } = await supabase.rpc("is_admin");
    if (error || !isAdmin) { await supabase.auth.signOut(); return; }
    adminUser = session.user;
    sessionStorage.setItem(ADMIN_CONFIG.sessionKey, "supabase-auth");
    $("admin-login-card").hidden = true;
    $("admin-dashboard").hidden = false;
    await loadEverything();
  } catch (error) {
    console.warn("Admin session restore skipped:", error.message);
  }
})();
