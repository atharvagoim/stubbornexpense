// Storage: MongoDB when MONGODB_URI is set, otherwise JSON files in ./data (good for your computer).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const pubUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, email: u.email, avatar: u.avatar || "", createdAt: u.createdAt });
const pubTx = (t) => t && ({ id: t.id, type: t.type, amount: t.amount, category: t.category, note: t.note || "", createdAt: t.createdAt });

function mongoStore(uri) {
  const mongoose = require("mongoose");
  // Own collections (expense_users / expense_transactions) so other apps in the same database are never touched
  const User = mongoose.model("ExpenseUser", new mongoose.Schema({
    name: String,
    username: { type: String, unique: true, index: true },
    email: { type: String, unique: true, index: true },
    passHash: String,
    avatar: String,
    createdAt: { type: Date, default: Date.now },
  }, { collection: "expense_users" }));
  const Tx = mongoose.model("ExpenseTx", new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    type: { type: String, enum: ["credit", "debit"] },
    amount: Number,
    category: String,
    note: String,
    createdAt: { type: Date, default: Date.now, index: true },
  }, { collection: "expense_transactions" }));
  const u = (d) => d && pubUser({ ...d, id: String(d._id) }) && { ...d, id: String(d._id) };
  const t = (d) => d && pubTx({ ...d, id: String(d._id) });
  const ok = (id) => mongoose.isValidObjectId(id);
  return {
    kind: "mongodb",
    async init() {
      // use the database named in the link; if the link has none (it would fall back to "test"), use "expense-tracker"
      let dbName = process.env.MONGODB_DB || "";
      if (!dbName) {
        const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
        if (!m || !m[1]) dbName = "expense-tracker";
      }
      await mongoose.connect(uri, dbName ? { dbName } : {});
      try { await User.init(); await Tx.init(); }
      catch (e) { console.warn("⚠  Could not build database indexes:", e.message); }
    },
    async findUserByLogin(login) {
      const l = login.toLowerCase();
      return u(await User.findOne({ $or: [{ username: l }, { email: l }] }).lean());
    },
    async getUser(id) { return ok(id) ? u(await User.findById(id).lean()) : null; },
    async taken({ username, email }, exceptId) {
      const q = { $or: [{ username }, { email }] };
      if (exceptId) q._id = { $ne: exceptId };
      const d = await User.findOne(q).lean();
      return d ? (d.username === username ? "username" : "email") : null;
    },
    async createUser(data) { const d = await User.create(data); return u(d.toObject()); },
    async updateUser(id, patch) { return ok(id) ? u(await User.findByIdAndUpdate(id, patch, { new: true }).lean()) : null; },
    async countTx(userId) { return Tx.countDocuments({ userId }); },
    async listTx(userId) { return (await Tx.find({ userId }).sort({ createdAt: -1 }).limit(5000).lean()).map(t); },
    async addTx(userId, data) { const d = await Tx.create({ ...data, userId }); return t(d.toObject()); },
    async removeTx(userId, id) { return ok(id) ? !!(await Tx.findOneAndDelete({ _id: id, userId })) : false; },
    async removeUser(id) { if (!ok(id)) return false; await Tx.deleteMany({ userId: id }); return !!(await User.findByIdAndDelete(id)); },
  };
}

function fileStore(dir) {
  const file = path.join(dir, "db.json");
  let db = { users: [], txs: [] };
  let queue = Promise.resolve();
  const save = () => (queue = queue.then(async () => {
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = file + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify(db));
    await fs.promises.rename(tmp, file);
  }));
  return {
    kind: "file",
    async init() { try { db = JSON.parse(await fs.promises.readFile(file, "utf8")); } catch { db = { users: [], txs: [] }; } },
    async findUserByLogin(login) { const l = login.toLowerCase(); return db.users.find((x) => x.username === l || x.email === l) || null; },
    async getUser(id) { return db.users.find((x) => x.id === id) || null; },
    async taken({ username, email }, exceptId) {
      const d = db.users.find((x) => x.id !== exceptId && (x.username === username || x.email === email));
      return d ? (d.username === username ? "username" : "email") : null;
    },
    async createUser(data) { const d = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data }; db.users.push(d); await save(); return d; },
    async updateUser(id, patch) { const d = db.users.find((x) => x.id === id); if (!d) return null; Object.assign(d, patch); await save(); return d; },
    async countTx(userId) { return db.txs.filter((x) => x.userId === userId).length; },
    async listTx(userId) { return db.txs.filter((x) => x.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(pubTx); },
    async addTx(userId, data) { const d = { id: crypto.randomUUID(), userId, createdAt: new Date().toISOString(), ...data }; db.txs.push(d); await save(); return pubTx(d); },
    async removeUser(id) { const n = db.users.length; db.users = db.users.filter((x) => x.id !== id); db.txs = db.txs.filter((x) => x.userId !== id); if (db.users.length === n) return false; await save(); return true; },
    async removeTx(userId, id) { const n = db.txs.length; db.txs = db.txs.filter((x) => !(x.id === id && x.userId === userId)); if (db.txs.length === n) return false; await save(); return true; },
  };
}

module.exports = Object.assign(function createStore() {
  const uri = process.env.MONGODB_URI;
  return uri ? mongoStore(uri) : fileStore(path.join(__dirname, "..", "data"));
}, { pubUser, pubTx });
