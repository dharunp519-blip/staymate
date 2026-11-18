const crypto = require("crypto");
const db = require("../config/db");

const resourceTables = {
  expenses: "expenses",
  payments: "payments",
  shopping: "shopping_items",
  inventory: "inventory",
  notices: "notices",
  shoppingList: "shopping_lists",
  reminders: "reminders",
  calendarEvents: "calendar_events",
  locations: "locations"
};
const allowedResources = [...Object.keys(resourceTables), "roommates"];
const emptyWorkspace = (user) => ({
  schemaVersion: 2,
  roomName: "",
  roomCity: "",
  profile: { name: user.name, email: user.email },
  roommates: [],
  rent: 0,
  rentDueDate: "",
  rentSplit: {},
  expenses: [],
  payments: [],
  paymentStatuses: {},
  shopping: [],
  inventory: [],
  locations: [],
  notices: [],
  shoppingList: [],
  reminders: [],
  calendarEvents: [],
  theme: "light"
});

function value(value, maxLength, label) {
  if (typeof value !== "string" || value.length > maxLength) throw Object.assign(new Error(`${label} is invalid.`), { status: 400 });
  return value;
}
function amount(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999) throw Object.assign(new Error(`${label} must be a non-negative amount.`), { status: 400 });
  return parsed;
}
function validDate(value, label, optional = false) {
  if (optional && !value) return null;
  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error(`${label} must be a valid YYYY-MM-DD date.`), { status: 400 });
  }
  return value;
}
function parsePayload(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}
function cleanImage(value) {
  if (Array.isArray(value)) return value.map(cleanImage);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanImage(item)]));
  if (typeof value === "string" && value.startsWith("data:image/")) {
    throw Object.assign(new Error("Images must be uploaded using the image upload API."), { status: 400 });
  }
  return value;
}

async function findAccessibleRoom(userId, connection = db, roomId = null) {
  const conditions = [
    "r.owner_user_id = ?",
    "EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?)"
  ];
  const params = [userId, userId];
  if (roomId) {
    params.push(roomId);
    const [rows] = await connection.execute(
      `SELECT r.* FROM rooms r WHERE r.id = ? AND (${conditions.join(" OR ")}) LIMIT 1`,
      [roomId, userId, userId]
    );
    return rows[0] || null;
  }
  const [rows] = await connection.execute(
    `SELECT r.* FROM rooms r WHERE ${conditions.join(" OR ")} ORDER BY (r.owner_user_id = ?) DESC LIMIT 1`,
    [...params, userId]
  );
  return rows[0] || null;
}
async function getWorkspace(user, connection = db) {
  const room = await findAccessibleRoom(user.id, connection);
  const workspace = emptyWorkspace(user);
  const [userRows] = await connection.execute("SELECT theme FROM users WHERE id = ?", [user.id]);
  workspace.theme = userRows[0]?.theme === "dark" ? "dark" : "light";
  if (!room) return workspace;
  workspace.roomId = room.id;
  workspace.roomName = room.name;
  workspace.roomCity = room.city;
  const [members] = await connection.execute("SELECT id, name, role, photo_url, color, payment_status FROM room_members WHERE room_id = ? ORDER BY created_at, id", [room.id]);
  workspace.roommates = members.map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    ...(member.photo_url ? { photo: member.photo_url } : {}),
    ...(member.color ? { color: member.color } : {})
  }));
  workspace.paymentStatuses = Object.fromEntries(members.filter((member) => member.payment_status).map((member) => [member.name, member.payment_status]));
  const [rentRows] = await connection.execute("SELECT monthly_rent, due_date, split_json FROM rent_details WHERE room_id = ?", [room.id]);
  if (rentRows.length) {
    workspace.rent = Number(rentRows[0].monthly_rent);
    workspace.rentDueDate = rentRows[0].due_date ? new Date(rentRows[0].due_date).toISOString().slice(0, 10) : "";
    workspace.rentSplit = parsePayload(rentRows[0].split_json) || {};
  }
  for (const [section, table] of Object.entries(resourceTables)) {
    const [rows] = await connection.execute(`SELECT payload FROM ${table} WHERE room_id = ? ORDER BY 1`, [room.id]);
    workspace[section] = rows.map((row) => cleanImage(parsePayload(row.payload)));
  }
  return workspace;
}

