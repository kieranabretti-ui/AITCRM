// Shared "facts" block for every AI feature that talks about A-IT's
// pricing (currently the sales draft assistant and the sales advisor
// chat) — one place, so a price or the SLA hours figure can never
// drift out of sync between prompts the way the SLA hours once did.
// Kept in sync with src/lib/pricing.js.
const { SLA_RESPONSE_HOURS } = require('./sla.js')

function buildPriceFacts() {
  return `A-IT's real published pricing (the only figures you may ever state — never invent a different number, a discount, or a bespoke deal):
- Silver: £15/device/month
- Gold: £18/device/month
- Platinum: £25/device/month
- Optional ${SLA_RESPONSE_HOURS}-hour response SLA add-on: +£10/device/month, on top of any tier
These are per-device monthly prices; do not quote an annual figure unless told one on file.`
}

module.exports = { buildPriceFacts }
