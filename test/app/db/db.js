import { db, env, drift } from "@titanpl/native";


export const connect = () => {
  return drift(db.connect(env.DB_URI, {
    max: 10,
    min: 1,
    ssl: true,
    pool_timeout: 10000,
  }));
};