async function insertRecords(connection, roomId, section, records) {
  const rows = Array.isArray(records) ? records : [];
  if (rows.length > 10000) throw Object.assign(new Error(`${section} has too many records.`), { status: 400 });
  for (const record of rows) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw Object.assign(new Error(`Invalid ${section} record.`), { status: 400 });
    const id = value(String(record.id || crypto.randomUUID()), 64, `${section} id`);
    const payload = JSON.stringify(cleanImage(record));
    switch (section) {
      case "expenses": {
        const title = value(String(record.title || ""), 180, "Expense name");
        const category = value(String(record.category || "Other"), 80, "Expense category");
        const paidBy = value(String(record.paidBy || ""), 100, "Expense payer");
        const expenseAmount = amount(record.amount, "Expense amount");
        const date = validDate(record.date, "Expense date");
        await connection.execute("INSERT INTO expenses (id, room_id, title, category, amount, expense_date, paid_by, note, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, roomId, title, category, expenseAmount, date, paidBy, String(record.note || ""), payload]);
        const participants = Array.isArray(record.splitWith) ? record.splitWith : [];
        for (const name of participants) {
          const share = record.shares && Object.prototype.hasOwnProperty.call(record.shares, name)
            ? amount(record.shares[name], "Expense share")
            : expenseAmount / Math.max(participants.length, 1);
          const [members] = await connection.execute("SELECT id FROM room_members WHERE room_id = ? AND name = ? LIMIT 1", [roomId, name]);
          await connection.execute("INSERT INTO expense_splits (expense_id, room_id, member_id, member_name, share_amount) VALUES (?, ?, ?, ?, ?)", [id, roomId, members[0]?.id || null, value(String(name), 100, "Roommate name"), share]);
        }
        break;
      }
      case "payments":
        if (!record.person || !record.recipient || record.person === record.recipient || Number(record.amount) <= 0) throw Object.assign(new Error("A payment needs different payer and recipient roommates and a positive amount."), { status: 400 });
        await connection.execute("INSERT INTO payments (id, room_id, payer, recipient, amount, payment_date, payload) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.person || ""), 100, "Payer"), value(String(record.recipient || ""), 100, "Recipient"), amount(record.amount, "Payment amount"), validDate(record.date, "Payment date"), payload]);
        break;
      case "shopping":
        await connection.execute("INSERT INTO shopping_items (id, room_id, item_name, amount, purchase_date, purchased_by, shop_name, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.item || ""), 180, "Item name"), amount(record.amount || 0, "Item amount"), validDate(record.date, "Purchase date"), value(String(record.purchaser || ""), 100, "Purchaser"), value(String(record.shop || ""), 180, "Shop name"), payload]);
        break;
      case "inventory":
        await connection.execute("INSERT INTO inventory (id, room_id, item_name, amount, purchase_date, purchased_by, payload) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.item || ""), 180, "Inventory item"), amount(record.amount || 0, "Purchase amount"), validDate(record.purchased || "", "Purchase date", true), value(String(record.purchasedBy || ""), 100, "Purchaser"), payload]);
        break;
      case "notices":
        await connection.execute("INSERT INTO notices (id, room_id, author, message, notice_date, payload) VALUES (?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.author || ""), 100, "Notice author"), value(String(record.text || ""), 500, "Notice text"), validDate(record.date, "Notice date"), payload]);
        break;
      case "shoppingList":
        await connection.execute("INSERT INTO shopping_lists (id, room_id, item_name, quantity, is_purchased, payload) VALUES (?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.item || ""), 180, "List item"), value(String(record.quantity || ""), 180, "Quantity"), Boolean(record.done), payload]);
        break;
      case "reminders":
        await connection.execute("INSERT INTO reminders (id, room_id, title, amount, due_date, assigned_to, is_done, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.title || ""), 180, "Reminder title"), amount(record.amount || 0, "Reminder amount"), validDate(record.due, "Reminder due date"), value(String(record.assignedTo || ""), 100, "Assigned roommate"), Boolean(record.done), payload]);
        break;
      case "calendarEvents":
        await connection.execute("INSERT INTO calendar_events (id, room_id, title, event_date, event_type, payload) VALUES (?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.title || ""), 180, "Event title"), validDate(record.date, "Event date"), value(String(record.type || "event"), 40, "Event type"), payload]);
        break;
      case "locations":
        if (!/^https?:\/\//i.test(String(record.link || ""))) throw Object.assign(new Error("Location must be a valid http or https URL."), { status: 400 });
        await connection.execute("INSERT INTO locations (id, room_id, name, address, map_url, location_type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, roomId, value(String(record.name || ""), 180, "Place name"), value(String(record.address || ""), 255, "Address"), value(String(record.link), 1000, "Map URL"), value(String(record.type || ""), 60, "Place type"), payload]);
        break;
      default:
        throw Object.assign(new Error(`Unsupported workspace collection: ${section}.`), { status: 400 });
    }
  }
}

async function saveWorkspace(user, body) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    let room = await findAccessibleRoom(user.id, connection);
    const roomName = value(String(body.roomName || "").trim(), 120, "Room name");
    const roomCity = value(String(body.roomCity || "").trim(), 160, "Room location");
    const hasRecords = Object.keys(resourceTables).some((key) => Array.isArray(body[key]) && body[key].length);
    if (!room && !roomName && !hasRecords) {
      await connection.commit();
      return emptyWorkspace(user);
    }
    if (!room && !roomName) throw Object.assign(new Error("Create a room before saving room data."), { status: 400 });
    if (!room) {
      const id = crypto.randomUUID();
      await connection.execute("INSERT INTO rooms (id, owner_user_id, name, city) VALUES (?, ?, ?, ?)", [id, user.id, roomName, roomCity]);
      room = { id, name: roomName, city: roomCity };
    } else {
      await connection.execute("UPDATE rooms SET name = ?, city = ? WHERE id = ?", [roomName || room.name, roomCity, room.id]);
    }
    await connection.execute("UPDATE users SET theme = ? WHERE id = ?", [body.theme === "dark" ? "dark" : "light", user.id]);
    const roommates = Array.isArray(body.roommates) ? body.roommates : [];
    if (roommates.length > 10) throw Object.assign(new Error("A room can have a maximum of 10 roommates."), { status: 400 });
    const memberNames = roommates.map((member) => String(member.name || "").trim().toLowerCase());
    if (memberNames.some((name) => !name) || new Set(memberNames).size !== memberNames.length) {
      throw Object.assign(new Error("Roommate names must be non-empty and unique."), { status: 400 });
    }
    const rentPercentages = Object.values(body.rentSplit || {}).map(Number);
    if (rentPercentages.some((percent) => !Number.isFinite(percent) || percent < 0 || percent > 100)
      || (rentPercentages.length && Math.abs(rentPercentages.reduce((sum, percent) => sum + percent, 0) - 100) > 0.001)) {
      throw Object.assign(new Error("Rent split percentages must total 100%."), { status: 400 });
    }

    for (const member of roommates) {
      const memberId = value(String(member.id || crypto.randomUUID()), 64, "Roommate id");
      const name = value(String(member.name || "").trim(), 100, "Roommate name");
      if (!name) throw Object.assign(new Error("Roommate names cannot be empty."), { status: 400 });
      await connection.execute(
        `INSERT INTO room_members (id, room_id, name, role, photo_url, color, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), photo_url = VALUES(photo_url), color = VALUES(color), payment_status = VALUES(payment_status)`,
        [memberId, room.id, name, value(String(member.role || "Roommate"), 40, "Roommate role"), member.photo || null, member.color || null, body.paymentStatuses?.[name] || null]
      );
    }
    const currentIds = roommates.map((member) => String(member.id));
    if (currentIds.length) {
      const marks = currentIds.map(() => "?").join(",");
      await connection.execute(`DELETE FROM room_members WHERE room_id = ? AND id NOT IN (${marks})`, [room.id, ...currentIds]);
    } else {
      await connection.execute("DELETE FROM room_members WHERE room_id = ?", [room.id]);
    }
    await connection.execute(
      "INSERT INTO rent_details (room_id, monthly_rent, due_date, split_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE monthly_rent = VALUES(monthly_rent), due_date = VALUES(due_date), split_json = VALUES(split_json)",
      [room.id, amount(body.rent || 0, "Monthly rent"), validDate(body.rentDueDate || "", "Rent due date", true), JSON.stringify(body.rentSplit || {})]
    );

    for (const table of ["expense_splits", "expenses", "payments", "shopping_items", "inventory", "notices", "shopping_lists", "reminders", "calendar_events", "locations"]) {
      await connection.execute(`DELETE FROM ${table} WHERE room_id = ?`, [room.id]);
    }
    for (const section of Object.keys(resourceTables)) {
      await insertRecords(connection, room.id, section, body[section]);
    }
    const result = await getWorkspace(user, connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function get(req, res, next) {
  try { return res.json(await getWorkspace(req.user)); }
  catch (error) { return next(error); }
}
async function put(req, res, next) {
  try { return res.json(await saveWorkspace(req.user, req.body)); }
  catch (error) { return next(error); }
}
async function report(req, res, next) {
  try {
    const month = String(req.query.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "Month must use YYYY-MM format." });
    const room = await findAccessibleRoom(req.user.id);
    if (!room) return res.json({ month, total: 0, count: 0, categories: [], roommates: [] });
    const [categories] = await db.execute(
      "SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE room_id = ? AND expense_date >= ? AND expense_date < DATE_ADD(?, INTERVAL 1 MONTH) GROUP BY category ORDER BY category",
      [room.id, `${month}-01`, `${month}-01`]
    );
    const [totals] = await db.execute(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE room_id = ? AND expense_date >= ? AND expense_date < DATE_ADD(?, INTERVAL 1 MONTH)",
      [room.id, `${month}-01`, `${month}-01`]
    );
    const [shares] = await db.execute(
      `SELECT s.member_name AS name, SUM(s.share_amount) AS expenseShare
       FROM expense_splits s JOIN expenses e ON e.id = s.expense_id AND e.room_id = s.room_id
       WHERE s.room_id = ? AND e.expense_date >= ? AND e.expense_date < DATE_ADD(?, INTERVAL 1 MONTH)
       GROUP BY s.member_name ORDER BY s.member_name`,
      [room.id, `${month}-01`, `${month}-01`]
    );
    return res.json({
      month,
      total: Number(totals[0].total),
      count: Number(totals[0].count),
      categories: categories.map((item) => ({ category: item.category, total: Number(item.total), count: Number(item.count) })),
      roommates: shares.map((item) => ({ name: item.name, expenseShare: Number(item.expenseShare) }))
    });
  } catch (error) { return next(error); }
}
async function balances(req, res, next) {
  try {
    const room = await findAccessibleRoom(req.user.id);
    if (!room) return res.json({ balances: {} });
    const [members] = await db.execute("SELECT name FROM room_members WHERE room_id = ?", [room.id]);
    const result = Object.fromEntries(members.map((member) => [member.name, 0]));
    const [expenses] = await db.execute("SELECT paid_by, amount FROM expenses WHERE room_id = ?", [room.id]);
    expenses.forEach((expense) => { if (result[expense.paid_by] !== undefined) result[expense.paid_by] += Number(expense.amount); });
    const [splits] = await db.execute("SELECT member_name, share_amount FROM expense_splits WHERE room_id = ?", [room.id]);
    splits.forEach((split) => { if (result[split.member_name] !== undefined) result[split.member_name] -= Number(split.share_amount); });
    const [payments] = await db.execute("SELECT payer, recipient, amount FROM payments WHERE room_id = ?", [room.id]);
    payments.forEach((payment) => {
      if (result[payment.payer] !== undefined) result[payment.payer] += Number(payment.amount);
      if (result[payment.recipient] !== undefined) result[payment.recipient] -= Number(payment.amount);
    });
    return res.json({ balances: result });
  } catch (error) { return next(error); }
}

async function listResource(req, res, next) {
  const section = req.params.resource;
  if (!allowedResources.includes(section)) return res.status(404).json({ error: "Resource not found." });
  try { return res.json((await getWorkspace(req.user))[section]); }
  catch (error) { return next(error); }
}
async function mutateResource(req, res, next) {
  const section = req.params.resource;
  if (!allowedResources.includes(section)) return res.status(404).json({ error: "Resource not found." });
  try {
    const workspace = await getWorkspace(req.user);
    const values = workspace[section];
    if (req.method === "POST") {
      const record = { ...req.body, id: String(req.body.id || crypto.randomUUID()) };
      values.push(record);
      if (section === "roommates" && values.length > 10) return res.status(400).json({ error: "A room can have a maximum of 10 roommates." });
    } else {
      const id = req.params.id;
      const index = values.findIndex((entry) => entry.id === id);
      if (index < 0) return res.status(404).json({ error: "Record not found." });
      if (req.method === "DELETE") values.splice(index, 1);
      else values[index] = { ...values[index], ...req.body, id };
    }
    const saved = await saveWorkspace(req.user, workspace);
    const updated = saved[section].find((entry) => entry.id === req.params.id) || saved[section][saved[section].length - 1] || null;
    return req.method === "DELETE" ? res.status(204).end() : res.status(req.method === "POST" ? 201 : 200).json(updated);
  } catch (error) { return next(error); }
}

async function upload(req, res, next) {
  try {
    const roomId = req.body.roomId || req.query.roomId;
    if (!roomId) return res.status(400).json({ error: "Room ID is required for an upload." });
    const room = await findAccessibleRoom(req.user.id, db, roomId);
    if (!room) return res.status(404).json({ error: "Room not found." });
    if (!req.files?.length) return res.status(400).json({ error: "Select at least one image to upload." });
    return res.status(201).json({ files: req.files.map((file) => ({ url: `/uploads/${file.filename}`, name: file.originalname, size: file.size })) });
  } catch (error) { return next(error); }
}

module.exports = {
  get,
  put,
  report,
  balances,
  listResource,
  mutateResource,
  upload,
  findAccessibleRoom,
  getWorkspace,
  saveWorkspace
};
