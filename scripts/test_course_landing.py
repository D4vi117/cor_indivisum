"""Custom course landing: mocked catalog, cart, access and responsive smoke test."""
import re
import mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def serve(route):
        path=route.request.url.split('landing.test',1)[-1].split('?')[0]
        file=ROOT/'public'/path.lstrip('/')
        if file.is_dir():file=file/'index.html'
        if not file.is_file():route.fulfill(status=404,body='');return
        if file.suffix=='.html':
            html=re.sub(r'<script\b[^>]*>.*?</script>','',file.read_text(encoding='utf-8'),flags=re.S)
            route.fulfill(body=html,content_type='text/html')
        else:route.fulfill(body=file.read_bytes(),content_type=mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
    page.route('https://landing.test/**',serve)
    page.goto('https://landing.test/cursos/Encontrar-o-belo-em-si/')
    page.add_script_tag(content="""
      window.course={nome:'Encontrar o belo em si',slug:'Encontrar-o-belo-em-si',preco:219,capa:'',status:'publicado'};
      window.db={collection:()=>({where(){return this},get:async()=>({empty:false,docs:[{id:'c1',data:()=>course}]})})};
      window.auth={onAuthStateChanged:callback=>{window.authCallback=callback;callback(null)}};
      window.functions={httpsCallable:()=>async()=>({data:{modulos:[{titulo:'Módulo privado',aulas:[{titulo:'Aula',texto:'Conteúdo restrito'}]}]}})};
    """)
    # The real page has a buy button. Exercise the optional cart hook too.
    page.evaluate("const b=document.createElement('button');b.type='button';b.textContent='Adicionar ao carrinho';b.dataset.coursePurchase='adicionar';document.querySelector('.course-purchase-actions').append(b)")
    page.add_script_tag(path=str(ROOT/'public/src/scripts/course-landing.js'))
    page.wait_for_function("document.querySelector('[data-course-price]').textContent.includes('219')")
    page.get_by_role('button',name='Adicionar ao carrinho',exact=True).click()
    page.get_by_role('button',name='Adicionar ao carrinho',exact=True).click()
    cart=page.evaluate("JSON.parse(localStorage.getItem('carrinho_cor_indivisum'))")
    assert len(cart)==1 and cart[0]['id']=='curso:c1' and cart[0]['qtd']==1 and cart[0]['preco']==219
    for width in [375,1280]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), str(page.evaluate("[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right > innerWidth+1).map(el=>[el.tagName,el.className,Math.round(el.getBoundingClientRect().right)])"))
    page.evaluate("authCallback({uid:'u1'})")
    page.get_by_role('link',name='Acessar minhas aulas').first.wait_for()
    assert page.locator('[data-course-ownership]').is_visible()
    assert 'Você já possui este curso' in page.locator('[data-course-ownership]').inner_text()
    assert not page.get_by_role('button',name='Quero participar').is_visible()
    assert page.get_by_text('Módulo privado',exact=True).is_visible()
    page.evaluate('authCallback(null)')
    assert not page.locator('#aulas').is_visible()
    assert not page.locator('[data-course-ownership]').is_visible()
    assert page.get_by_role('button',name='Quero participar').is_visible()
    page.get_by_role('button',name='Quero participar').click()
    page.wait_for_url('**/loja/checkout/')
    assert not errors, errors
    browser.close()
    print('PASS: custom course landing, server catalog price, cart, checkout, authorized content, logout and responsive layout.')
