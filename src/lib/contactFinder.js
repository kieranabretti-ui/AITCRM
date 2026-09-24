// Needs server-side robots.txt/SSRF handling, so this goes through a
// Netlify Function rather than fetching from the browser — see
// website-contact-finder.js and lib/websiteContactFinder.js for what
// it does and doesn't do (one company's own site, on demand, never a
// crawler or a third-party platform).
export async function findContactInfo(url, accessToken) {
  const res = await fetch('/.netlify/functions/website-contact-finder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong.')
  return json
}
