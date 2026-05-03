import { select, eq, param } from "@t8n/tom";
import { hui } from "../schema/users.js";

// Exporting the executor directly for the best DX
export const getUserById = select(hui)
  .columns(["id", "email", "name"])
  .where(eq(hui.columns.id, param("id")))
  .toAST();

export const listUsers = select(hui)
  .columns(["id", "name"])
  .limit(10)
  .toAST();
