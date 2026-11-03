"""Public purchase flow with mocked Firebase, no external writes or payments."""
import re
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    course = {'nome':'Curso de teste', 'slug':'Curso-de-teste', 'preco':89.9, 'status':'publicado'}
    def route_handler(route):
        path = route.request.url.replace('http://courses.test', '').split('?')[0]
        if path in ['/cursos/Curso-de-teste', '/loja/checkout/']:
            file = 'public/cursos/index.html' if path.startswith('/cursos') else 'public/loja/checkout/index.html'
            html = re.sub(r'<script\b[^>]*>.*?</script>', '', (ROOT / file).read_text(encoding='utf-8'), flags=re.S)
            route.fulfill(body=html, content_type='text/html')
        else:
            file = ROOT / 'public' / path.lstrip('/')
            if file.is_file():
                route.fulfill(body=file.read_bytes(), content_type='text/css' if path.endswith('.css') else 'text/plain')
            else:
                route.fulfill(status=404, body='')
    page.route('http://courses.test/**', route_handler)
    page.goto('http://courses.test/cursos/Curso-de-teste')
    page.wait_for_load_state('networkidle')
    page.evaluate('(course) => { window.db={collection:()=>({where(){return this},get:async()=>({empty:false,docs:[{id:"c1",data:()=>course}]})})}; }', course)
    page.add_script_tag(path=str(ROOT/'public/cursos/cursos.js'))
    page.get_by_role('button', name='Comprar curso').wait_for()
    for width in [375, 1280]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Course page overflow at {width}px'
        page.screenshot(path=str(Path(tempfile.gettempdir()) / f'cor-cursos-{width}.png'), full_page=True)
    page.get_by_role('button', name='Comprar curso').click()
    page.wait_for_url('**/loja/checkout/')
    page.wait_for_load_state('networkidle')
    page.add_script_tag(content="""
      crypto.randomUUID = () => '12345678-1234-4234-8234-123456789abc';
      window.firebase={auth:()=>({onAuthStateChanged:()=>{},currentUser:{uid:'u1'}})};
      window.functions={httpsCallable:()=>async(data)=>{window.submitted=data;throw new Error('TEST_STOP_BEFORE_PAYMENT')}};
    """)
    page.add_script_tag(path=str(ROOT/'public/loja/checkout/checkout.js'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    assert not page.locator('#entrega-checkout').is_visible()
    assert page.locator('#cep').is_disabled()
    assert page.locator('.btn-checkout').is_enabled()
    page.get_by_label('Nome Completo', exact=True).fill('Aluno de teste')
    page.get_by_label('E-mail', exact=True).fill('aluno@example.test')
    page.get_by_label('WhatsApp / Telefone', exact=True).fill('21999999999')
    page.get_by_label('CPF ou CNPJ', exact=True).fill('12345678901')
    page.on('dialog', lambda dialog: dialog.dismiss())
    page.locator('.btn-checkout').click()
    page.wait_for_function('!!window.submitted')
    submitted = page.evaluate('submitted')
    assert submitted['itens'] == [{'id':'curso:c1','qtd':1}]
    assert submitted['freteId'] is None
    assert not errors, errors
    browser.close()
    print('PASS: public course purchase -> cart -> digital checkout -> order request without shipping (mock Firebase).')
