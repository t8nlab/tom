import * as dsl from "./src/orm/dsl.js";
import { QueryCompiler } from "./src/compiler/query_compiler.js";
import { registerExtension } from "./utils/registerExtension.js";
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
    boolean,
    integer,
    json,
    decimal,
    select,
    insert,
    update,
    delete: deleteFrom,
    eq,
    param
} = dsl;

export { deleteFrom as delete };


registerExtension("tom", tom)
// Export Compiler
export { QueryCompiler };