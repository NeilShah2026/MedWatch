// Minimal Supabase Management API client (used for SQL that the CLI cannot run non-interactively).
export async function runSql(env, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_DEV_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    throw new Error(`Management API query failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}
