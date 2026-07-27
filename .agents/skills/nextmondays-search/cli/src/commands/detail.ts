import { BASE, htmlFetch, normalizeId, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a mission reference from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // The URL slug is decorative — `/jobs/<id>` resolves on its own.
    const html = await htmlFetch(`${BASE}/jobs/${id}`)
    if (!html || !/wrapper-job-title/i.test(html)) {
      writeError("Mission not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        job.subtitle ? job.subtitle : "",
        `${job.location || "—"} · ${job.tjm !== null ? `${job.tjm} ${job.currency ?? ""}`.trim() + "/j" : "TJM —"} · ${job.duration || "durée —"}`,
        job.date ? `Publiée : ${job.date}` : "",
        job.group ? `Domaine : ${job.group}` : "",
        job.employmentType ? `Contrat : ${job.employmentType}` : "",
        job.filled ? "STATUT : offre pourvue" : "",
        "",
        `Client final : non nommé (mission via ${job.intermediary})`,
        job.keyPoints.length ? `Points forts : ${job.keyPoints.join(" · ")}` : "",
        job.tags.length ? `Mots clés : ${job.tags.join(", ")}` : "",
        "",
        job.description || "(pas de description)",
        "",
        job.recruiter ? `Contact : ${job.recruiter}${job.recruiterEmail ? ` <${job.recruiterEmail}>` : ""}` : "",
        `URL : ${job.url}`,
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
