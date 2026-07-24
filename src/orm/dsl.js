// tom DSL - ORM for TitanPL

export class QueryBuilder {
    constructor(table, type = 'select') {
        this.state = {
            type,
            table,
            columns: [],
            where: null,
            limit: null,
            values: null,
            set: null,
            returning: [],
            params: [],
            isSingle: false
        };
    }

    single() { this.state.isSingle = true; return this; }

    columns(cols) { this.state.columns = cols; return this; }
    where(condition) {
        if (typeof condition === 'function') {
            this.state.where = condition(this.state.table);
        } else {
            this.state.where = condition;
        }
        return this;
    }
    limit(n) { this.state.limit = n; return this; }
    values(vals) {
        if (vals && vals.type === 'table') {
            this.state.values = {};
            Object.keys(vals.columns).forEach(key => {
                this.state.values[key] = param(key);
            });
        } else {
            this.state.values = vals;
        }
        return this;
    }
    set(vals) {
        if (vals && vals.type === 'table') {
            this.state.set = {};
            Object.keys(vals.columns).forEach(key => {
                this.state.set[key] = param(key);
            });
        } else {
            this.state.set = vals;
        }
        return this;
    }
    returning(cols) {
        if (cols && cols.type === 'table') {
            this.state.returning = Object.keys(cols.columns);
        } else {
            this.state.returning = cols;
        }
        return this;
    }


