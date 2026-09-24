import { useState } from 'react'
import { DORSET_LOCALITIES, SIC_PRESETS, COMPANY_STATUSES, searchLeads, enrichLead, formatAddress } from '../lib/leadFinder.js'
import { createOpportunityForNewLead } from '../lib/salesApi.js'
import { updateClient, addActivity } from '../lib/clientsApi.js'
import { fmtDate } from '../lib/pricing.js'

function buildEnrichmentNote(result) {
  const lines = [`Auto-detected website (unverified guess, confirm before use): ${result.website}`]
  if (result.emails?.length) lines.push(`Email(s) published there: ${result.emails.join(', ')}`)
  if (result.phones?.length) lines.push(`Phone(s) published there: ${result.phones.join(', ')}`)
  if (result.employeeCountHint) lines.push(`Mentioned on their site: ${result.employeeCountHint}`)
  if (lines.length === 1) lines.push('No contact details found published on that site.')
  return lines.join('\n')
}

function enrichLabel(status) {
  if (status === 'searching') return 'Looking for their website…'
  if (status === 'found') return 'Website + contact info found (unverified) — check the client record'
  if (status === 'none') return 'No matching website found'
  if (status === 'error') return 'Website lookup failed'
  return ''
}

const DEFAULT_LOCALITIES = ['Bournemouth', 'Poole', 'Christchurch', 'Dorchester', 'Weymouth', 'Blandford Forum']
const MAX_LOCALITIES = 8

