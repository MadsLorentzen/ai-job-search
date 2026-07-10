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

async function detail() {
  try {
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

detail();
