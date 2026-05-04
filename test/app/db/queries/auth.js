import { select, insert, update, eq, and, param } from "@t8n/tom";
import { users } from "../schema/user.js";
import { accounts } from "../schema/accounts.js";

// --- User Queries ---

export const findUserByEmail = select(users)
  .where(t => eq(t.email, param("email")))
  .limit(1)
  .toAST();

export const createUser = insert(users)
  .values({
    uid: param("uid"),
    displayName: param("displayName"),
    email: param("email"),
  })
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
  .values({
    id: param("id"),
    ownerUid: param("ownerUid"),
    accountName: param("accountName"),
    email: param("email"),
    picture: param("picture"),
    provider: param("provider"),
    providerUserId: param("providerUserId"),
    accessToken: param("accessToken"),
    refreshToken: param("refreshToken"),
    expiresAt: param("expiresAt"),
    refreshExpiresAt: param("refreshExpiresAt")
  })
  .returning(["id", "ownerUid", "providerUserId", "email", "accountName"])
  .toAST();

export const updateAccountTokens = update(accounts)
  .set({
    accessToken: param("accessToken"),
    refreshToken: param("refreshToken"),
    expiresAt: param("expiresAt"),
    refreshExpiresAt: param("refreshExpiresAt")
  })
  .where(t => and(
    eq(t.ownerUid, param("ownerUid")),
    eq(t.provider, param("provider")),
    eq(t.providerUserId, param("providerUserId"))
  ))
  .toAST();

export const findAccountsByOwner = select(accounts)
  .where(t => eq(t.ownerUid, param("ownerUid")))
  .toAST();
