// Sends a single email via Resend's REST API — server-side only, the
// only piece of this app that actually delivers an outreach email
// rather than just drafting one (see salesAssistant.js and
// send-outreach-email.js, the sole caller).
//
// Required env vars:
//   RESEND_API_KEY       from https://resend.com (Dashboard -> API Keys)
//   OUTREACH_FROM_EMAIL  the verified sending address, e.g.
//                        hello@a-it.uk — Resend rejects the send if
//                        this address's domain isn't verified there
//                        (Dashboard -> Domains -> add a-it.uk -> add
//                        the SPF/DKIM DNS records it gives you)
const RESEND_URL = 'https://api.resend.com/emails'

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.OUTREACH_FROM_EMAIL)
}

// Plain text in, simple paragraph-per-blank-line HTML out — the draft
// is written as plain prose by the AI, never markup, so this is only
// ever escaping and wrapping, never interpreting formatting syntax.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function textToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.OUTREACH_FROM_EMAIL
  if (!apiKey || !from) return { ok: false, reason: 'not_configured' }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${process.env.OUTREACH_FROM_NAME || 'Kieran at A-IT'} <${from}>`,
        to: [to],
        reply_to: from,
        subject,
        text,
        html: textToHtml(text),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, reason: 'resend_error', error: body?.message || `HTTP ${res.status}` }
    }
    return { ok: true, id: body.id }
  } catch (err) {
    return { ok: false, reason: 'network_error', error: err.message }
  }
}

module.exports = { isConfigured, sendEmail }