export default function LeadFinderPanel({ session, userId, onClose, onLeadAdded }) {
  const [localities, setLocalities] = useState(DEFAULT_LOCALITIES)
  const [sicCodes, setSicCodes] = useState([])
  const [customSic, setCustomSic] = useState('')
  const [status, setStatus] = useState('active')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [addedNumbers, setAddedNumbers] = useState(new Set())
  const [addingNumber, setAddingNumber] = useState(null)
  const [enrichStatus, setEnrichStatus] = useState({})

  function toggleLocality(loc) {
    setLocalities((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]))
  }

  function toggleSic(code) {
    setSicCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }

  async function handleSearch() {
    if (localities.length === 0) { setError('Pick at least one town.'); return }
    setSearching(true)
    setError('')
    setResults(null)
    try {
      const allSic = [...sicCodes, ...customSic.split(',').map((s) => s.trim()).filter(Boolean)]
      const rows = await searchLeads({ localities: localities.slice(0, MAX_LOCALITIES), sicCodes: allSic, companyStatus: status }, session.access_token)
      setResults(rows)
    } catch (err) {
      setError(err.message || 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function handleAdd(company) {
    setAddingNumber(company.companyNumber)
    setError('')
    try {
      const sicLabel = company.sicCodes.map((c) => SIC_PRESETS.find((p) => p.code === c)?.label || c).join(', ')
      const opp = await createOpportunityForNewLead(
        {
          business_name: company.companyName,
          site_address: formatAddress(company.address),
          notes: `Found via the Companies House lead finder (company no. ${company.companyNumber}${sicLabel ? `, ${sicLabel}` : ''}, incorporated ${company.incorporatedOn || 'unknown'}).\nThis is the registered office address, which may differ from where they actually trade. Employee count and contact details aren't available from Companies House — confirm these directly before reaching out.`,
        },
        { stage: 'new' },
        userId,
      )
      setAddedNumbers((prev) => new Set(prev).add(company.companyNumber))
      onLeadAdded?.()
      runEnrichment(company, opp)
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingNumber(null)
    }
  }

  // Fires after the opportunity is created — never blocks the "Added"
  // state on it, since the website guess can take a few seconds and
  // sometimes finds nothing at all.
  function runEnrichment(company, opp) {
    const clientId = opp?.clients?.id
    if (!clientId) return
    setEnrichStatus((s) => ({ ...s, [company.companyNumber]: 'searching' }))
    enrichLead(company.companyName, session.access_token)
      .then(async (result) => {
        if (!result?.website) {
          setEnrichStatus((s) => ({ ...s, [company.companyNumber]: 'none' }))
          return
        }
        await updateClient(clientId, { website: result.website })
        await addActivity(clientId, buildEnrichmentNote(result), userId)
        setEnrichStatus((s) => ({ ...s, [company.companyNumber]: 'found' }))
        onLeadAdded?.()
      })
      .catch(() => {
        setEnrichStatus((s) => ({ ...s, [company.companyNumber]: 'error' }))
      })
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
        <div className="flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-md bg-paper shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-4">
            <h2 className="font-display text-lg font-semibold">Find leads</h2>
            <button onClick={onClose} className="rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">✕</button>
          </div>

          <div className="overflow-y-auto px-5 py-4">
            <p className="mb-4 rounded-[6px] border border-stone bg-paper-dim p-3 text-[12px] leading-relaxed text-slate">
              Searches the UK's official <b className="text-ink">Companies House</b> register — never a scrape of any
              other site. Returns company name, registered office address, SIC code and incorporation date only.
              When you add one as an opportunity, it also tries to guess their website from the company name and
              checks it for a published contact — a best-effort, unverified guess, never a search engine or
              third-party platform. <b className="text-ink">Always confirm details before reaching out</b>, and make
              sure any outreach identifies A-IT clearly and offers an opt-out (PECR).
            </p>

            {error && (
              <p className="mb-4 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">{error}</p>
            )}

            <div className="mb-3.5">
              <label className="mb-1.5 block text-[12.5px] font-semibold">Towns (registered office locality)</label>
              <div className="flex flex-wrap gap-1.5">
                {DORSET_LOCALITIES.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocality(loc)}
                    aria-pressed={localities.includes(loc)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] ${localities.includes(loc) ? 'border-ink bg-ink text-paper' : 'border-stone bg-white text-slate hover:bg-paper-dim'}`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate">Up to {MAX_LOCALITIES} towns searched per request.</p>
            </div>

            <div className="mb-3.5">
              <label className="mb-1.5 block text-[12.5px] font-semibold">Industry (SIC code) — optional, narrows the search</label>
              <div className="flex flex-wrap gap-1.5">
                {SIC_PRESETS.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => toggleSic(s.code)}
                    aria-pressed={sicCodes.includes(s.code)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] ${sicCodes.includes(s.code) ? 'border-petrol bg-petrol/10 text-petrol-dark' : 'border-stone bg-white text-slate hover:bg-paper-dim'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Custom SIC codes, comma-separated…"
                value={customSic}
                onChange={(e) => setCustomSic(e.target.value)}
                className="field-input mt-1.5"
              />
            </div>

            <div className="mb-4 flex items-end gap-3">
              <div>
                <label className="mb-1.5 block text-[12.5px] font-semibold">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="field-input w-auto">
                  {COMPANY_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <button onClick={handleSearch} disabled={searching} className="btn btn-primary disabled:opacity-50">
                {searching ? 'Searching…' : 'Search Companies House'}
              </button>
            </div>

            {results && (
              results.length === 0 ? (
                <p className="text-[13px] text-slate">No companies matched — try different towns or fewer SIC filters.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-stone">
                  <div className="border-b border-stone bg-paper-dim px-3 py-2 text-[11.5px] text-slate">{results.length} companies found</div>
                  {results.map((c) => (
                    <div key={c.companyNumber} className="flex items-center gap-2.5 border-b border-stone bg-white px-3 py-2.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{c.companyName}</div>
                        <div className="truncate text-[11.5px] text-slate">
                          {formatAddress(c.address)} · {c.incorporatedOn ? `inc. ${fmtDate(c.incorporatedOn)}` : 'incorporation date unknown'}
                        </div>
                        {enrichStatus[c.companyNumber] && (
                          <div className="mt-0.5 text-[11px] text-petrol">{enrichLabel(enrichStatus[c.companyNumber])}</div>
                        )}
                      </div>
                      <button
                        onClick={() => handleAdd(c)}
                        disabled={addingNumber === c.companyNumber || addedNumbers.has(c.companyNumber)}
                        className="btn btn-ghost shrink-0 px-2.5 py-1 text-[12px] disabled:opacity-50"
                      >
                        {addedNumbers.has(c.companyNumber) ? 'Added ✓' : addingNumber === c.companyNumber ? 'Adding…' : '+ Add as opportunity'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  )
}
