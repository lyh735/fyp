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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const transactionRoutes = require("./routes/transactionRoutes");
const authRoutes = require("./routes/authRoutes");

app.use("/api", transactionRoutes);
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

app.set("io", io);

const PORT = 3005;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
