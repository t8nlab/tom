/**
 * tom Query Compiler
 * AST -> SQL string + JS Function with Native Titan Binding
 */

export class QueryCompiler {
    constructor() {
        this.paramCount = 0;
        this.params = []; // { name, titanType }
    }

    compile(ast) {
        this.paramCount = 0;
        this.params = [];
        
        switch (ast.type) {
            case 'select': return this.compileSelect(ast);
            case 'insert': return this.compileInsert(ast);
            case 'update': return this.compileUpdate(ast);
            case 'delete': return this.compileDelete(ast);
            default: throw new Error(`Unsupported AST type: ${ast.type}`);
        }
    }

    compileSelect(ast) {
        let sql = "SELECT ";
        const tableName = ast.table.name;
        
        if (ast.columns && ast.columns.length > 0) {
            sql += ast.columns.join(", ");
        } else {
            sql += "*";
        }
        
        sql += ` FROM ${tableName}`;
        if (ast.where) sql += " WHERE " + this.compileCondition(ast.where);
        if (ast.limit) sql += ` LIMIT ${ast.limit}`;
        
        return { sql, params: this.params };
    }

    compileInsert(ast) {
        const tableName = ast.table.name;
        const keys = Object.keys(ast.values);
        const colNames = keys.map(key => ast.table.columns[key]?.name || key);
        
        const valuesSql = keys.map(key => {
            const col = ast.table.columns[key];
            return this.getValue(ast.values[key], col?.titanType);
        }).join(", ");

        let sql = `INSERT INTO ${tableName} (${colNames.join(", ")}) VALUES (${valuesSql})`;
        
        if (ast.returning && ast.returning.length > 0) {
            sql += ` RETURNING ${ast.returning.join(", ")}`;
        }

        return { sql, params: this.params };
    }

    compileUpdate(ast) {
        const tableName = ast.table.name;
        const sets = Object.keys(ast.set).map(key => {
            const col = ast.table.columns[key];
            const colName = col?.name || key;
            const valSql = this.getValue(ast.set[key], col?.titanType);
            return `${colName} = ${valSql}`;
        }).join(", ");

        let sql = `UPDATE ${tableName} SET ${sets}`;
        if (ast.where) sql += " WHERE " + this.compileCondition(ast.where);

        return { sql, params: this.params };
    }

    compileDelete(ast) {
        const tableName = ast.table.name;
        let sql = `DELETE FROM ${tableName}`;
        if (ast.where) sql += " WHERE " + this.compileCondition(ast.where);

        return { sql, params: this.params };
    }

    compileCondition(cond) {
        if (!cond) return "";

        if (cond.type === 'eq') {
            const left = cond.left;
            const right = cond.right;
            const leftSql = left.name || left;
            const rightSql = this.getValue(right, left.titanType);
            return `${leftSql} = ${rightSql}`;
        }

        if (cond.type === 'and') {
            return `(${cond.conditions.map(c => this.compileCondition(c)).join(" AND ")})`;
        }

        if (cond.type === 'or') {
            return `(${cond.conditions.map(c => this.compileCondition(c)).join(" OR ")})`;
        }

        return "";
    }

    getValue(val, expectedTitanType) {
        if (val && val.type === 'param') {
            this.paramCount++;
            const titanType = val.typeOverride || expectedTitanType || 'STRING';
            this.params.push({ name: val.name, titanType });
            return `$${this.paramCount}`;
        }
        return val;
    }

    generateWrapper(name, compiled) {
        const paramList = compiled.params.map(p => p.name).join(", ");
        const args = compiled.params.length > 0 ? `{ ${paramList} }` : "{}";
        const valuesArray = compiled.params.map(p => `types.${p.titanType}(${p.name})`).join(", ");

        return `
/**
 * tom Compiled Query: ${name}
 * Accepts a connection (conn) created via db.connect()
 */
export function ${name}(conn, ${args}) {
  const sql = \`${compiled.sql}\`;
  const params = [${valuesArray}];
  return drift(conn.query(sql, params));
}
`;
    }
}