    toAST() {
        const ast = { ...this.state };

        const executor = (connOrParams, maybeParams) => {
            let conn = connOrParams;
            let params = maybeParams || {};

            // If first arg isn't a connection-like object, assume it's params and try to find a global connection
            if (connOrParams && !connOrParams.query && !connOrParams.execute) {
                params = connOrParams;
                conn = globalThis.t?.db || globalThis.db || globalThis.conn;
            }

            if (!conn) {
                return { data: null, error: "No database connection provided and no global connection found (t.db or db or conn)." };
            }

            // Environment-safe access to Titan Native APIs
            const drift = globalThis.drift || (globalThis.t && globalThis.t.drift);
            const types = globalThis.types || (globalThis.t && globalThis.t.types);
            const log = (globalThis.t && t.log);

            let sql = "";
            let bindValues = [];
            let pCount = 1;

            const buildWhere = (condition) => {
                if (!condition) return "";
                if (condition.type === 'eq') {
                    const left = condition.left.name;
                    const right = condition.right;
                    if (right && right.type === 'param') {
                        const tType = right.typeOverride || condition.left.titanType || 'STRING';
                        const val = params[right.name];

                        // Validation
                        if (condition.left.titanType === 'VARCHAR' && condition.left.length && val && val.length > condition.left.length) {
                            throw new Error(`Validation error: "${right.name}" length (${val.length}) exceeds maximum (${condition.left.length}) for column "${condition.left.name}"`);
                        }

                        try {
                            bindValues.push(types[tType](val));
                        } catch (e) {
                            throw new Error(`Failed to bind parameter "${right.name}" as ${tType}: ${e.message}`);
                        }
                        return `${left} = $${pCount++}`;
                    }
                    return `${left} = ${right}`;
                } else if (condition.type === 'and') {
                    return `(${condition.conditions.map(c => buildWhere(c)).join(' AND ')})`;
                } else if (condition.type === 'or') {
                    return `(${condition.conditions.map(c => buildWhere(c)).join(' OR ')})`;
                }
                return "";
            };

            try {
                if (ast.type === 'select') {
                    const mappedCols = ast.columns.map(c => {
                        if (typeof c === 'string') {
                            const col = ast.table[c];
                            return col ? col.name : c;
                        }
                        return c.name || c;
                    });
                    sql = `SELECT ${mappedCols.length ? mappedCols.join(', ') : '*'} FROM ${ast.table.name}`;
                    if (ast.where) {
                        sql += ` WHERE ${buildWhere(ast.where)}`;
                    }
                    if (ast.limit) sql += ` LIMIT ${ast.limit}`;
                } else if (ast.type === 'insert') {
                    const colKeys = Object.keys(ast.table.columns);
                    const colNames = [];
                    const values = [];
                    colKeys.forEach(prop => {
                        const val = ast.values[prop];
                        const col = ast.table[prop];
                        if (val && val.type === 'param') {
                            if (params[val.name] !== undefined) {
                                colNames.push(col ? col.name : prop);
                                const tType = val.typeOverride || (col ? col.titanType : 'STRING');
                                const paramVal = params[val.name];

                                // Validation
                                if (col && col.titanType === 'VARCHAR' && col.length && paramVal && paramVal.length > col.length) {
                                    throw new Error(`Validation error: "${val.name}" length (${paramVal.length}) exceeds maximum (${col.length}) for column "${col.name}"`);
                                }

                                try {
                                    bindValues.push(types[tType](paramVal));
                                } catch (e) {
                                    throw new Error(`Failed to bind parameter "${val.name}" as ${tType} for column "${prop}": ${e.message}`);
                                }
                                values.push(`$${pCount++}`);
                            }
                        } else if (val !== undefined) {
                            colNames.push(col ? col.name : prop);
                            values.push(val);
                        }
                    });
                    sql = `INSERT INTO ${ast.table.name} (${colNames.join(', ')}) VALUES (${values.join(', ')})`;

                    const mappedReturning = (ast.returning && ast.returning.length) ? ast.returning.map(r => {
                        if (typeof r === 'string') {
                            const col = ast.table[r];
                            return col ? col.name : r;
                        }
                        return r.name || r;
                    }) : [];

                    if (mappedReturning.length) {
                        sql += ` RETURNING ${mappedReturning.join(', ')}`;
                    }
                } else if (ast.type === 'update') {
                    const colKeys = Object.keys(ast.table.columns);
                    const sets = [];
                    colKeys.forEach(prop => {
                        // Skip the primary key in the SET clause if it's usually the ID
                        if (prop === 'id') return;

                        const val = ast.set[prop];
                        const col = ast.table[prop];
                        const colName = col ? col.name : prop;
                        if (val && val.type === 'param') {
                            if (params[val.name] !== undefined) {
                                const tType = val.typeOverride || (col ? col.titanType : 'STRING');
                                const paramVal = params[val.name];

                                // Validation
                                if (col && col.titanType === 'VARCHAR' && col.length && paramVal && paramVal.length > col.length) {
                                    throw new Error(`Validation error: "${val.name}" length (${paramVal.length}) exceeds maximum (${col.length}) for column "${col.name}"`);
                                }

                                try {
                                    bindValues.push(types[tType](paramVal));
                                } catch (e) {
                                    throw new Error(`Failed to bind parameter "${val.name}" as ${tType} for column "${prop}": ${e.message}`);
                                }
                                sets.push(`${colName} = $${pCount++}`);
                            }
                        } else if (val !== undefined) {
                            sets.push(`${colName} = ${val}`);
                        }
                    });
                    sql = `UPDATE ${ast.table.name} SET ${sets.join(', ')}`;
                    if (ast.where) {
                        sql += ` WHERE ${buildWhere(ast.where)}`;
                    }

                    const mappedReturning = (ast.returning && ast.returning.length) ? ast.returning.map(r => {
                        if (typeof r === 'string') {
                            const col = ast.table[r];
                            return col ? col.name : r;
                        }
                        return r.name || r;
                    }) : [];

                    if (mappedReturning.length) {
                        sql += ` RETURNING ${mappedReturning.join(', ')}`;
                    }
                }
                else if (ast.type === 'delete') {
                    sql = `DELETE FROM ${ast.table.name}`;
                    if (ast.where) {
                        sql += ` WHERE ${buildWhere(ast.where)}`;
                    }
                }

                let result = drift(conn.query(sql, bindValues));

                // Map results back to property names if it's a select or returning query
                if (result && Array.isArray(result) && ast.table && ast.table.columns) {
                    const colMap = {};
                    Object.entries(ast.table.columns).forEach(([prop, col]) => {
                        if (col.name) colMap[col.name] = prop;
                    });

                    result = result.map(row => {
                        const mappedRow = {};
                        Object.entries(row).forEach(([colName, value]) => {
                            const propName = colMap[colName] || colName;
                            mappedRow[propName] = value;
                        });
                        return mappedRow;
                    });
                }

                const isSingle = ast.isSingle || ast.limit === 1 || (ast.type === 'insert' && !Array.isArray(ast.values));

                if (isSingle) {
                    return (result && result.length) ? result[0] : null;
                }

                // TomResult Proxy for multi-results
                const response = result || [];
                const proxy = new Proxy(response, {
                    get(target, prop) {
                        if (prop === 'error') return target.__error || null;
                        if (prop === 'data') return target;
                        if (prop === 'isTomResult') return true;
                        if (prop === 'isTomResultProxy') return true;

                        if (prop in target) {
                            const val = target[prop];
                            return typeof val === 'function' ? val.bind(target) : val;
                        }

                        // TomResult: Fallback to first element for direct access
                        if (target.length > 0 && target[0] && typeof target[0] === 'object') {
                            return target[0][prop];
                        }
                        return undefined;
                    }
                });
                return proxy;
            } catch (err) {
                if (err.message === '__SUSPEND__' || err === '__SUSPEND__') {
                    throw err;
                }

                const errorMsg = `[tom] Database Error: ${err.message}${err.detail ? ` (${err.detail})` : ''}${err.hint ? ` - Hint: ${err.hint}` : ''}`;
                if (log) log.error(errorMsg);

                const isSingle = ast.isSingle || ast.limit === 1 || (ast.type === 'insert' && !Array.isArray(ast.values));
                if (isSingle) return null;

                const errResponse = [];
                errResponse.__error = errorMsg;
                return new Proxy(errResponse, {
                    get(target, prop) {
                        if (prop === 'error') return target.__error;
                        if (prop === 'data') return null;
                        return target[prop];
                    }
                });
            }
        };

        Object.assign(executor, ast);
        executor.isTomQuery = true;
        executor.ast = ast;

        return executor;
    }
}

