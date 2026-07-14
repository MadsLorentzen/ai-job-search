import { describe, expect, test } from "bun:test";
import {
  resolveCity,
  buildSearchUrl,
  idFromHref,
  urlFromHref,
  realSalary,
  companyFromTitle,
} from "../src/helpers";
import {
  shapeResults,
  shouldStopScrolling,
  NO_GROWTH_STOP_THRESHOLD,
  MAX_SCROLL_STEPS,
  type RawCard,
} from "../src/commands/search";
import { shapeDetail, normalizeUrl, type RawDetail } from "../src/commands/detail";

describe("resolveCity", () => {
  test("resolves known Chinese city names", () => {
    expect(resolveCity("上海")).toBe("101020100");
    expect(resolveCity("杭州")).toBe("101210100");
  });

  test("resolves known English aliases case-insensitively", () => {
    expect(resolveCity("shanghai")).toBe("101020100");
    expect(resolveCity("Shanghai")).toBe("101020100");
  });

  test("passes through a raw 9-digit city code", () => {
    expect(resolveCity("101280600")).toBe("101280600");
  });

  test("returns null for an unknown city", () => {
    expect(resolveCity("Atlantis")).toBeNull();
  });
});

describe("buildSearchUrl", () => {
  test("includes query and city params", () => {
    const url = buildSearchUrl("安全运营", "101020100");
    expect(url).toContain("/web/geek/job?");
    expect(url).toContain("city=101020100");
    expect(url).toContain(encodeURIComponent("安全运营"));
  });

  test("omits query param when query is empty", () => {
    const url = buildSearchUrl("", "101020100");
    expect(url).not.toContain("query=");
  });
});

describe("idFromHref / urlFromHref", () => {
  test("extracts the id from a relative job_detail href", () => {
    expect(idFromHref("/job_detail/cf386d859ead4dc40nF92NS0FVNX.html")).toBe(
      "cf386d859ead4dc40nF92NS0FVNX",
    );
  });

  test("handles ids containing a hyphen", () => {
    expect(idFromHref("/job_detail/0d52d083a8216edb0nF-39u5FlZY.html")).toBe(
      "0d52d083a8216edb0nF-39u5FlZY",
    );
  });

  test("returns null for a non-matching href", () => {
    expect(idFromHref("/gongsi/whatever.html")).toBeNull();
    expect(idFromHref(null)).toBeNull();
  });

  test("urlFromHref prefixes relative hrefs with the base URL", () => {
    expect(urlFromHref("/job_detail/abc.html")).toBe("https://www.zhipin.com/job_detail/abc.html");
  });

  test("urlFromHref leaves absolute URLs untouched", () => {
    expect(urlFromHref("https://www.zhipin.com/job_detail/abc.html")).toBe(
      "https://www.zhipin.com/job_detail/abc.html",
    );
  });
});

describe("realSalary", () => {
  test("treats the masked list-view placeholder as missing data", () => {
    expect(realSalary("-K")).toBeNull();
    expect(realSalary("-K·薪")).toBeNull();
  });

  test("passes through a real salary string", () => {
    expect(realSalary("25-40K")).toBe("25-40K");
    expect(realSalary("20-40K·16薪")).toBe("20-40K·16薪");
  });

  test("null in is null out", () => {
    expect(realSalary(null)).toBeNull();
  });
});

describe("companyFromTitle", () => {
  test("extracts the company name from the detail page <title>", () => {
    expect(companyFromTitle("「安全运营工程师招聘」_NIO蔚来招聘-BOSS直聘")).toBe("NIO蔚来");
  });

  test("returns null when the title doesn't match the expected shape", () => {
    expect(companyFromTitle("BOSS直聘")).toBeNull();
  });
});

describe("normalizeUrl (detail)", () => {
  test("passes an absolute URL through unchanged", () => {
    expect(normalizeUrl("https://www.zhipin.com/job_detail/abc.html")).toBe(
      "https://www.zhipin.com/job_detail/abc.html",
    );
  });

  test("builds a job_detail URL from a bare id (including hyphens/tildes)", () => {
    expect(normalizeUrl("0d52d083a8216edb0nF-39u5FlZY")).toBe(
      "https://www.zhipin.com/job_detail/0d52d083a8216edb0nF-39u5FlZY.html",
    );
  });

  test("rejects an id with disallowed characters", () => {
    expect(normalizeUrl("not a valid id!!")).toBeNull();
  });
});

