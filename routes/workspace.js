const express = require("express");
const upload = require("../middleware/upload");
const controller = require("../controllers/workspaceController");
const db = require("../config/db");

const router = express.Router();

router.get("/workspace", controller.get);
router.put("/workspace", controller.put);
router.get("/reports/monthly", controller.report);
router.get("/balances", controller.balances);
router.post("/uploads/images", upload.array("images", 5), controller.upload);
router.get("/rent", async (req, res, next) => {
  try {
    const workspace = await controller.getWorkspace(req.user);
    return res.json({ amount: workspace.rent, dueDate: workspace.rentDueDate, split: workspace.rentSplit });
  } catch (error) { return next(error); }
});
router.put("/rent", async (req, res, next) => {
  try {
    const workspace = await controller.getWorkspace(req.user);
    workspace.rent = req.body.amount;
    workspace.rentDueDate = req.body.dueDate || "";
    workspace.rentSplit = req.body.split || {};
    return res.json(await controller.saveWorkspace(req.user, workspace));
  } catch (error) { return next(error); }
});

router.get("/rooms", async (req, res, next) => {
  try {
    const workspace = await controller.getWorkspace(req.user);
    return res.json(workspace.roomId ? [{ id: workspace.roomId, name: workspace.roomName, city: workspace.roomCity }] : []);
  } catch (error) { return next(error); }
});
router.post("/rooms", async (req, res, next) => {
  try {
    const workspace = await controller.getWorkspace(req.user);
    if (workspace.roomId) return res.status(409).json({ error: "This account already has an active room." });
    if (typeof req.body.name !== "string" || !req.body.name.trim()) return res.status(400).json({ error: "Room name is required." });
    workspace.roomName = req.body.name.trim();
    workspace.roomCity = typeof req.body.city === "string" ? req.body.city.trim() : "";
    return res.status(201).json(await controller.saveWorkspace(req.user, workspace));
  } catch (error) { return next(error); }
});
router.put("/rooms", async (req, res, next) => {
  try {
    const workspace = await controller.getWorkspace(req.user);
    workspace.roomName = req.body.name;
    workspace.roomCity = req.body.city || "";
    return res.json(await controller.saveWorkspace(req.user, workspace));
  } catch (error) { return next(error); }
});
router.get("/rooms/:roomId", async (req, res, next) => {
  try {
    const room = await controller.findAccessibleRoom(req.user.id, db, req.params.roomId);
    if (!room) return res.status(404).json({ error: "Room not found." });
    const workspace = await controller.getWorkspace(req.user);
    return res.json({ id: room.id, name: room.name, city: room.city, roommates: workspace.roommates });
  } catch (error) { return next(error); }
});

router.post("/rooms/:roomId/invitations", async (req, res, next) => {
  try {
    const room = await controller.findAccessibleRoom(req.user.id, db, req.params.roomId);
    if (!room || room.owner_user_id !== req.user.id) return res.status(403).json({ error: "Only the room owner can add account members." });
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const memberId = typeof req.body.memberId === "string" ? req.body.memberId : "";
    if (!email || !memberId) return res.status(400).json({ error: "Member ID and account email are required." });
    const [users] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (!users.length) return res.status(404).json({ error: "No RoomSync account uses that email yet." });
    const [result] = await db.execute(
      "UPDATE room_members SET user_id = ? WHERE room_id = ? AND id = ?",
      [users[0].id, room.id, memberId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Roommate not found." });
    return res.status(200).json({ message: "Roommate account connected to this room." });
  } catch (error) { return next(error); }
});

const collections = ["expenses", "payments", "shopping", "inventory", "notices", "shoppingList", "reminders", "calendarEvents", "locations", "roommates"];
router.get("/:resource", controller.listResource);
router.post("/:resource", controller.mutateResource);
router.put("/:resource/:id", controller.mutateResource);
router.delete("/:resource/:id", controller.mutateResource);

module.exports = router;
