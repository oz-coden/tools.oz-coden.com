import { access, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceRoot = args.includes('--source-root') ? resolve(args[args.indexOf('--source-root') + 1]) : join(root, '.sources');
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
let checks = 0;
for (const tool of catalog.tools) {
    const directory = join(sourceRoot, tool.repository.split('/')[1]);
    for (const [file, options] of [['tests/archive.test.cjs', ['--test']], ['tests/converter.test.cjs', ['--test']], ['tests/browser.cjs', []]]) {
        const script = join(directory, file);
        try { await access(script); } catch (_) { continue; }
        console.log(`Checking ${tool.repository}: ${file}`);
        execFileSync(process.execPath, [...options, script], { cwd: directory, stdio: 'inherit' });
        checks++;
    }
}
if (checks === 0) throw new Error('No dedicated source checks found. Assemble the source repositories first.');
console.log(`Completed ${checks} dedicated source suites.`);
