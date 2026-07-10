import { parseArgs } from "util";

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
});

const idOrUrl = positionals[0];
if (!idOrUrl) {
  console.error(JSON.stringify({ error: "Missing ID or URL", code: "NO_ARGS" }));
  process.exit(1);
}

const slug = idOrUrl.replace("https://justjoin.it/offers/", "").split("?")[0];

async function detail() {
  try {
    const res = await fetch(`https://api.justjoin.it/v2/user-panel/offers/${slug}`, {
      headers: { "Version": "2" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    
    // Extract details
    const content = `
# ${data.title} at ${data.companyName}
Location: ${data.city || 'Remote'}
Salary: ${data.employmentTypes?.[0]?.from || 'N/A'} - ${data.employmentTypes?.[0]?.to || 'N/A'} ${data.employmentTypes?.[0]?.currency || ''}
Experience: ${data.experienceLevel || 'N/A'}

## Description
${data.body || 'No description provided.'}

## Skills
${(data.requiredSkills || []).join(", ")}
    `;
    console.log(content.trim());
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message, code: "FETCH_ERROR" }));
    process.exit(1);
  }
}

detail();
