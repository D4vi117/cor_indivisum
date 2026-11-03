"""Render the shared footer against each public page's CSS, without Firebase."""
import re
import mimetypes
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
pages = [p for p in (ROOT/'public').rglob('*.html') if '/src/scripts/site-footer.js' in p.read_text(encoding='utf-8')]
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    def serve(route):
        path = route.request.url.split('footer.test',1)[-1].split('?')[0]
        file = ROOT/'public'/path.lstrip('/')
        if file.is_dir(): file = file/'index.html'
        if not file.is_file(): route.fulfill(status=404,body=''); return
        if file.suffix == '.html':
            html = re.sub(r'<script\b[^>]*>.*?</script>', '', file.read_text(encoding='utf-8'), flags=re.S)
            route.fulfill(body=html,content_type='text/html')
        else: route.fulfill(body=file.read_bytes(),content_type=mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
    page.route('https://footer.test/**',serve)
    for file in pages:
        url='https://footer.test/'+file.relative_to(ROOT/'public').as_posix()
        page.goto(url)
        page.add_script_tag(path=str(ROOT/'public/src/scripts/site-footer.js'))
        page.wait_for_function("[...document.styleSheets].some(s => s.href && s.href.includes('site-footer.css'))")
        footer=page.locator('footer.site-footer')
        assert footer.count()==1
        assert footer.get_by_text('CNPJ: 53.537.087/0001-05',exact=True).count()==1
        assert footer.locator('a[href="https://wa.me/5521969800918"]').count()==1
        assert footer.locator('[data-sf-https]').count()==0
        assert footer.locator('img[alt="Google Safe Browsing"]').count()==1
        assert footer.locator('a[href="#"]').count()==0
        for width in [375,1280]:
            page.set_viewport_size({'width':width,'height':900})
            assert footer.evaluate('(el) => el.scrollWidth <= el.clientWidth'), str(file)
            assert footer.locator('.sf-inner').evaluate('(el) => el.getBoundingClientRect().right <= innerWidth'), str(file)
            if file.relative_to(ROOT/'public').as_posix()=='loja/index.html':
                footer.screenshot(path=str(Path(tempfile.gettempdir())/f'cor-footer-{width}.png'))
    browser.close()
    print(f'PASS: shared footer, contact links, HTTPS indicator and responsive layout across {len(pages)} public pages.')
