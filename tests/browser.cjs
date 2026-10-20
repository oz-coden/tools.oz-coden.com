const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const catalog = require('../catalog.json');
const root = path.resolve(__dirname, '../_site');
const monacoRoot = path.dirname(require.resolve('monaco-editor/package.json'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (file.endsWith('/')) file += 'index.html';
    file = path.resolve(root, '.' + file);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
    catch (_) { res.writeHead(404).end(); }
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    let count = 0;
    const check = async (name, run) => { await run(); console.log('PASS ' + name); count++; };
    try {
        browser = await chromium.launch(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
        const context = await browser.newContext();
        await context.route('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/**', async route => {
            const suffix = new URL(route.request().url()).pathname.split('/0.45.0/')[1].replace('loader.min.js', 'loader.js');
            const file = path.join(monacoRoot, suffix);
            await route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await check('index links to every catalog application', async () => {
            await page.goto(base);
            assert.equal(await page.locator('.tool-card').count(), catalog.tools.length);
            for (const link of await page.locator('.tool-card').all()) assert.equal((await page.request.get(new URL(await link.getAttribute('href'), base).href)).status(), 200);
        });
        await check('dummy text generation handles presets, repeat mode, Unicode and limits', async () => {
            await page.goto(base + '/dummy-text-generator/');
            assert.equal((await page.locator('#outputText').inputValue()).length, 400);
            await page.locator('#textSource').selectOption('custom');
            await page.locator('#customString').fill('😀a');
            await page.locator('#countValue').fill('3');
            await page.getByRole('button', { name: 'テキストを生成する' }).click();
            assert.equal(await page.locator('#outputText').inputValue(), '😀a😀');
            await page.locator('#generateMode').selectOption('repeat');
            await page.locator('#countValue').fill('2');
            await page.getByRole('button', { name: 'テキストを生成する' }).click();
            assert.equal(await page.locator('#outputText').inputValue(), '😀a😀a');
            await page.locator('#countValue').fill('1000001');
            await page.getByRole('button', { name: 'テキストを生成する' }).click();
            assert.match(await page.locator('#tool-status').innerText(), /100万/);
        });
        await check('JSON renders input as text and produces valid property paths', async () => {
            await page.goto(base + '/json-visualizer/');
            await page.locator('#jsonInput').fill(JSON.stringify({ 'odd.key': '<img src=x onerror="document.body.dataset.xss=1">', '"quoted"': null, list: [true, 12] }));
            await page.getByRole('button', { name: '解析する', exact: true }).click();
            assert.equal(await page.locator('#outputArea img').count(), 0);
            assert.equal(await page.locator('body').getAttribute('data-xss'), null);
            assert.ok((await page.locator('.path').allTextContents()).includes('data["odd.key"]'));
            assert.ok((await page.locator('.path').allTextContents()).includes('data.list[1]'));
            await page.locator('#jsonInput').fill('{ "a": <img src=x onerror=alert(1)> }');
            await page.getByRole('button', { name: '解析する', exact: true }).click();
            assert.match(await page.locator('#json-status').innerText(), /失敗/);
            assert.equal(await page.locator('#json-status img').count(), 0);
            await page.locator('#jsonFile').setInputFiles({ name: 'sample.json', mimeType: 'application/json', buffer: Buffer.from('{"fromFile":7}') });
            await page.getByText('data.fromFile', { exact: true }).waitFor();
        });
        await check('Nexus tolerates damaged storage and builds encoded searches', async () => {
            await page.goto(base + '/nexus-search/');
            await page.evaluate(() => { localStorage.setItem('search_history', '{}'); localStorage.setItem('bookmarks', 'broken'); localStorage.setItem('search_engine_pref', 'untrusted.example/?'); });
            await page.reload();
            await page.evaluate(() => { window.open = (...args) => { window.lastSearch = args; return null; }; });
            await page.locator('#search_key').fill('<img src=x onerror=alert(1)>');
            await page.getByRole('button', { name: '検索', exact: true }).click();
            const opened = await page.evaluate(() => window.lastSearch);
            assert.equal(new URL(opened[0]).hostname, 'www.google.com');
            assert.equal(new URL(opened[0]).searchParams.get('q'), '<img src=x onerror=alert(1)>');
            assert.equal(opened[2], 'noopener,noreferrer');
            assert.equal(await page.locator('#history_dropdown img').count(), 0);
            await page.locator('#adv_all').fill('example');
            await page.locator('#adv_site').fill('ac.jp edu');
            await page.getByRole('button', { name: '詳細検索を実行' }).click();
            assert.match(new URL((await page.evaluate(() => window.lastSearch))[0]).searchParams.get('q'), /\(site:ac.jp OR site:edu\)/);
        });
        await check('Nexus bookmarks escape titles, restrict URL protocols and persist', async () => {
            await page.getByRole('button', { name: '＋ 追加' }).click();
            await page.locator('#modal_title').fill('<img src=x onerror=alert(1)>');
            await page.locator('#modal_url').fill('javascript:alert(1)');
            await page.getByRole('button', { name: '保存', exact: true }).click();
            assert.equal(await page.locator('#bookmark_modal').evaluate(dialog => dialog.open), true);
            await page.locator('#modal_url').fill('example.com');
            await page.getByRole('button', { name: '保存', exact: true }).click();
            assert.equal(await page.locator('.bookmark-card img').count(), 0);
            assert.equal(await page.locator('.bookmark-card a').getAttribute('href'), 'https://example.com/');
            await page.reload();
            assert.equal(await page.locator('.bookmark-card').count(), 1);
            await page.locator('.bookmark-card button').click();
            await page.getByRole('button', { name: '削除する', exact: true }).click();
            assert.equal(await page.locator('.bookmark-card').count(), 0);
        });
        await check('regular expression worker generates matching results and rejects invalid or excessive patterns', async () => {
            await page.goto(base + '/random-re-visualizer/');
            await page.waitForFunction(() => document.getElementById('output-area').textContent.startsWith('候補 1:'));
            const lines = (await page.locator('#output-area').innerText()).split('\n');
            assert.equal(lines.length, 5);
            for (const line of lines) assert.match(line.replace(/^候補 \d: /, ''), /^[a-zA-Z0-9]{5,10}$/);
            for (const pattern of ['(', 'a{1000000000}', '(?!)']) {
                await page.locator('#regex-pattern').fill(pattern);
                await page.getByRole('button', { name: '一致する候補を生成する' }).click();
                await page.waitForFunction(() => document.getElementById('output-area').textContent.startsWith('エラー:'));
            }
        });
        await check('text analysis counts Unicode and clears with Escape', async () => {
            await page.goto(base + '/text-analyzer/');
            await page.locator('#text-input').fill('😀a\n日本');
            assert.equal(await page.locator('#count-chars-all').innerText(), '4');
            assert.equal(await page.locator('#count-lines').innerText(), '2');
            await page.locator('#text-input').press('Escape');
            assert.equal(await page.locator('#count-chars-all').innerText(), '0');
        });
        await check('QR generator renders locally, saves PNG and invalidates edited output', async () => {
            await page.goto(base + '/2d-code-generator/');
            await page.locator('#qr-input').fill('https://example.com/ 日本語');
            await page.getByRole('button', { name: 'QRコードを生成', exact: true }).click();
            assert.equal(await page.getByRole('img', { name: '生成したQRコード' }).count(), 1);
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: 'PNGを保存' }).click();
            assert.equal((await downloadPromise).suggestedFilename(), 'qrcode.png');
            await page.locator('#qr-input').fill('changed');
            assert.equal(await page.locator('#save-png').isDisabled(), true);
        });
        await check('Web IDE runs Monaco, scripts and styles inside the sandbox', async () => {
            await page.goto(base + '/webpage-ide/');
            await page.waitForFunction(() => typeof editor !== 'undefined' && editor);
            await page.frameLocator('#preview').getByRole('heading', { name: 'h1要素' }).waitFor();
            assert.equal(await page.locator('#preview').getAttribute('sandbox'), 'allow-scripts allow-forms allow-modals');
            await page.getByRole('button', { name: 'style.css', exact: true }).click();
            await page.evaluate(() => models.css.setValue('body { background: rgb(12, 34, 56); }'));
            await page.waitForTimeout(350);
            const frame = page.frames().find(value => value.parentFrame() === page.mainFrame());
            assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(12, 34, 56)');
        });
        await check('shared themes persist across tools and every page fits desktop and mobile', async () => {
            await page.goto(base);
            await page.getByRole('button', { name: 'ダークテーマに切り替え' }).click();
            const routes = ['', ...catalog.tools.map(tool => tool.slug + '/')];
            for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                for (const route of routes) {
                    await page.goto(base + '/' + route);
                    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
                    assert.equal(await page.locator('.ui-header').count(), 1);
                    assert.equal(await page.getByRole('navigation', { name: '共通ナビゲーション' }).count(), 1);
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, route + ' overflow at ' + width);
                }
            }
            await page.goto(base);
            await page.getByRole('button', { name: 'ライトテーマに切り替え' }).click();
            await mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
            await page.screenshot({ path: path.resolve(__dirname, '../test-results/index-mobile.png'), fullPage: true });
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(base + '/json-visualizer/');
            await page.screenshot({ path: path.resolve(__dirname, '../test-results/json-desktop.png'), fullPage: true });
        });
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`${count} integration checks passed`);
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
