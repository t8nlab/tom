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
            params: []
        };
    }

    columns(cols) { this.state.columns = cols; return this; }
    where(condition) { this.state.where = condition; return this; }
    limit(n) { this.state.limit = n; return this; }
    values(vals) { this.state.values = vals; return this; }
    set(vals) { this.state.set = vals; return this; }
    returning(cols) { this.state.returning = cols; return this; }


    toAST() {
        const ast = { ...this.state };
        
        // The Executor: This function is what the developer actually calls in their actions
        const executor = (conn, params = {}) => {
            // We use the global 't' object which is always available in Titan
            // This keeps the library Node-compatible for the CLI while being native in Titan
            const drift = globalThis.drift || (globalThis.t && t.drift);
            const types = globalThis.types || (globalThis.t && t.types);
            
            if (!drift || !types) {
                throw new Error("tom ORM: Titan Native APIs (drift/types) not found. Are you running in Titan?");
            }

            let sql = "";
            let bindValues = [];
            let pCount = 1;

            if (ast.type === 'select') {
                sql = `SELECT ${ast.columns.join(', ')} FROM ${ast.table.name}`;
                if (ast.where) {
                    const left = ast.where.left.name;
                    const right = ast.where.right;
                    if (right.type === 'param') {
                        sql += ` WHERE ${left} = $${pCount++}`;
                        const tType = right.typeOverride || ast.where.left.titanType || 'STRING';
                        bindValues.push(types[tType](params[right.name]));
                    }
                }
                if (ast.limit) sql += ` LIMIT ${ast.limit}`;
            }

            return drift(conn.query(sql, bindValues));
        };

        Object.assign(executor, ast);
        executor.isTomQuery = true;
        executor.ast = ast;

        return executor;
    }
}

export function pgTable(name, columns) {
    const table = { type: 'table', name, columns };
    Object.entries(columns).forEach(([prop, col]) => {
        col.propertyName = prop;
        col.table = table;
        if (!['name', 'type', 'columns'].includes(prop)) {
            table[prop] = col;
        }
    });

    return table;
}

export function select(table) { return new QueryBuilder(table, 'select'); }
export function insert(table) { return new QueryBuilder(table, 'insert'); }
export function update(table) { return new QueryBuilder(table, 'update'); }
export function deleteFrom(table) { return new QueryBuilder(table, 'delete'); }
export { deleteFrom as delete };


export function eq(left, right) { return { type: 'eq', left, right }; }
export function param(name, typeOverride = null) { return { type: 'param', name, typeOverride }; }

// Data Types
export const uuid = (name) => ({ name, type: 'UUID', titanType: 'UUID', modifiers: [] });
export const varchar = (name, { length } = {}) => ({ name, type: `VARCHAR(${length || 255})`, titanType: 'VARCHAR', modifiers: [] });
export const text = (name) => ({ name, type: 'TEXT', titanType: 'TEXT', modifiers: [] });
export const timestamp = (name) => ({ name, type: 'TIMESTAMP', titanType: 'TIMESTAMP', modifiers: [] });
export const bigint = (name) => ({ name, type: 'BIGINT', titanType: 'BIGINT', modifiers: [] });
export const boolean = (name) => ({ name, type: 'BOOLEAN', titanType: 'BOOLEAN', modifiers: [] });
export const integer = (name) => ({ name, type: 'INT', titanType: 'INT', modifiers: [] });

// Modifiers
Object.prototype.primaryKey = function() { this.modifiers.push('PRIMARY KEY'); return this; };
Object.prototype.notNull = function() { this.modifiers.push('NOT NULL'); return this; };
Object.prototype.unique = function() { this.modifiers.push('UNIQUE'); return this; };
Object.prototype.defaultNow = function() { this.modifiers.push('DEFAULT NOW()'); return this; };
Object.prototype.references = function(column) {
    // column is expected to be an object like { name, table: { name } }
    this.modifiers.push(`REFERENCES ${column.table.name}(${column.name})`);
    return this;
};

