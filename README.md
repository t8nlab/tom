# ▽ Tom — TitanPL ORM

**Tom** (Titan Object Mapper) is a high-performance, developer-friendly ORM for **Titan Planet**. It provides a "Drizzle-like" developer experience with zero runtime overhead and perfect native type binding.

## ✨ Features
- **Zero Runtime Overhead**: Queries are pre-compiled into native TitanPL actions.
- **Incremental Migrations**: Automatically tracks schema changes and generates versioned SQL files.
- **Risk Assessment**: Detects potential data loss and prompts for confirmation (rename/drop).
- **Uses TitanPL's `types` and `drift` runtime APIs under the hood.**
- **Drizzle-like syntax**: Familiar and easy to use for developers who have used Drizzle ORM.

---

## 🚀 Getting Started

### 1. Installation
Install tom in your Titan project:
```bash
npm install @t8n/tom
```

### 2. Project Structure
Tom expects a standard Titan directory structure:
```text
app/
  db/
    schema/      # Table definitions
    queries/     # Query AST definitions
    db.js        # Connection configuration
.titan/          # [AUTO-GENERATED] Rebuilt on every run.
  migrations/    # Versioned SQL migrations (000, 001, 002...)
  orm/           # Pre-compiled native queries + schema snapshots
```

> [!TIP]
> Add `.titan/` to your `.gitignore`. This directory is automatically generated.

### 3. Configuration (Optional)
You can customize the default directory structure by creating a `tom.config.json` in your project root:

```json
{
  "schema": "app/db/schema",
  "queries": "app/db/queries",
  "migrations": ".titan/migrations"
}
```


---

## 🔌 Database Connection

Tom does not manage its own database connections or pools. Instead, it is designed to work seamlessly with the **standard TitanPL Runtime API**.

- **Connection Source**: Tom uses the `db` object provided by TitanPl's `db.connect()` or `defineAction` context.
- **Under the Hood**: Tom converts your queries into standard TitanPl Query ASTs and executes them using the native `db.query` APIs.
- **Zero Configuration**: Since it uses your existing connection, there's no need to configure a separate database URL for runtime usage.

### Standard `app/db/db.js`
Your connection setup remains purely TitanPL native:

```javascript
import { db, env, drift } from "@titanpl/native";

export const connect = () => {
  return drift(db.connect(env.DB_URI, {
    max: 10,
    min: 1,
    ssl: true,
    pool_timeout: 10000,
  }));
};
```

---

## 📐 Defining Schema


Create files in `app/db/schema/` (e.g., `users.js`):

```javascript
import { pgTable, uuid, varchar, timestamp, text } from "@t8n/tom";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

### 📅 Date & Time
Tom supports both standard and timezone-aware timestamps:
- `timestamp(name, { withTimezone: true })`
- `timestampz(name)` (Alias for timezone-aware)

### 🔗 Relationships
Use `.references()` to define foreign keys:

```javascript
import { pgTable, uuid, text } from "@t8n/tom";
import { users } from "./users.js";

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  content: text("content").notNull(),
  authorId: uuid("author_id").references(users.id, { 
    onDelete: 'cascade', 
    onUpdate: 'cascade' 
  }),
});
```

---

## 🛠️ CLI & Migrations

Tom manages your database lifecycle with a focus on safety and speed.

| Command | Description |
| :--- | :--- |
| `npx tom push` | **Recommended**: Generates new migrations (if needed) and applies them to the DB. |
| `npx tom generate` | Scans schema/queries and generates versioned migrations + pre-compiled code. |
| `npx tom migrate` | Alias for `push`. |
| `npx tom rebase` | Clear `.titan` directory (snapshots/migrations) to start fresh. |

### ⚠️ Risk Assessment
When you run `tom push` or `tom generate`, Tom compares your current schema with the last snapshot. If it detects a missing table or column, it will warn you:

```text
⚠️  RISK: Column "bio" in table "users" is missing.
Did you rename "bio" or should it be DROPPED? (Enter "r" for rename, "d" for drop, "c" to cancel) [r/d/C]:
```

### 🔄 Incremental SQL
Tom generates idempotent SQL using `IF EXISTS` and `IF NOT EXISTS`, ensuring your migrations are robust:
- `000_initial.sql`
- `001_update.sql`
- `002_update.sql`

---

## 🔍 Building Queries

Define queries in `app/db/queries/` (e.g., `userQueries.js`):

```javascript
import { select, insert, update, eq, param } from "@t8n/tom";
import { users } from "../schema/users.js";

