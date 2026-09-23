// Small text helpers shared by the support-desk functions.

function cleanEmail(email) {
  return (email || '').trim().toLowerCase()
}

function emailDomain(email) {
  const at = (email || '').lastIndexOf('@')
  return at === -1 ? null : email.slice(at + 1)
}

// Escapes LIKE/ILIKE wildcards so a value used in a PostgREST
// ilike() filter is matched literally, not as a pattern.
function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, '\\$&')
}

module.exports = { cleanEmail, emailDomain, escapeLike }
