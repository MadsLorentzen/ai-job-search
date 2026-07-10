import { parseArgs } from "util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    query: { type: "string", short: "q" },
    location: { type: "string", short: "l" },
    jobage: { type: "string" },
    limit: { type: "string" },
    format: { type: "string" },
  },
});

const query = (values.query || "").toLowerCase();
const location = (values.location || "").toLowerCase();
const limit = parseInt(values.limit || "20", 10);

async function search() {
  try {
    const res = await fetch("https://api.justjoin.it/v2/user-panel/offers?page=1&perPage=100&sortBy=published&orderBy=DESC", {
      headers: { "Version": "2" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    
    let results = data.data || [];
    
    // Client-side filtering because API search params are undocumented
    if (query) {
      results = results.filter((j: any) => 
        j.title.toLowerCase().includes(query) || 
        (j.companyName && j.companyName.toLowerCase().includes(query)) ||
        (j.requiredSkills && j.requiredSkills.some((s: string) => s.toLowerCase().includes(query)))
      );
    }
    
    if (location) {
      results = results.filter((j: any) => 
        (j.city && j.city.toLowerCase().includes(location)) || 
        (j.multilocation && j.multilocation.some((m: any) => m.city && m.city.toLowerCase().includes(location)))
      );
    }
    
    // Sort by date (assuming id/slug gives some order or published date)
    // Map to standard format
    const mapped = results.slice(0, limit).map((j: any) => ({
      id: j.slug,
      title: j.title,
      company: j.companyName,
      location: j.city || "Remote",
      date: j.publishedAt || new Date().toISOString(),
      url: `https://justjoin.it/offers/${j.slug}`
    }));
    
    if (values.format === "table" || values.format === "plain") {
      mapped.forEach((r: any) => console.log(`${r.id} | ${r.title} | ${r.company} | ${r.url}`));
    } else {
      console.log(JSON.stringify({ meta: { count: mapped.length, page: 1 }, results: mapped }, null, 2));
    }
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message, code: "FETCH_ERROR" }));
    process.exit(1);
  }
}

search();
