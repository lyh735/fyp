const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

const transactionRoutes = require("./routes/transactionRoutes");
app.use("/api", transactionRoutes);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

app.set("io", io);

const PORT = 3005;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});