describe("shapeResults", () => {
  function card(overrides: Partial<RawCard> = {}): RawCard {
    return {
      href: "/job_detail/abc123.html",
      title: "安全运营工程师",
      company: "NIO蔚来",
      companyHref: "/gongsi/xyz.html",
      location: "上海·嘉定区·安亭",
      salaryRaw: "-K",
      experience: "1-3年",
      education: "本科",
      ...overrides,
    };
  }

  test("maps a raw card to the documented JobCard shape", () => {
    const [result] = shapeResults([card()]);
    expect(result).toMatchObject({
      id: "abc123",
      title: "安全运营工程师",
      company: "NIO蔚来",
      location: "上海·嘉定区·安亭",
      date: null,
      url: "https://www.zhipin.com/job_detail/abc123.html",
      salary: null, // masked placeholder -> null
      experience: "1-3年",
      education: "本科",
    });
  });

  test("drops cards with no extractable id or title", () => {
    const results = shapeResults([card({ href: null }), card({ title: null })]);
    expect(results).toHaveLength(0);
  });

  test("respects the limit", () => {
    const results = shapeResults([card(), card({ href: "/job_detail/def456.html" })], 1);
    expect(results).toHaveLength(1);
  });

  test("passes through a real (unmasked) salary if the page ever stops masking it", () => {
    const [result] = shapeResults([card({ salaryRaw: "25-40K" })]);
    expect(result.salary).toBe("25-40K");
  });
});

describe("shouldStopScrolling", () => {
  test("stops once the card count reaches the target", () => {
    expect(
      shouldStopScrolling({ count: 45, target: 45, noGrowthStreak: 0, steps: 3 }),
    ).toBe(true);
  });

  test("stops after the no-growth streak crosses the threshold", () => {
    expect(
      shouldStopScrolling({
        count: 15,
        target: 90,
        noGrowthStreak: NO_GROWTH_STOP_THRESHOLD,
        steps: 2,
      }),
    ).toBe(true);
  });

  test("stops once the safety ceiling of scroll steps is hit", () => {
    expect(
      shouldStopScrolling({ count: 30, target: 90, noGrowthStreak: 0, steps: MAX_SCROLL_STEPS }),
    ).toBe(true);
  });

  test("keeps scrolling when none of the stop conditions are met", () => {
    expect(
      shouldStopScrolling({ count: 15, target: 45, noGrowthStreak: 1, steps: 2 }),
    ).toBe(false);
  });
});

describe("shapeDetail", () => {
  function detail(overrides: Partial<RawDetail> = {}): RawDetail {
    return {
      title: "安全运营工程师",
      salary: "25-40K",
      city: "上海",
      experience: "1-3年",
      education: "本科",
      address: "上海嘉定区蔚来汽车",
      company: "NIO蔚来",
      description: "职位描述...",
      pageTitle: "「安全运营工程师招聘」_NIO蔚来招聘-BOSS直聘",
      ...overrides,
    };
  }

  const URL = "https://www.zhipin.com/job_detail/abc123.html";

  test("maps raw detail data to the documented JobDetail shape", () => {
    const job = shapeDetail(detail(), URL);
    expect(job).toMatchObject({
      id: "abc123",
      title: "安全运营工程师",
      company: "NIO蔚来",
      location: "上海嘉定区蔚来汽车",
      salary: "25-40K",
      experience: "1-3年",
      education: "本科",
      description: "职位描述...",
      url: URL,
    });
  });

  test("falls back to the page-title company when the sidebar selector is empty", () => {
    const job = shapeDetail(detail({ company: null }), URL);
    expect(job?.company).toBe("NIO蔚来");
  });

  test("falls back to city when no full address is present", () => {
    const job = shapeDetail(detail({ address: null }), URL);
    expect(job?.location).toBe("上海");
  });

  test("returns null when the page didn't render (no title)", () => {
    expect(shapeDetail(detail({ title: null }), URL)).toBeNull();
  });
});