// SELECT query
export const getUserById = select(users)
  .columns(["id", "email", "name"])
  .where(eq(users.id, param("id")))
  .toAST();
```

After generating, use them in your actions:
```javascript
import { getUserById } from "../db/queries.js";
import { connect } from "../db/db.js";
import { defineAction } from "@titanpl/native";

export default defineAction((req) => {
  const db = connect();
  return getUserById(db, { id: req.params.id });
})
```

---

## ⚡ Direct Usage in Actions

While pre-compiling with `tom generate` is recommended for maximum performance, you can also use Tom queries **directly** inside your Titan actions for quick prototyping or dynamic queries. No separate files required!

```javascript
import { select, eq, param } from "@t8n/tom";
import { defineAction } from "@titanpl/native";
import { users } from "../db/schema/users.js";
import { connect } from "../db/db.js";

export default defineAction((req) => {
  const db = connect();

  // Define and execute in one place
  const getUser = select(users)
    .where(eq(users.id, param("id")))
    .toAST();

  return getUser(db, { id: req.params.id });
})
```

---

## 🛠️ Detailed API & Examples


### 📊 Query Building

#### 1. SELECT
Retrieve data from your tables.

```javascript
import { select, eq, param } from "@t8n/tom";
import { users } from "../schema/users.js";

export const getActiveUsers = select(users)
  .columns(["id", "name", "email"]) // Optional: defaults to all columns
  .where(eq(users.name, param("name")))
  .limit(10)
  .toAST();
```

#### 2. INSERT
Add new records to the database.

```javascript
import { insert, param } from "@t8n/tom";
import { users } from "../schema/users.js";

export const createUser = insert(users)
  .values({
    id: param("id"),
    email: param("email"),
    name: param("name")
  })
  .returning(["id"]) // Return specific columns after insert
  .toAST();
```

#### 3. UPDATE
Modify existing records.

```javascript
import { update, eq, param } from "@t8n/tom";
import { users } from "../schema/users.js";

export const updateUserName = update(users)
  .set({ name: param("newName") })
  .where(eq(users.id, param("userId")))
  .toAST();
```

#### 4. DELETE
Remove records from the database.

```javascript
import { deleteFrom, eq, param } from "@t8n/tom";
import { users } from "../schema/users.js";

export const deleteUser = deleteFrom(users)
  .where(eq(users.id, param("id")))
  .toAST();
```

---

### 🔍 Helper Functions

#### `eq(column, value)`
Creates an equality condition.
- **column**: The table column reference (e.g., `users.id`).
- **value**: A static value or a `param()`.

#### `param(name, typeOverride?)`
Defines a named parameter for the query.
- **name**: The key you will pass in the action (e.g., `getUserById(db, { id: "..." })`).
- **typeOverride**: Optional. Force a specific Titan type (e.g., `UUID`, `BIGINT`).

#### `and(...conditions)`
Combines multiple conditions using SQL `AND`.
```javascript
.where(and(eq(users.active, true), eq(users.id, param("id"))))
```

#### `or(...conditions)`
Combines multiple conditions using SQL `OR`.
```javascript
.where(or(eq(users.role, "admin"), eq(users.role, "superadmin")))
```

#### `where(t => condition)`
Functional style for `where` clauses.
```javascript
.where(t => eq(t.ownerUid, param("ownerUid")))
```

---

## 📋 API Quick Reference

### Data Types
- `uuid(name)`: Postgres UUID type.
- `varchar(name, { length })`: Variable-length string.
- `text(name)`: Large text content.
- `bigint(name)`: 64-bit integer.
- `integer(name)`: 32-bit integer.
- `boolean(name)`: True/False.
- `timestamp(name, { withTimezone })`: Date and time.
- `timestampz(name)`: Date and time with timezone.
- `json(name)`: JSON/JSONB data.
- `decimal(name)`: Precise numeric type.

### Column Modifiers
- `.primaryKey()`: Marks as the primary identifier.
- `.notNull()`: Prevents null values.
- `.unique()`: Ensures value uniqueness.
- `.default(value)`: Sets a static default.
- `.defaultNow()`: Sets current timestamp as default.
- `.references(table.column, { onDelete, onUpdate })`: Creates a foreign key link with optional cascading.

---

## ⚖️ Deployment
The generated code in `.titan/orm/` is standard JavaScript. No extra dependencies are needed in production. The `.titan/` folder is **automatically generated** on production during the build phase (e.g., when running `titan build` or `tom push`). You do not need to manually push or commit the `.titan/` directory. Just ensure your migrations are pushed to the production database.

