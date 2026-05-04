// app/db/db.js (db connection)
import { db as TitanDb, drift } from "@titanpl/native"

const connection = drift(TitanDb.connect(Titan.env.DB_URI, {
    max: 15,
    min: 1,
    ssl: true
}))

export const connect = () => connection;