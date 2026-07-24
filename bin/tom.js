#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execSync } from 'child_process';
import readline from 'node:readline/promises';
import { QueryCompiler } from '../src/compiler/query_compiler.js';

async function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = await rl.question(question);
    rl.close();
    return answer;
}


const CWD = process.cwd();
const TANFIG_PATH = path.join(CWD, 'tanfig.json');
const CONFIG_PATH = path.join(CWD, 'tom.config.js');
const CONFIG_JSON_PATH = path.join(CWD, 'tom.config.json');

async function getConfig() {
    const defaultConfig = {
        schema: 'app/db/schema',
        queries: 'app/db/queries',
        migrations: '.titan/migrations'
    };
    try {
        const content = await fs.readFile(CONFIG_JSON_PATH, 'utf-8');
        return { ...defaultConfig, ...JSON.parse(content) };
    } catch (e) {
        return defaultConfig;
    }
}

// ▽ tom - Colors
const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    magenta: "\x1b[35m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m"
};

const icon = `${colors.magenta}▽${colors.reset}`;
const tomTag = `${colors.magenta}${colors.bold}tom:${colors.reset}`;

const help = `
${colors.magenta}${colors.bold}▽ tom — TitanPL ORM CLI ${colors.reset}

Usage:
  tom generate    Scan schema and queries (from tom.config.json) to generate migrations.
  tom push        Apply all pending migrations in migrations folder to the database.
  tom migrate     Alias for push.
  tom all         Run generate followed by push.
  tom rebase      Clear .titan directory (snapshots/migrations) to start fresh.

Options:
  --help          Show this help message.

Configuration:
  Create a 'tom.config.json' in your project root to customize paths:
  {
    "schema": "app/db/schema",
    "queries": "app/db/queries",
    "migrations": ".titan/migrations"
  }
`;

/**
 * Robust Database URI Resolver
 */
