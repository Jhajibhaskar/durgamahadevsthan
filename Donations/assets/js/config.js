/*
 * Durga Mahadev Sthan - Supabase configuration
 */
window.DMS_SUPABASE_CONFIG = Object.freeze({
  supabaseUrl: "https://ncagkjuzlntsvmhgdvnc.supabase.co",
  supabasePublishableKey: "sb_publishable_N8yZmlyC5de121CeEJK6vg_QPlcHLw1",
  donorFunctionName: "donor-api",
  paymentProofBucket: "payment-proofs",
  currency: "INR",
  timezone: "Asia/Kolkata",
  maxProofSizeBytes: 5 * 1024 * 1024,
  allowedProofTypes: ["image/jpeg", "image/png"]
});
