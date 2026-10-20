import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
const args = process.argv.slice(2);
const sourceRoot = args.includes('--source-root') ? resolve(args[args.indexOf('--source-root') + 1]) : null;
const work = join(root, '.sources');
const output = join(root, '_site');
const headers = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
async function revision(item) {
    if (sourceRoot) {
        try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(sourceRoot, item.repository.split('/')[1]), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return 'local'; }
    }
    const response = await fetch(`https://api.github.com/repos/${item.repository}/commits/${encodeURIComponent(item.ref)}`, { headers });
    if (!response.ok) throw new Error(`${item.repository}: cannot resolve ${item.ref} (HTTP ${response.status})`);
    return (await response.json()).sha;
}
const all = [catalog.sharedUi, ...catalog.tools];
const revisions = await Promise.all(all.map(revision));
const sources = Object.fromEntries(all.map((item, i) => [item.repository, revisions[i]]));
const info = { publisher: process.env.GITHUB_SHA || 'local', sources };
if (args.includes('--skip-unchanged')) {
    try {
        const response = await fetch(`https://tools.oz-coden.com/build-info.json?t=${Date.now()}`);
        if (response.ok && JSON.stringify(await response.json()) === JSON.stringify(info)) {
            if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, 'changed=false\n', { flag: 'a' });
            console.log('All published source revisions are current.');
            process.exit(0);
        }
    } catch (_) { /* A missing publication is built normally. */ }
}
async function checkout(item, sha) {
    const target = join(sourceRoot || work, item.repository.split('/')[1]);
    if (sourceRoot) return target;
    const response = await fetch(`https://api.github.com/repos/${item.repository}/tarball/${sha}`, { headers });
    if (!response.ok) throw new Error(`${item.repository}: archive HTTP ${response.status}`);
    const archive = join(work, item.repository.split('/')[1] + '.tar.gz');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await mkdir(target, { recursive: true });
    execFileSync('tar', ['-xzf', archive, '-C', target, '--strip-components=1', '--no-same-owner']);
    return target;
}
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const checkouts = await Promise.all(all.map((item, i) => checkout(item, revisions[i])));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const uiDirectory = join(checkouts[0], 'assets');
async function ui(target) {
    await mkdir(join(target, 'vendor', 'ui'), { recursive: true });
    const files = {};
    for (const name of ['ui.css', 'ui.js']) {
        await cp(join(uiDirectory, name), join(target, 'vendor', 'ui', name));
        files[name] = createHash('sha256').update(await readFile(join(uiDirectory, name))).digest('hex');
    }
    await writeFile(join(target, 'shared-ui.json'), JSON.stringify({ repository: catalog.sharedUi.repository, commit: revisions[0], files }, null, 2) + '\n');
}
const excluded = new Set(['node_modules', 'tests', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'CNAME']);
async function copyPublic(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
        if (entry.isDirectory()) await copyPublic(join(from, entry.name), join(to, entry.name));
        else if (entry.isFile() && /\.(?:html|css|js|json|txt|svg|png|jpe?g|webp|ico|woff2?)$/i.test(entry.name)) await cp(join(from, entry.name), join(to, entry.name));
    }
}
for (let i = 0; i < catalog.tools.length; i++) {
    const item = catalog.tools[i];
    if (!/^[a-z0-9-]+$/.test(item.slug)) throw new Error('Invalid tool slug');
    const destination = join(output, item.slug);
    await copyPublic(join(checkouts[i + 1], item.directory), destination);
    await ui(destination);
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const cards = catalog.tools.map(item => `<a class="tool-card ui-panel" href="${item.slug}/"><span class="ui-eyebrow">${escape(item.category)}</span><h2>${escape(item.title)} <span aria-hidden="true">↗</span></h2><p>${escape(item.description)}</p></a>`).join('\n');
await writeFile(join(output, 'index.html'), (await readFile(join(root, 'index.html'), 'utf8')).replace('<!-- TOOL_CARDS -->', cards));
await cp(join(root, 'style.css'), join(output, 'style.css'));
await ui(output);
await writeFile(join(output, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
await writeFile(join(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(join(output, '.nojekyll'), '');
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, 'changed=true\n', { flag: 'a' });
console.log(`Prepared ${catalog.tools.length} static tools in ${output}`);
