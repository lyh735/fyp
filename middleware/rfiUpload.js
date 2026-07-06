const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDirectory = path.join(__dirname, "..", "uploads", "rfi-responses");
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedExtensions = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  }
});

const uploadResponse = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "response_file"));
    }
    callback(null, true);
  }
}).single("response_file");

function handleResponseUpload(req, res, next) {
  uploadResponse(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).send("Response file must not exceed 10 MB");
    if (err.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).send("Unsupported response file type");
    res.status(400).send("Unable to upload response file");
  });
}

module.exports = { uploadDirectory, handleResponseUpload };
