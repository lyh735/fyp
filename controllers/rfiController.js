const { query } = require("../services/dbQuery");
const fs = require("fs");
const path = require("path");
const { uploadDirectory } = require("../middleware/rfiUpload");

const STANDARD_DOCUMENTS = [
  "Proof of the transaction, such as a receipt or transaction confirmation",
  "Customer identification information obtained during customer due diligence",
  "Source-of-funds information or declaration",
  "Purpose-of-remittance information or declaration",
  "Beneficiary details"
];

function addBusinessDays(start, days) {
  const date = new Date(start);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added += 1;
  }
  return date;
}

function inputDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function displayMoney(amount, currency = "SGD") {
  if (amount === null || amount === undefined || amount === "") return "Not specified";
  return `${currency || "SGD"} ${Number(amount).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isPastDue(value) {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today > due;
}

function parseDocuments(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [String(value)];
  }
}

async function loadRfiPage(alertId) {
  const alerts = await query(`
    SELECT a.*, m.merchant_name, t.amount, t.currency, t.txn_time
    FROM alerts a
    LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
    LEFT JOIN transactions t ON t.transaction_id = a.transaction_id
    WHERE a.alert_id = ?
    LIMIT 1
  `, [alertId]);

  if (!alerts.length) return null;

  const rfis = await query(`
    SELECT r.*, u.name AS analyst_name
    FROM rfi_requests r
    LEFT JOIN users u ON u.user_id = r.requested_by
    WHERE r.alert_id = ?
    LIMIT 1
  `, [alertId]);

  const rfi = rfis[0] || null;
  const dueDate = rfi ? inputDate(rfi.due_at) : inputDate(addBusinessDays(new Date(), 3));
  const documents = rfi ? parseDocuments(rfi.requested_documents) : STANDARD_DOCUMENTS;
  const referenceNo = rfi
    ? rfi.reference_no
    : `RFI-${new Date().getFullYear()}-${String(alertId).padStart(4, "0")}`;
  const isOverdue = Boolean(
    rfi && rfi.status === "Pending Merchant Response" && isPastDue(rfi.due_at)
  );

  const caseHistory = await query(`
    SELECT ca.action_id, ca.action_type, ca.status_after_action, ca.remarks,
           ca.created_at, u.name AS actor_name
    FROM case_actions ca
    LEFT JOIN users u ON u.user_id = ca.user_id
    WHERE ca.alert_id = ?
    ORDER BY ca.created_at DESC, ca.action_id DESC
  `, [alertId]);

  return {
    alert: alerts[0], rfi, dueDate,
    issuedDateDisplay: displayDate(rfi ? rfi.created_at : new Date()),
    dueDateDisplay: displayDate(rfi ? rfi.due_at : dueDate),
    sentDateDisplay: rfi && rfi.sent_at ? displayDate(rfi.sent_at) : "",
    transactionDateDisplay: displayDate(alerts[0].txn_time),
    transactionAmountDisplay: displayMoney(alerts[0].amount, alerts[0].currency),
    documents, referenceNo, isOverdue, caseHistory,
  };
}

exports.showRfiPage = async (req, res) => {
  try {
    const page = await loadRfiPage(req.params.id);
    if (!page) return res.status(404).send("Alert not found");
    res.render("rfiRequest", {
      ...page,
      standardDocuments: [...new Set([...STANDARD_DOCUMENTS, ...page.documents])],
      message: req.query.message || "",
    });
  } catch (err) {
    console.error("Error loading RFI:", err);
    res.status(500).send("Error loading RFI");
  }
};

exports.getAnalystRfiHistory = async (req, res) => {
  try {
    const isStro = String(req.user?.role || "").trim().toLowerCase() === "stro";
    const ownershipClause = isStro ? "" : "WHERE r.requested_by = ?";
    const values = isStro ? [] : [req.user.id];
    const rows = await query(`
      SELECT r.rfi_id, r.alert_id, r.reference_no, r.requested_documents,
             r.additional_remarks, r.status, r.created_at, r.updated_at,
             r.sent_at, r.due_at, r.responded_at, r.is_sent,
             r.response_attachment,
             a.transaction_id, a.risk_level, a.priority,
             m.merchant_id, m.merchant_name, u.name AS analyst_name,
             CASE
               WHEN r.status = 'Pending Merchant Response' AND DATE(r.due_at) < CURDATE()
               THEN 1 ELSE 0
             END AS is_overdue
      FROM rfi_requests r
      JOIN alerts a ON a.alert_id = r.alert_id
      LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
      LEFT JOIN users u ON u.user_id = r.requested_by
      ${ownershipClause}
      ORDER BY r.created_at DESC, r.rfi_id DESC
    `, values);

    res.json(rows.map((row) => ({
      ...row,
      requested_documents: parseDocuments(row.requested_documents),
      is_overdue: Boolean(row.is_overdue),
    })));
  } catch (err) {
    console.error("Error loading analyst RFI history:", err);
    res.status(500).json({ message: "Unable to load RFI history" });
  }
};

exports.saveRfi = async (req, res) => {
  const alertId = Number(req.params.id);
  const analystName = String(req.body.analyst_name || "").trim();
  const dueDate = req.body.due_date;
  const documents = parseDocuments(req.body.documents);
  const remarks = String(req.body.additional_remarks || "").trim();
  const intent = String(req.body.intent || "save");

  const parsedDueDate = new Date(`${dueDate}T23:59:59`);
  if (!alertId || !analystName || !dueDate || Number.isNaN(parsedDueDate.getTime()) || !documents.length) {
    return res.status(400).send("Analyst name, due date, and at least one document are required");
  }

  try {
    const analysts = await query(
      "SELECT user_id FROM users WHERE name = ? AND role = 'analyst' AND status = 'active' LIMIT 1",
      [analystName]
    );
    if (!analysts.length) return res.status(400).send("Analyst name must match an active analyst account");

    const existing = await query("SELECT rfi_id, status FROM rfi_requests WHERE alert_id = ? LIMIT 1", [alertId]);
    if (existing.length && existing[0].status !== "Draft") {
      return res.status(409).send("A sent RFI can no longer be edited");
    }

    const referenceNo = `RFI-${new Date().getFullYear()}-${String(alertId).padStart(4, "0")}`;
    const requestMessage = "Please provide the requested supporting documents within the stated deadline.";

    let rfiId;
    if (existing.length) {
      await query(`
        UPDATE rfi_requests
        SET requested_by = ?, requested_documents = ?, additional_remarks = ?,
            request_message = ?, due_at = ?, updated_at = NOW()
        WHERE rfi_id = ?
      `, [analysts[0].user_id, JSON.stringify(documents), remarks || null, requestMessage, dueDate, existing[0].rfi_id]);
      rfiId = existing[0].rfi_id;
    } else {
      const insertResult = await query(`
        INSERT INTO rfi_requests
          (alert_id, requested_by, reference_no, requested_documents, additional_remarks,
           request_message, status, due_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?)
      `, [alertId, analysts[0].user_id, referenceNo, JSON.stringify(documents), remarks || null, requestMessage, dueDate]);
      rfiId = insertResult.insertId;
      const alertRows = await query("SELECT status FROM alerts WHERE alert_id = ? LIMIT 1", [alertId]);
      await query(`
        INSERT INTO case_actions
          (alert_id, user_id, action_type, status_after_action, remarks)
        VALUES (?, ?, 'rfi_generated', ?, ?)
      `, [alertId, analysts[0].user_id, alertRows[0]?.status || "Pending", `RFI generated: ${referenceNo}`]);
    }

    if (intent === "export") {
      return res.redirect(`/api/officer/rfi/${rfiId}/pdf`);
    }
    if (intent === "mark_sent") {
      const rfi = await markRfiAsSent(rfiId);
      return res.redirect(`/api/officer/alerts/${rfi.alert_id}`);
    }
    res.redirect(`/api/officer/alerts/${alertId}/rfi?message=${encodeURIComponent("Draft saved. Export the PDF, then mark it as sent.")}`);
  } catch (err) {
    console.error("Error saving RFI:", err);
    res.status(err.statusCode || 500).send(err.statusCode ? err.message : "Error saving RFI");
  }
};

async function markRfiAsSent(rfiId) {
  const rfis = await query("SELECT * FROM rfi_requests WHERE rfi_id = ? LIMIT 1", [rfiId]);
  if (!rfis.length) {
    const error = new Error("RFI not found");
    error.statusCode = 404;
    throw error;
  }

  const rfi = rfis[0];
  if (rfi.status !== "Draft") {
    const error = new Error("This RFI has already been marked as sent");
    error.statusCode = 409;
    throw error;
  }

  const updateResult = await query(`
    UPDATE rfi_requests
    SET status = 'Pending Merchant Response', is_sent = 1,
        sent_at = NOW(), updated_at = NOW()
    WHERE rfi_id = ? AND status = 'Draft'
  `, [rfi.rfi_id]);
  if (updateResult.affectedRows !== 1) {
    const error = new Error("RFI status changed before it could be marked as sent");
    error.statusCode = 409;
    throw error;
  }

  await query("UPDATE alerts SET status = 'Pending Merchant Response' WHERE alert_id = ?", [rfi.alert_id]);
  await query(`
    INSERT INTO case_actions
      (alert_id, user_id, action_type, status_after_action, remarks)
    VALUES (?, ?, 'rfi_marked_sent', 'Pending Merchant Response', ?)
  `, [rfi.alert_id, rfi.requested_by, `RFI Sent: ${rfi.reference_no}; due ${inputDate(rfi.due_at)}`]);

  return rfi;
}

exports.markAsSent = async (req, res) => {
  try {
    const rfi = await markRfiAsSent(req.params.id);
    res.redirect(`/api/officer/alerts/${rfi.alert_id}`);
  } catch (err) {
    console.error("Error marking RFI as sent:", err);
    res.status(err.statusCode || 500).send(err.statusCode ? err.message : "Error marking RFI as sent");
  }
};

function removeUploadedFile(file) {
  if (!file || !file.path) return;
  fs.unlink(file.path, () => {});
}

exports.recordResponse = async (req, res) => {
  const responseMessage = String(req.body.response_message || "").trim();
  let responseSaved = false;
  if (!responseMessage && !req.file) {
    return res.status(400).send("Add a response message or upload a response file");
  }

  try {
    const rfis = await query("SELECT * FROM rfi_requests WHERE rfi_id = ? LIMIT 1", [req.params.id]);
    if (!rfis.length) {
      removeUploadedFile(req.file);
      return res.status(404).send("RFI not found");
    }

    const rfi = rfis[0];
    if (!["Pending Merchant Response", "Responded"].includes(rfi.status)) {
      removeUploadedFile(req.file);
      return res.status(409).send("Only a sent RFI can receive a merchant response");
    }

    const attachment = req.file ? req.file.filename : rfi.response_attachment;

    await query(`
      UPDATE rfi_requests
      SET response_message = ?, response_attachment = ?, status = 'Responded',
          responded_at = NOW(), updated_at = NOW()
      WHERE rfi_id = ?
    `, [responseMessage || rfi.response_message || null, attachment, rfi.rfi_id]);
    responseSaved = true;

    await query(`
      UPDATE alerts
      SET status = CASE
        WHEN status IN ('Escalated', 'Escalated to STRO') THEN status
        ELSE 'RFI Responded'
      END
      WHERE alert_id = ?
    `, [rfi.alert_id]);
    const alertRows = await query("SELECT status FROM alerts WHERE alert_id = ? LIMIT 1", [rfi.alert_id]);

    await query(`
      INSERT INTO case_actions
        (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, 'rfi_response_recorded', ?, ?)
    `, [rfi.alert_id, rfi.requested_by, alertRows[0]?.status || "RFI Responded", responseMessage || `Merchant response file received: ${attachment}`]);

    if (req.file && rfi.response_attachment && rfi.response_attachment !== req.file.filename) {
      const previousPath = path.join(uploadDirectory, path.basename(rfi.response_attachment));
      fs.unlink(previousPath, () => {});
    }

    res.redirect(`/api/officer/alerts/${rfi.alert_id}`);
  } catch (err) {
    if (!responseSaved) removeUploadedFile(req.file);
    console.error("Error recording RFI response:", err);
    res.status(500).send("Error recording merchant response");
  }
};

exports.downloadResponseFile = async (req, res) => {
  try {
    const rfis = await query(`
      SELECT response_attachment
      FROM rfi_requests WHERE rfi_id = ? LIMIT 1
    `, [req.params.id]);
    if (!rfis.length || !rfis[0].response_attachment) {
      return res.status(404).send("Merchant response file not found");
    }

    const storedName = path.basename(rfis[0].response_attachment);
    const filePath = path.join(uploadDirectory, storedName);
    if (!fs.existsSync(filePath)) return res.status(404).send("Merchant response file not found");
    res.setHeader("Cache-Control", "no-store");
    res.download(filePath, storedName);
  } catch (err) {
    console.error("Error downloading RFI response:", err);
    res.status(500).send("Error downloading merchant response file");
  }
};

function wrapText(text, width = 84) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createPdf(lines) {
  const commands = ["BT", "/F1 12 Tf", "50 790 Td", "16 TL"];
  lines.forEach((line, index) => {
    if (index) commands.push("T*");
    commands.push(`(${pdfEscape(line)}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n%RFI-PDF\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

exports.exportPdf = async (req, res) => {
  try {
    const rfiId = Number(req.params.id);
    if (!Number.isInteger(rfiId) || rfiId <= 0) return res.status(400).send("Invalid RFI ID");
    const rows = await query(`
      SELECT r.*, a.transaction_id, m.merchant_name,
             t.amount, t.currency, t.txn_time
      FROM rfi_requests r
      JOIN alerts a ON a.alert_id = r.alert_id
      LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
      LEFT JOIN transactions t ON t.transaction_id = a.transaction_id
      WHERE r.rfi_id = ? LIMIT 1
    `, [rfiId]);
    if (!rows.length) return res.status(404).send("RFI not found");
    const rfi = rows[0];
    const documents = parseDocuments(rfi.requested_documents);
    const documentLines = documents.flatMap((document, index) => {
      const suffix = index === documents.length - 1 ? "." : ";";
      return wrapText(`${index + 1}. ${document}${suffix}`, 78)
        .map((line, lineIndex) => lineIndex ? `   ${line}` : line);
    });
    const lines = [
      "REQUEST FOR INFORMATION", "",
      `Reference No.: ${rfi.reference_no}`,
      `Date Issued: ${displayDate(rfi.created_at)}`,
      `Response Due Date: ${displayDate(rfi.due_at)}`, "",
      "To:", rfi.merchant_name || "Not specified", "",
      "From:", "Compliance Team", "Uniweb Pte. Ltd.", "Email: compliance@uniweb.com.sg", "",
      "Dear Sir/Madam,", "",
      ...wrapText("As part of our ongoing compliance and customer due diligence procedures, we require additional supporting information relating to the following transaction processed through our payment network."),
      "", `Transaction Reference: ${rfi.transaction_id}`,
      `Transaction Date: ${displayDate(rfi.txn_time) || "Not specified"}`,
      `Transaction Amount: ${displayMoney(rfi.amount, rfi.currency)}`, "",
      ...wrapText(`Please provide the following available information and supporting documents by ${displayDate(rfi.due_at)}:`), "",
      ...documentLines,
      ...(rfi.additional_remarks ? ["", "Additional remarks:", ...wrapText(rfi.additional_remarks)] : []),
      "", ...wrapText("Please submit the requested information through the merchant portal or email it to compliance@uniweb.com.sg."),
      "", ...wrapText("Where any requested document is unavailable, please provide an explanation in your response. This request forms part of Uniweb Pte. Ltd.'s standard compliance review procedures. Your prompt cooperation is appreciated."),
      "", "Yours sincerely,", "Compliance Team", "Uniweb Pte. Ltd."
    ];
    const pdf = createPdf(lines);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${rfi.reference_no}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (err) {
    console.error("Error exporting RFI PDF:", err);