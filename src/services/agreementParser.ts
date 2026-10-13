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
  city: string;
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
    city: "",
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
  // PDF text runs can split superscript ordinals and even the two day digits.
  value = value.replace(
    /\b([A-Za-z]+\.?)\s+(\d)\s*(\d?)\s*(?:st|nd|rd|th)?\s*,?\s+(\d{4})\b/gi,
    "$1 $2$3, $4",
  );
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
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
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
    "client(?: name)?|customer(?: name)?|contact name|booked by|name",
  );
  result.email =
    label("(?:client |customer |contact )?e-?mail(?: address)?").match(
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    )?.[0] || "";
  result.phone = label(
    "(?:client |customer |contact )?phone(?: number)?|telephone",
  );
  result.event_date = normalizeDate(
    label("event date|date of events?|service date"),
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
  result.city = label("(?:event |venue )?city");
  if (!result.city) {
    const intro = lines.join(" ").split(/WHEREAS/i)[0];
    const clientAddress = intro.match(/\bClient Name:.*?\bAddress:\s*(.{1,300})$/i)?.[1] || "";
    result.city = cityFromAddress(result.location) || cityFromAddress(clientAddress);
  }
  const labelledHours = label("service hours|hours of service|duration|hours").match(/^\d+(?:\.\d+)?\b/)?.[0] || "";
  if (validServiceHours(labelledHours)) result.hours = labelledHours;
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
  else if (/portable(?: fold)? bar|pop[- ]?up bar/i.test(service)) result.service_type = "portable_bar";
  else if (/bartend|bar service/i.test(service))
    result.service_type = "bartending";
  // Older agreements put event details in prose instead of form-style labels.
  // Keep these fallbacks tied to explicit event/service/payment wording.
  const prose = lines.join(" ").replace(/\s+/g, " ");
  if (!result.event_date) {
    const eventDate = prose.match(/\b(?:date of events?|event date|service date)\b\s*:?\s*(.{1,100})/i);
    if (eventDate) result.event_date = normalizeDate(eventDate[1]);
  }
  if (!result.bartenders_needed) {
    const staff = prose.match(/\bCompany\s+(?:is to|will|shall)\s+(?:supply|provider?)\s+(?:client with\s+)?(\d+)\s+bartenders?\b/i);
    if (staff) result.bartenders_needed = staff[1];
    else result.bartenders_needed = prose.match(/\bClient needs\s+(\d+)\s+bartenders?\b/i)?.[1]
      || prose.match(/\bbartending service\s*\(only (\d+) needed\)/i)?.[1] || "";
  }
  if (!result.hours) {
    // Service time excludes travel, setup and cleanup. Don't round fractional hours.
    const durations = [...prose.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\s+(?:of\s+)?(?:service|serving)\b/gi)]
      .map((match) => match[1]);
    const unique = [...new Set(durations)];
    if (unique.length === 1 && validServiceHours(unique[0])) result.hours = unique[0];
  }
  if (!service && result.bartenders_needed && Number(result.bartenders_needed) > 0)
    result.service_type = "bartending";

  const serviceDescription = prose.match(/Services Description\.\s*(.*?)\b(?:3\.\s*)?TERM OF SERVICES\b/i)?.[1] || "";
  if (!service && !result.service_type && /\b(?:bartending service|(?:mobile bar|tap) trailer)\b/i.test(serviceDescription))
    result.service_type = "bartending";

  if (!service && /\bCompany\s+(?:(?:is to|will|shall|agrees to)\s+)?(?:also\s+)?(?:supply|provide)\b[^.!?]{0,100}\b(?:portable(?: fold)? bars?|pop[- ]?up bars?)\b/i.test(serviceDescription))
    result.service_type = "portable_bar";

  // Only explicit serving ranges can supply service hours/start time. A contracted
  // shift can include travel/setup; don't silently treat its start as serving time.
  const servingRange = serviceDescription.match(/\b(?:service(?: time)?|serve)\s+from\s*\(?\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i);
  if (servingRange) {
    const start = clockMinutes(servingRange[1]), end = clockMinutes(servingRange[2]);
    if (start !== null && end !== null && end > start) {
      if (!result.start_time) result.start_time = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
      if (!result.hours && validServiceHours(String((end - start) / 60))) result.hours = String((end - start) / 60);
    }
  }

  // Read the stated payment base, not equipment line items, security deposits,
  // late fees or a price reconstructed from hourly rates.
  const bookingPayment = prose.match(
    /\bClient shall pay Company as follows:\s*(\d+(?:\.\d+)?)%\s+of\s+(?:the\s+)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d])/i,
  );
  if (bookingPayment) {
    const percent = Number(bookingPayment[1]);
    const total = Number(bookingPayment[2].replace(/,/g, ""));
    if (percent > 0 && percent <= 100 && total > 0 && total <= 1000000) {
      if (!result.total_price) result.total_price = total.toFixed(2);
      if (!result.deposit_amount && Number(result.total_price) === total)
        result.deposit_amount = (Math.round(total * percent) / 100).toFixed(2);
    }
  }
  return result;
}

function validServiceHours(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 0.5 && Number(value) <= 168 && Number.isInteger(Number(value) * 2);
}

