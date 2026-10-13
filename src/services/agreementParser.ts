import mammoth from "mammoth";
import { dirname, join } from "node:path";
import yauzl from "yauzl";

export type AgreementDetails = {
  name: string;
  email: string;
  phone: string;
  event_date: string;
  start_time: string;
  location: string;
  hours: string;
  bartenders_needed: string;
  guest_count: string;
  total_price: string;
  deposit_amount: string;
  drinks_serving: string;
  service_type: string;
  deposit_paid: boolean;
  balance_paid: boolean;
};

export function emptyDetails(): AgreementDetails {
  return {
    name: "",
    email: "",
    phone: "",
    event_date: "",
    start_time: "",
    location: "",
    hours: "",
    bartenders_needed: "",
    guest_count: "",
    total_price: "",
    deposit_amount: "",
    drinks_serving: "",
    service_type: "",
    deposit_paid: false,
    balance_paid: false,
  };
}

export function normalizeDate(value: string): string {
  const numeric = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const named = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i,
  );
  let y: number, m: number, d: number;
  if (iso) [, y, m, d] = iso.map(Number);
  else if (numeric) {
    m = +numeric[1];
    d = +numeric[2];
    y = +numeric[3];
  } else if (named) {
    m =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    d = +named[2];
    y = +named[3];
  } else return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 &&
    y <= 2100 &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : "";
}

export function parseAgreementText(text: string): AgreementDetails {
  const result = emptyDetails();
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Only labelled values are suggested. Boilerplate and payment terms aren't proof of payment.
  function label(pattern: string) {
    const regex = new RegExp(`^(?:${pattern})\\s*[:–—-]\\s*(.*)$`, "i");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(regex);
      if (match)
        return (
          match[1] ||
          (lines[i + 1]?.includes(":") ? "" : lines[i + 1]) ||
          ""
        ).trim();
    }
    return "";
  }
  const money = (value: string) => {
    const match = value
      .replace(/,/g, "")
      .match(/^\$?\s*(\d+(?:\.\d{1,2})?)(?![\d.%])/);
    return match && !value.includes("%") ? match[1] : "";
  };
  const integer = (value: string) => value.match(/^\d+(?![\d.])\b/)?.[0] || "";
  result.name = label(
    "client(?: name)?|customer(?: name)?|contact name|booked by",
  );
  result.email =
    label("(?:client |customer |contact )?e-?mail(?: address)?").match(
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    )?.[0] || "";
  result.phone = label(
    "(?:client |customer |contact )?phone(?: number)?|telephone",
  );
  result.event_date = normalizeDate(
    label("event date|date of event|service date"),
  );
  const time = label(
    "start time|event start(?: time)?|service start(?: time)?",
  ).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (time) {
    let h = +time[1];
    const min = +(time[2] || 0);
    if (time[3] && h >= 1 && h <= 12)
      h = (h % 12) + (time[3].toLowerCase() === "pm" ? 12 : 0);
    if (h < 24 && min < 60)
      result.start_time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  result.location = label(
    "event location|location|venue(?: address)?|event address",
  );
  result.hours = integer(
    label("service hours|hours of service|duration|hours"),
  );
  result.bartenders_needed = integer(
    label("bartenders(?: needed)?|number of bartenders|bartender count"),
  );
  result.guest_count = integer(label("guests|guest count|number of guests"));
  result.total_price = money(
    label("total(?: price| cost| amount| fee)?|contract total|grand total"),
  );
  result.deposit_amount = money(
    label("deposit(?: amount|required)?|retainer(?: amount)?"),
  );
  result.drinks_serving = label(
    "drinks(?: serving| served| menu)?|drink menu|beverages(?: served)?|cocktail menu",
  );
  const service = label("service(?: type)?");
  if (/soda/i.test(service)) result.service_type = "soda";
  else if (/bartend|bar service/i.test(service))
    result.service_type = "bartending";
  return result;
}

