// Loads the admin-configurable settings table, with defaults matching
// the migration's seed values — so the bot behaves sensibly even if a
// row is missing (e.g. someone deleted it, or the migration hasn't run
// on this database yet).
const DEFAULTS = {
  ai_enabled: true,
  confidence_threshold: { high: 85, medium: 50 },
  sla_warning_minutes: 30,
  max_automation_attempts: 2,
  auto_responses_enabled: true,
  escalation_queue: 'Escalation',
  routing_map: {
    Security: 'Security',
    'Account & Access': 'Security',
    'Microsoft 365': 'Microsoft 365',
    Backup: 'Backup/Infrastructure',
    Network: 'Support',
    Endpoint: 'Support',
    Hardware: 'Support',
    Software: 'Support',
    'New User': 'Support',
    'User Change': 'Support',
    Other: 'Support',
  },
}

async function loadSettings(admin) {
  const { data, error } = await admin.from('settings').select('key, value')
  const settings = { ...DEFAULTS }
  if (!error && data) {
    for (const row of data) settings[row.key] = row.value
  }
  return settings
}

module.exports = { loadSettings, DEFAULTS }
