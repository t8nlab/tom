import { select, insert, update, eq, and, param } from "@t8n/tom";
import { users } from "../schema/user.js";
import { accounts } from "../schema/accounts.js";

// --- User Queries ---

export const findUserByEmail = select(users)
  .where(t => eq(t.email, param("email")))
  .limit(1)
  .toAST();

export const createUser = insert(users)
  .values(users)
  .returning(["uid", "email", "displayName"])
  .toAST();

// --- Account Queries ---

export const findAccountByProviderId = select(accounts)
  .where(t => and(
    eq(t.providerUserId, param("providerUserId")),
    eq(t.provider, param("provider"))
  ))
  .limit(1)
  .toAST();

export const findAccountByOwnerAndProvider = select(accounts)
  .where(t => and(
    eq(t.ownerUid, param("ownerUid")),
    eq(t.provider, param("provider"))
  ))
  .limit(1)
  .toAST();

export const createAccount = insert(accounts)
  .values(accounts)
  .returning(["id", "ownerUid", "providerUserId", "email", "accountName"])
  .toAST();

export const updateAccount = update(accounts)
  .set(accounts)
  .where(t => eq(t.id, param("id")))
  .toAST();

export const findAccountsByOwner = select(accounts)
  .where(t => eq(t.ownerUid, param("ownerUid")))
  .toAST();