export function pgTable(name, columns, extraConfig) {
    const table = { type: 'table', name, columns };
    table.indexes = [];

    Object.entries(columns).forEach(([prop, col]) => {
        col.propertyName = prop;
        col.table = table;
        if (!['name', 'type', 'columns'].includes(prop)) {
            table[prop] = col;
        }
    });

    // Evaluate index callbacks if present
    if (typeof extraConfig === 'function') {
        const result = extraConfig(table);
        if (Array.isArray(result)) {
            table.indexes.push(...result);
        } else if (result && typeof result === 'object') {
            Object.values(result).forEach(idx => {
                table.indexes.push(idx);
            });
        }
    }

    // If there is a column named 'name', wrap it to behave as the table name string
    if (columns.name) {
        const col = columns.name;
        const specialName = new String(name);
        Object.assign(specialName, col);
        specialName.toJSON = () => name;
        specialName.toString = () => name;
        columns.name = specialName;
    }

    // If there is a column named 'type', wrap it to behave as the string 'table'
    if (columns.type) {
        const col = columns.type;
        const specialType = new String('table');
        Object.assign(specialType, col);
        specialType.toJSON = () => 'table';
        specialType.toString = () => 'table';
        columns.type = specialType;
    }

    return new Proxy(table, {
        get(target, prop) {
            if (typeof prop === 'string' && target.columns[prop]) {
                return target.columns[prop];
            }
            return target[prop];
        }
    });
}

export function select(table) { return new QueryBuilder(table, 'select'); }
export function insert(table) { return new QueryBuilder(table, 'insert'); }
export function update(table) { return new QueryBuilder(table, 'update'); }
export function deleteFrom(table) { return new QueryBuilder(table, 'delete'); }
export { deleteFrom as delete };


export function eq(left, right) { return { type: 'eq', left, right }; }
export function and(...conditions) { return { type: 'and', conditions }; }
export function or(...conditions) { return { type: 'or', conditions }; }
export function param(name, typeOverride = null) { return { type: 'param', name, typeOverride }; }

// Data Types
export const uuid = (name) => ({ name, type: 'UUID', titanType: 'UUID', modifiers: [] });
export const varchar = (name, { length } = {}) => ({ name, type: `VARCHAR(${length || 255})`, titanType: 'VARCHAR', length: length || 255, modifiers: [] });
export const text = (name) => ({ name, type: 'TEXT', titanType: 'TEXT', modifiers: [] });
const tomTimestamp = (name) => ({ name, type: 'TIMESTAMP', titanType: 'TIMESTAMP', modifiers: [] });
export const timestampz = (name) => ({ name, type: 'TIMESTAMPTZ', titanType: 'TIMESTAMPTZ', modifiers: [] });
export const bigint = (name) => ({ name, type: 'BIGINT', titanType: 'BIGINT', modifiers: [] });
export const boolean = (name) => ({ name, type: 'BOOLEAN', titanType: 'BOOLEAN', modifiers: [] });
export const integer = (name) => ({ name, type: 'INT', titanType: 'INT', modifiers: [] });
export const json = (name) => ({ name, type: 'JSONB', titanType: 'JSON', modifiers: [] });
export const decimal = (name) => ({ name, type: 'DECIMAL', titanType: 'DECIMAL', modifiers: [] });

