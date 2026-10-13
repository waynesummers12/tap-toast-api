import { Router } from "express";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase";
import { requireAdmin } from "../middleware/auth";
import { extractAgreement, validateDetails } from "../services/agreementParser";

const router = Router();
const bucket = "event-agreements";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single("agreement");
router.use(requireAdmin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post("/upload", (req, res) => {
  upload(req, res, async (error) => {
    if (error)
      return res
        .status(400)
        .json({
          error: "Choose one PDF or Word (.docx) agreement, up to 10 MB.",
        });
    if (!req.file)
      return res.status(400).json({ error: "Choose an agreement to upload." });
    const extension =
      req.file.originalname.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "docx"].includes(extension))
      return res
        .status(400)
        .json({ error: "Choose a PDF or Word (.docx) agreement." });
    try {
      let parsed;
      try {
        parsed = await extractAgreement(req.file.buffer, extension, req.file.originalname);
      } catch {
        return res
          .status(422)
          .json({
            error:
              "We couldn't read this agreement. Use an unlocked PDF (30 pages or fewer) or .docx file. You can export it again and retry.",
          });
      }
      const hash = createHash("sha256").update(req.file.buffer).digest("hex");
      const { data: existing, error: lookupError } = await supabase
        .from("event_agreements")
        .select("id,event_id,file_name")
        .eq("file_hash", hash)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing)
        return res.json({
          agreement: existing,
          ...parsed,
          already_imported: !!existing.event_id,
        });
      const id = randomUUID(),
        path = `${id}/agreement.${extension}`;
      const fileName = req.file.originalname
        .replace(/[\x00-\x1f\x7f/\\]/g, "_")
        .slice(0, 200);
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .upload(path, req.file.buffer, {
          contentType:
            extension === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: false,
        });
      if (storageError) throw storageError;
      const { data: agreement, error: insertError } = await supabase
        .from("event_agreements")
        .insert({
          id,
          file_hash: hash,
          file_name: fileName,
          storage_path: path,
        })
        .select("id,event_id,file_name")
        .single();
      if (insertError) {
        await supabase.storage.from(bucket).remove([path]);
        if (insertError.code === "23505") {
          const { data: duplicate, error: duplicateError } = await supabase
            .from("event_agreements")
            .select("id,event_id,file_name")
            .eq("file_hash", hash)
            .single();
          if (!duplicateError)
            return res.json({
              agreement: duplicate,
              ...parsed,
              already_imported: !!duplicate.event_id,
            });
        }
        throw insertError;
      }
      return res
        .status(201)
        .json({ agreement, ...parsed, already_imported: false });
    } catch {
      return res
        .status(500)
        .json({
          error:
            "The agreement could not be saved. Please try again. No event has been created.",
        });
    }
  });
});

router.post("/:id/import", async (req, res) => {
  if (!uuid.test(String(req.params.id)))
    return res.status(400).json({ error: "Invalid agreement." });
  const details = validateDetails(req.body?.details);
  if (
    !details ||
    req.body?.reviewed !== true ||
    (req.body.allow_duplicate !== undefined &&
      typeof req.body.allow_duplicate !== "boolean")
  )
    return res
      .status(400)
      .json({
        error:
          "Check the required fields, amounts, and payment status, then confirm you reviewed the agreement.",
      });
  const { data: eventId, error } = await supabase.rpc(
    "import_signed_agreement",
    {
      p_agreement_id: req.params.id,
      p_details: details,
      p_allow_duplicate: req.body.allow_duplicate === true,
    },
  );
  if (error) {
    if (error.message.includes("POSSIBLE_DUPLICATE"))
      return res
        .status(409)
        .json({
          code: "POSSIBLE_DUPLICATE",
          error:
            "An event already exists for this customer on that date. Check the list before adding another.",
        });
    if (error.message.includes("AGREEMENT_NOT_FOUND"))
      return res
        .status(404)
        .json({ error: "Agreement not found. Upload it again." });
    return res
      .status(500)
      .json({
        error:
          "Could not add the event. Your agreement is saved; please try again.",
      });
  }
  return res.json({ success: true, event_id: eventId });
});

router.get("/event/:eventId", async (req, res) => {
  if (!uuid.test(String(req.params.eventId)))
    return res.status(400).json({ error: "Invalid event." });
  const { data, error } = await supabase
    .from("event_agreements")
    .select("file_name,storage_path")
    .eq("event_id", req.params.eventId)
    .maybeSingle();
  if (error)
    return res.status(500).json({ error: "Could not load the agreement." });
  if (!data) return res.json({ agreement: null });
  const { data: signed, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(data.storage_path, 300, { download: data.file_name });
  if (signError)
    return res
      .status(500)
      .json({ error: "Could not open the agreement. Please try again." });
  return res.json({
    agreement: { file_name: data.file_name, url: signed.signedUrl },
  });
});
export default router;
