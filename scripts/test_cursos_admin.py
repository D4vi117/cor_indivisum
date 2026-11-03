"""Browser smoke test with mocked Firebase; never writes to production.

Requires: pip install playwright, and Microsoft Edge installed.
Run from the repository root: python scripts/test_cursos_admin.py
"""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MOCK = """
crypto.randomUUID = () => 'test-' + Math.random().toString(36).slice(2);
window.testDocs = {};
window.testStamp = {isEqual: () => true};
window.auth = {onAuthStateChanged: cb => cb({uid:'admin-test'})};
window.firebase = {firestore: {FieldValue: {serverTimestamp: () => window.testStamp}}};
window.db = {
  collection: collection => ({doc: (id = 'course-test') => ({
    id, path: collection + '/' + id,
    get: async () => collection === 'usuarios'
      ? {data: () => ({role:'admin'})}
      : {exists: !!testDocs[collection+'/'+id], data: () => testDocs[collection+'/'+id]}
  })}),
  runTransaction: async cb => cb({
    get: async ref => ref.get(),
    set: (ref, value) => {testDocs[ref.path] = value;}
  })
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # A local HTTP origin allows history.replaceState and avoids external assets.
    html = (ROOT / 'public/admin/curso/index.html').read_text(encoding='utf-8')
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
    page.route('http://courses.test/**', lambda route: route.fulfill(body=html, content_type='text/html'))
    page.goto('http://courses.test/admin/curso/')
    page.wait_for_load_state('networkidle')
    for path in ['public/styles.css', 'public/admin/produto/produto.css', 'public/admin/curso/curso.css']:
        page.add_style_tag(path=str(ROOT / path))
    page.add_script_tag(content=MOCK)
    page.add_script_tag(path=str(ROOT / 'public/admin/curso/curso.js'))
    page.locator('#curso-form').wait_for(state='visible')
    page.get_by_label('Nome do curso', exact=True).fill('Curso de teste')
    page.get_by_label('Professor', exact=True).click()
    assert page.get_by_label('Slug', exact=True).input_value() == 'Curso-de-teste'
    page.get_by_label('Preço (R$)', exact=True).fill('89.90')
    page.get_by_role('button', name='+ Adicionar módulo', exact=True).click()
    assert not errors, errors
    page.get_by_label('Título do módulo', exact=True).fill('Primeiro módulo')
    page.get_by_role('button', name='+ Adicionar aula', exact=True).click()
    page.get_by_label('Título da aula', exact=True).fill('Primeira aula')
    page.get_by_label('Conteúdo em texto', exact=True).fill('<script>Não executar</script>')
    page.get_by_role('button', name='+ Adicionar aula', exact=True).click()
    page.get_by_label('Título da aula', exact=True).nth(1).fill('Segunda aula')
    page.get_by_role('button', name='Subir aula', exact=True).nth(1).click()
    assert page.get_by_label('Título da aula', exact=True).nth(0).input_value() == 'Segunda aula'
    page.get_by_role('button', name='Salvar rascunho', exact=True).click()
    page.wait_for_function("document.getElementById('feedback').textContent.includes('Rascunho salvo')")
    docs = page.evaluate('testDocs')
    assert docs['cursos/course-test']['tipo'] == 'curso'
    assert docs['cursos/course-test']['status'] == 'rascunho'
    assert docs['cursos/course-test']['preco'] == 89.9
    assert docs['cursos_conteudos/course-test']['modulos'][0]['aulas'][0]['titulo'] == 'Segunda aula'
    assert 'modulos' not in docs['cursos/course-test']
    page.locator('select[name="status"]').select_option('publicado')
    page.get_by_role('button', name='Salvar curso', exact=True).click()
    page.wait_for_function("document.getElementById('feedback').textContent.includes('disponível para compra')")
    assert page.evaluate("testDocs['cursos/course-test'].status") == 'publicado'
    for width in [375, 1280]:
        page.set_viewport_size({'width': width, 'height': 850})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}px'
    assert not errors, errors
    browser.close()
    print('PASS: course draft, module/lesson editing, reordering, private separation and responsive layout (mock Firebase).')