export function cityFromAddress(address: string): string {
  const prefix = address.match(/^(.*),\s*(?:CO|Colorado)\b/i)?.[1]?.trim();
  if (!prefix) return "";
  // Prefer a delimited city; never use the business's address elsewhere in the contract.
  const delimited = prefix.match(/(?:,|\bin)\s+([A-Za-z][A-Za-z .'-]{1,79})$/i)?.[1];
  if (delimited) return delimited.trim();
  const local = prefix.match(/\b(Colorado Springs|Highlands? Ranch|Castle Rock|Commerce City|Wheat Ridge|Fort Collins|Fort Lupton|Estes Park|Mountain View|Denver|Golden|Boulder|Littleton|Lakewood|Parker|Centennial|Arvada|Aurora|Broomfield|Westminster|Frisco|Sedalia|Bennett?|Johns?ton|Johnstown)\s*$/i);
  return local?.[1] || "";
}

function clockMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i);
  if (!match || +match[1] < 1 || +match[1] > 12 || +(match[2] || 0) > 59) return null;
  return ((+match[1] % 12) + (match[3].toLowerCase() === "p" ? 12 : 0)) * 60 + +(match[2] || 0);
}

export function agreementReviewWarnings(text: string, details: AgreementDetails, filename = ""): string[] {
  const prose = text.replace(/\s+/g, " ");
  const warnings: string[] = [];
  const address = prose.split(/WHEREAS/i)[0].match(/\bClient Name:.*?\bAddress:\s*(.{1,300})$/i)?.[1]?.trim();
  if (!details.location && address)
    warnings.push(`The client address is listed as "${address}". Confirm whether this is the event venue before entering it.`);
  const introName = prose.split(/WHEREAS/i)[0].match(/\bClient Name:\s*(.*?)\s*(?:,?\s*located at|Address:)/i)?.[1]?.trim();
  if (introName && details.name && introName.toLowerCase() !== details.name.toLowerCase())
    warnings.push(`The opening names "${introName}" differ from the contact name "${details.name}". Confirm the spelling.`);
  const serviceSection = prose.match(/Services Description\.\s*(.*?)\b(?:3\.\s*)?TERM OF SERVICES\b/i)?.[1] || "";
  const serviceRange = serviceSection.match(/\b(?:service(?: time)?|serve)\s+from\s*\(?\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i);
  if (serviceRange && !details.hours) {
    const start = clockMinutes(serviceRange[1]), end = clockMinutes(serviceRange[2]);
    if (start !== null && end !== null && end > start)
      warnings.push(`The stated serving window is ${serviceRange[1]}–${serviceRange[2]} (${(end - start) / 60} hours). The event form accepts 30-minute increments; confirm how to record the duration.`);
  }
  const namedDate = filename.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{4}))?\b/);
  if (namedDate && details.event_date) {
    const [year, month, day] = details.event_date.split("-").map(Number);
    if (+namedDate[1] !== month || +namedDate[2] !== day || (namedDate[3] && +namedDate[3] !== year))
      warnings.push(`The event date in the agreement (${details.event_date}) differs from the filename. Confirm the correct date.`);
  }
  if (!details.hours && !serviceRange && /\b(?:hrs?|hours?|contracted from)\b/i.test(serviceSection))
    warnings.push("Confirm service hours separately from travel, setup and cleanup. Unclear hours were left blank; enter service time in 30-minute increments.");
  if (/\b\d+\s*(?:to|[-–])\s*\d+\s+guests?\b/i.test(prose))
    warnings.push("The agreement gives a guest-count range. Enter the confirmed guest count.");
  const eventTerm = prose.match(/\bDate of events?\b(.*?)(?:Survival|COMPENSATION)/i)?.[1] || "";
  if ((eventTerm.match(/\b20\d{2}\b/g) || []).length > 1)
    warnings.push("The agreement spans multiple dates. The event date is the first date; confirm how the rental duration should be tracked.");
  if (/security\s+deposit/i.test(prose))
    warnings.push("The agreement includes a security deposit. Review whether the stated total and booking deposit include that refundable amount.");
  if (/subject to change|rough estimate/i.test(prose))
    warnings.push("Some contracted times or charges are estimates. Confirm the final arrangements before saving.");
  return warnings;
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

export async function extractAgreement(buffer: Buffer, extension: string, filename = "") {
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
              "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
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
        ? "This looks like a scan or image-only agreement. Automatic text extraction is unavailable. Enter details from the original and check handwritten edits or crossed-out amounts."
        : "We filled in the details we could read, including service terms and any deposit calculated from the stated total. Check every field against the agreement; blanks need your input.",
      ...(!details.location ? ["Confirm the event venue/address. A company address or client affiliation is not treated as the event location."] : []),
      ...(!details.start_time ? ["The start time was not specified clearly. Enter it when confirmed."] : []),
      ...(!details.drinks_serving ? ["No specific drink menu was found. Add the drinks you will serve."] : []),
      ...((text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).filter((email, index, all) => all.indexOf(email) === index).length > 1
        ? ["The agreement lists multiple email addresses. Confirm which customer email to use; the original agreement keeps the other contacts."] : []),
      ...agreementReviewWarnings(text, details, filename),
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
      if (key === "city" && input[key] === undefined) continue;
      if (typeof input[key] !== "string") return null;
      details[key] = (input[key] as string).trim();
    }
  }
  if (
    !details.name ||
    details.name.length > 200 ||
    !details.location ||
    details.location.length > 1000 ||
    details.city.length > 200 ||
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
    ["bartenders_needed", 100, false],
    ["guest_count", 100000, true],
  ] as const) {
    if (optional && details[key] === "") continue;
    if (!/^\d+$/.test(details[key]) || Number(details[key]) > max) return null;
  }
  if (!validServiceHours(details.hours)) return null;
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
  if (!["soda", "bartending", "portable_bar"].includes(details.service_type)) return null;
  details.email = details.email.toLowerCase();
  return details;
}
