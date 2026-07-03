const { query } = require("../services/dbQuery");

const STANDARD_DOCUMENTS = [
  "Invoice",
  "Receipt",
  "Delivery Proof",
  "Customer Authorisation (if applicable)"
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

  return { alert: alerts[0], rfi, dueDate, documents, referenceNo, isOverdue };
}

exports.showRfiPage = async (req, res) => {
  try {
    const page = await loadRfiPage(req.params.id);
    if (!page) return res.status(404).send("Alert not found");
    res.render("rfiRequest", { ...page, standardDocuments: STANDARD_DOCUMENTS, message: req.query.message || "" });
  } catch (err) {
    console.error("Error loading RFI:", err);
    res.status(500).send("Error loading RFI");
  }
};

exports.saveRfi = async (req, res) => {
  const alertId = Number(req.params.id);
  const analystName = String(req.body.analyst_name || "").trim();
  const dueDate = req.body.due_date;
  const documents = parseDocuments(req.body.documents);
  const remarks = String(req.body.additional_remarks || "").trim();

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

    if (existing.length) {
      await query(`
        UPDATE rfi_requests
        SET requested_by = ?, requested_documents = ?, additional_remarks = ?,
            request_message = ?, due_at = ?, updated_at = NOW()
        WHERE rfi_id = ?
      `, [analysts[0].user_id, JSON.stringify(documents), remarks || null, requestMessage, dueDate, existing[0].rfi_id]);
    } else {
      await query(`
        INSERT INTO rfi_requests
          (alert_id, requested_by, reference_no, requested_documents, additional_remarks,
           request_message, status, due_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?)
      `, [alertId, analysts[0].user_id, referenceNo, JSON.stringify(documents), remarks || null, requestMessage, dueDate]);
    }

    res.redirect(`/api/officer/alerts/${alertId}/rfi?message=${encodeURIComponent("Draft saved. Export the PDF, then mark it as sent.")}`);
  } catch (err) {
    console.error("Error saving RFI:", err);
    res.status(500).send("Error saving RFI");
  }
};

exports.markAsSent = async (req, res) => {
  try {
    const rfis = await query("SELECT * FROM rfi_requests WHERE rfi_id = ? LIMIT 1", [req.params.id]);
    if (!rfis.length) return res.status(404).send("RFI not found");
    const rfi = rfis[0];
    if (rfi.status !== "Draft") {
      return res.status(409).send("This RFI has already been marked as sent");
    }

    await query(`
      UPDATE rfi_requests
      SET status = 'Pending Merchant Response', sent_at = NOW(), updated_at = NOW()
      WHERE rfi_id = ? AND status = 'Draft'
    `, [rfi.rfi_id]);
    await query("UPDATE alerts SET status = 'Pending Merchant Response' WHERE alert_id = ?", [rfi.alert_id]);
    await query(`
      INSERT INTO case_actions
        (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, 'rfi_sent', 'Pending Merchant Response', ?)
    `, [rfi.alert_id, rfi.requested_by, `RFI Sent: ${rfi.reference_no}; due ${inputDate(rfi.due_at)}`]);

    res.redirect(`/api/officer/alerts/${rfi.alert_id}/rfi?message=${encodeURIComponent("RFI marked as sent. Status is now Pending Merchant Response.")}`);
  } catch (err) {
    console.error("Error marking RFI as sent:", err);
    res.status(500).send("Error marking RFI as sent");
  }
};

exports.sendReminder = async (req, res) => {
  try {
    const rfis = await query("SELECT * FROM rfi_requests WHERE rfi_id = ? LIMIT 1", [req.params.id]);
    if (!rfis.length) return res.status(404).send("RFI not found");
    const rfi = rfis[0];
    if (rfi.status !== "Pending Merchant Response" || !isPastDue(rfi.due_at)) {
      return res.status(409).send("A reminder is only available for an overdue RFI");
    }

    await query(`
      UPDATE rfi_requests
      SET reminder_count = reminder_count + 1, last_reminder_at = NOW(), updated_at = NOW()
      WHERE rfi_id = ?
    `, [rfi.rfi_id]);
    await query(`
      INSERT INTO case_actions
        (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, 'rfi_reminder', 'Pending Merchant Response', ?)
    `, [rfi.alert_id, rfi.requested_by, `Merchant response reminder recorded for ${rfi.reference_no}`]);

    res.redirect(`/api/officer/alerts/${rfi.alert_id}/rfi?message=${encodeURIComponent("Reminder recorded. Send it using the company's email process.")}`);
  } catch (err) {
    console.error("Error recording reminder:", err);
    res.status(500).send("Error recording reminder");
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
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "ascii");
}

exports.exportPdf = async (req, res) => {
  try {
    const rows = await query(`
      SELECT r.*, a.transaction_id, m.merchant_name
      FROM rfi_requests r
      JOIN alerts a ON a.alert_id = r.alert_id
      LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
      WHERE r.rfi_id = ? LIMIT 1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).send("RFI not found");
    const rfi = rows[0];
    const documents = parseDocuments(rfi.requested_documents);
    const lines = [
      "REQUEST FOR INFORMATION", "", `Reference No: ${rfi.reference_no}`, "", "Dear Merchant,", "",
      ...wrapText("As part of our routine compliance review, we require additional supporting information relating to the transaction(s) listed below."),
      "", `Merchant: ${rfi.merchant_name || "Not specified"}`, `Transaction: ${rfi.transaction_id}`,
      "", `Please provide the following documents by ${inputDate(rfi.due_at)}:`, "",
      ...documents.map((document) => `[X] ${document}`),
      ...(rfi.additional_remarks ? ["", "Additional remarks:", ...wrapText(rfi.additional_remarks)] : []),
      "", "Thank you.", "", "Compliance Team"
    ];
    const pdf = createPdf(lines);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${rfi.reference_no}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("Error exporting RFI PDF:", err);
    res.status(500).send("Error exporting RFI PDF");
  }
};
