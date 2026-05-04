import { pgTable, text, timestamp, timestampz, uuid, varchar } from "@t8n/tom";
import { users } from "./user.js";

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  ownerUid: uuid('owner_uid')
    .notNull()
    .references(users.uid, { onDelete: 'cascade', onUpdate: 'cascade' }),
  accountName: varchar('account_name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull(),
  picture: varchar('picture', { length: 500 }),
  provider: text('provider'),
  providerUserId: text('provider_user_id').unique().notNull(),
  accessToken: varchar('access_token', { length: 2048 }),
  refreshToken: varchar('refresh_token', { length: 2048 }),
  createdAt: timestampz('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  refreshExpiresAt: timestamp('refresh_expires_at'),
});