async function validateWordZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(new Error("This Word file could not be read."));
      let bytes = 0,
        entries = 0,
        document = false;
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        bytes += entry.uncompressedSize;
        entries++;
        if (bytes > 25 * 1024 * 1024 || entries > 1000 || entry.isEncrypted()) {
          zip.close();
          reject(
            new Error(
              "This Word file is too large or encrypted. Export it as a PDF.",
            ),
          );
          return;
        }
        if (entry.fileName === "word/document.xml") document = true;
        zip.readEntry();
      });
      zip.on("end", () =>
        document
          ? resolve()
          : reject(new Error("Please upload a valid .docx agreement.")),
      );
      zip.readEntry();
    });
  });
}

export async function extractAgreement(buffer: Buffer, extension: string) {
  let text = "";
  if (extension === "pdf") {
    if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("Please upload a valid PDF agreement.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl:
        join(
          dirname(require.resolve("pdfjs-dist/package.json")),
          "standard_fonts",
        ) + "/",
    });
    const timer = setTimeout(() => {
      void task.destroy();
    }, 20000);
    try {
      const doc = await task.promise;
      if (doc.numPages > 30)
        throw new Error("Please upload an agreement with 30 pages or fewer.");
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("") + "\n";
        page.cleanup();
        if (text.length > 100000)
          throw new Error(
            "This agreement contains too much text. Upload a shorter document.",
          );
      }
    } finally {
      clearTimeout(timer);
      await task.destroy();
    }
  } else if (extension === "docx") {
    await validateWordZip(buffer);
    text = (await mammoth.extractRawText({ buffer })).value;
    if (text.length > 100000)
      throw new Error(
        "This agreement contains too much text. Upload a shorter document.",
      );
  } else throw new Error("Choose a PDF or Word (.docx) agreement.");
  const details = parseAgreementText(text);
  return {
    details,
    warnings: [
      text.trim().length < 30
        ? "This looks like a scan or image-only agreement. Fill in the details below using the original."
        : "We filled in the labelled details we could read. Check every field against the agreement; blanks need your input.",
      "Payment status must be confirmed by you; a signed agreement does not prove payment.",
    ],
    excerpt: text.slice(0, 20000),
  };
}

export function validateDetails(value: unknown): AgreementDetails | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>,
    details = emptyDetails();
  for (const key of Object.keys(details) as (keyof AgreementDetails)[]) {
    if (key === "deposit_paid" || key === "balance_paid") {
      if (typeof input[key] !== "boolean") return null;
      details[key] = input[key] as boolean;
    } else {
      if (typeof input[key] !== "string") return null;
      details[key] = (input[key] as string).trim();
    }
  }
  if (
    !details.name ||
    details.name.length > 200 ||
    !details.location ||
    details.location.length > 1000 ||
    details.phone.length > 50 ||
    details.drinks_serving.length > 2000
  )
    return null;
  if (
    details.email &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email) ||
      details.email.length > 254)
  )
    return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(details.event_date) ||
    normalizeDate(details.event_date) !== details.event_date
  )
    return null;
  if (
    details.start_time &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(details.start_time)
  )
    return null;
  for (const [key, max, optional] of [
    ["hours", 168, false],
    ["bartenders_needed", 100, false],
    ["guest_count", 100000, true],
  ] as const) {
    if (optional && details[key] === "") continue;
    if (!/^\d+$/.test(details[key]) || Number(details[key]) > max) return null;
  }
  if (Number(details.hours) < 1) return null;
  for (const key of ["total_price", "deposit_amount"] as const)
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(details[key]) ||
      Number(details[key]) > 1000000
    )
      return null;
  if (
    Number(details.deposit_amount) > Number(details.total_price) ||
    (details.balance_paid && !details.deposit_paid)
  )
    return null;
  if (!["soda", "bartending"].includes(details.service_type)) return null;
  details.email = details.email.toLowerCase();
  return details;
}
