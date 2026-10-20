"""Capture the real local Contexa frontend with a synthetic demo API fixture."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
ROOT=Path(__file__).resolve().parent
BASE={"kind":"base","base_id":"orbit-8f31a2","project":"Orbit","stack":["TypeScript","Express","Prisma","PostgreSQL"],"contracts":[{"path":"src/lib/response.ts","content":"export function success(data) { return { success: true, data }; }"},{"path":"src/middleware/auth.ts","content":"export function requireAuth(req, res, next) { /* existing auth contract */ }"}]}
TASK={"kind":"task","base_id":"orbit-8f31a2","request":{"task":"Add role-based access to project endpoints","endpoints":"PATCH /projects/:id","access":"Only project owners can edit","rules":"Reuse requireAuth and the existing response helper"},"source":[{"path":"src/routes/projects.ts","content":"router.patch('/:id', requireAuth, updateProject);"},{"path":"src/controllers/projectController.ts","content":"export async function updateProject(req, res) { /* source contract */ }"}],"models":[{"name":"Project","content":"model Project {\n  id String @id\n  ownerId String\n  owner User @relation(fields: [ownerId], references: [id])\n}"}],"enums":[{"name":"Role","values":["OWNER","MEMBER"]}]}
RESULT={"base":BASE,"task":TASK,"report":{"base_size":1248,"task_size":1836,"privacy":"Database records excluded.","missing":[],"omitted":[],"included":[{"path":"src/routes/projects.ts","reason":"Task endpoint and local imports","pack":"task"},{"path":"prisma/schema.prisma","reason":"Project model, User relation and Role enum","pack":"task"}],"selection":"Task names, model references, and local import relationships."}}
def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1600,"height":1060},device_scale_factor=2)
        context.add_init_script("localStorage.setItem('cxa_token','synthetic-ad-demo');localStorage.setItem('cxa_user',JSON.stringify({username:'Demo workspace',email:'demo@example.test'}));localStorage.setItem('cxa_theme_mode','light');localStorage.setItem('cxa_sidebar_collapsed','1');")
        page=context.new_page()
        def api(route):
            url=route.request.url
            if 'context-pack' in url:res=RESULT
            elif 'connections' in url:res=[]
            elif 'installations' in url:res=[{"id":1,"account_login":"orbit-team"}]
            elif '/api/auth/me' in url:res={"username":"Demo workspace"}
            else:res={}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(res),headers={"Access-Control-Allow-Origin":"*"})
        page.route('http://localhost:8000/**',api)
        page.goto('http://127.0.0.1:5179/contexts/orbit-demo/claude-context',wait_until='networkidle')
        page.get_by_role('heading',name='Give your AI just what it needs').wait_for()
        page.evaluate('document.fonts.ready')
        page.add_style_tag(content='*{animation:none!important;transition:none!important} body{background:#fff!important}')
        page.screenshot(path=str(ROOT/'assets/product-base.png'))
        page.get_by_label('What do you want to build?',exact=True).fill('Add role-based access to project endpoints')
        page.get_by_label('Endpoints or interfaces',exact=True).fill('PATCH /projects/:id')
        page.get_by_label('Who can use it?',exact=True).fill('Only project owners can edit')
        page.get_by_label('Business rules and edge cases',exact=True).fill('Reuse requireAuth and the response helper')
        page.get_by_label('Expected response',exact=True).fill('Existing success / error response format')
        page.screenshot(path=str(ROOT/'assets/product-task-input.png'))
        page.get_by_role('button',name='Prepare context packs',exact=True).click()
        page.get_by_role('tab',name='2. Task pack',exact=True).wait_for()
        page.wait_for_timeout(300)
        page.screenshot(path=str(ROOT/'assets/product-task-result.png'))
        preview=page.get_by_label('task pack preview')
        preview.screenshot(path=str(ROOT/'assets/product-pack.png'))
        page.get_by_role('heading',name='Describe the change').locator('..').screenshot(path=str(ROOT/'assets/product-form.png'))
        print('Captured real frontend components with synthetic demo data.')
        browser.close()
if __name__=='__main__':main()
