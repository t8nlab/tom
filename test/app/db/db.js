// app/db/db.js (db connection)
import { db as TitanDb, drift } from "@titanpl/native"

export const conn = drift(TitanDb.connect(Titan.env.DB_URI, {
    max: 15,
    min: 1,
    ssl: true
}))