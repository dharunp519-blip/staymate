const crypto = require("crypto");
const path = require("path");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: path.join(__dirname, "..", "uploads"),
  filename: (req, file, callback) => {
    const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" }[file.mimetype];
    callback(null, `${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      return callback(new Error("Only JPEG, PNG, GIF, and WebP images are allowed."));
    }
    return callback(null, true);
  }
});

module.exports = upload;
