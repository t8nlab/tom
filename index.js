import * as dsl from "./src/orm/dsl.js";
import { QueryCompiler } from "./src/compiler/query_compiler.js";
/**
 * tom - Native TitanPL ORM
 */
export default class tom {
  constructor(config = {}) {
    this.config = config;
  }
}


// Export DSL
export const {
    pgTable,
    bigint,
    varchar,
    text,
    uuid,
    timestamp,
    timestampz,
    boolean,
    integer,
    json,
    decimal,
    select,
    insert,
    update,
    delete: deleteFrom,
    eq,
    and,
    or,
    param,
    pgEnum,
    numeric,
    index,
    uniqueIndex,
    sql
} = dsl;

export { deleteFrom as delete };


// Export Compiler
export { QueryCompiler };