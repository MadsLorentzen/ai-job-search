import { describe, expect, test } from "bun:test"
import {
  matchField,
  matchOption,
  normalizeLabel,
  resolveSponsorship,
  type Profile,
} from "../src/matcher.ts"

// Fixture only. Keep this synthetic: these tests are committed, so no real
// contact details belong here.
const profile: Profile = {
  identity: {
    firstName: "Jordan",
    lastName: "Rivera",
    email: "jordan.rivera@example.com",
    phone: "555-0100",
    city: "Springfield",
    state: "Illinois",
    postalCode: "62701",
    country: "United States",
  },
  links: {
    linkedin: "https://linkedin.com/in/example",
    github: "https://github.com/example",
    portfolio: "https://example.com/",
  },
  workAuthorization: {
    authorizedUS: true,
    requiresSponsorship: false,
    citizenshipStatus: "US Citizen",
    activeClearance: null,
    clearanceEligible: true,
  },
  eeo: {
    gender: "Decline to self-identify",
    race: "Decline to self-identify",
    veteranStatus: "Decline to self-identify",
    disabilityStatus: "Decline to self-identify",
  },
  preferences: {
    remotePreference: "Remote",
    willingToRelocate: false,
    desiredSalary: null,
    currentSalary: null,
    earliestStartDate: null,
    noticePeriod: null,
  },
  documents: { resume: "/tmp/resume.pdf", coverLetter: null },
  answers: {},
}

describe("normalizeLabel", () => {
  test("strips the required-marker asterisk and collapses whitespace", () => {
    expect(normalizeLabel("  First   Name *  ")).toBe("first name")
  })

  test("drops punctuation but keeps slashes and plus signs", () => {
    expect(normalizeLabel("Email (work)?")).toBe("email work")
    expect(normalizeLabel("He/Him")).toBe("he/him")
  })
})

// The whole point of the tool. Getting these backwards is disqualifying.
describe("sponsorship and authorization polarity", () => {
  const auth = profile.workAuthorization

  test("'require sponsorship' answers No for someone who needs none", () => {
    expect(
      resolveSponsorship("Will you now or in the future require visa sponsorship?", auth),
    ).toBe(false)
  })

  test("'authorized to work' answers Yes", () => {
    expect(resolveSponsorship("Are you legally authorized to work in the United States?", auth)).toBe(
      true,
    )
  })

  test("'authorized to work WITHOUT sponsorship' answers Yes, not No", () => {
    expect(
      resolveSponsorship(
        "Are you legally authorized to work in the US without sponsorship?",
        auth,
      ),
    ).toBe(true)
  })

  test("'do NOT require sponsorship' answers Yes", () => {
    expect(
      resolveSponsorship("I do not require sponsorship to work in the United States", auth),
    ).toBe(true)
  })

  test("polarity inverts for a candidate who does need sponsorship", () => {
    const needsSponsor = { authorizedUS: false, requiresSponsorship: true }
    expect(resolveSponsorship("Do you require sponsorship?", needsSponsor)).toBe(true)
    expect(resolveSponsorship("Are you authorized to work in the US?", needsSponsor)).toBe(false)
  })

  test("returns null for unrelated labels", () => {
    expect(resolveSponsorship("First name", auth)).toBeNull()
  })

  test("routes through matchField as a boolean", () => {
    const m = matchField("Will you now or in the future require sponsorship?", profile)
    expect(m?.value).toEqual({ kind: "boolean", value: false })
    expect(m?.confidence).toBe("high")
  })
})

