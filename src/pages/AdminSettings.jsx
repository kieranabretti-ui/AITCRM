import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchSettings, updateSetting } from '../lib/settingsApi.js'
import { CATEGORIES } from '../lib/categories.js'

const DEFAULTS = {
  ai_enabled: true,
  confidence_threshold: { high: 85, medium: 50 },
  sla_warning_minutes: 30,
  max_automation_attempts: 2,
  auto_responses_enabled: true,
  escalation_queue: 'Escalation',
  routing_map: Object.fromEntries(CATEGORIES.map((c) => [c, c === 'Backup' ? 'Backup/Infrastructure' : c === 'Security' || c === 'Account & Access' ? 'Security' : 'Support'])),
}

export default function AdminSettings() {
  const { user } = useAuth()
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    fetchSettings()
      .then((s) => setForm({ ...DEFAULTS, ...s, confidence_threshold: { ...DEFAULTS.confidence_threshold, ...s.confidence_threshold }, routing_map: { ...DEFAULTS.routing_map, ...s.routing_map } }))
      .catch((err) => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false))
  }, [])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await Promise.all(Object.entries(form).map(([key, value]) => updateSetting(key, value, user.id)))
      setMessage({ type: 'ok', text: 'Settings saved.' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-24 text-center text-slate">Loading settings…</div>

  return (
    <div className="max-w-[640px]">
      <h1 className="mb-6 font-display text-2xl font-semibold">Support bot settings</h1>

      <form onSubmit={handleSave} className="space-y-5">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">AI support bot</h2>
              <p className="mt-0.5 text-[12.5px] text-slate">
                Turn off to stop all automated triage, labelling and customer replies — Jira and the CRM keep working normally either way.
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" checked={form.ai_enabled} onChange={(e) => set('ai_enabled', e.target.checked)} className="h-4 w-4 accent-petrol" />
              {form.ai_enabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Confidence thresholds</h2>
          <p className="mb-3.5 text-[12.5px] text-slate">
            High confidence: automated triage and a safe reply where appropriate. Medium: classified and routed, but escalated to a human. Below medium: escalated without attempting anything.
          </p>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold">High confidence at or above (%)</label>
              <input
                type="number" min={0} max={100} className="field-input"
                value={form.confidence_threshold.high}
                onChange={(e) => set('confidence_threshold', { ...form.confidence_threshold, high: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold">Medium confidence at or above (%)</label>
              <input
                type="number" min={0} max={100} className="field-input"
                value={form.confidence_threshold.medium}
                onChange={(e) => set('confidence_threshold', { ...form.confidence_threshold, medium: Number(e.target.value) })}
              />
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3.5 font-semibold">Automation limits</h2>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold">SLA warning window (minutes)</label>
              <input type="number" min={1} className="field-input" value={form.sla_warning_minutes} onChange={(e) => set('sla_warning_minutes', Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold">Max automated attempts before escalating</label>
              <input type="number" min={0} className="field-input" value={form.max_automation_attempts} onChange={(e) => set('max_automation_attempts', Number(e.target.value))} />
            </div>
          </div>
          <label className="mt-3.5 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.auto_responses_enabled} onChange={(e) => set('auto_responses_enabled', e.target.checked)} className="h-4 w-4 accent-petrol" />
            Allow automatic low-risk customer replies (acknowledgement, request for info)
          </label>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Routing</h2>
          <p className="mb-3.5 text-[12.5px] text-slate">Which Jira queue each category routes to. Escalated tickets (P1, security, low confidence) always go to the escalation queue below, regardless of category.</p>
          <div className="mb-3.5">
            <label className="mb-1.5 block text-[12.5px] font-semibold">Escalation queue</label>
            <input type="text" className="field-input max-w-[240px]" value={form.escalation_queue} onChange={(e) => set('escalation_queue', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <label className="w-[124px] shrink-0 text-[12.5px] text-slate">{cat}</label>
                <input
                  type="text" className="field-input"
                  value={form.routing_map[cat] || ''}
                  onChange={(e) => set('routing_map', { ...form.routing_map, [cat]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>

        {message && (
          <p className={`rounded-[4px] border p-2.5 text-[12.5px] ${message.type === 'ok' ? 'border-petrol/30 bg-petrol/10 text-petrol-dark' : 'border-status-churned/30 bg-status-churned/10 text-status-churned'}`}>
            {message.text}
          </p>
        )}

        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}
