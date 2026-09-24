// Needs the Anthropic API key (server-side only) and a live read of
// the pipeline, so this goes through a Netlify Function rather than
// calling Claude from the browser — see sales-advisor.js /
// lib/salesAdvisor.js for what it does and doesn't do (pipeline-wide
// tactical advice, never a per-opportunity draft — that's
// requestSalesDraft in salesApi.js — and never persisted).
export async function askSalesAdvisor(messages, accessToken) {
  const res = await fetch('/.netlify/functions/sales-advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messages }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong.')
  return json.reply
}
