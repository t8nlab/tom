import { pgTable, varchar, timestampz, uuid } from '@t8n/tom';

export const users = pgTable('users', {
  uid: uuid('uid').primaryKey(),
  displayName: varchar('display_name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique().notNull(),
  createdAt: timestampz('created_at').notNull().defaultNow(),
  updatedAt: timestampz('updated_at').defaultNow(),
});