describe("identity fields", () => {
  test.each([
    ["First Name", "Jordan"],
    ["Last Name *", "Rivera"],
    ["Email", "jordan.rivera@example.com"],
    ["Phone", "555-0100"],
    ["City", "Springfield"],
    ["State", "Illinois"],
    ["Zip Code", "62701"],
  ])("%s -> %s", (label, expected) => {
    const m = matchField(label, profile)
    expect(m?.value).toEqual({ kind: "text", value: expected })
  })

  test("'Full name' composes first and last", () => {
    expect(matchField("Full name", profile)?.value).toEqual({
      kind: "text",
      value: "Jordan Rivera",
    })
  })

  test("specific name rules win over the generic 'name' rule", () => {
    expect(matchField("First name", profile)?.key).toBe("firstName")
    expect(matchField("Last name", profile)?.key).toBe("lastName")
  })

  test("'LinkedIn Profile' matches the link, not the generic name rule", () => {
    expect(matchField("LinkedIn Profile", profile)?.key).toBe("linkedin")
  })
})

describe("compensation is never volunteered", () => {
  test("desired salary stays unfilled when no floor is set", () => {
    expect(matchField("Desired salary", profile)).toBeNull()
    expect(matchField("What are your salary expectations?", profile)).toBeNull()
  })

  test("it fills only once the user sets a value, and flags it for review", () => {
    const withSalary = {
      ...profile,
      preferences: { ...profile.preferences, desiredSalary: "$150,000" },
    }
    const m = matchField("Desired salary", withSalary)
    expect(m?.value).toEqual({ kind: "text", value: "$150,000" })
    expect(m?.confidence).toBe("low")
  })
})

describe("unknown labels are left alone", () => {
  test.each([
    "Describe a time you disagreed with a coworker",
    "What is your favorite programming language and why?",
    "Please list three references",
  ])("%s -> null", (label) => {
    expect(matchField(label, profile)).toBeNull()
  })

  test("a matched concept with no profile data still returns null", () => {
    const noGithub = { ...profile, links: { ...profile.links, github: null } }
    expect(matchField("GitHub URL", noGithub)).toBeNull()
  })
})

describe("template placeholders never reach a form", () => {
  test.each(["CONFIRM", "TBD", "TODO", "xxxx", "[YOUR_LINKEDIN_URL]", "your_name_here"])(
    "%s is treated as missing data",
    (placeholder) => {
      const p = { ...profile, links: { ...profile.links, linkedin: placeholder } }
      expect(matchField("LinkedIn Profile", p)).toBeNull()
    },
  )

  test("a real value still fills", () => {
    expect(matchField("LinkedIn Profile", profile)?.value).toEqual({
      kind: "text",
      value: "https://linkedin.com/in/example",
    })
  })

  test("underscore-prefixed answer keys are file comments, not answers", () => {
    const withComment = {
      ...profile,
      answers: { _comment: "these are notes about comments" },
    }
    expect(matchField("Additional comments", withComment)).toBeNull()
  })
})

describe("user-supplied free-text answers", () => {
  test("a keyed answer matches a containing label", () => {
    const withAnswers = {
      ...profile,
      answers: { "how did you hear about": "LinkedIn" },
    }
    const m = matchField("How did you hear about us?", withAnswers)
    expect(m?.value).toEqual({ kind: "text", value: "LinkedIn" })
    expect(m?.confidence).toBe("low")
  })
})

describe("matchOption", () => {
  test("maps booleans onto Yes/No option sets", () => {
    expect(matchOption({ kind: "boolean", value: true }, ["Yes", "No"])).toBe("Yes")
    expect(matchOption({ kind: "boolean", value: false }, ["Yes", "No"])).toBe("No")
  })

  test("matches decline-to-identify across vendor phrasings", () => {
    const value = { kind: "choice" as const, value: "Decline to self-identify" }
    expect(matchOption(value, ["Male", "Female", "I don't wish to answer"])).toBe(
      "I don't wish to answer",
    )
    expect(matchOption(value, ["Male", "Female", "Prefer not to say"])).toBe("Prefer not to say")
  })

  test("returns null when nothing is a defensible match", () => {
    expect(matchOption({ kind: "choice", value: "Remote" }, ["Yes", "No"])).toBeNull()
    expect(matchOption({ kind: "boolean", value: true }, [])).toBeNull()
  })
})
