// Car types are admin-editable (Manage tab) and stored as a JSON array in
// settings.car_types. Until the admin changes them, the original six apply.
export const DEFAULT_CAR_TYPES = ['Hatchback', 'Sedan', 'Compact SUV', 'Mid SUV', 'Large SUV', 'Luxury Car'];

export async function getCarTypes(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'car_types'").first();
  if (row) {
    try {
      const list = JSON.parse(row.value);
      if (Array.isArray(list) && list.length) return list;
    } catch {}
  }
  return DEFAULT_CAR_TYPES;
}

export async function saveCarTypes(env, list) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('car_types', ?)")
    .bind(JSON.stringify(list)).run();
}
