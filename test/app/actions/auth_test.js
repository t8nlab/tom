/* eslint-disable titanpl/drift-only-titan-async */
import Google from '@t8n/google-oauth';
import { defineAction, jwt, response, env, log } from '@titanpl/native';
import '@titanpl/node/globals'
import { v4 as uuid } from 'uuid'
import { createAccount, findAccountByProviderId, createUser, updateAccount, findAccountByOwnerAndProvider, findUserByEmail } from '../db/queries/auth.js';
import { connect } from '../db/db.js';
import { getExpiryDate } from '../lib/time.js';

export const google = new Google({
  clientId: Titan.env.GOOGLE_CLIENT_ID,
  redirectUri: Titan.env.GOOGLE_REDIRECT_URI,
  clientSecret: Titan.env.GOOGLE_SECRET,
  scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly"
})

export default defineAction((req) => {
  const conn = connect();
  const code = req.query.code

  if (!code) {
    return response.json({ error: 'code not found', success: false }, { status: 400 })
  }

  const data = google.callback(code)
  // console.log("GOOGLE CALLBACK DATA:", JSON.stringify(data, null, 2));

  if (!data) {
    return response.json({ error: 'Failed to fetch data from Google', success: false }, { status: 400 })
  }

  if (!data.user) {
    return response.json({ error: 'Failed to fetch user profile from Google', data, success: false }, { status: 400 })
  }

  const googleUserId = data.user?.id;
  const email = data.user?.email;
  const picture = data.user?.picture;
  const googleName = data.user?.name || 'Google User';

  if (!googleUserId || !email) {
    return response.json({ error: 'Incomplete user data from Google profile', user: data.user, success: false }, { status: 400 })
  }

  // 1. Check if this Google account is already linked
  const accountResult = findAccountByProviderId(conn, {
    providerUserId: googleUserId,
    provider: 'google'
  });

  let account = accountResult.data?.[0];

  let userUid;

  if (account) {
    updateAccount(conn, {
      id: account.id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: getExpiryDate(data.expires_in || data.access_token_expires_in),
      refreshExpiresAt: getExpiryDate(data.refresh_token_expires_in),
    });

    const updatedAccountRes = findAccountByProviderId(conn, {
      providerUserId: googleUserId,
      provider: 'google'
    });

    userUid = account.ownerUid;
  } else {
    const userByEmailRes = findUserByEmail(conn, { email });
    const existingUser = userByEmailRes?.data?.[0];

    if (existingUser) {
      userUid = existingUser?.uid;
    } else {
      const newUserUid = uuid();
      const userRes = createUser(conn, {
        uid: newUserUid,
        email: email,
        displayName: googleName,
      });

      if (userRes?.error) {
        return response.json({ error: "Failed to create user", details: userRes?.error, success: false }, { status: 500 });
      }

      userUid = newUserUid;
    }

    // Link account to the user
    const createAccRes = createAccount(conn, {
      id: uuid(),
      ownerUid: userUid,
      accountName: googleName,
      email: email,
      picture: picture,
      provider: 'google',
      providerUserId: googleUserId,
      accessToken: data?.access_token,
      refreshToken: data?.refresh_token,
      expiresAt: getExpiryDate(data?.expires_in || data?.access_token_expires_in),
      refreshExpiresAt: getExpiryDate(data?.refresh_token_expires_in),
    });

    if (createAccRes?.error) {
      return response.json({ error: "Failed to link account", details: createAccRes?.error, success: false }, { status: 500 });
    }

    account = createAccRes?.data?.[0];
  }

  // 3. Generate Token
  const tokenPayload = {
    uid: userUid,
    email: email,
    displayName: googleName,
    currentAccount: {
      email: email,
      googleId: googleUserId
    }
  }

  const tokenResult = jwt.sign(tokenPayload, env.SECRET_KEY, {
    expiresIn: "28d"
  })

  if (!tokenResult) {
    return response.json({ error: "Token generation failed", success: false }, { status: 500 })
  }

  const userData = {
    user: {
      uid: userUid,
      email: email,
      displayName: googleName,
    },
    account: {
      id: account?.id,
      name: account?.accountName || googleName,
      email: account?.email || email,
      picture: account?.picture,
      provider: account?.provider,
      expiresAt: account?.expiresAt,
      refreshExpiresAt: account?.refreshExpiresAt,
    },
    token: tokenResult,
  }

  // const dataParam = encodeURIComponent(JSON.stringify(userData));
  // const uri = `flow://?data=${dataParam}`;

  // return response.redirect(uri, {
  //   status: 302,
  // });

  return response.json({
    userData,
    data
  }, {
    status: 200
  });
})
