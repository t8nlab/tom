import { log, response } from "@titanpl/native";
import { connect } from "../db/db";
import { listUsers } from "../db/queries/users";

export default function getusers(req) {
  const conn = connect();
  const rows = listUsers(conn, {});

  return response.json({ count: rows.length, users: rows });
}
