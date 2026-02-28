/**
 * Migration Generator Wrapper
 *
 * This script addresses a known TypeORM limitation where migration generation
 * produces DROP COLUMN + ADD COLUMN operations instead of MODIFY COLUMN for
 * column type/length changes, which can result in data loss.
 *
 * Related Issues & PRs:
 * - https://github.com/typeorm/typeorm/issues/3357 (Main issue, open since 2019)
 * - https://github.com/typeorm/typeorm/pull/11922 (Postgres fix attempt)
 * - https://github.com/typeorm/typeorm/pull/11966 (Multi-driver fix attempt)
 * - https://github.com/typeorm/typeorm/pull/11974 (Postgres length changes fix)
 * - https://github.com/typeorm/typeorm/pull/11997 (ALTER COLUMN fix)
 * - https://github.com/typeorm/typeorm/pull/12032 (Comprehensive fix for 5 drivers)
 *
 * This wrapper automatically corrects generated migrations by replacing
 * destructive DROP+ADD patterns with safe MODIFY COLUMN operations when
 * applicable (same table and column name).
 *
 * Note: This issue affects both MySQL and PostgreSQL, despite common misconceptions.
 * The problem is in TypeORM's column diff logic, not database-specific behavior.
 *
 * @see https://github.com/typeorm/typeorm/issues/3357
 */

const { execSync } = require('child_process');
const path = require('path');

const migrationName = process.argv[2];

if (!migrationName || migrationName.trim() === '') {
  process.exit(1);
}

const basePath = path.join('src', 'migrations');
const migrationPath = path.join(basePath, migrationName).replace(/\\/g, '/');
const dataSourcePath = path.join('src', 'data-source.ts').replace(/\\/g, '/');

try {
  const output = execSync(
    `typeorm-ts-node-commonjs migration:generate ${migrationPath} -d ${dataSourcePath}`,
    { encoding: 'utf-8', shell: true },
  );

  if (output.includes('No changes in database schema were found')) {
    process.exit(0);
  }

  // Automatically corrects DROP + ADD to MODIFY COLUMN
  try {
    const fs = require('fs');
    const migrationFiles = fs
      .readdirSync(basePath)
      .filter((file) => file.includes(migrationName) && file.endsWith('.ts'))
      .map((file) => path.join(basePath, file));

    for (const filePath of migrationFiles) {
      let content = fs.readFileSync(filePath, 'utf-8');
      const originalContent = content;

      // Pattern: DROP COLUMN followed by ADD COLUMN (same column, same table)
      // Captures lines with escaped backticks: \`posts\`
      const dropAddPattern =
        /await queryRunner\.query\(`ALTER TABLE \\`([^\\`]+)\\` DROP COLUMN \\`([^\\`]+)\\``\);\s*await queryRunner\.query\(`ALTER TABLE \\`([^\\`]+)\\` ADD \\`([^\\`]+)\\`\s+([^`]+)`\);/g;

      content = content.replace(
        dropAddPattern,
        (match, table1, col1, table2, col2, colDef) => {
          // Verifies if it's the same table and same column
          if (table1 === table2 && col1 === col2) {
            return `        await queryRunner.query(\`ALTER TABLE \\\`${table1}\\\` MODIFY COLUMN \\\`${col1}\\\` ${colDef}\`);`;
          }
          return match;
        },
      );

      if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf-8');
      }
    }
  } catch (fixError) {}

  process.exit(0);
} catch (error) {
  const errorMessage = error?.stdout || error?.stderr || error?.message || '';

  if (errorMessage.includes('No changes in database schema were found')) {
    process.exit(0);
  }

  process.exit(1);
}
