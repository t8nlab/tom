/**
 * @package tom
 * @description Native TitanPL ORM providing a Drizzle-like DX for high-performance database operations.
 */

/**
 * Represents a database column with modifiers.
 */
export interface Column {
    /** The column name in the database. */
    name: string;
    /** The SQL data type. */
    type: string;
    /** The Titan internal type mapping. */
    titanType: string;
    /** Mark the column as a Primary Key. */
    primaryKey(): Column;
    /** Mark the column as Not Null. */
    notNull(): Column;
    /** Mark the column as Unique. */
    unique(): Column;
    /** Set a default value for the column. */
    default(val: any): Column;
    /** Set the default value to the current timestamp. */
    defaultNow(): Column;
    /** 
     * Define a foreign key reference.
     * @example .references(users.id)
     */
    references(column: Column): Column;
}

/**
 * Represents a database table schema.
 */
export type Table<T = Record<string, Column>> = {
    /** Internal type identifier. */
    type: 'table';
    /** The table name. */
    name: string;
    /** The column definitions. */
    columns: T;
} & T;

/**
 * Define a PostgreSQL table schema.
 * @param name The table name in the database.
 * @param columns Column definitions.
 */
export function pgTable<T extends Record<string, Column>>(name: string, columns: T): Table<T>;


/** 
 * UUID (Universally Unique Identifier) type.
 * @param name The column name in the database.
 */
export function uuid(name: string): Column;

/** 
 * Variable-length character string.
 * @param name The column name in the database.
 * @param opts Options like max length.
 */
export function varchar(name: string, opts?: { length: number }): Column;

/** 
 * Variable-length character string (large).
 * @param name The column name in the database.
 */
export function text(name: string): Column;

/** 
 * 64-bit signed integer.
 * @param name The column name in the database.
 */
export function bigint(name: string): Column;

/** 
 * 32-bit signed integer.
 * @param name The column name in the database.
 */
export function integer(name: string): Column;

/** 
 * Boolean (true/false) type.
 * @param name The column name in the database.
 */
export function boolean(name: string): Column;

/** 
 * Date and time (without time zone).
 * @param name The column name in the database.
 */
export function timestamp(name: string): Column;

/** 
 * JSON data.
 * @param name The column name in the database.
 */
export function json(name: string): Column;

/** 
 * Fixed-precision decimal number.
 * @param name The column name in the database.
 */
export function decimal(name: string): Column;


/**
 * Query Builder interface for fluent query construction.
 */
export interface QueryBuilder {
    /** Select specific columns. */
    columns(cols: string[]): QueryBuilder;
    /** Add a WHERE clause. */
    where(condition: any): QueryBuilder;
    /** Add a LIMIT clause. */
    limit(n: number): QueryBuilder;
    /** Set values for INSERT. */
    values(vals: Record<string, any>): QueryBuilder;
    /** Set values for UPDATE. */
    set(vals: Record<string, any>): QueryBuilder;
    /** Add a RETURNING clause. */
    returning(cols: string[]): QueryBuilder;
    /** Convert the builder state to an AST for compilation. */
    toAST(): any;
}

/**
 * Start a SELECT query.
 * @param table The table to select from.
 */
export function select(table: any): QueryBuilder;

/**
 * Start an INSERT query.
 * @param table The table to insert into.
 */
export function insert(table: any): QueryBuilder;

/**
 * Start an UPDATE query.
 * @param table The table to update.
 */
export function update(table: any): QueryBuilder;

/**
 * Start a DELETE query.
 * @param table The table to delete from.
 */
export { deleteFrom as delete };
declare function deleteFrom(table: any): QueryBuilder;


/**
 * Equality condition for WHERE clauses.
 */
export function eq(left: any, right: any): any;

/**
 * Named parameter for pre-compiled queries.
 * @param name Parameter name.
 * @param typeOverride Optional Titan type override.
 */
export function param(name: string, typeOverride?: string): any;

/**
 * Internal query compiler for generating SQL and Titan wrappers.
 */
export class QueryCompiler {
    /** Compile an AST into SQL and parameter mappings. */
    compile(ast: any): { sql: string; params: { name: string; titanType: string }[]; table?: any };
    /** Generate a JavaScript wrapper for the compiled query. */
    generateWrapper(name: string, compiled: any): string;
}

/**
 * Main tom ORM class.
 */
export default class tom {
    constructor(config?: any);
}
