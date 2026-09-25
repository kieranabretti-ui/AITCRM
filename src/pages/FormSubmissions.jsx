import { useEffect, useState } from 'react'
import { fetchFormSubmissions } from '../lib/formSubmissionsApi.js'
import { fmtDateTime } from '../lib/pricing.js'
import { FormSubmissionStatusBadge } from '../components/Badges.jsx'

export default function FormSubmissions() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function reload() {
    setLoading(true)
    fetchFormSubmissions()
      .then(setSubmissions)
      .catch((err) => setError(err.message || 'Could not load form submissions.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  if (loading) return <div className="py-24 text-center text-slate">Loading form submissions…</div>

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Form submissions</h1>
        <button onClick={reload} className="btn btn-ghost px-2.5 py-1 text-[12px]">Refresh</button>
      </div>
      <p className="mb-6 max-w-[65ch] text-slate">
        Every attempt to reach the Dorset IT Support landing page's webhook lands here — not just the ones that
        became a lead. If a submission isn't showing up as expected, this is where to find out why: a bad or
        missing secret, a payload the CRM couldn't make sense of, or a genuine error all show up as their own row,
        instead of just silently not creating a lead.
      </p>

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
          {error}
        </p>
      )}

      {submissions.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">Nothing has arrived yet</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">
            Submit the landing page form to test it — a row should appear here within a few seconds either way,
            whether or not it becomes a lead.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {submissions.map((s) => (
            <SubmissionRow key={s.id} submission={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionRow({ submission: s }) {
  const who = [s.submitted_name, s.submitted_company].filter(Boolean).join(' · ') || '(no name or company on the submission)'
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{who}</span>
            <FormSubmissionStatusBadge status={s.status} />
          </div>
          <div className="mt-1 text-[12.5px] text-slate">
            {s.submitted_email || 'no email on the submission'} · {fmtDateTime(s.received_at)}
          </div>
          {s.status_detail && (
            <div className="mt-1.5 text-[12.5px] text-ink/80">{s.status_detail}</div>
          )}
          {s.status === 'lead_created' && s.clients?.business_name && (
            <div className="mt-1.5 text-[12px] text-slate">
              Created as <span className="font-semibold text-ink">{s.clients.business_name}</span> on the Sales page.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
