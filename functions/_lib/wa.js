// Server-side WhatsApp sender via Meta Cloud API
// Required secrets: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN
// Required approved templates: dhulaai_otp, dhulaai_status_link

const API_BASE = 'https://graph.facebook.com/v18.0';

function e164(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
}

// Send a template message with body variables
export async function sendTemplate(env, to, templateName, bodyVars = []) {
  if (!env.WA_PHONE_NUMBER_ID || !env.WA_ACCESS_TOKEN) {
    console.warn('WhatsApp credentials not set — skipping send');
    return false;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: e164(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: bodyVars.length ? [{
        type: 'body',
        parameters: bodyVars.map(v => ({ type: 'text', text: String(v) })),
      }] : [],
    },
  };

  const r = await fetch(`${API_BASE}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    console.error('WA API error:', JSON.stringify(err));
  }
  return r.ok;
}

// Convenience: send OTP code
export function sendOTP(env, phone, code) {
  // Template dhulaai_otp body: "{{1}} is your OTP for Dhulaai Express. Valid for 5 minutes."
  return sendTemplate(env, phone, 'dhulaai_otp', [code]);
}

// Convenience: send job-created status link
export function sendStatusLink(env, phone, firstName, vehicleDesc, regNumber, statusUrl) {
  // Template dhulaai_status_link body:
  // "Hi {{1}}! Your {{2}} ({{3}}) is checked in at Dhulaai Express. Track live: {{4}}"
  return sendTemplate(env, phone, 'dhulaai_status_link', [firstName, vehicleDesc, regNumber, statusUrl]);
}
