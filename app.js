const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", "./views");

app.use(express.urlencoded({ extended: true }));

const transactionRoutes = require("./routes/transactionRoutes");
const authRoutes = require("./routes/authRoutes");
const stroRoutes = require("./routes/stroRoutes");
const rfiRoutes = require("./routes/rfiRoutes");
const merchantRoutes = require("./routes/merchantRoutes");
const { ensureComplianceSchema } = require("./services/schema");
const { showTransactionDetailsPage } = require("./controllers/transactionController");

app.use("/api", transactionRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/stro", stroRoutes);
app.use("/api/rfis", rfiRoutes);
app.use("/api/merchants", merchantRoutes);

const officerRoutes = require("./routes/officerRoutes");
app.use("/api/officer", officerRoutes);

app.get("/transaction/:id", showTransactionDetailsPage);
app.get("/stro", (req, res) => res.redirect("/stro-alerts.html"));


app.get("/", (req, res) => {
  res.redirect("/login.html");
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

app.set("io", io);


const PORT = 3006;

ensureComplianceSchema()
  .catch((err) => {
    console.error("Compliance schema setup failed:", err);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
