import { defineAction, response } from "@titanpl/native";
import { connect } from "../db/db.js";
import { select, eq, param } from "@t8n/tom";
import { hui } from "../db/schema/users.js";

/**
 * Action to get a user
 * Demonstrating Direct Usage: No separate query file needed!
 */
export default defineAction((req) => {
  const conn = connect();

  // Define and execute the query directly in the action
  const getUser = select(hui)
    .columns(["id", "email", "name"])
    .where(eq(hui.id, param("id")))
    .toAST();

  const rows = getUser(conn, { id: req.params.id });



  if (!rows || rows.length === 0) {
    return response.json({ error: "User not found" }, { status: 404 });
  }

  return response.json(rows[0]);
})