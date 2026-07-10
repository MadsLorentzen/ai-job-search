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

async function search() {
  try {
    // Note: Pracuj.pl is heavily protected by Cloudflare anti-bot systems.
    // A standard fetch request will often receive a 403 Forbidden or a "Just a moment..." challenge.
    // 
    // To implement this fully, consider:
    // 1. Using a headless browser via Puppeteer/Playwright
    // 2. Finding an alternative open API endpoint (e.g. mobile app API)
    // 3. Passing specific user-agent and headers to bypass simple checks
    
    console.error(JSON.stringify({ 
      error: "Pracuj.pl blocks simple HTTP requests via Cloudflare. Implementation requires browser automation.", 
      code: "CLOUDFLARE_BLOCK" 
    }));
    process.exit(1);

  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message, code: "FETCH_ERROR" }));
    process.exit(1);
  }
}

search();