async function getDbURI() {
    // 1. Intelligent discovery from app/db/db.js
    const dbPath = path.join(CWD, 'app', 'db', 'db.js');
    try {
        const dbContent = await fs.readFile(dbPath, 'utf-8');
        // Regex to find env.VARIABLE in db.connect or similar
        const envMatch = dbContent.match(/env\.(\w+)/);
        if (envMatch) {
            const varName = envMatch[1];
            // Read .env to get the actual value
            const envPath = path.join(CWD, '.env');
            const envContent = await fs.readFile(envPath, 'utf-8');
            // More flexible regex for .env: handles spaces around = and quotes
            const valMatch = envContent.match(new RegExp(`^\\s*${varName}\\s*=\\s*["']?(.+?)["']?\\s*$`, 'm'));
            if (valMatch) {
                console.log(`${icon} ${tomTag} Discovered ${colors.cyan}${varName}${colors.reset} from app/db/db.js`);
                return valMatch[1].trim();
            }
        }
    } catch (e) {}


    // 2. Try tom.config.js (Mocking Titan native for Node)
    try {
        const stats = await fs.stat(CONFIG_PATH);
        if (stats.isFile()) {
            // We use a regex fallback for config if it imports native (which fails in node)
            const configText = await fs.readFile(CONFIG_PATH, 'utf-8');
            const uriMatch = configText.match(/url:\s*["']?(.+?)["']?/); // Simple case
            if (uriMatch && uriMatch[1].startsWith('postgres')) return uriMatch[1];
            
            // If it uses env.VAR, try to resolve it
            const envVarMatch = configText.match(/url:\s*env\.(\w+)/);
            if (envVarMatch) {
                const varName = envVarMatch[1];
                const envContent = await fs.readFile(path.join(CWD, '.env'), 'utf-8');
                const valMatch = envContent.match(new RegExp(`${varName}=["']?(.+?)["']?(\\s|$)`, 'm'));
                if (valMatch) return valMatch[1];
            }
        }
    } catch (e) {}

    return null;
}

function getForeignKeyName(table, col, refTable, refCol) {
    const name = `${table}_${col}_${refTable}_${refCol}_fkey`;
    if (name.length <= 60) return name;
    let hash = 0;
    const str = `${table}_${col}_${refTable}_${refCol}`;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    const hashStr = Math.abs(hash).toString(36).substring(0, 12);
    return `${table}_${hashStr}_fkey`;
}

async function generate() {
    const config = await getConfig();
    console.log(`${icon} ${tomTag} Generating schema and queries...`);

    // 1. Scan schema for tables and enums
    const schemaDir = path.join(CWD, config.schema);

    const tables = [];
    const enums = [];
    const files = (await fs.readdir(schemaDir)).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const module = await import(pathToFileURL(path.join(schemaDir, file)));
            Object.values(module).forEach(val => {
                if (val && val.type === 'table') {
                    console.log(`  - Found table: ${colors.cyan}${val.name}${colors.reset}`);
                    tables.push(val);
                } else if (val && val.isEnumDefinition) {
                    console.log(`  - Found enum: ${colors.cyan}${val.enumName}${colors.reset}`);
                    enums.push(val);
                }
            });
        } catch (e) {
            console.error(`${icon} ${colors.red}Error loading schema ${file}:${colors.reset}`, e.message);
        }
    }

    // 2. Load Previous Snapshot for Diffing
    const snapshotPath = path.join(CWD, '.titan', 'tom', 'snapshot.json');
    let previousSnapshot = null;
    try {
        previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
        // Handle migration from old array-of-tables format
        if (Array.isArray(previousSnapshot)) {
            previousSnapshot = {
                enums: [],
                tables: previousSnapshot.map(t => ({
                    name: t.name,
                    columns: t.columns.map(c => ({
                        name: c.name,
                        type: c.type,
                        modifiers: c.modifiers || [],
                        reference: null
                    })),
                    indexes: []
                }))
            };
        }
    } catch (e) {
        previousSnapshot = { enums: [], tables: [] };
    }

    const currentSnapshot = {
        enums: enums.map(e => ({
            name: e.enumName,
            values: e.values
        })),
        tables: tables.map(t => ({
            name: t.name,
            columns: Object.values(t.columns).map(c => ({
                name: c.name,
                type: c.type,
                modifiers: (c.modifiers || []).filter(m => !m.startsWith('REFERENCES')),
                reference: c.reference ? {
                    table: c.reference.column.table.name,
                    column: c.reference.column.name,
                    onDelete: c.reference.opts?.onDelete,
                    onUpdate: c.reference.opts?.onUpdate
                } : null
            })),
            indexes: (t.indexes || []).map(idx => ({
                name: idx.name,
                isUnique: idx.isUnique,
                columns: idx.columns.map(c => c.name || c)
            }))
        }))
    };

    // 2.5 Check if migrations are missing
    const migrationsDir = path.join(CWD, config.migrations);
    try {
        await fs.mkdir(migrationsDir, { recursive: true });
        const existingSqlFiles = (await fs.readdir(migrationsDir)).filter(f => f.endsWith('.sql'));
        if (existingSqlFiles.length === 0 && previousSnapshot && previousSnapshot.tables.length > 0) {
            console.log(`${icon} ${tomTag} ${colors.yellow}No migration files found. Clearing snapshot to re-generate initial migration.${colors.reset}`);
            previousSnapshot = { enums: [], tables: [] };
        }
    } catch (e) {}

    // 3. Interactive Risk Assessment
    if (previousSnapshot && previousSnapshot.tables && previousSnapshot.tables.length > 0) {
        for (const prevTable of previousSnapshot.tables) {
            const currentTable = currentSnapshot.tables.find(t => t.name === prevTable.name);
            if (!currentTable) {
                console.warn(`\n${colors.yellow}${colors.bold}⚠️  RISK: Table "${prevTable.name}" is missing from schema.${colors.reset}`);
                const confirm = await ask(`Do you want to drop table "${prevTable.name}"? (This will ${colors.red}DELETE ALL DATA${colors.reset}) [y/N]: `);
                if (confirm.toLowerCase() !== 'y') {
                    console.log(`${colors.red}✖ Generation aborted.${colors.reset}`);
                    return;
                }
            } else {
                for (const prevCol of prevTable.columns) {
                    const currentCol = currentTable.columns.find(c => c.name === prevCol.name);
                    if (!currentCol) {
                        console.warn(`\n${colors.yellow}${colors.bold}⚠️  RISK: Column "${prevCol.name}" in table "${prevTable.name}" is missing.${colors.reset}`);
                        const confirm = await ask(`Did you rename "${prevCol.name}" or should it be ${colors.red}DROPPED${colors.reset}? (Enter "r" for rename, "d" for drop, "c" to cancel) [r/d/C]: `);
                        if (confirm.toLowerCase() === 'c' || !confirm) {
                            console.log(`${colors.red}✖ Generation aborted.${colors.reset}`);
                            return;
                        }
                        if (confirm.toLowerCase() === 'r') {
                            const newName = await ask(`Enter the NEW name for column "${prevCol.name}": `);
                            console.log(`${colors.cyan}ℹ️  Note: Please update your schema file to use "${newName}" if you haven't already.${colors.reset}`);
                        }
                    }
                }
            }
        }
    }

    // 4. Build Migration SQL
    let migrationSql = `-- Generated by tom\n`;
    let hasChanges = false;
    const isInitial = !previousSnapshot || !previousSnapshot.tables || previousSnapshot.tables.length === 0;

    if (isInitial) {
        // Enums
        currentSnapshot.enums.forEach(e => {
            migrationSql += `CREATE TYPE "${e.name}" AS ENUM(${e.values.map(v => `'${v}'`).join(', ')});--> statement-breakpoint\n`;
        });
        if (currentSnapshot.enums.length > 0) migrationSql += '\n';

        // Tables
        currentSnapshot.tables.forEach(table => {
            migrationSql += `CREATE TABLE "${table.name}" (\n`;
            const columns = table.columns.map(col => {
                let colType = col.type;
                if (colType.toUpperCase() === 'TIMESTAMPTZ') {
                    colType = 'timestamp with time zone';
                }
                let line = `\t"${col.name}" ${colType}`;
                if (col.modifiers.length > 0) line += ` ${col.modifiers.join(' ')}`;
                return line;
            });
            migrationSql += columns.join(',\n');
            migrationSql += '\n);\n--> statement-breakpoint\n';
        });

        // Indexes
        currentSnapshot.tables.forEach(table => {
            table.indexes.forEach(idx => {
                const uniqueStr = idx.isUnique ? 'UNIQUE ' : '';
                const colsStr = idx.columns.map(c => `"${c}"`).join(',');
                migrationSql += `CREATE ${uniqueStr}INDEX "${idx.name}" ON "${table.name}" (${colsStr});--> statement-breakpoint\n`;
            });
        });

        // Foreign Key Constraints
        currentSnapshot.tables.forEach(table => {
            table.columns.forEach(col => {
                if (col.reference) {
                    const ref = col.reference;
                    const constraintName = getForeignKeyName(table.name, col.name, ref.table, ref.column);
                    let alterSql = `ALTER TABLE "${table.name}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${col.name}") REFERENCES "${ref.table}"("${ref.column}")`;
                    if (ref.onDelete) {
                        alterSql += ` ON DELETE ${ref.onDelete.toUpperCase()}`;
                    }
                    if (ref.onUpdate) {
                        alterSql += ` ON UPDATE ${ref.onUpdate.toUpperCase()}`;
                    }
                    migrationSql += `${alterSql};--> statement-breakpoint\n`;
                }
            });
        });

        hasChanges = currentSnapshot.tables.length > 0 || currentSnapshot.enums.length > 0;
    } else {
        // Incremental Enums
        currentSnapshot.enums.forEach(e => {
            const prev = previousSnapshot.enums.find(pe => pe.name === e.name);
            if (!prev) {
                migrationSql += `CREATE TYPE "${e.name}" AS ENUM(${e.values.map(v => `'${v}'`).join(', ')});--> statement-breakpoint\n`;
                hasChanges = true;
            }
        });

        // Drop tables (and constraints)
        previousSnapshot.tables.forEach(prevTable => {
            const currentTable = currentSnapshot.tables.find(t => t.name === prevTable.name);
            if (!currentTable) {
                prevTable.columns.forEach(col => {
                    if (col.reference) {
                        const constraintName = getForeignKeyName(prevTable.name, col.name, col.reference.table, col.reference.column);
                        migrationSql += `ALTER TABLE "${prevTable.name}" DROP CONSTRAINT IF EXISTS "${constraintName}";--> statement-breakpoint\n`;
                    }
                });
                migrationSql += `DROP TABLE "${prevTable.name}";--> statement-breakpoint\n`;
                hasChanges = true;
            }
        });

        // Create new tables
        currentSnapshot.tables.forEach(table => {
            const prev = previousSnapshot.tables.find(pt => pt.name === table.name);
            if (!prev) {
                migrationSql += `CREATE TABLE "${table.name}" (\n`;
                const columns = table.columns.map(col => {
                    let colType = col.type;
                    if (colType.toUpperCase() === 'TIMESTAMPTZ') {
                        colType = 'timestamp with time zone';
                    }
                    let line = `\t"${col.name}" ${colType}`;
                    if (col.modifiers.length > 0) line += ` ${col.modifiers.join(' ')}`;
                    return line;
                });
                migrationSql += columns.join(',\n');
                migrationSql += '\n);\n--> statement-breakpoint\n';

                // Indexes
                table.indexes.forEach(idx => {
                    const uniqueStr = idx.isUnique ? 'UNIQUE ' : '';
                    const colsStr = idx.columns.map(c => `"${c}"`).join(',');
                    migrationSql += `CREATE ${uniqueStr}INDEX "${idx.name}" ON "${table.name}" (${colsStr});--> statement-breakpoint\n`;
                });

                // Foreign Keys
                table.columns.forEach(col => {
                    if (col.reference) {
                        const ref = col.reference;
                        const constraintName = getForeignKeyName(table.name, col.name, ref.table, ref.column);
                        let alterSql = `ALTER TABLE "${table.name}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${col.name}") REFERENCES "${ref.table}"("${ref.column}")`;
                        if (ref.onDelete) {
                            alterSql += ` ON DELETE ${ref.onDelete.toUpperCase()}`;
                        }
                        if (ref.onUpdate) {
                            alterSql += ` ON UPDATE ${ref.onUpdate.toUpperCase()}`;
                        }
                        migrationSql += `${alterSql};--> statement-breakpoint\n`;
                    }
                });
                hasChanges = true;
            }
        });

        // Alter existing tables
        currentSnapshot.tables.forEach(currentTable => {
            const prevTable = previousSnapshot.tables.find(t => t.name === currentTable.name);
            if (prevTable) {
                // New or modified columns
                currentTable.columns.forEach(currentCol => {
                    const prevCol = prevTable.columns.find(c => c.name === currentCol.name);
                    if (!prevCol) {
                        let colType = currentCol.type;
                        if (colType.toUpperCase() === 'TIMESTAMPTZ') {
                            colType = 'timestamp with time zone';
                        }
                        let alterSql = `ALTER TABLE "${currentTable.name}" ADD COLUMN "${currentCol.name}" ${colType}`;
                        if (currentCol.modifiers.length > 0) alterSql += ` ${currentCol.modifiers.join(' ')}`;
                        migrationSql += `${alterSql};--> statement-breakpoint\n`;

                        if (currentCol.reference) {
                            const ref = currentCol.reference;
                            const constraintName = getForeignKeyName(currentTable.name, currentCol.name, ref.table, ref.column);
                            let fkSql = `ALTER TABLE "${currentTable.name}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${currentCol.name}") REFERENCES "${ref.table}"("${ref.column}")`;
                            if (ref.onDelete) {
                                fkSql += ` ON DELETE ${ref.onDelete.toUpperCase()}`;
                            }
                            if (ref.onUpdate) {
                                fkSql += ` ON UPDATE ${ref.onUpdate.toUpperCase()}`;
                            }
                            migrationSql += `${fkSql};--> statement-breakpoint\n`;
                        }
                        hasChanges = true;
                    } else {
                        // Check type change
                        if (prevCol.type !== currentCol.type) {
                            let colType = currentCol.type;
                            if (colType.toUpperCase() === 'TIMESTAMPTZ') {
                                colType = 'timestamp with time zone';
                            }
                            migrationSql += `ALTER TABLE "${currentTable.name}" ALTER COLUMN "${currentCol.name}" SET DATA TYPE ${colType} USING "${currentCol.name}"::${colType};--> statement-breakpoint\n`;
                            hasChanges = true;
                        }

                        // Check FK change
                        const prevRef = prevCol.reference;
                        const currentRef = currentCol.reference;
                        const prevRefKey = prevRef ? `${prevRef.table}.${prevRef.column}.${prevRef.onDelete || ''}.${prevRef.onUpdate || ''}` : '';
                        const currentRefKey = currentRef ? `${currentRef.table}.${currentRef.column}.${currentRef.onDelete || ''}.${currentRef.onUpdate || ''}` : '';
                        if (prevRefKey !== currentRefKey) {
                            if (prevRef) {
                                const constraintName = getForeignKeyName(currentTable.name, currentCol.name, prevRef.table, prevRef.column);
                                migrationSql += `ALTER TABLE "${currentTable.name}" DROP CONSTRAINT IF EXISTS "${constraintName}";--> statement-breakpoint\n`;
                            }
                            if (currentRef) {
                                const constraintName = getForeignKeyName(currentTable.name, currentCol.name, currentRef.table, currentRef.column);
                                let fkSql = `ALTER TABLE "${currentTable.name}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${currentCol.name}") REFERENCES "${currentRef.table}"("${currentRef.column}")`;
                                if (currentRef.onDelete) {
                                    fkSql += ` ON DELETE ${currentRef.onDelete.toUpperCase()}`;
                                }
                                if (currentRef.onUpdate) {
                                    fkSql += ` ON UPDATE ${currentRef.onUpdate.toUpperCase()}`;
                                }
                                migrationSql += `${fkSql};--> statement-breakpoint\n`;
                            }
                            hasChanges = true;
                        }
                    }
                });

                // Dropped columns
                prevTable.columns.forEach(prevCol => {
                    const currentCol = currentTable.columns.find(c => c.name === prevCol.name);
                    if (!currentCol) {
                        if (prevCol.reference) {
                            const constraintName = getForeignKeyName(currentTable.name, prevCol.name, prevCol.reference.table, prevCol.reference.column);
                            migrationSql += `ALTER TABLE "${currentTable.name}" DROP CONSTRAINT IF EXISTS "${constraintName}";--> statement-breakpoint\n`;
                        }
                        migrationSql += `ALTER TABLE "${currentTable.name}" DROP COLUMN "${prevCol.name}";--> statement-breakpoint\n`;
                        hasChanges = true;
                    }
                });

                // Dropped indexes
                prevTable.indexes = prevTable.indexes || [];
                prevTable.indexes.forEach(prevIdx => {
                    const currentIdx = currentTable.indexes.find(idx => idx.name === prevIdx.name);
                    if (!currentIdx) {
                        migrationSql += `DROP INDEX IF EXISTS "${prevIdx.name}";--> statement-breakpoint\n`;
                        hasChanges = true;
                    }
                });

                // New indexes
                currentTable.indexes.forEach(currentIdx => {
                    const prevIdx = prevTable.indexes.find(idx => idx.name === currentIdx.name);
                    if (!prevIdx) {
                        const uniqueStr = currentIdx.isUnique ? 'UNIQUE ' : '';
                        const colsStr = currentIdx.columns.map(c => `"${c}"`).join(',');
                        migrationSql += `CREATE ${uniqueStr}INDEX "${currentIdx.name}" ON "${currentTable.name}" (${colsStr});--> statement-breakpoint\n`;
                        hasChanges = true;
                    }
                });
            }
        });
    }

    if (!hasChanges) {
        console.log(`${icon} ${tomTag} No schema changes detected.`);
    } else {
        await fs.mkdir(migrationsDir, { recursive: true });

        const existingFiles = (await fs.readdir(migrationsDir)).filter(f => f.endsWith('.sql'));
        let maxIndex = -1;
        existingFiles.forEach(f => {
            const idx = parseInt(f.split('_')[0]);
            if (!isNaN(idx) && idx > maxIndex) maxIndex = idx;
        });
        const nextIndex = maxIndex + 1;
        const fileName = `${String(nextIndex).padStart(3, '0')}_${isInitial ? 'initial' : 'update'}.sql`;

        await fs.writeFile(path.join(migrationsDir, fileName), migrationSql);
        console.log(`${colors.green}✓ Migration generated:${colors.reset} ${config.migrations}/${fileName}`);
    }

    // Save snapshot
    const outputDir = path.join(CWD, '.titan', 'tom');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(currentSnapshot, null, 2));

    // 3. Compile Queries
    const queriesDir = path.join(CWD, config.queries);
    const compiler = new QueryCompiler();

    let compiledJS = 'import { db, types, drift } from "@titanpl/native";\n\n';
    let queryCount = 0;

    try {
        await fs.access(queriesDir);
        const files = (await fs.readdir(queriesDir)).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const module = await import(pathToFileURL(path.join(queriesDir, file)));
            for (let [name, ast] of Object.entries(module)) {
                // Support both direct executors and factory functions
                if (typeof ast === 'function') {
                    if (ast.isTomQuery) {
                        // It's a direct executor, its properties are the AST
                    } else {
                        // It might be a factory function like () => select(...).toAST()
                        try { 
                            const result = ast(); 
                            if (result && (result.type || result.isTomQuery)) ast = result;
                        } catch (e) {}
                    }
                }

                if (ast && (ast.type === 'select' || ast.type === 'insert' || ast.type === 'update' || ast.type === 'delete' || ast.isTomQuery)) {
                    const compiled = compiler.compile(ast.ast || ast); // Use raw AST if available
                    compiledJS += compiler.generateWrapper(name, compiled);
                    queryCount++;
                }
            }
        }
    } catch (e) {
        console.error(`${icon} ${colors.red}Error reading queries:${colors.reset}`, e.message);
    }


    const ormDir = path.join(CWD, '.titan', 'tom');
    await fs.mkdir(ormDir, { recursive: true });
    await fs.writeFile(path.join(ormDir, 'queries.js'), compiledJS);
    console.log(`${colors.green}✓ Compiled ${queryCount} queries:${colors.reset} .titan/tom/queries.js`);


}

