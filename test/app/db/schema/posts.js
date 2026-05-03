import { pgTable, uuid, varchar, text, timestamp } from "@t8n/tom";
import { hui as users } from "./users.js";

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),


  authorId: uuid("author_id").notNull().references(users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
