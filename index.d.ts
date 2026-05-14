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
    /** Optional max length for validation. */
    length?: number;
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
     * @example .references(users.id, { onDelete: 'cascade' })
     */
    references(column: Column, opts?: { onDelete?: string; onUpdate?: string }): Column;
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
 * Date and time (without time zone, unless configured).
 * @param name The column name in the database.
 * @param opts Options like withTimezone.
 */
export function timestamp(name: string, opts?: { withTimezone?: boolean }): Column;

/** 
 * Date and time (with time zone).
 * @param name The column name in the database.
 */
export function timestampz(name: string): Column;

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
 * Smart Result type. 
 * Behaves as an array of T, but also allows direct access to the first element's properties.
 */
export type TomeResult<T> = T[] & T & {
    /** Error message if the query failed, otherwise null. */
    error: string | null;
    /** Reference to the raw data array. */
    data: T[] | null;
    /** Whether this is a tom result. */
    isTomResult: boolean;
};

/**
 * A compiled tom query executor.
 */
export type TomQuery<TParams = Record<string, any>, TResult = any> = {
    /**
     * Execute the query with a specific connection.
     * @param connection Database connection
     * @param params Query parameters
     */
    (connection: any, params: TParams): TResult;
    
    /**
     * Execute the query using the global connection (t.db or db).
     * @param params Query parameters
     */
    (params: TParams): TResult;
    
    /** Whether this is a tom query. */
    isTomQuery: boolean;
    /** The underlying AST. */
    ast: any;
};

/**
 * Internal types for parameter inference.
 */
export type Param<N extends string> = { type: 'param', name: N, typeOverride?: string };
export type Condition<P = {}> = { type: string; _params?: P };

/**
 * Helper to infer parameter types from WHERE clauses, values(), or set().
 */
export type InferParams<T> = 
    T extends Param<infer N> ? { [K in N]: any } :
    T extends Record<string, any> ? { [K in keyof T as T[K] extends Param<infer N> ? N : never]: any } :
    T extends (table: any) => infer R ? (R extends Condition<infer P> ? P : {}) :
    {};

/**
 * Query Builder interface for fluent query construction.
 */
export interface QueryBuilder<TParams = {}, TResult = any, IsSingle = false> {
    /** Select specific columns. */
    columns(cols: string[]): QueryBuilder<TParams, TResult, IsSingle>;
    
    /** 
     * Add a WHERE clause. 
     * Parameters used in param() calls inside the callback will be automatically required.
     * @example .where(acc => eq(acc.id, param("id")))
     */
    where<C>(condition: C): QueryBuilder<TParams & InferParams<C>, TResult, IsSingle>;
    
    /** 
     * Add a LIMIT clause. 
     * If n is 1, toAST() will return a single object/null instead of a TomeResult.
     */
    limit<N extends number>(n: N): QueryBuilder<TParams, TResult, N extends 1 ? true : false>;
    
    /** 
     * Explicitly mark the query to return a single result (or null) instead of an array.
     */
    single(): QueryBuilder<TParams, TResult, true>;

    /** 
     * Set values for INSERT. 
     * Parameters used here will be automatically required in the final query.
     */
    values<V>(vals: V): QueryBuilder<TParams & InferParams<V>, TResult, IsSingle>;
    
    /** 
     * Set values for UPDATE. 
     * Parameters used here will be automatically required in the final query.
     */
    set<V>(vals: V): QueryBuilder<TParams & InferParams<V>, TResult, IsSingle>;
    
    /** 
     * Add a RETURNING clause. 
     * Supports array of column names or a table object to return all columns.
     */
    returning(cols: string[] | Table<any>): QueryBuilder<TParams, TResult, IsSingle>;
    
    /** 
     * Convert the builder state to an AST for compilation. 
     */
    toAST(): TomQuery<TParams, IsSingle extends true ? (TResult | null) : TomeResult<TResult>>;
}

/**
 * Start a SELECT query.
 * @param table The table to select from.
 */
export function select<T extends Record<string, Column>>(table: Table<T>): QueryBuilder<{}, { [K in keyof T]: any }>;

/**
 * Start an INSERT query.
 * @param table The table to insert into.
 */
export function insert<T extends Record<string, Column>>(table: Table<T>): QueryBuilder<{}, { [K in keyof T]: any }>;

/**
 * Start an UPDATE query.
 * @param table The table to update.
 */
export function update<T extends Record<string, Column>>(table: Table<T>): QueryBuilder<{}, { [K in keyof T]: any }>;

/**
 * Start a DELETE query.
 * @param table The table to delete from.
 */
export { deleteFrom as delete };
declare function deleteFrom(table: any): QueryBuilder;


/**
 * Equality condition for WHERE clauses.
 */
export function eq<C extends Column, V>(left: C, right: V): Condition<InferParams<V>>;

/**
 * Logical AND operator for combining multiple conditions.
 */
export function and<C extends Condition<any>[]>(...conditions: C): Condition<InferParams<C[number]>>;

/**
 * Logical OR operator for combining multiple conditions.
 */
export function or<C extends Condition<any>[]>(...conditions: C): Condition<InferParams<C[number]>>;

/**
 * Named parameter for pre-compiled queries.
 * @param name Parameter name.
 * @param typeOverride Optional Titan type override.
 */
export function param<N extends string>(name: N, typeOverride?: string): Param<N>;

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