async function push() {
    await generate();
    const config = await getConfig();
    console.log(`${icon} ${tomTag} Pushing schema to database...`);

    
    const dbURI = await getDbURI();
    if (!dbURI) {
        console.error(`${colors.red}Error: DATABASE_URL not found in tom.config.js, tanfig.json, or .env${colors.reset}`);
        return;
    }

    // Resolve native migration tool
    const __dirname = path.dirname(import.meta.url.replace('file:///', ''));
    const binPath = path.join(__dirname, '../bin/tom-migrate.exe');

    try {
        console.log(`${icon} ${tomTag} Using migration tool: ${colors.cyan}${binPath}${colors.reset}`);
        execSync(`"${binPath}"`, { 
            stdio: 'inherit',
            env: { ...process.env, DB_URI: dbURI, MIGRATIONS_DIR: config.migrations } 
        });
        console.log(`${colors.green}✓ tom: Push complete!${colors.reset}`);
    } catch (err) {
        console.error(`${icon} ${colors.red}tom: Migration failed.${colors.reset}`);
    }
}

async function rebase() {
    console.log(`\n${icon} ${tomTag} ${colors.yellow}${colors.bold}Rebasing Tom...${colors.reset}`);
    console.log(`This will delete all snapshots and migrations in ${colors.cyan}.titan/${colors.reset}`);
    const confirm = await ask(`Are you sure you want to proceed? (This cannot be undone) [y/N]: `);
    
    if (confirm.toLowerCase() === 'y') {
        const titanDir = path.join(CWD, '.titan');
        try {
            await fs.rm(titanDir, { recursive: true, force: true });
            console.log(`${colors.green}✓ .titan folder cleared.${colors.reset}`);
            console.log(`${icon} ${tomTag} You can now run ${colors.cyan}tom generate${colors.reset} to create a clean initial snapshot.`);
        } catch (e) {
            console.error(`${colors.red}Error clearing .titan:${colors.reset}`, e.message);
        }
    } else {
        console.log(`${colors.yellow}Rebase cancelled.${colors.reset}`);
    }
}

async function main() {
    const command = process.argv[2];

    if (!command || command === '--help') {
        console.log(help);
        return;
    }

    switch (command) {
        case 'generate':
            await generate();
            break;
        case 'push':
        case 'migrate':
            await push();
            break;
        case 'all':
            await generate();
            await push();
            break;
        case 'rebase':
            await rebase();
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.log(help);
            process.exit(1);
    }
}

main().catch(err => {
    console.error('⏣ tom CLI Error:', err);
    process.exit(1);
});