// Schema / Drizzle-like Helpers
/**
 * Define a custom PostgreSQL enum type.
 * @param {string} name Enum type name in the database.
 * @param {string[]} values Allowed values for the enum.
 * @returns {EnumDefinition} The enum creator function.
 */
export function pgEnum(name, values) {
    const fn = (colName) => {
        const col = text(colName);
        col.type = `"${name}"`;
        col.titanType = 'STRING';
        col.isEnum = true;
        col.enumName = name;
        return col;
    };
    fn.isEnumDefinition = true;
    fn.enumName = name;
    fn.values = values;
    return fn;
}

/**
 * Define a custom numeric (arbitrary precision) decimal type.
 * @param {string} name Column name.
 * @param {object} [opts] Options.
 * @param {number} [opts.precision] Max number of digits.
 * @param {number} [opts.scale] Number of digits after decimal point.
 * @returns {Column} Column definition.
 */
export function numeric(name, opts) {
    let type = 'NUMERIC';
    if (opts && opts.precision !== undefined) {
        if (opts.scale !== undefined) {
            type = `NUMERIC(${opts.precision}, ${opts.scale})`;
        } else {
            type = `NUMERIC(${opts.precision})`;
        }
    }
    return { name, type, titanType: 'DECIMAL', modifiers: [] };
}

/**
 * Define a timestamp column.
 * @param {string} name Column name.
 * @param {object} [opts] Options.
 * @param {boolean} [opts.withTimezone] Whether to use timezone (TIMESTAMPTZ).
 * @returns {Column} Column definition.
 */
export function timestamp(name, opts) {
    if (opts && opts.withTimezone) {
        return { name, type: 'TIMESTAMPTZ', titanType: 'TIMESTAMPTZ', modifiers: [] };
    }
    return tomTimestamp(name);
}

/**
 * Define a database index.
 * @param {string} name Index name.
 * @returns {Index} Index definition.
 */
export function index(name) {
    return {
        name,
        isUnique: false,
        on(...columns) {
            this.columns = columns;
            return this;
        }
    };
}

/**
 * Define a unique database index.
 * @param {string} name Index name.
 * @returns {Index} Index definition.
 */
export function uniqueIndex(name) {
    return {
        name,
        isUnique: true,
        on(...columns) {
            this.columns = columns;
            return this;
        }
    };
}

/**
 * Template tag/function for writing raw SQL.
 * @param {TemplateStringsArray|string} strings Raw SQL string or template array.
 * @param {...any} values Template values.
 * @returns {Sql} Raw SQL expression object.
 */
export function sql(strings, ...values) {
    let query = "";
    if (Array.isArray(strings)) {
        for (let i = 0; i < strings.length; i++) {
            query += strings[i];
            if (i < values.length) {
                query += values[i];
            }
        }
    } else {
        query = strings;
    }
    return {
        type: 'sql',
        sql: query,
        toString() { return this.sql; }
    };
}

// Modifiers
Object.prototype.primaryKey = function () { this.modifiers.push('PRIMARY KEY'); return this; };
Object.prototype.notNull = function () { this.modifiers.push('NOT NULL'); return this; };
Object.prototype.unique = function () { this.modifiers.push('UNIQUE'); return this; };
Object.prototype.defaultNow = function () { this.modifiers.push('DEFAULT NOW()'); return this; };

// Modify column prototype for references (avoid pushing fkey inline)
Object.prototype.references = function (column, opts = {}) {
    this.reference = { column, opts };
    return this;
};

// Modify column prototypes to inject missing modifiers
if (!Object.prototype.default) {
    Object.prototype.default = function (val) {
        let sqlVal = val;
        if (val && val.type === 'sql') {
            sqlVal = val.sql;
        } else if (typeof val === 'string') {
            if (this.isEnum) {
                sqlVal = `'${val}'::"${this.enumName}"`;
            } else {
                sqlVal = `'${val.replace(/'/g, "''")}'`;
            }
        }
        this.modifiers.push(`DEFAULT ${sqlVal}`);
        return this;
    };
}

if (!Object.prototype.defaultRandom) {
    Object.prototype.defaultRandom = function () {
        this.modifiers.push('DEFAULT gen_random_uuid()');
        return this;
    };
}
