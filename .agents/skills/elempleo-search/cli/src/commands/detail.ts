import { htmlFetch, parseJobDetail, writeError, normalizeId } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const normalized = normalizeId(opts.id)
  if (!normalized) {
    writeError(
      `Use a full URL from search results (numeric IDs alone don't work for Elempleo). ` +
      `Example: detail "https://www.elempleo.com/co/ofertas-trabajo/...-ID"`,
      "BAD_ID",
    )
    return 1
  }
  const url = normalized.url

  try {
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, opts.id, url)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.salary ? `Salario: ${job.salary}` : "",
        job.contractType ? `Contrato: ${job.contractType}` : "",
        job.workMode ? `Modalidad: ${job.workMode}` : "",
        job.experienceLevel ? `Nivel: ${job.experienceLevel}` : "",
        "",
        job.description || "(sin descripción)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
