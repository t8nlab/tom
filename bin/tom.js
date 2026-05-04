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

async function generate() {
    const config = await getConfig();
    console.log(`${icon} ${tomTag} Generating schema and queries...`);

    // 1. Scan schema for tables
    const schemaDir = path.join(CWD, config.schema);

    const tables = [];
    const files = (await fs.readdir(schemaDir)).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const module = await import(pathToFileURL(path.join(schemaDir, file)));
            Object.values(module).forEach(val => {
                if (val && val.type === 'table') {
                    console.log(`  - Found table: ${colors.cyan}${val.name}${colors.reset}`);
                    tables.push(val);
                }
            });
        } catch (e) {
            console.error(`${icon} ${colors.red}Error loading schema ${file}:${colors.reset}`, e.message);
        }
    }



    // 2. Load Previous Snapshot for Diffing
    const snapshotPath = path.join(CWD, '.titan', 'orm', 'snapshot.json');
    let previousSnapshot = null;
    try {
        previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    } catch (e) {}

    const currentSnapshot = tables.map(t => ({
        name: t.name,
        columns: Object.values(t.columns).map(c => ({
            name: c.name,
            type: c.type,
            modifiers: c.modifiers
        }))
    }));

    // 2.5 Check if migrations are missing
    const migrationsDir = path.join(CWD, config.migrations);
    try {
        await fs.mkdir(migrationsDir, { recursive: true });
        const existingSqlFiles = (await fs.readdir(migrationsDir)).filter(f => f.endsWith('.sql'));
        if (existingSqlFiles.length === 0 && previousSnapshot) {
            console.log(`${icon} ${tomTag} ${colors.yellow}No migration files found. Clearing snapshot to re-generate initial migration.${colors.reset}`);
            previousSnapshot = null;
        }
    } catch (e) {}

    // 3. Interactive Risk Assessment
    if (previousSnapshot) {
        for (const prevTable of previousSnapshot) {
            const currentTable = currentSnapshot.find(t => t.name === prevTable.name);
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

    if (!previousSnapshot) {
        // Initial migration
        tables.forEach(table => {
            migrationSql += `CREATE TABLE IF NOT EXISTS ${table.name} (\n`;
            const columns = Object.values(table.columns).map(col => {
                let line = `  ${col.name} ${col.type}`;
                if (col.modifiers.length > 0) line += ` ${col.modifiers.join(' ')}`;
                return line;
            });
            migrationSql += columns.join(',\n');
            migrationSql += '\n);\n\n';
        });

        hasChanges = true;
    } else {
        // Incremental migration (ALTER TABLE)
        for (const currentTable of currentSnapshot) {
            const prevTable = previousSnapshot.find(t => t.name === currentTable.name);
            if (!prevTable) {
                // New Table
                const tableObj = tables.find(t => t.name === currentTable.name);
                migrationSql += `CREATE TABLE ${currentTable.name} (\n`;
                const columns = Object.values(tableObj.columns).map(col => {
                    let line = `  ${col.name} ${col.type}`;
                    if (col.modifiers.length > 0) line += ` ${col.modifiers.join(' ')}`;
                    return line;
                });
                migrationSql += columns.join(',\n');
                migrationSql += '\n);\n\n';
                hasChanges = true;
            } else {
                // Existing Table: Check for new columns
                for (const currentCol of currentTable.columns) {
                    const prevCol = prevTable.columns.find(c => c.name === currentCol.name);
                    if (!prevCol) {
                        migrationSql += `ALTER TABLE ${currentTable.name} ADD COLUMN IF NOT EXISTS ${currentCol.name} ${currentCol.type}`;
                        if (currentCol.modifiers.length > 0) migrationSql += ` ${currentCol.modifiers.join(' ')}`;
                        migrationSql += ';\n';
                        hasChanges = true;
                    }
                }
                // Check for dropped columns
                for (const prevCol of prevTable.columns) {
                    const currentCol = currentTable.columns.find(c => c.name === prevCol.name);
                    if (!currentCol) {
                        // User already confirmed in Risk Assessment step
                        migrationSql += `ALTER TABLE ${currentTable.name} DROP COLUMN IF EXISTS ${prevCol.name};\n`;
                        hasChanges = true;
                    }
                }
            }
        }
        
        // Check for dropped tables
        for (const prevTable of previousSnapshot) {
            const currentTable = currentSnapshot.find(t => t.name === prevTable.name);
            if (!currentTable) {
                migrationSql += `DROP TABLE IF EXISTS ${prevTable.name};\n`;
                hasChanges = true;
            }
        }

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
        const fileName = `${String(nextIndex).padStart(3, '0')}_${previousSnapshot ? 'update' : 'initial'}.sql`;

        
        await fs.writeFile(path.join(migrationsDir, fileName), migrationSql);
        console.log(`${colors.green}✓ Migration generated:${colors.reset} ${config.migrations}/${fileName}`);
    }

    // Save snapshot
    const outputDir = path.join(CWD, '.titan', 'orm');
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


    const ormDir = path.join(CWD, '.titan', 'orm');
    await fs.mkdir(ormDir, { recursive: true });
    await fs.writeFile(path.join(ormDir, 'queries.js'), compiledJS);
    console.log(`${colors.green}✓ Compiled ${queryCount} queries:${colors.reset} .titan/orm/queries.js`);


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
