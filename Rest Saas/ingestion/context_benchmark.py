"""Original known-answer contracts: retrieval checks, not AI-generation results."""
import hashlib
import json


def scenarios():
    noise_js = '\n'.join(f'export function unrelated{i}() {{ return {i}; }}' for i in range(350))
    noise_py = '\n\n'.join(f'def unrelated_{i}():\n    return {i}' for i in range(350))
    cases = [
        dict(name='express-prisma-generic-large-controller', task='Schedule an interview for an applicant',
             endpoints='POST /interviews', access='Recruiters only', rules='Validate status and applicant ID',
             response_shape='Use sendSuccess', required=['function createInterview', 'function requireRecruiter', 'function validateInterview', 'function sendSuccess', 'model Interview', 'enum InterviewStatus', "'/interviews'"],
             forbidden=['unrelated349', 'payrollSecret'], files={
                 'src/controllers/index.ts': "import {sendSuccess} from '../utils/response';\nimport {validateInterview} from '../validation';\nimport {prisma} from '../db';\nexport async function createInterview(req, res) { const input = validateInterview(req.body); return sendSuccess(res, await prisma.interview.create({data: input})); }\n" + noise_js,
                 'src/routes/index.ts': "import {createInterview} from '../controllers';\nimport {requireRecruiter} from '../auth';\nrouter.post('/interviews', requireRecruiter, createInterview);",
                 'src/auth.ts': "export function requireRecruiter(req, res, next) { if (req.user.role !== 'recruiter') return res.sendStatus(403); next(); }",
                 'src/validation.ts': "export function validateInterview(data) { if (!Number.isInteger(data.applicantId)) throw Error('Invalid applicant'); return data; }",
                 'src/utils/response.ts': 'export function sendSuccess(res, data) { return res.json({data}); }',
                 'src/db.ts': "import {PrismaClient} from '@prisma/client';\nexport const prisma = new PrismaClient();",
                 'prisma/schema.prisma': 'model Interview {\n id Int @id\n applicantId Int\n status InterviewStatus\n @@map("interviews")\n}\nenum InterviewStatus {\n SCHEDULED\n CANCELLED\n}',
                 'src/payroll.ts': "export const payrollSecret = 'not-needed-for-interviews';",
             }),
        dict(name='django-decorators-and-reverse-url', task='Update invoice creation', endpoints='POST /invoices',
             access='Authenticated billing staff', rules='Use serializer validation', response_shape='Use Response',
             required=['def create_invoice', '@permission_classes', 'class InvoiceSerializer', 'class BillingStaff', 'class Invoice(', 'path("invoices"'],
             forbidden=['unrelated_349'], files={
                 'billing/views.py': 'from rest_framework.decorators import api_view, permission_classes\nfrom rest_framework.response import Response\nfrom .serializers import InvoiceSerializer\nfrom .permissions import BillingStaff\n\n@api_view(["POST"])\n@permission_classes([BillingStaff])\ndef create_invoice(request):\n    serializer = InvoiceSerializer(data=request.data)\n    serializer.is_valid(raise_exception=True)\n    return Response(serializer.save())\n\n' + noise_py,
                 'billing/urls.py': 'from django.urls import path\nfrom .views import create_invoice\nurlpatterns = [path("invoices", create_invoice)]',
                 'billing/serializers.py': 'from rest_framework import serializers\nfrom .models import Invoice\nclass InvoiceSerializer(serializers.ModelSerializer):\n    class Meta:\n        model = Invoice\n        fields = ["id", "status"]',
                 'billing/permissions.py': 'from rest_framework.permissions import BasePermission\nclass BillingStaff(BasePermission):\n    def has_permission(self, request, view):\n        return request.user.is_authenticated and request.user.is_staff',
                 'billing/models.py': 'from django.db import models\nclass Invoice(models.Model):\n    status = models.CharField(max_length=20, choices=[("draft", "Draft"), ("paid", "Paid")])',
             }),
        dict(name='react-typescript-alias-and-shared-types', task='Update the invoice editor', endpoints='InvoiceEditor component',
             access='Existing session', rules='Preserve InvoiceStatus type', response_shape='Existing component props',
             required=['function InvoiceEditor', 'function useInvoices', 'type InvoiceStatus', 'function apiGet'],
             forbidden=['unrelated349'], files={
                 'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
                 'src/screens/index.tsx': 'import {useInvoices} from "@/hooks/billing";\nimport type {InvoiceStatus} from "@/types/billing";\nexport function InvoiceEditor({status}: {status: InvoiceStatus}) { const invoices = useInvoices(); return <div>{status}: {invoices.length}</div>; }\n' + noise_js,
                 'src/hooks/billing.ts': 'import {apiGet} from "@/lib/client";\nexport function useInvoices() { return apiGet("/invoices"); }',
                 'src/types/billing.ts': 'export type InvoiceStatus = "draft" | "paid";',
                 'src/lib/client.ts': 'export function apiGet(path: string): unknown[] { return []; }',
             }),
    ]
    for case in cases:
        case['raw'] = {'codebase': {'repository': {'commit_sha': 'original-benchmark-v1'},
            'key_files_by_role': {'source': [{'path': p, 'content': c} for p, c in case.pop('files').items()]}}}
    return cases


def evaluate(builder):
    results = []
    for case in scenarios():
        request = {key: case[key] for key in ('task', 'endpoints', 'access', 'rules', 'response_shape')}
        request['max_tokens'] = 4000
        output = builder(case['raw'], request)
        text = json.dumps({'base': output['base'], 'task': output['task']}, ensure_ascii=False)
        # Only included source counts, never omission/report text containing names.
        source = '\n'.join(u['content'] for pack in (output['base'], output['task'])
                           for section in ('contracts', 'example', 'code', 'models') for u in pack.get(section, []))
        missing = [name for name in case['required'] if name not in source]
        noise = [name for name in case['forbidden'] if name in source]
        results.append(dict(name=case['name'], required=len(case['required']), missing=missing,
            required_contract_recall=(len(case['required']) - len(missing)) / len(case['required']),
            unrelated_markers_included=noise, base_tokens=output['report']['base_size'],
            task_tokens=output['report']['task_size'], handoff_tokens=output['report'].get('handoff_size'),
            within_budget=all(output['report'][k] <= 4000 for k in ('base_size', 'task_size')),
            fixture_sha256=hashlib.sha256(json.dumps(case['raw'], sort_keys=True).encode()).hexdigest()))
    return dict(format='contexa.contract-benchmark.v1', scope='Original known-answer fixtures; not public-project or generated-code success evidence.',
                cases=results, all_contracts_present=all(not r['missing'] and not r['unrelated_markers_included'] and r['within_budget'] for r in results))
