require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- STATİK DOSYALAR ---------------- //
app.use(express.static(path.join(__dirname, "public")));
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ---------------- POSTGRESQL BAĞLANTI ---------------- //
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---------------- TEST ---------------- //
app.get("/", (req, res) => {
  res.send("Saha CRM Sistemi Çalışıyor 🚀 (Postgres)");
});

// ---------------- AUTH ---------------- //
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const existingUser = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    if (existingUser.rows.length > 0) return res.status(400).json({ error: "Kullanıcı zaten var" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password) VALUES ($1, $2)", [username, hashedPassword]);
    res.json({ success: true, message: "Kullanıcı eklendi" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Kayıt sırasında hata" }); }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Kullanıcı bulunamadı" });
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Şifre hatalı" });
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || "secretkey", { expiresIn: "1h" });
    res.json({ token });
  } catch (err) { console.error(err); res.status(500).json({ error: "Giriş sırasında hata" }); }
});

// ---------------- ÜRÜNLER ---------------- //
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Ürünler alınamadı" }); }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, price, description } = req.body;
    if (!name || !price) return res.status(400).json({ error: "Ürün adı ve fiyat zorunlu" });
    await pool.query("INSERT INTO products (name, price, description) VALUES ($1, $2, $3)", [name, price, description]);
    res.json({ success: true, message: "Ürün eklendi" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Ürün eklenemedi" }); }
});

// ---------------- SİPARİŞLER ---------------- //
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT o.*, p.name as product_name FROM orders o LEFT JOIN products p ON o.product_id=p.id ORDER BY o.id DESC");
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Siparişler alınamadı" }); }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { customer_name, product_id, quantity } = req.body;
    if (!customer_name || !product_id || !quantity) return res.status(400).json({ error: "Tüm alanlar zorunlu" });
    await pool.query("INSERT INTO orders (customer_name, product_id, quantity) VALUES ($1, $2, $3)", [customer_name, product_id, quantity]);
    res.json({ success: true, message: "Sipariş eklendi" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Sipariş eklenemedi" }); }
});

// ---------------- DEMO STATS ---------------- //
app.get("/api/stats", (req, res) => {
  res.json({
    totalSales: 1200,
    totalOrders: 50,
    totalCustomers: 25
  });
});

// ---------------- SUNUCU ---------------- //
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
