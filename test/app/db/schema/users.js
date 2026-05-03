import { pgTable, uuid, varchar, timestamp } from "@t8n/tom";

export const hui = pgTable("hui", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});
